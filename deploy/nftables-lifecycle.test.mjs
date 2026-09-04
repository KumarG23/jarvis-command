import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const deployDirectory = fileURLToPath(new URL('.', import.meta.url));
const guardScript = join(deployDirectory, 'apply-nftables-ruleset.sh');
const policyPath = join(deployDirectory, 'jarvis-command-egress.nft');
const policyUnitPath = join(deployDirectory, 'jarvis-command-egress.service');
const nftablesDropInPath = join(deployDirectory, '50-jarvis-command-nftables.conf');
const appUnitPath = join(deployDirectory, 'jarvis-command-app.service');
const readProxyUnitPath = join(deployDirectory, 'jarvis-command-read-proxy.service');
const runbookPath = join(deployDirectory, '..', 'docs', 'deployment', 'v0.1.md');

async function writeExecutable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function createFixture({ egressState = 'active', nftablesLoadState = 'loaded', nftablesState = 'inactive', nftablesEnabled = false, failApply = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-command-nftables-test-'));
  const mainConfig = join(root, 'nftables.conf');
  const fakeNft = join(root, 'nft');
  const fakeSystemctl = join(root, 'systemctl');
  const log = join(root, 'lifecycle.log');
  const state = join(root, 'egress.state');
  const nftablesStatePath = join(root, 'nftables.state');
  const nftablesLoadStatePath = join(root, 'nftables.load-state');
  const nftablesEnabledPath = join(root, 'nftables.enabled');
  const rules = join(root, 'base-rules.state');
  await writeFile(mainConfig, 'flush ruleset\ntable inet base_firewall { }\n', { mode: 0o644 });
  await writeFile(state, `${egressState}\n`);
  await writeFile(nftablesStatePath, `${nftablesState}\n`);
  await writeFile(nftablesLoadStatePath, `${nftablesLoadState}\n`);
  await writeFile(nftablesEnabledPath, `${nftablesEnabled ? 'enabled' : 'disabled'}\n`);
  await writeFile(rules, 'old-rules\n');
  await writeExecutable(fakeSystemctl, `#!/usr/bin/bash
set -Eeuo pipefail
if [[ $1 == show && $3 == --value ]]; then
  property=\${2#--property=}
  unit=$4
  if [[ $unit == jarvis-command-egress.service && $property == ActiveState ]]; then
    printf 'egress-active-state\\n' >> "$LIFECYCLE_LOG"
    cat "$EGRESS_STATE"
  elif [[ $unit == nftables.service && $property == LoadState ]]; then
    printf 'nftables-load-state\\n' >> "$LIFECYCLE_LOG"
    cat "$NFTABLES_LOAD_STATE"
  elif [[ $unit == nftables.service && $property == ActiveState ]]; then
    printf 'nftables-active-state\\n' >> "$LIFECYCLE_LOG"
    cat "$NFTABLES_STATE"
  elif [[ $unit == nftables.service && $property == UnitFileState ]]; then
    printf 'nftables-unit-file-state\\n' >> "$LIFECYCLE_LOG"
    cat "$NFTABLES_ENABLED"
  else
    exit 64
  fi
else
  exit 64
fi
`);
  await writeExecutable(fakeNft, `#!/usr/bin/bash
set -Eeuo pipefail
if [[ $1 == --check && $2 == -f ]]; then
  printf 'nft-check\\n' >> "$LIFECYCLE_LOG"
elif [[ $1 == -f ]]; then
  printf 'nft-apply\\n' >> "$LIFECYCLE_LOG"
  [[ $(<"$EGRESS_STATE") == inactive ]]
  if (( FAIL_NFT_APPLY != 0 )); then exit "$FAIL_NFT_APPLY"; fi
  printf 'new-base-rules\\n' > "$BASE_RULES_STATE"
else
  exit 64
fi
`);
  return { root, mainConfig, fakeNft, fakeSystemctl, log, state, nftablesLoadStatePath, nftablesStatePath, nftablesEnabledPath, rules, failApply };
}

function runGuard(fixture, mode) {
  return spawnSync(guardScript, [mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NFTABLES_CONFIG: fixture.mainConfig,
      NFT_BIN: fixture.fakeNft,
      SYSTEMCTL_BIN: fixture.fakeSystemctl,
      EGRESS_UNIT: 'jarvis-command-egress.service',
      EXPECTED_FILE_UID: String(process.getuid()),
      EXPECTED_FILE_GID: String(process.getgid()),
      LIFECYCLE_LOG: fixture.log,
      EGRESS_STATE: fixture.state,
      NFTABLES_STATE: fixture.nftablesStatePath,
      NFTABLES_LOAD_STATE: fixture.nftablesLoadStatePath,
      NFTABLES_ENABLED: fixture.nftablesEnabledPath,
      BASE_RULES_STATE: fixture.rules,
      FAIL_NFT_APPLY: String(fixture.failApply),
    },
  });
}

