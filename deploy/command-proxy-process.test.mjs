import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { before, test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const key = 'synthetic-command-key-'.repeat(3);
const upstreamKey = 'synthetic-upstream-key-'.repeat(3);
before(() => {
  assert.match(process.version, /^v22\./, 'Run with the production Node 22 runtime');
  execFileSync('npm', ['run', 'build', '-w', '@jarvis-command/command-proxy'], { cwd: root, stdio: 'pipe' });
});
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(25); }
  assert.fail('Condition did not settle within 2.5 seconds');
}
function launch(port, upstreamPort, extra = {}) {
  const child = spawn(process.execPath, ['apps/command-proxy/dist/index.js'], {
    cwd: root, env: {
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      COMMAND_PROXY_KEY: key, HERMES_API_KEY: upstreamKey,
      HERMES_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`, ...extra,
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = once(child, 'exit');
  return { child, exited, output: () => output };
}
async function boundedExit(fixture) {
  await until(() => fixture.child.exitCode !== null || fixture.child.signalCode !== null);
  return await fixture.exited;
}
async function cleanup(fixture) {
  if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
    fixture.child.kill('SIGKILL'); await fixture.exited;
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) {
  for (const stream of [false, true]) {
    test(`emitted production entrypoint ${signal}: ${stream ? 'open SSE reclaims both sockets' : 'idle clean exit'}`, async () => {
      let upstreamClosed = false;
      let upstreamOpened = false;
      const upstream = createServer((request, response) => {
        assert.equal(request.headers.authorization, `Bearer ${upstreamKey}`);
        upstreamOpened = true;
        response.on('close', () => { upstreamClosed = true; });
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.flushHeaders();
      });
      const upstreamPort = await listen(upstream);
      const allocator = createServer();
      const port = await listen(allocator); await close(allocator);
      const fixture = launch(port, upstreamPort);
      let downstream;
      let downstreamClosed = false;
      try {
        await until(async () => {
          assert.equal(fixture.child.exitCode, null, fixture.output());
          try {
            return await new Promise(resolve => {
              get(`http://127.0.0.1:${port}/_health`, { agent: false }, response => {
                response.resume(); resolve(response.statusCode === 200);
              }).on('error', () => resolve(false));
            });
          } catch { return false; }
        });
        if (stream) {
          downstream = await new Promise((resolve, reject) => {
            get(`http://127.0.0.1:${port}/v1/runs/run_1234567890abcdef1234567890abcdef/events`, {
              agent: false, headers: { authorization: `Bearer ${key}` },
            }, resolve).on('error', reject);
          });
          assert.equal(downstream.statusCode, 200);
          downstream.on('error', () => {});
          downstream.on('close', () => { downstreamClosed = true; });
          downstream.resume();
          assert.equal(upstreamOpened, true);
        }
        fixture.child.kill(signal);
        assert.deepEqual(await boundedExit(fixture), [0, null], fixture.output());
        if (stream) await until(() => upstreamClosed && downstreamClosed);
        assert.equal(fixture.output(), '');
      } finally { downstream?.destroy(); await cleanup(fixture); await close(upstream); }
    }, { timeout: 10_000 });
  }
}
for (const mode of ['occupied port', 'invalid configuration']) {
  test(`emitted startup failure: ${mode} exits bounded with sanitized diagnostic`, async () => {
    const occupied = createServer(); const port = await listen(occupied);
    const fixture = launch(port, port, mode === 'invalid configuration' ? { HOST: 'invalid-synthetic-host' } : {});
    try {
      assert.deepEqual(await boundedExit(fixture), [1, null]);
      assert.equal(fixture.output().trim(), 'Jarvis Command command proxy failed to start');
    } finally { await cleanup(fixture); await close(occupied); }
  });
}
