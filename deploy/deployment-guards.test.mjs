import assert from 'node:assert/strict';
import process from 'node:process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat as fsStat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { exportJWK, generateKeyPair } from 'jose';

const deployDirectory = new URL('.', import.meta.url).pathname;
const validatedComposeScript = join(deployDirectory, 'validated-compose-up.sh');
const refreshJwksScript = join(deployDirectory, 'refresh-cloudflare-jwks.sh');
const secureEnvScript = join(deployDirectory, 'secure-env-file.py');
const releaseAppScript = join(deployDirectory, 'release-app.sh');
const allocateReleaseStageScript = join(deployDirectory, 'allocate-release-stage.sh');
const installAppReleaseScript = join(deployDirectory, 'install-app-release.sh');
const egressRules = join(deployDirectory, 'jarvis-command-egress.nft');
const egressService = join(deployDirectory, 'jarvis-command-egress.service');
const nftablesDropIn = join(deployDirectory, '50-jarvis-command-nftables.conf');
const appCompose = join(deployDirectory, 'app.compose.yaml');
const readProxyCompose = join(deployDirectory, 'read-proxy.compose.yaml');
const appService = join(deployDirectory, 'jarvis-command-app.service');
const readProxyService = join(deployDirectory, 'jarvis-command-read-proxy.service');
const deploymentRunbook = join(deployDirectory, '..', 'docs', 'deployment', 'v0.1.md');
const implementationPlan = join(
  deployDirectory,
  '..',
  'docs',
  'plans',
  '2026-09-03-v0.1-vertical-slice.md',
);

