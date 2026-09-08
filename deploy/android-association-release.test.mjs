import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';
import { recoveryFixtureScript, checkAcquisitionRace } from './recovery-fixture.mjs';
import { checkRootRefusal, rejectedRoots, checkRollbackRefusal, rollbackAttacks } from './recovery-root-cases.mjs';

const deployDirectory = new URL('.', import.meta.url).pathname;
let associationScript = join(deployDirectory, 'install-android-association.sh');
const imageId = 'sha256:2fd64f267f33feeb6a17a20e37b2a6594e3398817ba114b8ead13bc949cfe654';
const unapprovedImage = `sha256:${'f'.repeat(64)}`;
const oldCompose = 'services:\n  app:\n    image: old\n';
const newCompose = 'services:\n  app:\n    image: same\n    volumes:\n      - association:ro\n';
const assetLinks = '[{"relation":["delegate_permission/common.handle_all_urls"]}]\n';
const oldAssetLinks = '[{"relation":["delegate_permission/common.get_login_creds"]}]\n';
const attackerCompose = 'services:\n  app:\n    image: attacker\n';
const attackerAssetLinks = '[{"relation":["attacker"]}]\n';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function makeFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-association-'));
  associationScript = await recoveryFixtureScript(join(deployDirectory, 'install-android-association.sh'), directory);
  const bin = join(directory, 'bin');
  const stage = join(directory, 'stage');
  const backupRoot = join(directory, 'backups');
  const composeTarget = join(directory, 'runtime', 'compose.yaml');
  const associationTarget = join(directory, 'runtime', 'public', '.well-known', 'assetlinks.json');
  const log = join(directory, 'commands.log');
  const appRunning = join(directory, 'app.running');
  const appEnabled = join(directory, 'app.enabled');
  const runtimeImageState = join(directory, 'runtime.image');
  const runtimeHealthState = join(directory, 'runtime.health');
  const rootBodyState = join(directory, 'runtime-root.html');
  const servedAssociationOverride = join(directory, 'served-assetlinks.override');
  const failRollbackDirectoryInstall = join(directory, 'fail-rollback-directory-install');
  const failRollbackStop = join(directory, 'fail-rollback-stop');
  const ignoreRollbackStop = join(directory, 'ignore-rollback-stop');
  const ignoreRollbackRestart = join(directory, 'ignore-rollback-restart');
  const ignoreRollbackEnable = join(directory, 'ignore-rollback-enable');
  const ignoreRollbackDisable = join(directory, 'ignore-rollback-disable');
  const failRuntimeHealthRequest = join(directory, 'fail-runtime-health-request');
  const failRuntimeRootRequest = join(directory, 'fail-runtime-root-request');
  const failRuntimeAssociationRequest = join(directory, 'fail-runtime-association-request');
  const captureFailureArmed = join(directory, 'capture-failure-armed');
  const failActiveStateCapture = join(directory, 'fail-active-state-capture');
  const failUnitFileStateCapture = join(directory, 'fail-unit-file-state-capture');
  const failNextChmod = join(directory, 'fail-next-chmod');
  const failedRestart = join(directory, 'failed-restart');
  const raceMutation = join(directory, 'race-mutated');
  const attackerComposeSource = join(directory, 'attacker-compose.yaml');
  const attackerAssociationSource = join(directory, 'attacker-assetlinks.json');

  await mkdir(bin);
  await mkdir(backupRoot, { mode: 0o700 });
  await mkdir(stage, { mode: 0o700 });
  await mkdir(dirname(composeTarget), { recursive: true });
  await mkdir(dirname(associationTarget), { recursive: true });
  await writeFile(composeTarget, oldCompose, { mode: 0o644 });
  if (options.initialAssociation) {
    await writeFile(associationTarget, oldAssetLinks, { mode: 0o644 });
  }
  if (options.insecureCompose) {
    await chmod(composeTarget, 0o666);
  }
  await writeFile(join(stage, 'app.compose.yaml'), newCompose, { mode: 0o644 });
  await writeFile(join(stage, 'assetlinks.json'), assetLinks, { mode: 0o644 });
  await writeFile(
    join(stage, 'SHA256SUMS'),
    `${sha256(newCompose)}  app.compose.yaml\n${sha256(assetLinks)}  assetlinks.json\n`,
    { mode: 0o600 },
  );
  if (options.replaceStageBeforeApply) {
    await writeFile(join(stage, 'app.compose.yaml'), attackerCompose, { mode: 0o644 });
    await writeFile(join(stage, 'assetlinks.json'), attackerAssetLinks, { mode: 0o644 });
    await writeFile(
      join(stage, 'SHA256SUMS'),
      `${sha256(attackerCompose)}  app.compose.yaml\n${sha256(attackerAssetLinks)}  assetlinks.json\n`,
      { mode: 0o600 },
    );
  }
  await writeFile(appRunning, 'true\n');
  await writeFile(appEnabled, `${options.unitFileState ?? 'enabled'}\n`);
  await writeFile(runtimeImageState, `${options.runtimeImage ?? imageId}\n`);
  await writeFile(runtimeHealthState, 'healthy\n');
  await writeFile(rootBodyState, '<html><title>Jarvis Command</title></html>\n');
  await writeFile(attackerComposeSource, attackerCompose);
  await writeFile(attackerAssociationSource, attackerAssetLinks);

  const docker = `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> ${JSON.stringify(log)}
if [[ "$1" == inspect && "\${!#}" == jarvis-command-app ]]; then
  if [[ ! -e ${JSON.stringify(captureFailureArmed)} ]]; then
    : > ${JSON.stringify(captureFailureArmed)}
    if [[ ${options.failActiveStateCapture ? 'true' : 'false'} == true ]]; then
      : > ${JSON.stringify(failActiveStateCapture)}
    fi
    if [[ ${options.failUnitFileStateCapture ? 'true' : 'false'} == true ]]; then
      : > ${JSON.stringify(failUnitFileStateCapture)}
    fi
  fi
  if [[ ${options.mutateStageOnInspect ? 'true' : 'false'} == true && ! -e ${JSON.stringify(raceMutation)} ]]; then
    : > ${JSON.stringify(raceMutation)}
    cp ${JSON.stringify(attackerComposeSource)} ${JSON.stringify(join(stage, 'app.compose.yaml'))}
    cp ${JSON.stringify(attackerAssociationSource)} ${JSON.stringify(join(stage, 'assetlinks.json'))}
  fi
  printf '%s|%s|%s\\n' "$(tr -d '\\n' < ${JSON.stringify(runtimeImageState)})" "$(tr -d '\\n' < ${JSON.stringify(appRunning)})" "$(tr -d '\\n' < ${JSON.stringify(runtimeHealthState)})"
else
  exit 64
fi
`;

  const systemctl = `#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\\n' "$*" >> ${JSON.stringify(log)}
read_state() { tr -d '\\n' < "$1"; }
write_state() { printf '%s\\n' "$2" > "$1"; }
case "$1" in
  is-active)
    if [[ -e ${JSON.stringify(failActiveStateCapture)} ]]; then
      rm -f -- ${JSON.stringify(failActiveStateCapture)}
      exit 99
    fi
    [[ "$(read_state ${JSON.stringify(appRunning)})" == true ]]
    ;;
  is-enabled)
    if [[ -e ${JSON.stringify(failUnitFileStateCapture)} ]]; then
      rm -f -- ${JSON.stringify(failUnitFileStateCapture)}
      exit 99
    fi
    [[ "$(read_state ${JSON.stringify(appEnabled)})" == enabled ]]
    ;;
  daemon-reload) ;;
  restart)
    if [[ -n ${JSON.stringify(options.signal ?? '')} && ! -e ${JSON.stringify(failedRestart)} ]]; then
      : > ${JSON.stringify(failedRestart)}
      kill -s ${JSON.stringify(options.signal ?? '')} "$PPID"
    fi
    if [[ ${options.replaceRoot ? 'true' : 'false'} == true && ! -e ${JSON.stringify(failedRestart)} ]]; then
      : > ${JSON.stringify(failedRestart)}
      mv ${JSON.stringify(backupRoot)} ${JSON.stringify(backupRoot + '.retained')}
      ln -s ${JSON.stringify(join(directory, 'sentinel'))} ${JSON.stringify(backupRoot)}
    fi
    if [[ ${options.failFirstRestart ? 'true' : 'false'} == true && ! -e ${JSON.stringify(failedRestart)} ]]; then
      : > ${JSON.stringify(failedRestart)}
      write_state ${JSON.stringify(appRunning)} false
      if [[ ${options.armDirectoryFailureOnFailedRestart ? 'true' : 'false'} == true ]]; then
        : > ${JSON.stringify(failRollbackDirectoryInstall)}
      fi
      if [[ ${options.corruptStatusOnFailedRestart ? 'true' : 'false'} == true ]]; then
        status_path=${JSON.stringify(join(backupRoot, 'association-20260904T160000Z', 'status'))}
        rm -f -- "$status_path"
        mkdir -- "$status_path"
      fi
      exit 23
    fi
    if [[ ! -e ${JSON.stringify(ignoreRollbackRestart)} ]]; then
      write_state ${JSON.stringify(appRunning)} true
    fi
    ;;
  start) write_state ${JSON.stringify(appRunning)} true ;;
  stop)
    if [[ -e ${JSON.stringify(failRollbackStop)} ]]; then exit 99; fi
    if [[ ! -e ${JSON.stringify(ignoreRollbackStop)} ]]; then
      write_state ${JSON.stringify(appRunning)} false
    fi
    ;;
  show)
    case "$*" in
      *ActiveState*)
        if [[ -e ${JSON.stringify(failActiveStateCapture)} ]]; then
          rm -f -- ${JSON.stringify(failActiveStateCapture)}
          exit 99
        fi
        if [[ -n ${JSON.stringify(options.activeStateCaptureValue ?? '')} ]]; then
          printf '%s\\n' ${JSON.stringify(options.activeStateCaptureValue ?? '')}
        elif [[ "$(read_state ${JSON.stringify(appRunning)})" == true ]]; then
          printf 'active\\n'
        else
          printf 'inactive\\n'
        fi
        ;;
      *UnitFileState*)
        if [[ -e ${JSON.stringify(failUnitFileStateCapture)} ]]; then
          rm -f -- ${JSON.stringify(failUnitFileStateCapture)}
          exit 99
        fi
        read_state ${JSON.stringify(appEnabled)}
        ;;
      *) exit 64 ;;
    esac
    ;;
  enable)
    if [[ ! -e ${JSON.stringify(ignoreRollbackEnable)} ]]; then
      write_state ${JSON.stringify(appEnabled)} enabled
    fi
    ;;
  disable)
    if [[ ! -e ${JSON.stringify(ignoreRollbackDisable)} ]]; then
      write_state ${JSON.stringify(appEnabled)} disabled
    fi
    ;;
  *) exit 64 ;;
esac
`;

  const curl = `#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\\n' "$*" >> ${JSON.stringify(log)}
[[ "$(tr -d '\\n' < ${JSON.stringify(appRunning)})" == true ]]
url=\${!#}
case "$url" in
  http://127.0.0.1:3000/api/health)
    [[ ! -e ${JSON.stringify(failRuntimeHealthRequest)} ]] || exit 99
    printf '{"status":"ok"}\\n'
    ;;
  http://127.0.0.1:3000/)
    [[ ! -e ${JSON.stringify(failRuntimeRootRequest)} ]] || exit 99
    cat ${JSON.stringify(rootBodyState)}
    ;;
  http://127.0.0.1:3000/.well-known/assetlinks.json)
    [[ ! -e ${JSON.stringify(failRuntimeAssociationRequest)} ]] || exit 99
    if [[ -f ${JSON.stringify(servedAssociationOverride)} ]]; then
      cat ${JSON.stringify(servedAssociationOverride)}
    else
      cat ${JSON.stringify(associationTarget)}
    fi
    ;;
  *) exit 22 ;;
esac
`;

  const date = '#!/usr/bin/env bash\nprintf \'20260904T160000Z\\n\'\n';
  const install = `#!/usr/bin/env bash
set -euo pipefail
printf 'install %s\\n' "$*" >> ${JSON.stringify(log)}
if [[ -e ${JSON.stringify(failRollbackDirectoryInstall)} && " $* " == *' -d '* ]]; then
  exit 99
fi
exec /usr/bin/install "$@"
`;
  const chmodCommand = `#!/usr/bin/env bash
set -euo pipefail
if [[ -e ${JSON.stringify(failNextChmod)} ]]; then
  rm -f -- ${JSON.stringify(failNextChmod)}
  exit 99
fi
exec /usr/bin/chmod "$@"
`;
  for (const [name, content] of Object.entries({
    docker,
    systemctl,
    curl,
    date,
    install,
    chmod: chmodCommand,
  })) {
    const path = join(bin, name);
    await writeFile(path, content);
    await chmod(path, 0o755);
  }

  return {
    directory,
    stage,
    backupRoot,
    composeTarget,
    associationTarget,
    appRunning,
    appEnabled,
    runtimeImageState,
    runtimeHealthState,
    rootBodyState,
    servedAssociationOverride,
    failRollbackDirectoryInstall,
    failRollbackStop,
    ignoreRollbackStop,
    ignoreRollbackRestart,
    ignoreRollbackEnable,
    ignoreRollbackDisable,
    failRuntimeHealthRequest,
    failRuntimeRootRequest,
    failRuntimeAssociationRequest,
    failActiveStateCapture,
    failUnitFileStateCapture,
    failNextChmod,
    log,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      APP_COMPOSE_PATH: composeTarget,
      ASSOCIATION_PATH: associationTarget,
      ASSOCIATION_SLEEP_SECONDS: '0',
    },
  };
}

