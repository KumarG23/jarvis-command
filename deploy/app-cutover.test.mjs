import assert from 'node:assert/strict';
import process from 'node:process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { URL } from 'node:url';

const deployDirectory = new URL('.', import.meta.url).pathname;
const cutoverScript = join(deployDirectory, 'cutover-app.sh');

const bootstrapImage = `sha256:${'b'.repeat(64)}`;
const appImage = `sha256:${'a'.repeat(64)}`;

async function makeFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-cutover-'));
  const bin = join(directory, 'bin');
  const backupRoot = join(directory, 'backups');
  const log = join(directory, 'commands.log');
  const bootstrapRunning = join(directory, 'bootstrap.running');
  const bootstrapRestart = join(directory, 'bootstrap.restart');
  const appRunning = join(directory, 'app.running');
  const appEnabled = join(directory, 'app.enabled');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
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