test('egress policy replacement and container startup fail closed as one lifecycle', async () => {
  const [
    rules,
    policyUnit,
    appComposeFile,
    readProxyComposeFile,
    appUnit,
    readProxyUnit,
    runbook,
    plan,
    secureEnvHelper,
    releaseOrchestrator,
    releaseAllocator,
    releaseInstaller,
  ] = await Promise.all([
    readFile(egressRules, 'utf8'),
    readFile(egressService, 'utf8'),
    readFile(appCompose, 'utf8'),
    readFile(readProxyCompose, 'utf8'),
    readFile(appService, 'utf8'),
    readFile(readProxyService, 'utf8'),
    readFile(deploymentRunbook, 'utf8'),
    readFile(implementationPlan, 'utf8'),
    readFile(secureEnvScript, 'utf8'),
    readFile(releaseAppScript, 'utf8'),
    readFile(allocateReleaseStageScript, 'utf8'),
    readFile(installAppReleaseScript, 'utf8'),
  ]);

  assert.match(rules, /^delete table inet jarvis_command_egress$/m);
  assert.match(secureEnvHelper, /O_NOFOLLOW/);
  assert.match(secureEnvHelper, /O_NONBLOCK/);
  assert.match(secureEnvHelper, /os\.fstat/);
  assert.match(policyUnit, /^After=.*nftables\.service$/m);
  assert.doesNotMatch(policyUnit, /^(?:Requires|BindsTo|PartOf)=nftables\.service$/m);
  assert.match(policyUnit, /^ExecStartPre=\/usr\/local\/libexec\/jarvis-command-apply-nftables egress-start$/m);
  assert.match(policyUnit, /^ExecStartPre=-\/usr\/sbin\/nft add table inet jarvis_command_egress$/m);
  assert.match(policyUnit, /^ExecStart=\/usr\/sbin\/nft -f \/etc\/jarvis-command\/jarvis-command-egress\.nft$/m);
  assert.match(policyUnit, /^ExecReload=\/usr\/sbin\/nft -f \/etc\/jarvis-command\/jarvis-command-egress\.nft$/m);
  assert.doesNotMatch(policyUnit, /^ExecStop=.*delete table/m);

  for (const composeFile of [appComposeFile, readProxyComposeFile]) {
    assert.match(composeFile, /^\s+restart: ["']no["']$/m);
    assert.doesNotMatch(composeFile, /restart:\s+unless-stopped/);
  }

  for (const unit of [appUnit, readProxyUnit]) {
    assert.match(unit, /^Requires=.*jarvis-command-egress\.service.*docker\.service$/m);
    assert.match(unit, /^After=.*jarvis-command-egress\.service.*docker\.service$/m);
    assert.match(unit, /^BindsTo=jarvis-command-egress\.service$/m);
    assert.match(unit, /^PartOf=jarvis-command-egress\.service$/m);
    assert.match(unit, /^ConditionFileIsExecutable=\/usr\/local\/libexec\/jarvis-command-validated-compose-up$/m);
    assert.doesNotMatch(unit, /^ConditionPathIsExecutable=/m);
    assert.match(unit, /^Type=notify$/m);
    assert.match(unit, /^NotifyAccess=all$/m);
    assert.match(unit, /^Restart=always$/m);
    assert.doesNotMatch(unit, /^RemainAfterExit=/m);
    assert.match(
      unit,
      /^ExecStart=\/usr\/local\/libexec\/jarvis-command-validated-compose-up .* --monitor$/m,
    );
    assert.match(unit, /^ExecStop=\/usr\/bin\/docker stop --time 20 jarvis-command-/m);
    assert.match(unit, /^ExecStopPost=-\/usr\/bin\/docker stop --time 20 jarvis-command-/m);
    assert.match(unit, /^WantedBy=multi-user\.target jarvis-command-egress\.service$/m);
  }

  assert.match(runbook, /install -m 0644 deploy\/jarvis-command-read-proxy\.service/);
  const secureHelperInstall = runbook.indexOf(
    'sudo install -m 0755 deploy/secure-env-file.py /usr/local/libexec/jarvis-command-secure-env-file',
  );
  const readProxyInstall = runbook.indexOf(
    'sudo /usr/local/libexec/jarvis-command-secure-env-file install "${READ_PROXY_ENV_SOURCE}" /etc/jarvis-command/read-proxy.env "${OPERATOR_UID}"',
  );
  const readProxyVerify = runbook.indexOf(
    'sudo test "$(sudo stat -c %u:%g:%a /etc/jarvis-command/read-proxy.env)" = 0:0:600',
  );
  const readProxyEnable = runbook.indexOf(
    'sudo systemctl enable --now jarvis-command-read-proxy.service',
  );
  assert.ok(secureHelperInstall >= 0);
  assert.ok(readProxyInstall > secureHelperInstall);
  assert.ok(readProxyVerify > readProxyInstall);
  assert.ok(readProxyEnable > readProxyVerify);
  const releaseMetadataTrap = runbook.indexOf('trap cleanup_release_env EXIT');
  const releaseMetadataStage = runbook.indexOf(
    'release_stage=$(mktemp -d /tmp/jarvis-command-read-proxy.XXXXXXXXXX)',
  );
  assert.ok(releaseMetadataTrap >= 0 && releaseMetadataTrap < releaseMetadataStage);
  assert.match(runbook, /release metadata staging cleanup failed/);
  assert.match(runbook, /\(\( cleanup_status != 0 \)\) \|\| cleanup_status=1/);
  assert.match(
    runbook,
    /jarvis-command-secure-env-file install \\\n+\s+"\$\{release_stage\}\/release\.env" \/etc\/jarvis-command\/release\.env "\$\{OPERATOR_UID\}"/,
  );
  assert.match(runbook, /sudo cmp -s "\$\{release_stage\}\/release\.env" \/etc\/jarvis-command\/release\.env/);
  assert.match(runbook, /READ_PROXY_ENV_SOURCE=\/path\/to\/completed\/read-proxy\.env/);
  assert.match(runbook, /OPERATOR_UID=\$\(id -u\)/);
  assert.doesNotMatch(runbook, /systemctl enable --now jarvis-command-app\.service/);
  assert.doesNotMatch(
    runbook,
    /sudo \/usr\/local\/libexec\/jarvis-command-validated-compose-up (?:app|read-proxy)/,
  );
  assert.match(runbook, /APP_ENV_SOURCE=\/path\/to\/completed\/app\.env/);
  assert.match(runbook, /SSH_KEY=\/home\/neal\/\.ssh\/jarvis_homelab_ed25519/);
  assert.match(
    runbook,
    /CUTOVER_STATE_DIR=\$\(deploy\/release-app\.sh \\\n\s+"\$\{APP_ENV_SOURCE\}" "\$\{SSH_TARGET\}" "\$\{SSH_KEY\}"/,
  );

  for (const script of [releaseAppScript, allocateReleaseStageScript, installAppReleaseScript]) {
    assert.notEqual((await fsStat(script)).mode & 0o111, 0, `${script} must be executable`);
  }
  for (const source of [releaseOrchestrator, releaseAllocator, releaseInstaller]) {
    assert.match(source, /^#!\/usr\/bin\/bash\nset -Eeuo pipefail\numask 077$/m);
    assert.match(source, /\(\( cleanup_status != 0 \)\) \|\| cleanup_status=1/);
    assert.match(source, /trap 'exit 129' HUP/);
    assert.match(source, /trap 'exit 130' INT/);
    assert.match(source, /trap 'exit 143' TERM/);
  }

  const localTrap = releaseOrchestrator.indexOf('trap cleanup_release_stage EXIT');
  const localStageCreation = releaseOrchestrator.indexOf(
    'local_stage=$(mktemp -d /tmp/jarvis-command-release.XXXXXXXXXX)',
  );
  assert.ok(localTrap >= 0 && localTrap < localStageCreation);
  assert.match(releaseOrchestrator, /readonly -a ssh_options=\([\s\S]*-i "\$\{ssh_key\}"[\s\S]*IdentitiesOnly=yes[\s\S]*BatchMode=yes[\s\S]*StrictHostKeyChecking=yes/);
  assert.match(releaseOrchestrator, /operator_uid=\$\(id -u\)/);
  assert.match(releaseOrchestrator, /remote_operator_uid=\$\{BASH_REMATCH\[1\]\}/);
  assert.match(releaseOrchestrator, /docker save "\$\{app_image_id\}"/);
  assert.doesNotMatch(releaseOrchestrator, /docker save "jarvis-command-app:/);
  const allocation = releaseOrchestrator.indexOf('remote_stage_record=$(');
  const transfer = releaseOrchestrator.indexOf('scp -p');
  const installation = releaseOrchestrator.indexOf('cutover_output=$(');
  assert.ok(allocation >= 0 && allocation < transfer && transfer < installation);

  const allocatorTrap = releaseAllocator.indexOf('trap cleanup_allocator_stage EXIT');
  const allocatorStageCreation = releaseAllocator.indexOf(
    'stage=$(mktemp -d /tmp/jarvis-command-release.XXXXXXXXXX)',
  );
  const allocatorRecord = releaseAllocator.indexOf("printf '%s:%s\\n'");
  const allocatorHandoff = releaseAllocator.indexOf('handed_off=1');
  assert.ok(allocatorTrap >= 0 && allocatorTrap < allocatorStageCreation);
  assert.ok(allocatorRecord >= 0 && allocatorRecord < allocatorHandoff);
  assert.match(releaseAllocator, /stage_metadata=\$\(stat -c '%u:%a' -- "\$\{stage\}"\)/);

  const installerTrap = releaseInstaller.indexOf('trap cleanup_remote_stage EXIT');
  const installerValidation = releaseInstaller.indexOf(
    '[[ ${expected_app_image} =~ ^sha256:[0-9a-f]{64}$ ]]',
  );
  assert.ok(installerTrap >= 0 && installerTrap < installerValidation);
  assert.match(releaseInstaller, /sha256sum -c SHA256SUMS/);
  assert.match(releaseInstaller, /jarvis-command-secure-env-file install/);
  assert.match(releaseInstaller, /jarvis-command-cutover-app cutover/);

  for (const fixedTemporaryPath of [
    '/tmp/jarvis-command-app.tar.gz',
    '/tmp/jarvis-command-app.tar.gz.sha256',
    '/tmp/jarvis-command-release.env',
    '/tmp/jarvis-command-app.compose.yaml',
    '/tmp/jarvis-command-app.service',
    '/tmp/jarvis-command-cutover-app',
    '/tmp/jarvis-command-app.env',
  ]) {
    const releaseSurface = [runbook, releaseOrchestrator, releaseAllocator, releaseInstaller].join('\n');
    assert.equal(releaseSurface.includes(fixedTemporaryPath), false, fixedTemporaryPath);
  }

  const appInstall = releaseInstaller.search(
    /jarvis-command-secure-env-file install \\\n\s+"\$\{stage\}\/app\.env" \/etc\/jarvis-command\/app\.env "\$\{operator_uid\}"/,
  );
  const appVerify = releaseInstaller.indexOf('[[ ${app_env_metadata} == 0:0:600 ]]');
  const appCutover = releaseInstaller.indexOf(
    'cutover_output=$(sudo -n /usr/local/libexec/jarvis-command-cutover-app cutover',
  );
  assert.ok(appInstall >= 0);
  assert.ok(appVerify > appInstall);
  assert.ok(appCutover > appVerify);
  assert.match(releaseInstaller, /install -m 0644 "\$\{stage\}\/app\.compose\.yaml" \/srv\/jarvis-command\/compose\.yaml/);
  assert.match(
    releaseInstaller,
    /install -o root -g root -m 0600 "\$\{stage\}\/release\.env" \\\n \s+\/etc\/jarvis-command\/release\.env/,
  );
  assert.match(releaseInstaller, /install -m 0755 "\$\{stage\}\/cutover-app\.sh" \/usr\/local\/libexec\/jarvis-command-cutover-app/);
  assert.match(releaseInstaller, /sudo -n cmp -s "\$\{stage\}\/app\.env" \/etc\/jarvis-command\/app\.env/);
  assert.match(releaseInstaller, /sudo -n cmp -s "\$\{stage\}\/release\.env" \/etc\/jarvis-command\/release\.env/);
  assert.match(releaseInstaller, /cmp -s "\$\{stage\}\/app\.compose\.yaml" \/srv\/jarvis-command\/compose\.yaml/);
  assert.match(releaseInstaller, /cmp -s "\$\{stage\}\/app\.service" \/etc\/systemd\/system\/jarvis-command-app\.service/);
  assert.match(releaseInstaller, /cmp -s "\$\{stage\}\/cutover-app\.sh" \/usr\/local\/libexec\/jarvis-command-cutover-app/);
  assert.match(runbook, /ssh "\$\{SSH_OPTIONS\[@\]\}" "\$\{SSH_TARGET\}" "sudo -n \/usr\/local\/libexec\/jarvis-command-cutover-app rollback \$\{cutover_state_q\}"/);
  assert.doesNotMatch(runbook, /^sudo \/usr\/local\/libexec\/jarvis-command-cutover-app rollback/m);

  assert.doesNotMatch(plan, /Generate a dedicated Ed25519 forwarding key on VM 113/);
  assert.doesNotMatch(plan, /Transfer the bearer credential directly between hosts/);
  assert.match(plan, /Hermes-host-originated reverse SSH forward/);
  assert.match(plan, /read-only proxy/);
});

test('all production systemd units verify together with their executable dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-systemd-verify-'));
  const unitDirectory = join(directory, 'etc', 'systemd', 'system');
  const unitNames = [
    'nftables.service',
    'jarvis-command-app.service',
    'jarvis-command-read-proxy.service',
    'jarvis-command-egress.service',
    'jarvis-command-jwks.service',
    'jarvis-command-jwks.timer',
    'jarvis-command-bridge.service',
  ];

  try {
    await mkdir(unitDirectory, { recursive: true });
    await Promise.all(unitNames.slice(1).map((name) => copyFile(join(deployDirectory, name), join(unitDirectory, name))));
    await writeFile(
      join(unitDirectory, 'nftables.service'),
      '[Unit]\nDescription=verification fixture nftables\nDefaultDependencies=no\n'
        + '[Service]\nType=oneshot\nExecStart=/usr/sbin/nft -f /etc/nftables.conf\n'
        + 'ExecReload=/usr/sbin/nft -f /etc/nftables.conf\n'
        + 'ExecStop=/usr/sbin/nft flush ruleset\nRemainAfterExit=yes\n',
    );
    const nftablesDropInDirectory = join(unitDirectory, 'nftables.service.d');
    await mkdir(nftablesDropInDirectory);
    await copyFile(nftablesDropIn, join(nftablesDropInDirectory, '50-jarvis-command.conf'));

    for (const name of [
      'sysinit.target',
      'basic.target',
      'multi-user.target',
      'timers.target',
      'network-pre.target',
      'network.target',
      'network-online.target',
      'shutdown.target',
    ]) {
      await writeFile(
        join(unitDirectory, name),
        `[Unit]\nDescription=verification fixture ${name}\nDefaultDependencies=no\n`,
      );
    }
    await writeFile(
      join(unitDirectory, 'docker.service'),
      '[Unit]\nDescription=verification fixture docker\nDefaultDependencies=no\n'
        + '[Service]\nType=oneshot\nExecStart=/usr/bin/true\nRemainAfterExit=yes\n',
    );

    for (const relativePath of [
      'usr/local/libexec/jarvis-command-apply-nftables',
      'usr/local/libexec/jarvis-command-validated-compose-up',
      'usr/local/libexec/jarvis-command-refresh-cloudflare-jwks',
      'usr/bin/docker',
      'usr/bin/ssh',
      'usr/bin/true',
      'usr/sbin/nft',
    ]) {
      const path = join(directory, relativePath);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, '#!/bin/sh\nexit 0\n');
      await chmod(path, 0o755);
    }

    const result = spawnSync(
      'systemd-analyze',
      [`--root=${directory}`, 'verify', ...unitNames],
      { encoding: 'utf8', timeout: 30_000 },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment rejects mutable image references before Docker is called', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const log = join(directory, 'docker.log');
    await installFakeDocker(directory, log);
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, 'JARVIS_COMMAND_APP_IMAGE=jarvis-command-app:latest\n');
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sha256/i);
    await assert.rejects(readFile(log, 'utf8'), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment starts and verifies exactly the selected image ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const imageId = `sha256:${'a'.repeat(64)}`;
    const log = join(directory, 'docker.log');
    await installFakeDocker(directory, log, imageId);
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${imageId}\n`);
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /image inspect/);
    assert.match(calls, /compose .* config --images/);
    assert.match(calls, /compose .* up -d --wait --wait-timeout 60/);
    assert.match(calls, /inspect .*jarvis-command-app/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment rejects a container that exited after Compose reported success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const imageId = `sha256:${'1'.repeat(64)}`;
    const log = join(directory, 'docker.log');
    await installFakeDocker(directory, log, imageId, { runningState: 'false' });
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${imageId}\n`);
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not running and healthy/i);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /stop jarvis-command-app/);
    assert.match(calls, /ps .*jarvis-command-app/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment rejects an unhealthy running container', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const imageId = `sha256:${'2'.repeat(64)}`;
    const log = join(directory, 'docker.log');
    await installFakeDocker(directory, log, imageId, { healthStatus: 'unhealthy' });
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${imageId}\n`);
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not running and healthy/i);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /stop jarvis-command-app/);
    assert.match(calls, /ps .*jarvis-command-app/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment notifies readiness then fails and cleans up on a healthy-to-unhealthy transition', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const imageId = `sha256:${'3'.repeat(64)}`;
    const dockerLog = join(directory, 'docker.log');
    const notifyLog = join(directory, 'notify.log');
    const sleepLog = join(directory, 'sleep.log');
    await installFakeDocker(directory, dockerLog, imageId, {
      healthStatusAfterFirstInspect: 'unhealthy',
    });
    const notify = join(directory, 'systemd-notify');
    await writeFile(notify, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(notifyLog)}\n`);
    await chmod(notify, 0o755);
    const sleep = join(directory, 'sleep');
    await writeFile(sleep, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(sleepLog)}\n`);
    await chmod(sleep, 0o755);
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${imageId}\n`);
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment, '--monitor',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        MONITOR_INTERVAL_SECONDS: '1',
        SLEEP_BIN: sleep,
        SYSTEMD_NOTIFY_BIN: notify,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /became unhealthy/i);
    assert.match(await readFile(notifyLog, 'utf8'), /--ready/);
    assert.match(await readFile(sleepLog, 'utf8'), /^1$/m);
    const dockerCalls = await readFile(dockerLog, 'utf8');
    assert.equal((dockerCalls.match(/^inspect .*jarvis-command-app$/gm) ?? []).length, 2);
    assert.match(dockerCalls, /^stop jarvis-command-app$/m);
    assert.doesNotMatch(dockerCalls, /^wait jarvis-command-app$/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment monitor fails closed on missing health, stopped state, and identity drift', async () => {
  const selectedImage = `sha256:${'6'.repeat(64)}`;
  const driftedImage = `sha256:${'7'.repeat(64)}`;
  for (const scenario of [
    {
      expected: /became unhealthy/i,
      options: { healthStatusAfterFirstInspect: 'missing' },
    },
    {
      expected: /stopped after readiness/i,
      options: { runningStateAfterFirstInspect: 'false' },
    },
    {
      expected: /identity changed after readiness/i,
      options: { runningImageAfterFirstInspect: driftedImage },
    },
  ]) {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-monitor-'));
    try {
      const log = join(directory, 'docker.log');
      await installFakeDocker(directory, log, selectedImage, scenario.options);
      const notify = join(directory, 'systemd-notify');
      const sleep = join(directory, 'sleep');
      await writeFile(notify, '#!/usr/bin/env bash\nexit 0\n');
      await writeFile(sleep, '#!/usr/bin/env bash\nexit 0\n');
      await chmod(notify, 0o755);
      await chmod(sleep, 0o755);
      const releaseEnvironment = join(directory, 'release.env');
      const composeFile = join(directory, 'compose.yaml');
      await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${selectedImage}\n`);
      await writeFile(composeFile, 'services: {}\n');

      const result = spawnSync(validatedComposeScript, [
        'app', composeFile, releaseEnvironment, '--monitor',
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          MONITOR_INTERVAL_SECONDS: '1',
          SLEEP_BIN: sleep,
          SYSTEMD_NOTIFY_BIN: notify,
        },
      });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
      assert.match(await readFile(log, 'utf8'), /^stop jarvis-command-app$/m);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('validated deployment cleans interrupted startup for both managed components', async () => {
  for (const component of [
    {
      container: 'jarvis-command-app',
      imageVariable: 'JARVIS_COMMAND_APP_IMAGE',
      name: 'app',
    },
    {
      container: 'jarvis-command-read-proxy',
      imageVariable: 'JARVIS_COMMAND_READ_PROXY_IMAGE',
      name: 'read-proxy',
    },
  ]) {
    const directory = await mkdtemp(join(tmpdir(), `jarvis-command-signal-${component.name}-`));
    let child;
    try {
      const imageHex = component.name === 'app' ? '4' : '5';
      const imageId = `sha256:${imageHex.repeat(64)}`;
      const dockerLog = join(directory, 'docker.log');
      const state = await installFakeDocker(directory, dockerLog, imageId, {
        composeUpDelaySeconds: 30,
        containerName: component.container,
      });
      const releaseEnvironment = join(directory, 'release.env');
      const composeFile = join(directory, 'compose.yaml');
      await writeFile(releaseEnvironment, `${component.imageVariable}=${imageId}\n`);
      await writeFile(composeFile, 'services: {}\n');

      child = spawn(validatedComposeScript, [component.name, composeFile, releaseEnvironment, '--monitor'], {
        detached: true,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      await waitForState(state, 'running');
      process.kill(-child.pid, 'SIGTERM');
      const result = await new Promise((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      child = undefined;

      assert.notEqual(result.code, 0, stderr);
      assert.equal(await readFile(state, 'utf8'), 'stopped\n');
      assert.match(await readFile(dockerLog, 'utf8'), new RegExp(`^stop ${component.container}$`, 'm'));
    } finally {
      if (child?.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Process already exited.
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('validated deployment stops and verifies the candidate when image inspection fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const imageId = `sha256:${'b'.repeat(64)}`;
    const log = join(directory, 'docker.log');
    await installFakeDocker(directory, log, imageId, { runningInspectStatus: 42 });
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${imageId}\n`);
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /inspection failed; candidate stopped/i);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /compose .* up -d/);
    assert.match(calls, /inspect .*jarvis-command-app/);
    assert.match(calls, /stop jarvis-command-app/);
    assert.match(calls, /ps .*jarvis-command-app/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment verifies a mismatched candidate is stopped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const imageId = `sha256:${'c'.repeat(64)}`;
    const mismatchedImageId = `sha256:${'d'.repeat(64)}`;
    const log = join(directory, 'docker.log');
    await installFakeDocker(directory, log, imageId, { runningImageId: mismatchedImageId });
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${imageId}\n`);
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /identity mismatch; candidate stopped/i);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /stop jarvis-command-app/);
    assert.match(calls, /ps .*jarvis-command-app/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment reports cleanup failure without claiming the candidate stopped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const imageId = `sha256:${'e'.repeat(64)}`;
    const log = join(directory, 'docker.log');
    await installFakeDocker(directory, log, imageId, {
      runningInspectStatus: 42,
      stopStatus: 23,
    });
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${imageId}\n`);
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cleanup could not be verified/i);
    assert.doesNotMatch(result.stderr, /candidate stopped/i);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /stop jarvis-command-app/);
    assert.match(calls, /ps .*jarvis-command-app/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validated deployment cleans up a partially started candidate when Compose fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-image-guard-'));
  try {
    const imageId = `sha256:${'f'.repeat(64)}`;
    const log = join(directory, 'docker.log');
    await installFakeDocker(directory, log, imageId, { composeUpStatus: 17 });
    const releaseEnvironment = join(directory, 'release.env');
    const composeFile = join(directory, 'compose.yaml');
    await writeFile(releaseEnvironment, `JARVIS_COMMAND_APP_IMAGE=${imageId}\n`);
    await writeFile(composeFile, 'services: {}\n');

    const result = spawnSync(validatedComposeScript, [
      'app', composeFile, releaseEnvironment,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Compose startup failed; candidate stopped/i);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /compose .* up -d/);
    assert.match(calls, /stop jarvis-command-app/);
    assert.match(calls, /ps .*jarvis-command-app/);
    assert.doesNotMatch(calls, /^inspect .*jarvis-command-app$/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JWKS refresh atomically retains the last known good key set on invalid input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-jwks-refresh-'));
  try {
    const outputDirectory = join(directory, 'output');
    const source = join(directory, 'source.json');
    const curlLog = join(directory, 'curl.log');
    await installFakeCurl(directory, source, curlLog);
    const environment = {
      ...process.env,
      CURL_BIN: join(directory, 'curl'),
    };
    const pair = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(pair.publicKey);
    const good = JSON.stringify({
      keys: [{ ...publicJwk, alg: 'RS256', kid: 'key-1', use: 'sig' }],
    });
    await writeFile(source, good);

    const first = spawnSync(refreshJwksScript, [
      'team.cloudflareaccess.com', outputDirectory,
    ], { encoding: 'utf8', env: environment });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(await readFile(join(outputDirectory, 'certs.json'), 'utf8'), `${good}\n`);
    assert.match(await readFile(curlLog, 'utf8'), /^https:\/\/team\.cloudflareaccess\.com\/cdn-cgi\/access\/certs$/m);

    const invalidPayloads = [
      JSON.stringify({ keys: [] }),
      JSON.stringify({ keys: [
        { ...publicJwk, alg: 'RS256', kid: 'duplicate', use: 'sig' },
        { ...publicJwk, alg: 'RS256', kid: 'duplicate', use: 'sig' },
      ] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', kid: 'encryption-key', use: 'enc' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', kid: 'weak-modulus', n: 'AQ', use: 'sig' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', e: 'Ag', kid: 'even-exponent', use: 'sig' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', e: 'Ax', kid: 'noncanonical-exponent', use: 'sig' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', kid: 'padded-modulus', n: `${publicJwk.n}=`, use: 'sig' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', d: 'AQ', kid: 'private-key', use: 'sig' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', key_ops: ['verify', 'verify'], kid: 'duplicate-operation', use: 'sig' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', key_ops: ['verify', 'encrypt'], kid: 'extra-operation', use: 'sig' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', ext: false, kid: 'not-extractable', use: 'sig' }] }),
      JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', ext: 'true', kid: 'invalid-ext', use: 'sig' }] }),
      `{"keys":[{"kty":"RSA","alg":"RS256","kid":"nan","use":"sig","n":"${publicJwk.n}","e":"${publicJwk.e}","unexpected":NaN}]}`,
    ];
    for (const invalidPayload of invalidPayloads) {
      await writeFile(source, invalidPayload);
      const rejected = spawnSync(refreshJwksScript, [
        'team.cloudflareaccess.com', outputDirectory,
      ], { encoding: 'utf8', env: environment });
      assert.notEqual(rejected.status, 0);
      assert.equal(await readFile(join(outputDirectory, 'certs.json'), 'utf8'), `${good}\n`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function installFakeDocker(directory, log, imageId = '', options = {}) {
  const state = join(directory, 'container.state');
  const inspectCount = join(directory, 'inspect.count');
  const runningInspectStatus = options.runningInspectStatus ?? 0;
  const runningImageId = options.runningImageId ?? imageId;
  const runningImageAfterFirstInspect = options.runningImageAfterFirstInspect ?? runningImageId;
  const runningState = options.runningState ?? 'true';
  const runningStateAfterFirstInspect = options.runningStateAfterFirstInspect ?? runningState;
  const healthStatus = options.healthStatus ?? 'healthy';
  const healthStatusAfterFirstInspect = options.healthStatusAfterFirstInspect ?? healthStatus;
  const containerExitCode = options.containerExitCode ?? 0;
  const stopStatus = options.stopStatus ?? 0;
  const composeUpStatus = options.composeUpStatus ?? 0;
  const composeUpDelaySeconds = options.composeUpDelaySeconds ?? 0;
  const containerName = options.containerName ?? 'jarvis-command-app';
  const script = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [[ "$1 $2" == "image inspect" ]]; then printf '%s\\n' ${JSON.stringify(imageId)}; fi
if [[ "$1" == "compose" && "$*" == *" config --images"* ]]; then printf '%s\\n' ${JSON.stringify(imageId)}; fi
if [[ "$1" == "compose" && "$*" == *" up -d"* ]]; then
  printf 'running\\n' > ${JSON.stringify(state)}
  if (( ${composeUpDelaySeconds} > 0 )); then /bin/sleep ${composeUpDelaySeconds}; fi
  if (( ${composeUpStatus} != 0 )); then exit ${composeUpStatus}; fi
fi
if [[ "$1" == "inspect" ]]; then
  if (( ${runningInspectStatus} != 0 )); then exit ${runningInspectStatus}; fi
  if [[ "$*" == *".State.Running"* ]]; then
    count=0
    if [[ -f ${JSON.stringify(inspectCount)} ]]; then count=$(<${JSON.stringify(inspectCount)}); fi
    count=$((count + 1))
    printf '%s\\n' "$count" > ${JSON.stringify(inspectCount)}
    current_health=${JSON.stringify(healthStatus)}
    current_image=${JSON.stringify(runningImageId)}
    current_running=${JSON.stringify(runningState)}
    if (( count > 1 )); then
      current_health=${JSON.stringify(healthStatusAfterFirstInspect)}
      current_image=${JSON.stringify(runningImageAfterFirstInspect)}
      current_running=${JSON.stringify(runningStateAfterFirstInspect)}
    fi
    printf '%s|%s|%s\\n' "$current_image" "$current_running" "$current_health"
  else
    printf '%s\\n' ${JSON.stringify(runningImageId)}
  fi
fi
if [[ "$1" == "wait" ]]; then
  printf 'stopped\\n' > ${JSON.stringify(state)}
  printf '%s\\n' ${JSON.stringify(String(containerExitCode))}
fi
if [[ "$1" == "stop" ]]; then
  if (( ${stopStatus} != 0 )); then exit ${stopStatus}; fi
  printf 'stopped\\n' > ${JSON.stringify(state)}
fi
if [[ "$1" == "ps" && -f ${JSON.stringify(state)} ]] && grep -qx running ${JSON.stringify(state)}; then
  printf '%s\\n' ${JSON.stringify(containerName)}
fi
`;
  const path = join(directory, 'docker');
  await writeFile(path, script);
  await chmod(path, 0o755);
  return state;
}

async function waitForState(path, expected) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, 'utf8')).trim() === expected) return;
    } catch {
      // The fake Compose process has not created the state file yet.
    }
    await delay(20);
  }
  throw new Error(`timed out waiting for ${path} to become ${expected}`);
}

async function installFakeCurl(directory, source, log) {
  const script = `#!/usr/bin/env bash
set -euo pipefail
output=''
url=''
while (($#)); do
  case "$1" in
    --output) output=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> ${JSON.stringify(log)}
cp ${JSON.stringify(source)} "$output"
`;
  const path = join(directory, 'curl');
  await writeFile(path, script);
  await chmod(path, 0o755);
}