test('nftables start is refused before rules change while the Jarvis egress stack is active', async () => {
  const fixture = await createFixture();
  try {
    const result = runGuard(fixture, 'start');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /global nftables start is disabled/i);
    await assert.rejects(readFile(fixture.log, 'utf8'), /ENOENT/);
    assert.equal(await readFile(fixture.state, 'utf8'), 'active\n');
    assert.equal(await readFile(fixture.rules, 'utf8'), 'old-rules\n');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('nftables reload is refused without changing rules or workload state', async () => {
  const fixture = await createFixture();
  try {
    const result = runGuard(fixture, 'reload');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /global nftables reload is disabled/i);
    await assert.rejects(readFile(fixture.log, 'utf8'), /ENOENT/);
    assert.equal(await readFile(fixture.state, 'utf8'), 'active\n');
    assert.equal(await readFile(fixture.rules, 'utf8'), 'old-rules\n');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('nftables start is refused even after failed container stops leave the egress unit inactive', async () => {
  const fixture = await createFixture({ egressState: 'inactive' });
  try {
    const result = runGuard(fixture, 'start');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /global nftables start is disabled/i);
    await assert.rejects(readFile(fixture.log, 'utf8'), /ENOENT/);
    assert.equal(await readFile(fixture.state, 'utf8'), 'inactive\n');
    assert.equal(await readFile(fixture.rules, 'utf8'), 'old-rules\n');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('nftables stop is refused before the inherited global flush can run', async () => {
  const fixture = await createFixture({ egressState: 'inactive' });
  try {
    const result = runGuard(fixture, 'stop');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /global nftables stop is disabled/i);
    await assert.rejects(readFile(fixture.log, 'utf8'), /ENOENT/);
    assert.equal(await readFile(fixture.rules, 'utf8'), 'old-rules\n');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('failed protected-container stop attempts cannot expose a global flush or base apply', async () => {
  const fixture = await createFixture({ egressState: 'inactive' });
  const failedStop = join(fixture.root, 'failed-container-stop');
  try {
    await writeExecutable(failedStop, `#!/usr/bin/bash
printf 'container-stop:%s\\n' "$1" >> "$LIFECYCLE_LOG"
exit 1
`);

    for (const container of ['jarvis-command-app', 'jarvis-command-read-proxy']) {
      const stopResult = spawnSync(failedStop, [container], {
        encoding: 'utf8',
        env: { ...process.env, LIFECYCLE_LOG: fixture.log },
      });
      assert.equal(stopResult.status, 1);
    }

    for (const mode of ['stop', 'start']) {
      const result = runGuard(fixture, mode);
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    }

    assert.deepEqual((await readFile(fixture.log, 'utf8')).trim().split('\n'), [
      'container-stop:jarvis-command-app',
      'container-stop:jarvis-command-read-proxy',
    ]);
    assert.equal(await readFile(fixture.rules, 'utf8'), 'old-rules\n');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('egress start allows the normal dormant and disabled nftables service', async () => {
  const fixture = await createFixture({ egressState: 'inactive' });
  try {
    const result = runGuard(fixture, 'egress-start');
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual((await readFile(fixture.log, 'utf8')).trim().split('\n'), [
      'nftables-load-state',
      'nftables-active-state',
      'nftables-unit-file-state',
    ]);
    assert.equal(await readFile(fixture.rules, 'utf8'), 'old-rules\n');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('egress start allows only a stable active nftables service', async () => {
  const fixture = await createFixture({ egressState: 'inactive', nftablesState: 'active', nftablesEnabled: true });
  try {
    const result = runGuard(fixture, 'egress-start');
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual((await readFile(fixture.log, 'utf8')).trim().split('\n'), [
      'nftables-load-state',
      'nftables-active-state',
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

for (const transitionalState of ['reloading', 'activating', 'deactivating']) {
  test(`egress start refuses transitional nftables state ${transitionalState}`, async () => {
    const fixture = await createFixture({
      egressState: 'inactive',
      nftablesState: transitionalState,
      nftablesEnabled: true,
    });
    try {
      const result = runGuard(fixture, 'egress-start');
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, new RegExp(`refusing egress startup.*${transitionalState}`, 'i'));
      assert.deepEqual((await readFile(fixture.log, 'utf8')).trim().split('\n'), [
        'nftables-load-state',
        'nftables-active-state',
      ]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test('egress start refuses a failed nftables service', async () => {
  const fixture = await createFixture({ egressState: 'inactive', nftablesState: 'failed', nftablesEnabled: true });
  try {
    const result = runGuard(fixture, 'egress-start');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /refusing egress startup.*failed/i);
    assert.deepEqual((await readFile(fixture.log, 'utf8')).trim().split('\n'), [
      'nftables-load-state',
      'nftables-active-state',
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('egress start refuses an enabled but inactive nftables service', async () => {
  const fixture = await createFixture({ egressState: 'inactive', nftablesEnabled: true });
  try {
    const result = runGuard(fixture, 'egress-start');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /refusing egress startup.*enabled but inactive/i);
    assert.deepEqual((await readFile(fixture.log, 'utf8')).trim().split('\n'), [
      'nftables-load-state',
      'nftables-active-state',
      'nftables-unit-file-state',
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('global nftables start never invokes even a failing base apply', async () => {
  const fixture = await createFixture({ egressState: 'inactive', failApply: 42 });
  try {
    const result = runGuard(fixture, 'start');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    await assert.rejects(readFile(fixture.log, 'utf8'), /ENOENT/);
    assert.equal(await readFile(fixture.state, 'utf8'), 'inactive\n');
    assert.equal(await readFile(fixture.rules, 'utf8'), 'old-rules\n');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('standalone Jarvis policy survives repeated real nft loads in an isolated namespace', async (t) => {
  const capability = spawnSync('sudo', ['-n', 'unshare', '--net', '/bin/true'], { encoding: 'utf8' });
  if (capability.status !== 0) {
    t.skip('passwordless isolated network namespaces are unavailable');
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'jarvis-command-nftables-real-'));
  const policy = join(root, 'jarvis-command-egress.nft');
  try {
    await copyFile(policyPath, policy);
    await chmod(policy, 0o644);
    const result = spawnSync('sudo', [
      '-n',
      'unshare',
      '--net',
      '/usr/bin/bash',
      '-c',
      '/usr/sbin/nft add table inet jarvis_command_egress && /usr/sbin/nft -f "$1" && /usr/sbin/nft -f "$1" && /usr/sbin/nft list table inet jarvis_command_egress',
      '--',
      policy,
    ], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /table inet jarvis_command_egress/);
    assert.equal((result.stdout.match(/meta skuid 10001 reject/g) ?? []).length, 1);
    assert.equal((result.stdout.match(/meta skuid 10002 reject/g) ?? []).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('systemd lifecycle blocks every stock nftables mutation without enabling the global service', async () => {
  const [policy, policyUnit, dropIn, appUnit, readProxyUnit, runbook] = await Promise.all([
    readFile(policyPath, 'utf8'),
    readFile(policyUnitPath, 'utf8'),
    readFile(nftablesDropInPath, 'utf8'),
    readFile(appUnitPath, 'utf8'),
    readFile(readProxyUnitPath, 'utf8'),
    readFile(runbookPath, 'utf8'),
  ]);

  assert.match(policy, /^delete table inet jarvis_command_egress$/m);
  assert.doesNotMatch(dropIn, /^PropagatesStopTo=/m);
  assert.match(dropIn, /^ExecStart=$/m);
  assert.match(dropIn, /^ExecStart=\/usr\/local\/libexec\/jarvis-command-apply-nftables start$/m);
  assert.match(dropIn, /^ExecReload=$/m);
  assert.match(dropIn, /^ExecReload=\/usr\/local\/libexec\/jarvis-command-apply-nftables reload$/m);
  assert.match(dropIn, /^ExecStop=$/m);
  assert.match(dropIn, /^ExecStop=\/usr\/local\/libexec\/jarvis-command-apply-nftables stop$/m);

  assert.match(policyUnit, /^After=.*nftables\.service$/m);
  assert.doesNotMatch(policyUnit, /^(?:Requires|BindsTo|PartOf)=nftables\.service$/m);
  assert.match(policyUnit, /^ExecStartPre=\/usr\/local\/libexec\/jarvis-command-apply-nftables egress-start$/m);
  assert.match(policyUnit, /^ExecStartPre=-\/usr\/sbin\/nft add table inet jarvis_command_egress$/m);
  assert.match(policyUnit, /^ExecStart=\/usr\/sbin\/nft -f \/etc\/jarvis-command\/jarvis-command-egress\.nft$/m);
  assert.match(policyUnit, /^ExecReload=\/usr\/sbin\/nft -f \/etc\/jarvis-command\/jarvis-command-egress\.nft$/m);
  assert.match(policyUnit, /^RestrictAddressFamilies=AF_UNIX AF_NETLINK$/m);
  assert.match(policyUnit, /^WantedBy=multi-user\.target$/m);

  for (const unit of [appUnit, readProxyUnit]) {
    assert.match(unit, /^After=.*jarvis-command-egress\.service/m);
    assert.match(unit, /^BindsTo=jarvis-command-egress\.service$/m);
    assert.match(unit, /^PartOf=jarvis-command-egress\.service$/m);
  }

  assert.match(runbook, /nftables\.service\.d\/50-jarvis-command\.conf/);
  assert.match(runbook, /overrides stock start, stop, and reload.*fails/is);
  assert.doesNotMatch(runbook, /systemctl (?:start|stop|restart|reload) nftables\.service/);
  assert.match(runbook, /host-specific maintenance transaction/i);
  assert.match(runbook, /Docker and Tailscale/i);
  assert.match(runbook, /do not enable or start `nftables\.service` solely for Jarvis Command/i);
  assert.doesNotMatch(runbook, /systemctl enable(?: --now)? nftables\.service/);
});

test('egress production sandbox permits the AF_UNIX systemctl preflight', async (t) => {
  const policyUnit = await readFile(policyUnitPath, 'utf8');
  const families = policyUnit.match(/^RestrictAddressFamilies=(.+)$/m)?.[1];
  assert.equal(families, 'AF_UNIX AF_NETLINK');

  const sudo = spawnSync('sudo', ['-n', '/bin/true'], { encoding: 'utf8' });
  if (sudo.status !== 0) {
    t.skip('passwordless sudo is unavailable for the transient systemd sandbox probe');
    return;
  }

  const unitName = `jarvis-command-egress-sandbox-test-${process.pid}`;
  const result = spawnSync('sudo', [
    '-n',
    '/usr/bin/systemd-run',
    '--quiet',
    '--pipe',
    '--wait',
    '--collect',
    `--unit=${unitName}`,
    '--property=Type=oneshot',
    '--property=NoNewPrivileges=yes',
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=yes',
    '--property=PrivateTmp=yes',
    '--property=PrivateDevices=yes',
    '--property=ProtectKernelTunables=yes',
    '--property=ProtectKernelModules=yes',
    '--property=ProtectControlGroups=yes',
    `--property=RestrictAddressFamilies=${families}`,
    '--property=RestrictNamespaces=yes',
    '--property=LockPersonality=yes',
    '--property=MemoryDenyWriteExecute=yes',
    '/usr/bin/systemctl',
    'show',
    'nftables.service',
    '--property=LoadState',
    '--value',
  ], { encoding: 'utf8', timeout: 30_000 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout.trim(), 'loaded');
});
