import assert from 'node:assert/strict';
import process from 'node:process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { URL } from 'node:url';
import { recoveryFixtureScript, checkAcquisitionRace } from './recovery-fixture.mjs';
import { checkRootRefusal, rejectedRoots, checkRollbackRefusal, rollbackAttacks } from './recovery-root-cases.mjs';

const deployDirectory = new URL('.', import.meta.url).pathname;
let cutoverScript = join(deployDirectory, 'cutover-app.sh');

const bootstrapImage = `sha256:${'b'.repeat(64)}`;
const appImage = `sha256:${'a'.repeat(64)}`;

async function makeFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-cutover-'));
  cutoverScript = await recoveryFixtureScript(join(deployDirectory, 'cutover-app.sh'), directory);
  const bin = join(directory, 'bin');
  const backupRoot = join(directory, 'backups');
  const log = join(directory, 'commands.log');
  const bootstrapRunning = join(directory, 'bootstrap.running');
  const bootstrapRestart = join(directory, 'bootstrap.restart');
  const appRunning = join(directory, 'app.running');
  const appEnabled = join(directory, 'app.enabled');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
  await mkdir(backupRoot, { mode: 0o700 });
  await writeFile(bootstrapRunning, 'true\n');
  await writeFile(bootstrapRestart, 'unless-stopped\n');
  await writeFile(appRunning, 'false\n');
  await writeFile(appEnabled, 'disabled\n');

  const docker = `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> ${JSON.stringify(log)}
last=\${!#}
read_state() { tr -d '\\n' < "$1"; }
write_state() { printf '%s\\n' "$2" > "$1"; }
case "$1" in
  inspect)
    format=$3
    if [[ "$last" == jarvis-command-bootstrap ]]; then
      case "$format" in
        *'.Image'*) printf '%s\\n' ${JSON.stringify(bootstrapImage)} ;;
        *'.HostConfig.RestartPolicy.Name'*) read_state ${JSON.stringify(bootstrapRestart)} ;;
        *'.State.Running'*) read_state ${JSON.stringify(bootstrapRunning)} ;;
        *'com.docker.compose.project.config_files'*) printf '%s\\n' '/srv/jarvis-command/bootstrap/docker-compose.yml' ;;
        *'com.docker.compose.project.working_dir'*) printf '%s\\n' '/srv/jarvis-command/bootstrap' ;;
        *'com.docker.compose.project'*) printf '%s\\n' 'bootstrap' ;;
        *) exit 65 ;;
      esac
    elif [[ "$last" == jarvis-command-app ]]; then
      if [[ "$format" == *'.State.Health'* ]]; then
        printf '%s|%s|%s\\n' ${JSON.stringify(appImage)} "$(read_state ${JSON.stringify(appRunning)})" healthy
      elif [[ "$format" == *'.State.Running'* ]]; then
        read_state ${JSON.stringify(appRunning)}
      else
        printf '%s\\n' ${JSON.stringify(appImage)}
      fi
    else
      exit 1
    fi
    ;;
  update)
    policy=\${2#--restart=}
    write_state ${JSON.stringify(bootstrapRestart)} "$policy"
    ;;
  stop)
    if [[ "$last" == jarvis-command-bootstrap ]]; then
      write_state ${JSON.stringify(bootstrapRunning)} false
    else
      write_state ${JSON.stringify(appRunning)} false
    fi
    ;;
  start)
    if [[ "$last" == jarvis-command-bootstrap ]]; then
      write_state ${JSON.stringify(bootstrapRunning)} true
    else
      write_state ${JSON.stringify(appRunning)} true
    fi
    ;;
  ps)
    if [[ ${options.failRollbackInspection ? 'true' : 'false'} == true ]]; then exit 99; fi
    if [[ "$(read_state ${JSON.stringify(appRunning)})" == true ]]; then printf 'jarvis-command-app\\n'; fi
    ;;
  *) exit 64 ;;
esac
`;

  const systemctl = `#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\\n' "$*" >> ${JSON.stringify(log)}
read_state() { tr -d '\\n' < "$1"; }
write_state() { printf '%s\\n' "$2" > "$1"; }
case "$1" in
  is-enabled)
    [[ "$(read_state ${JSON.stringify(appEnabled)})" == enabled ]]
    ;;
  is-active)
    [[ "$(read_state ${JSON.stringify(appRunning)})" == true ]]
    ;;
  enable)
    write_state ${JSON.stringify(appEnabled)} enabled
    if [[ "$*" == *'--now'* ]]; then
      if [[ ${options.failAppStart ? 'true' : 'false'} == true ]]; then exit 23; fi
      write_state ${JSON.stringify(appRunning)} true
      if [[ -n ${JSON.stringify(options.signal ?? '')} ]]; then kill -s ${JSON.stringify(options.signal ?? '')} "$PPID"; fi
      if [[ ${options.replaceRoot ? 'true' : 'false'} == true ]]; then
        mv ${JSON.stringify(backupRoot)} ${JSON.stringify(backupRoot + '.retained')}
        ln -s ${JSON.stringify(join(directory, 'sentinel'))} ${JSON.stringify(backupRoot)}
      fi
    fi
    ;;
  disable)
    write_state ${JSON.stringify(appEnabled)} disabled
    if [[ "$*" == *'--now'* ]]; then write_state ${JSON.stringify(appRunning)} false; fi
    ;;
  start)
    if [[ ${options.failAppStart ? 'true' : 'false'} == true ]]; then exit 23; fi
    write_state ${JSON.stringify(appRunning)} true
    ;;
  stop)
    write_state ${JSON.stringify(appRunning)} false
    ;;
  *) exit 64 ;;
esac
`;

  const ss = `#!/usr/bin/env bash
set -euo pipefail
printf 'ss %s\\n' "$*" >> ${JSON.stringify(log)}
bootstrap=$(tr -d '\\n' < ${JSON.stringify(bootstrapRunning)})
app=$(tr -d '\\n' < ${JSON.stringify(appRunning)})
if [[ ${options.stuckPort ? 'true' : 'false'} == true || "$bootstrap" == true || "$app" == true ]]; then
  printf 'LISTEN 0 128 127.0.0.1:3000 0.0.0.0:*\\n'
fi
`;

  const curl = `#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\\n' "$*" >> ${JSON.stringify(log)}
url=\${!#}
bootstrap=$(tr -d '\\n' < ${JSON.stringify(bootstrapRunning)})
app=$(tr -d '\\n' < ${JSON.stringify(appRunning)})
if [[ "$url" == */api/health ]]; then
  [[ "$app" == true ]]
  printf '{"status":"ok"}\\n'
elif [[ "$url" == http://127.0.0.1:3000/ ]]; then
  if [[ "$app" == true ]]; then
    printf '<html><title>Jarvis Command</title><div id="root"></div></html>\\n'
  elif [[ "$bootstrap" == true ]]; then
    printf '<html><title>Bootstrap</title><p>ORIGIN_HEALTHY</p></html>\\n'
  else
    exit 7
  fi
else
  exit 22
fi
`;

  const date = `#!/usr/bin/env bash\nprintf '20260903T154500Z\\n'\n`;
  for (const [name, content] of Object.entries({ docker, systemctl, ss, curl, date })) {
    const path = join(bin, name);
    await writeFile(path, content);
    await chmod(path, 0o755);
  }

  return {
    directory,
    backupRoot,
    log,
    bootstrapRunning,
    bootstrapRestart,
    appRunning,
    appEnabled,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CUTOVER_SLEEP_SECONDS: '0' },
  };
}

