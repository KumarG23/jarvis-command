import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./validated-compose-up.sh', import.meta.url));
const image = `sha256:${'a'.repeat(64)}`;
const other = `sha256:${'b'.repeat(64)}`;
const variable = 'JARVIS_COMMAND_COMMAND_PROXY_IMAGE';

// Every Docker invocation resolves to this private executable, never the daemon.
async function runScenario(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jc-command-lifecycle-'));
  try {
    const executable = async (name, body) => writeFile(join(root, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o700 });
    await writeFile(join(root, 'release.env'), options.release ?? `${variable}=${image}\n`);
    await writeFile(join(root, 'compose.yaml'), 'services: {}\n');
    await executable('docker', `
printf '%s\\n' "$*" >> "$FIXTURE/log"
case "$1" in
 image) printf '%s\\n' '${image}' ;;
 compose)
  if [[ "$*" == *'config --images' ]]; then printf '%s\\n' '${options.resolved ?? image}';
  else
   printf running > "$FIXTURE/state"
   ${options.startSignal ? `kill -${options.startSignal} "$PPID"` : ':'}
   exit ${options.startStatus ?? 0}
  fi ;;
 inspect)
  [[ "\${*: -1}" == jarvis-command-command-proxy ]] || exit 99
  if [[ -e "$FIXTURE/inspected" ]]; then printf '%s\\n' '${options.after ?? `${image}|true|unhealthy`}';
  else touch "$FIXTURE/inspected"; printf '%s\\n' '${options.initial ?? `${image}|true|healthy`}'; fi ;;
 stop)
  [[ "$2" == jarvis-command-command-proxy ]] || exit 99
  ${options.stopFails ? 'exit 23' : 'printf stopped > "$FIXTURE/state"'} ;;
 ps)
  ${options.psFails ? 'exit 24' : 'if [[ $(<"$FIXTURE/state") == running ]]; then printf jarvis-command-command-proxy; fi'} ;;
 *) exit 98 ;;
esac`);
    await executable('notify', `printf ready > "$FIXTURE/notified"; exit ${options.notifyFails ? 1 : 0}`);
    await executable('pause', options.signal ? `kill -${options.signal} "$PPID"` : 'exit 0');
    const result = spawnSync(runner, ['command-proxy', join(root, 'compose.yaml'), join(root, 'release.env'), '--monitor'], {
      encoding: 'utf8', timeout: 5_000,
      env: { PATH: `${root}:/usr/bin:/bin`, FIXTURE: root, SYSTEMD_NOTIFY_BIN: join(root, 'notify'), SLEEP_BIN: join(root, 'pause'), MONITOR_INTERVAL_SECONDS: '1' },
    });
    const read = (name) => readFile(join(root, name), 'utf8').catch(() => '');
    return { ...result, log: await read('log'), state: await read('state'), notified: await read('notified') };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const [name, options, reason, started, ready] of [
  ['invalid image', { release: `${variable}=latest\n` }, /must appear exactly once as sha256/, false, false],
  ['duplicate image', { release: `${variable}=${image}\n${variable}=${image}\n` }, /must appear exactly once as sha256/, false, false],
  ['Compose mismatch', { resolved: other }, /Compose resolved an image other/, false, false],
  ['startup failure', { startStatus: 17 }, /Compose startup failed; candidate stopped/, true, false],
  ['missing health at startup', { initial: `${image}|true|missing` }, /not running and healthy; candidate stopped/, true, false],
  ['stopped after readiness', { after: `${image}|false|healthy` }, /stopped after readiness; candidate stopped/, true, true],
  ['unhealthy after readiness', {}, /became unhealthy after readiness; candidate stopped/, true, true],
  ['missing health after readiness', { after: `${image}|true|missing` }, /became unhealthy after readiness; candidate stopped/, true, true],
  ['identity drift', { after: `${other}|true|healthy` }, /identity changed after readiness; candidate stopped/, true, true],
  ['notify failure', { notifyFails: true }, /readiness notification failed; candidate stopped/, true, true],
  ['stop failed', { stopFails: true }, /cleanup could not be verified/, true, true],
  ['stop verification failed', { psFails: true }, /cleanup could not be verified/, true, true],
]) {
  test(`command supervisor: ${name}`, async () => {
    const result = await runScenario(options);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, reason);
    assert.equal(result.notified === 'ready', ready);
    if (started) {
      assert.match(result.log, /^stop jarvis-command-command-proxy$/m);
      assert.match(result.log, /^ps --filter name=\^\/jarvis-command-command-proxy\$ --format/m);
      if (!options.stopFails && !options.psFails) assert.equal(result.state, 'stopped');
      else assert.doesNotMatch(result.stderr, /candidate stopped/);
    } else {
      assert.doesNotMatch(result.log, / up -d|^stop /m);
      if (options.release) assert.equal(result.log, '');
    }
  });
}

for (const [signal, code] of [['HUP', 129], ['INT', 130], ['TERM', 143]]) {
  for (const phase of ['startup', 'monitor']) {
    test(`command supervisor: ${signal} during ${phase} stops and verifies`, async () => {
      const result = await runScenario(phase === 'startup' ? { startSignal: signal } : { signal });
      assert.equal(result.status, code, result.stderr);
      assert.equal(result.state, 'stopped');
      assert.match(result.log, /^stop jarvis-command-command-proxy$/m);
      assert.match(result.log, /^ps /m);
    });
  }
}

// Keep the runtime pin explicit even when this suite is launched independently.
test('command lifecycle tests run on Node 22', () => assert.equal(process.versions.node.split('.')[0], '22'));