async function applyAssociation(fixture) {
  const result = spawnSync(associationScript, [
    'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
    sha256(newCompose), sha256(assetLinks),
  ], { encoding: 'utf8', env: fixture.env });
  assert.equal(result.status, 0, result.stderr);
  const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(result.stdout);
  assert.ok(match);
  return match[1];
}

async function assertRollbackRejected(fixture, stateDirectory, errorPattern) {
  const result = spawnSync(associationScript, ['rollback', stateDirectory], {
    encoding: 'utf8', env: fixture.env,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, errorPattern);
  assert.doesNotMatch(result.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
  assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
}

for (const point of ['ancestor-validation', 'handoff', 'leaf-create']) {
  test(`association acquisition race ${point}`, () => checkAcquisitionRace(makeFixture,
    fixture => spawnSync(associationScript, ['apply', fixture.stage, String(process.getuid()),
      imageId, fixture.backupRoot, sha256(newCompose), sha256(assetLinks)],
    { encoding: 'utf8', env: fixture.env, timeout: 5000 }), point));
}

for (const kind of [...rollbackAttacks, ...['previous-app-image-id', 'previous-unit-enabled',
  'previous-association-existed', 'previous-compose.yaml'].map(name => `missing:${name}`)]) {
  test(`association rollback adversarial ${kind}`, () => checkRollbackRefusal(makeFixture,
    applyAssociation, (fixture, state) => spawnSync(associationScript, ['rollback', state],
      { encoding: 'utf8', env: fixture.env, timeout: 5000 }), 'previous-unit-active', 'previous-assetlinks.json', kind));
}

for (const kind of rejectedRoots) {
  test(`association refuses ${kind} root without side effects`, () => checkRootRefusal(makeFixture,
    (fixture, path) => spawnSync(associationScript, ['apply', fixture.stage, String(process.getuid()),
      imageId, path, sha256(newCompose), sha256(assetLinks)], { encoding: 'utf8', env: fixture.env, timeout: 5000 }), kind));
}

test('standalone packaged association executes over stdin without a sibling helper', async () => {
  const fixture = await makeFixture();
  try {
    const result = spawnSync('/bin/bash', ['-s', '--', 'apply', fixture.stage, String(process.getuid()),
      imageId, fixture.backupRoot, sha256(newCompose), sha256(assetLinks)], {
      encoding: 'utf8', env: fixture.env, input: await readFile(associationScript, 'utf8'), timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(fixture.composeTarget, 'utf8'), newCompose);
    assert.equal(await readFile(fixture.associationTarget, 'utf8'), assetLinks);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test('untrusted backup root is refused without chmod or consequential commands', async () => {
  const fixture = await makeFixture();
  try {
    const target = join(fixture.directory, 'sentinel');
    await mkdir(target, { mode: 0o755 });
    await writeFile(join(target, 'unrelated'), 'keep me');
    await rm(fixture.backupRoot, { recursive: true });
    await symlink(target, fixture.backupRoot);
    const before = await stat(target);
    const result = spawnSync(associationScript, ['apply', fixture.stage, String(process.getuid()),
      imageId, fixture.backupRoot, sha256(newCompose), sha256(assetLinks)], { encoding: 'utf8', env: fixture.env });
    assert.notEqual(result.status, 0);
    assert.equal((await stat(target)).mode, before.mode, 'must not chmod symlink target');
    assert.equal(await readFile(join(target, 'unrelated'), 'utf8'), 'keep me');
    assert.equal(await readFile(fixture.log, 'utf8').catch(() => ''), '');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('privileged association installer rejects a matching healthy but unapproved image', async () => {
  const fixture = await makeFixture({ runtimeImage: unapprovedImage });
  try {
    const result = spawnSync(associationScript, [
      'apply',
      fixture.stage,
      String(process.getuid()),
      unapprovedImage,
      fixture.backupRoot,
      sha256(newCompose),
      sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /approved production image/i);
    assert.equal(await exists(fixture.log), false, 'image pin must reject before runtime inspection');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('privileged association installer rejects a substituted stage with a matching substituted manifest', async () => {
  const fixture = await makeFixture({ replaceStageBeforeApply: true });
  try {
    const result = spawnSync(associationScript, [
      'apply',
      fixture.stage,
      String(process.getuid()),
      imageId,
      fixture.backupRoot,
      sha256(newCompose),
      sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match reviewed checksum/i);
    assert.equal(await exists(fixture.log), false, 'substituted bytes must be rejected before runtime inspection');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('association release rejects an ActiveState capture transport failure', async () => {
  const fixture = await makeFixture({ failActiveStateCapture: true });
  try {
    const result = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /ASSOCIATION_STATE_DIR=/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('association release rejects a UnitFileState capture transport failure', async () => {
  const fixture = await makeFixture({ failUnitFileStateCapture: true });
  try {
    const result = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /ASSOCIATION_STATE_DIR=/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('association release rejects a transient ActiveState capture', async () => {
  const fixture = await makeFixture({ activeStateCaptureValue: 'activating' });
  try {
    const result = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ActiveState changed/i);
    assert.doesNotMatch(result.stdout, /ASSOCIATION_STATE_DIR=/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('association release rejects an unsupported UnitFileState capture', async () => {
  const fixture = await makeFixture({ unitFileState: 'static' });
  try {
    const result = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UnitFileState is unsupported/i);
    assert.doesNotMatch(result.stdout, /ASSOCIATION_STATE_DIR=/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('association release installs reviewed bytes when the operator stage changes after validation', async () => {
  const fixture = await makeFixture({ mutateStageOnInspect: true });
  try {
    const result = spawnSync(associationScript, [
      'apply',
      fixture.stage,
      String(process.getuid()),
      imageId,
      fixture.backupRoot,
      sha256(newCompose),
      sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(fixture.stage, 'app.compose.yaml'), 'utf8'), attackerCompose);
    assert.equal(await readFile(join(fixture.stage, 'assetlinks.json'), 'utf8'), attackerAssetLinks);
    assert.equal(await readFile(fixture.composeTarget, 'utf8'), newCompose);
    assert.equal(await readFile(fixture.associationTarget, 'utf8'), assetLinks);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('association release keeps the approved image, proves exact bytes, and rolls back explicitly', async () => {
  const fixture = await makeFixture();
  try {
    const apply = spawnSync(associationScript, [
      'apply',
      fixture.stage,
      String(process.getuid()),
      imageId,
      fixture.backupRoot,
      sha256(newCompose),
      sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(apply.status, 0, apply.stderr);
    const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(apply.stdout);
    assert.ok(match);
    const stateDirectory = match[1];

    assert.equal(await readFile(fixture.composeTarget, 'utf8'), newCompose);
    assert.equal(await readFile(fixture.associationTarget, 'utf8'), assetLinks);
    assert.equal((await readFile(join(stateDirectory, 'previous-app-image-id'), 'utf8')).trim(), imageId);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');

    const commands = await readFile(fixture.log, 'utf8');
    assert.match(commands, /systemctl restart jarvis-command-app\.service/);
    assert.match(commands, /curl .*\.well-known\/assetlinks\.json/);

    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8',
      env: fixture.env,
    });
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.equal(await readFile(fixture.composeTarget, 'utf8'), oldCompose);
    assert.equal(await exists(fixture.associationTarget), false);
    assert.equal((await readFile(fixture.appRunning, 'utf8')).trim(), 'true');
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-rolled-back');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('automatic rollback fails closed when runtime target directory preparation fails', async () => {
  const fixture = await makeFixture({
    failFirstRestart: true,
    armDirectoryFailureOnFailedRestart: true,
  });
  try {
    const result = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    const stateDirectory = join(fixture.backupRoot, 'association-20260904T160000Z');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /restoration also failed/i);
    assert.doesNotMatch(result.stderr, /previous association release restored/i);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'captured');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when restoring an inactive unit cannot stop it', async () => {
  const fixture = await makeFixture();
  try {
    const apply = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(apply.status, 0, apply.stderr);
    const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(apply.stdout);
    assert.ok(match);
    const stateDirectory = match[1];

    await writeFile(join(stateDirectory, 'previous-unit-active'), 'false\n');
    await writeFile(fixture.failRollbackStop, 'armed\n');
    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8', env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback verifies that a previously inactive unit is actually inactive', async () => {
  const fixture = await makeFixture();
  try {
    const apply = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(apply.status, 0, apply.stderr);
    const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(apply.stdout);
    assert.ok(match);
    const stateDirectory = match[1];

    await writeFile(join(stateDirectory, 'previous-unit-active'), 'false\n');
    await writeFile(fixture.ignoreRollbackStop, 'armed\n');
    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8', env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the restarted unit remains inactive', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(fixture.appRunning, 'false\n');
    await writeFile(fixture.ignoreRollbackRestart, 'armed\n');

    await assertRollbackRejected(fixture, stateDirectory, /application unit is not active/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the restarted container has no health status', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(fixture.runtimeHealthState, 'missing\n');

    await assertRollbackRejected(fixture, stateDirectory, /container is not healthy/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the health endpoint transport fails', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(fixture.failRuntimeHealthRequest, 'armed\n');

    await assertRollbackRejected(fixture, stateDirectory, /health endpoint failed/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the root endpoint transport fails', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(fixture.failRuntimeRootRequest, 'armed\n');

    await assertRollbackRejected(fixture, stateDirectory, /application root failed/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the association endpoint transport fails', async () => {
  const fixture = await makeFixture({ initialAssociation: true });
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(fixture.failRuntimeAssociationRequest, 'armed\n');

    await assertRollbackRejected(fixture, stateDirectory, /Digital Asset Links endpoint failed/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback verifies that an enabled unit is restored as enabled', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(fixture.appEnabled, 'disabled\n');
    await writeFile(fixture.ignoreRollbackEnable, 'armed\n');

    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8', env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback verifies that a disabled unit is restored as disabled', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(join(stateDirectory, 'previous-unit-enabled'), 'false\n');
    await writeFile(fixture.appEnabled, 'enabled\n');
    await writeFile(fixture.ignoreRollbackDisable, 'armed\n');

    await assertRollbackRejected(fixture, stateDirectory, /UnitFileState was not restored/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when UnitFileState read-back fails', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(fixture.failUnitFileStateCapture, 'armed\n');

    await assertRollbackRejected(fixture, stateDirectory, /UnitFileState could not be read after rollback/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when inactive-state read-back fails', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(join(stateDirectory, 'previous-unit-active'), 'false\n');
    await writeFile(fixture.failActiveStateCapture, 'armed\n');

    await assertRollbackRejected(fixture, stateDirectory, /state could not be read after rollback stop/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the restored runtime has the wrong image', async () => {
  const fixture = await makeFixture();
  try {
    const apply = spawnSync(associationScript, [
      'apply',
      fixture.stage,
      String(process.getuid()),
      imageId,
      fixture.backupRoot,
      sha256(newCompose),
      sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(apply.status, 0, apply.stderr);
    const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(apply.stdout);
    assert.ok(match);
    const stateDirectory = match[1];

    await writeFile(fixture.runtimeImageState, `${unapprovedImage}\n`);
    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8',
      env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.match(rollback.stderr, /image identity changed/i);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the restored runtime is unhealthy', async () => {
  const fixture = await makeFixture();
  try {
    const apply = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(apply.status, 0, apply.stderr);
    const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(apply.stdout);
    assert.ok(match);
    const stateDirectory = match[1];

    await writeFile(fixture.runtimeHealthState, 'unhealthy\n');
    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8', env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.match(rollback.stderr, /container is not healthy/i);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the restored root loses product identity', async () => {
  const fixture = await makeFixture();
  try {
    const apply = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(apply.status, 0, apply.stderr);
    const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(apply.stdout);
    assert.ok(match);
    const stateDirectory = match[1];

    await writeFile(fixture.rootBodyState, '<html><title>Unexpected application</title></html>\n');
    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8', env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.match(rollback.stderr, /root lost reviewed product identity/i);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback fails closed when the restored association bytes do not match', async () => {
  const fixture = await makeFixture({ initialAssociation: true });
  try {
    const apply = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(apply.status, 0, apply.stderr);
    const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(apply.stdout);
    assert.ok(match);
    const stateDirectory = match[1];

    await writeFile(fixture.servedAssociationOverride, attackerAssetLinks);
    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8', env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.match(rollback.stderr, /served Digital Asset Links bytes differ/i);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal(await readFile(fixture.associationTarget, 'utf8'), oldAssetLinks);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback rejects invalid rollback-state file metadata', async () => {
  const fixture = await makeFixture();
  try {
    const apply = spawnSync(associationScript, [
      'apply',
      fixture.stage,
      String(process.getuid()),
      imageId,
      fixture.backupRoot,
      sha256(newCompose),
      sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(apply.status, 0, apply.stderr);
    const match = /^ASSOCIATION_STATE_DIR=(.+)$/m.exec(apply.stdout);
    assert.ok(match);
    const stateDirectory = match[1];

    await chmod(join(stateDirectory, 'previous-app-image-id'), 0o644);
    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8',
      env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.match(rollback.stderr, /state metadata is invalid for previous-app-image-id/i);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('explicit rollback preserves the prior status when status metadata publication fails', async () => {
  const fixture = await makeFixture();
  try {
    const stateDirectory = await applyAssociation(fixture);
    await writeFile(fixture.failNextChmod, 'armed\n');

    const rollback = spawnSync(associationScript, ['rollback', stateDirectory], {
      encoding: 'utf8', env: fixture.env,
    });

    assert.notEqual(rollback.status, 0);
    assert.doesNotMatch(rollback.stdout, /ASSOCIATION_ROLLED_BACK_FROM=/);
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'association-verified');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('automatic rollback reports restoration failure when its status receipt cannot be written', async () => {
  const fixture = await makeFixture({
    failFirstRestart: true,
    corruptStatusOnFailedRestart: true,
  });
  try {
    const result = spawnSync(associationScript, [
      'apply', fixture.stage, String(process.getuid()), imageId, fixture.backupRoot,
      sha256(newCompose), sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /restoration also failed/i);
    assert.doesNotMatch(result.stderr, /previous association release restored/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('failed association restart automatically restores the previous compose and runtime', async () => {
  const fixture = await makeFixture({ failFirstRestart: true });
  try {
    const result = spawnSync(associationScript, [
      'apply',
      fixture.stage,
      String(process.getuid()),
      imageId,
      fixture.backupRoot,
      sha256(newCompose),
      sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /previous association release restored/i);
    assert.equal(await readFile(fixture.composeTarget, 'utf8'), oldCompose);
    assert.equal(await exists(fixture.associationTarget), false);
    assert.equal((await readFile(fixture.appRunning, 'utf8')).trim(), 'true');

    const states = await import('node:fs/promises').then(({ readdir }) => readdir(fixture.backupRoot));
    assert.equal(states.length, 1);
    assert.equal(
      (await readFile(join(fixture.backupRoot, states[0], 'status'), 'utf8')).trim(),
      'association-restored-after-failure',
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

for (const failure of ['persistent', 'one-shot']) {
test(`installer-local snapshot cleanup ${failure} failure restores rollout and retains honest recovery metadata`, async () => {
  const fixture = await makeFixture({ initialAssociation: true });
  let snapshot;
  try {
    const cleanupLog = join(fixture.directory, 'cleanup-path');
    await writeFile(join(fixture.directory, 'bin/rm'), `#!/bin/bash
if [[ \${!#} == /tmp/jarvis-command-association-root.* && ( ${JSON.stringify(failure)} == persistent || ! -e ${JSON.stringify(cleanupLog)} ) ]]; then
  printf '%s\\n' "\${!#}" > ${JSON.stringify(cleanupLog)}
  exit 97
fi
exec /usr/bin/rm "$@"
`, { mode: 0o700 });
    const result = spawnSync(associationScript, ['apply', fixture.stage, String(process.getuid()),
      imageId, fixture.backupRoot, sha256(newCompose), sha256(assetLinks)], { encoding: 'utf8', env: fixture.env });
    snapshot = (await readFile(cleanupLog, 'utf8')).trim();
    assert.match(snapshot, /^\/tmp\/jarvis-command-association-root\.[A-Za-z0-9_]+$/);
    assert.equal(await exists(snapshot), true, 'cleanup failure must retain the snapshot, not retry deletion on EXIT');
    assert.equal((await stat(snapshot)).uid, process.getuid());
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /ASSOCIATION_STATE_DIR=/);
    assert.match(result.stderr, /snapshot cleanup failed/);
    assert.equal(await readFile(join(snapshot, 'app.compose.yaml'), 'utf8'), newCompose);
    assert.equal(await readFile(join(snapshot, 'assetlinks.json'), 'utf8'), assetLinks);
    assert.equal(await readFile(fixture.composeTarget, 'utf8'), oldCompose, 'must not silently abandon active rollout');
    assert.equal(await readFile(fixture.associationTarget, 'utf8'), oldAssetLinks);
    const state = join(fixture.backupRoot, 'association-20260904T160000Z');
    assert.equal(await readFile(join(state, 'status'), 'utf8'), 'association-restored-after-failure\n');
    assert.equal(await readFile(join(state, 'snapshot-cleanup-status'), 'utf8'), 'failed\n');
    assert.equal(await readFile(join(state, 'retained-snapshot'), 'utf8'), snapshot + '\n');
    assert.equal(await readFile(join(state, 'previous-compose.yaml'), 'utf8'), oldCompose);
    assert.equal((await stat(join(state, 'snapshot-cleanup-status'))).mode & 0o777, 0o600);
  } finally {
    if (snapshot) await rm(snapshot, { recursive: true, force: true });
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
}

for (const signal of ['HUP', 'INT', 'TERM']) {
  test(`association ${signal} restores prior bytes and cleans its snapshot`, async () => {
    const fixture = await makeFixture({ signal });
    const before = (await readdir('/tmp')).filter(name => name.startsWith('jarvis-command-association-root.'));
    try {
      const result = spawnSync(associationScript, ['apply', fixture.stage, String(process.getuid()),
        imageId, fixture.backupRoot, sha256(newCompose), sha256(assetLinks)], { encoding: 'utf8', env: fixture.env });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /ASSOCIATION_STATE_DIR=/);
      assert.equal(await readFile(fixture.composeTarget, 'utf8'), oldCompose);
      assert.equal(await exists(fixture.associationTarget), false);
      assert.equal((await readFile(fixture.appRunning, 'utf8')).trim(), 'true');
      assert.equal((await readFile(join(fixture.backupRoot, 'association-20260904T160000Z/status'), 'utf8')).trim(), 'association-restored-after-failure');
      assert.deepEqual((await readdir('/tmp')).filter(name => name.startsWith('jarvis-command-association-root.')), before);
    } finally { await rm(fixture.directory, { recursive: true, force: true }); }
  });
}

test('association root replacement retains original state without redirecting writes', async () => {
  const fixture = await makeFixture({ replaceRoot: true });
  try {
    const target = join(fixture.directory, 'sentinel');
    await mkdir(target, { mode: 0o755 });
    await writeFile(join(target, 'unrelated'), 'keep me');
    const before = await stat(target);
    const result = spawnSync(associationScript, ['apply', fixture.stage, String(process.getuid()),
      imageId, fixture.backupRoot, sha256(newCompose), sha256(assetLinks)], { encoding: 'utf8', env: fixture.env });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /ASSOCIATION_STATE_DIR=/);
    assert.equal((await stat(target)).mode, before.mode);
    assert.deepEqual(await readdir(target), ['unrelated']);
    assert.equal(await readFile(join(target, 'unrelated'), 'utf8'), 'keep me');
    assert.equal((await readFile(join(fixture.backupRoot + '.retained', 'association-20260904T160000Z/status'), 'utf8')).trim(), 'captured');
    assert.equal(await readFile(fixture.composeTarget, 'utf8'), oldCompose);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test('rollback refuses trailing newline forgery before consequential commands', async () => {
  const fixture = await makeFixture();
  try {
    const state = await applyAssociation(fixture);
    await writeFile(join(state, 'previous-unit-active'), 'true\n\n');
    await writeFile(fixture.log, '');
    const result = spawnSync(associationScript, ['rollback', state], { encoding: 'utf8', env: fixture.env });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(fixture.log, 'utf8'), '');
    assert.equal((await readFile(join(state, 'status'), 'utf8')).trim(), 'association-verified');
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test('association release rejects a group-writable active compose before capture', async () => {
  const fixture = await makeFixture({ insecureCompose: true });
  try {
    const result = spawnSync(associationScript, [
      'apply',
      fixture.stage,
      String(process.getuid()),
      imageId,
      fixture.backupRoot,
      sha256(newCompose),
      sha256(assetLinks),
    ], { encoding: 'utf8', env: fixture.env });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /active compose metadata is invalid/i);
    assert.equal(await readFile(fixture.composeTarget, 'utf8'), oldCompose);
    assert.equal(await exists(fixture.associationTarget), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