test('app cutover records the bootstrap, prevents restart, proves the new runtime, and is reversible', async () => {
  const script = await readFile(cutoverScript, 'utf8');
  assert.match(script, /^trap rollback_on_error ERR INT TERM HUP$/m);

  const fixture = await makeFixture();
  try {
    const cutover = spawnSync(cutoverScript, [
      'cutover',
      'jarvis-command-bootstrap',
      'none',
      'jarvis-command-app.service',
      appImage,
      fixture.backupRoot,
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(cutover.status, 0, cutover.stderr);
    const match = /^CUTOVER_STATE_DIR=(.+)$/m.exec(cutover.stdout);
    assert.ok(match);
    const stateDirectory = match[1];
    assert.equal((await readFile(join(stateDirectory, 'bootstrap-image-id'), 'utf8')).trim(), bootstrapImage);
    assert.equal((await readFile(join(stateDirectory, 'bootstrap-restart-policy'), 'utf8')).trim(), 'unless-stopped');
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'cutover-verified');
    assert.equal((await readFile(fixture.bootstrapRunning, 'utf8')).trim(), 'false');
    assert.equal((await readFile(fixture.bootstrapRestart, 'utf8')).trim(), 'no');
    assert.equal((await readFile(fixture.appRunning, 'utf8')).trim(), 'true');

    const commands = await readFile(fixture.log, 'utf8');
    assert.ok(commands.indexOf('docker update --restart=no jarvis-command-bootstrap') < commands.indexOf('docker stop jarvis-command-bootstrap'));
    assert.match(commands, /systemctl enable --now jarvis-command-app\.service/);
    assert.match(commands, /curl .*http:\/\/127\.0\.0\.1:3000\/api\/health/);

    const rollback = spawnSync(cutoverScript, [
      'rollback', stateDirectory,
    ], { encoding: 'utf8', env: fixture.env });
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.equal((await readFile(fixture.bootstrapRunning, 'utf8')).trim(), 'true');
    assert.equal((await readFile(fixture.bootstrapRestart, 'utf8')).trim(), 'unless-stopped');
    assert.equal((await readFile(fixture.appRunning, 'utf8')).trim(), 'false');
    assert.equal((await readFile(fixture.appEnabled, 'utf8')).trim(), 'disabled');
    assert.equal((await readFile(join(stateDirectory, 'status'), 'utf8')).trim(), 'bootstrap-restored');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

for (const point of ['ancestor-validation', 'handoff', 'leaf-create']) {
  test(`cutover acquisition race ${point}`, () => checkAcquisitionRace(makeFixture,
    fixture => spawnSync(cutoverScript, ['cutover', 'jarvis-command-bootstrap', 'none',
      'jarvis-command-app.service', appImage, fixture.backupRoot],
    { encoding: 'utf8', env: fixture.env, timeout: 5000 }), point));
}

for (const kind of [...rollbackAttacks, ...['bootstrap-container', 'bootstrap-unit', 'app-unit',
  'bootstrap-image-id', 'bootstrap-restart-policy', 'bootstrap-unit-enabled',
  'bootstrap-unit-active', 'app-unit-enabled'].map(name => `missing:${name}`)]) {
  test(`cutover rollback adversarial ${kind}`, () => checkRollbackRefusal(makeFixture,
    async fixture => {
      const result = spawnSync(cutoverScript, ['cutover', 'jarvis-command-bootstrap', 'none',
        'jarvis-command-app.service', appImage, fixture.backupRoot], { encoding: 'utf8', env: fixture.env });
      assert.equal(result.status, 0, result.stderr);
      return /^CUTOVER_STATE_DIR=(.+)$/m.exec(result.stdout)[1];
    }, (fixture, state) => spawnSync(cutoverScript, ['rollback', state],
      { encoding: 'utf8', env: fixture.env, timeout: 5000 }), 'bootstrap-was-running', 'bootstrap-root.html', kind));
}

for (const kind of rejectedRoots) {
  test(`cutover refuses ${kind} root without side effects`, () => checkRootRefusal(makeFixture,
    (fixture, path) => spawnSync(cutoverScript, ['cutover', 'jarvis-command-bootstrap', 'none',
      'jarvis-command-app.service', appImage, path], { encoding: 'utf8', env: fixture.env, timeout: 5000 }), kind));
}

test('untrusted backup root is refused without chmod or consequential commands', async () => {
  const fixture = await makeFixture();
  try {
    const target = join(fixture.directory, 'sentinel');
    await mkdir(target, { mode: 0o755 });
    await writeFile(join(target, 'unrelated'), 'keep me');
    await rm(fixture.backupRoot, { recursive: true });
    await symlink(target, fixture.backupRoot);
    const before = await stat(target);
    const result = spawnSync(cutoverScript, ['cutover', 'jarvis-command-bootstrap', 'none',
      'jarvis-command-app.service', appImage, fixture.backupRoot], { encoding: 'utf8', env: fixture.env });
    assert.notEqual(result.status, 0, 'must refuse symlink backup root');
    assert.equal((await stat(target)).mode, before.mode, 'must not chmod symlink target');
    assert.equal(await readFile(join(target, 'unrelated'), 'utf8'), 'keep me');
    assert.equal(await readFile(fixture.log, 'utf8').catch(() => ''), '');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('failed app startup automatically restores the exact bootstrap lifecycle', async () => {
  const fixture = await makeFixture({ failAppStart: true });
  try {
    const result = spawnSync(cutoverScript, [
      'cutover',
      'jarvis-command-bootstrap',
      'none',
      'jarvis-command-app.service',
      appImage,
      fixture.backupRoot,
    ], { encoding: 'utf8', env: fixture.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bootstrap restored/i);
    assert.equal((await readFile(fixture.bootstrapRunning, 'utf8')).trim(), 'true');
    assert.equal((await readFile(fixture.bootstrapRestart, 'utf8')).trim(), 'unless-stopped');
    assert.equal((await readFile(fixture.appRunning, 'utf8')).trim(), 'false');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

for (const signal of ['HUP', 'INT', 'TERM']) {
  test(`cutover ${signal} restores bootstrap and retains recovery state`, async () => {
    const fixture = await makeFixture({ signal });
    try {
      const result = spawnSync(cutoverScript, ['cutover', 'jarvis-command-bootstrap', 'none',
        'jarvis-command-app.service', appImage, fixture.backupRoot], { encoding: 'utf8', env: fixture.env });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /CUTOVER_STATE_DIR=/);
      assert.equal((await readFile(fixture.bootstrapRunning, 'utf8')).trim(), 'true');
      assert.equal((await readFile(fixture.bootstrapRestart, 'utf8')).trim(), 'unless-stopped');
      assert.equal((await readFile(fixture.appRunning, 'utf8')).trim(), 'false');
      assert.equal((await readFile(join(fixture.backupRoot, 'cutover-20260903T154500Z/status'), 'utf8')).trim(), 'bootstrap-restored');
    } finally { await rm(fixture.directory, { recursive: true, force: true }); }
  });
}

test('cutover root replacement never redirects writes or emits success', async () => {
  const fixture = await makeFixture({ replaceRoot: true });
  try {
    const target = join(fixture.directory, 'sentinel');
    await mkdir(target, { mode: 0o755 });
    await writeFile(join(target, 'unrelated'), 'keep me');
    const before = await stat(target);
    const result = spawnSync(cutoverScript, ['cutover', 'jarvis-command-bootstrap', 'none',
      'jarvis-command-app.service', appImage, fixture.backupRoot], { encoding: 'utf8', env: fixture.env });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /CUTOVER_STATE_DIR=|BOOTSTRAP_RESTORED_FROM=/);
    assert.equal((await stat(target)).mode, before.mode);
    assert.equal(await readFile(join(target, 'unrelated'), 'utf8'), 'keep me');
    assert.equal((await readFile(join(fixture.backupRoot + '.retained', 'cutover-20260903T154500Z/status'), 'utf8')).trim(), 'captured');
    assert.equal((await readFile(fixture.bootstrapRunning, 'utf8')).trim(), 'true');
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test('failed rollback inspection cannot emit a restoration receipt', async () => {
  const fixture = await makeFixture({ failAppStart: true, failRollbackInspection: true });
  try {
    const result = spawnSync(cutoverScript, ['cutover', 'jarvis-command-bootstrap', 'none',
      'jarvis-command-app.service', appImage, fixture.backupRoot], { encoding: 'utf8', env: fixture.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /restoration also failed/);
    assert.doesNotMatch(result.stdout, /CUTOVER_STATE_DIR=|BOOTSTRAP_RESTORED_FROM=/);
    assert.equal((await readFile(join(fixture.backupRoot, 'cutover-20260903T154500Z/status'), 'utf8')).trim(), 'captured');
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test('a listener that survives bootstrap shutdown aborts cutover and restores bootstrap', async () => {
  const fixture = await makeFixture({ stuckPort: true });
  try {
    const result = spawnSync(cutoverScript, [
      'cutover',
      'jarvis-command-bootstrap',
      'none',
      'jarvis-command-app.service',
      appImage,
      fixture.backupRoot,
    ], { encoding: 'utf8', env: fixture.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /port 3000 remained bound/i);
    assert.equal((await readFile(fixture.bootstrapRunning, 'utf8')).trim(), 'true');
    assert.equal((await readFile(fixture.bootstrapRestart, 'utf8')).trim(), 'unless-stopped');
    assert.equal((await readFile(fixture.appRunning, 'utf8')).trim(), 'false');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
