import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('container-chain fixture is opt-in and defaults to read-only', () => {
  assert.ok(existsSync('deploy/verify-container-chain.py'), 'Missing reusable containerized browser/dual-proxy fixture');
  const result = spawnSync('/usr/bin/python3', ['deploy/verify-container-chain.py'], { encoding: 'utf8', env: { PATH: '/home/neal/.local/bin:/usr/local/bin:/usr/bin:/bin' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Read-only default/);
});

// Exercise the actual synthetic handler without opening host ports.
test('execution preflight refuses unsafe invocations before mkdir or subprocess even optimized', () => {
  for (const optimized of [false, true]) {
    const invoke = (args, uid = 0) => spawnSync('/usr/bin/python3', [...(optimized ? ['-O'] : []), '-c', `
import os, pathlib, runpy, subprocess, sys
os.geteuid = lambda: ${uid}
def forbidden(*a, **kw): raise RuntimeError('SIDE_EFFECT_FORBIDDEN')
pathlib.Path.mkdir = forbidden
subprocess.run = forbidden
sys.argv = ['deploy/verify-container-chain.py'] + ${JSON.stringify(args)}
runpy.run_path(sys.argv[0], run_name='__main__')
`], { encoding: 'utf8' });
    const readonly = invoke([]);
    assert.equal(readonly.status, 0); assert.match(readonly.stdout, /Read-only default/);
    for (const [args, uid, expected] of [
      [['--execute', '--ack', 'WRONG'], 0, /SYNTHETIC_ONLY/],
      [['--execute', '--ack', 'SYNTHETIC_ONLY'], 0, /required/],
      [['--execute', '--ack', 'SYNTHETIC_ONLY', '--parent-app', '/nonexistent-app', '--parent-command', '/nonexistent-command', '--evidence', '/nonexistent-evidence'], 0, /required.*file|missing/i],
      [['--execute', '--ack', 'SYNTHETIC_ONLY'], 1000, /root/],
    ]) {
      const result = invoke(args, uid);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /SIDE_EFFECT_FORBIDDEN|AssertionError/);
      assert.match(result.stderr, optimized ? /optimized execution/ : expected);
    }
  }
});

function fixture(files = new Map(), forward, globals = {}) {
  let handler, transport;
  const source = readFileSync('deploy/container-chain-upstream.mjs', 'utf8').replace(/^import .*;$/gm, '');
  runInNewContext(source, {
    process: { argv: ['node', 'fixture', '/fixture'] }, Buffer, URL,
    readFileSync: path => files.get(path) ?? (path.endsWith('synthetic.json') ? '{"upstream":"synthetic-key"}' : ''),
    writeFileSync: (path, text) => files.set(path, text), existsSync: path => files.has(path),
    http: (_options, callback) => { handler = callback; return { listen() {} }; },
    https: (_options, callback) => { transport = callback; return { listen() {} }; }, forward, ...globals,
  });
  return { handler, transport, async request(method, path, body, key = 'jc-v1-' + '1'.repeat(64)) {
    let status, text = '';
    const req = { method, url: path, headers: { authorization: 'Bearer synthetic-key', 'idempotency-key': key }, async *[Symbol.asyncIterator]() { if (body) yield JSON.stringify(body); } };
    await handler(req, { writeHead(code) { status = code; }, end(value) { text = value; } });
    return { status, text, json: () => JSON.parse(text) };
  } };
}

test('synthetic sequential admissions retain independent run identity and completion', async () => {
  const f = fixture(), session_id = 'jc_' + 'a'.repeat(32);
  const first = (await f.request('POST', '/v1/runs', { session_id, input: 'first' })).json();
  await f.request('GET', '/v1/runs/' + first.run_id + '/events');
  const second = (await f.request('POST', '/v1/runs', { session_id, input: 'second' }, 'jc-v1-' + '2'.repeat(64))).json();
  assert.notEqual(first.run_id, second.run_id);
  assert.equal((await f.request('GET', '/v1/runs/' + first.run_id)).json().status, 'completed');
  assert.equal((await f.request('GET', '/v1/runs/' + second.run_id)).json().status, 'running');
});

test('synthetic idempotency persists exact replay and refuses conflicting payloads', async () => {
  const files = new Map(), f = fixture(files), body = { session_id: 'jc_' + 'a'.repeat(32), input: 'first' };
  const first = (await f.request('POST', '/v1/runs', body)).json();
  await f.request('GET', '/v1/runs/' + first.run_id + '/events');
  const restarted = fixture(files);
  const replay = (await restarted.request('POST', '/v1/runs', { input: body.input, session_id: body.session_id })).json();
  assert.equal(replay.run_id, first.run_id);
  assert.equal(replay.replayed, true);
  assert.equal((await restarted.request('GET', '/v1/runs/' + first.run_id)).json().status, 'completed');
  assert.equal((await restarted.request('POST', '/v1/runs', { ...body, input: 'conflict' })).status, 409);
  assert.equal((await restarted.request('POST', '/v1/runs', body, '')).status, 400);
  assert.equal((await restarted.request('GET', '/fixture-counts')).json().runs.length, 1);
});

test('synthetic routes reject wrong methods and unknown identities without completion', async () => {
  const f = fixture(), seed = 'jc_' + 'a'.repeat(32);
  const run = (await f.request('POST', '/v1/runs', { session_id: seed, input: 'first' })).json().run_id;
  for (const path of ['/health/detailed', '/v1/capabilities', '/api/sessions', '/api/sessions/' + seed, '/api/sessions/' + seed + '/messages', '/v1/runs/' + run, '/v1/runs/' + run + '/events', '/fixture-counts']) assert.equal((await f.request('POST', path)).status, 405, path);
  for (const path of ['/v1/runs/run_' + 'f'.repeat(32), '/v1/runs/run_' + 'f'.repeat(32) + '/events', '/api/sessions/jc_' + 'f'.repeat(32) + '/messages']) assert.equal((await f.request('GET', path)).status, 404, path);
  assert.equal((await f.request('GET', '/v1/runs')).status, 405);
  assert.equal((await f.request('GET', '/v1/runs/' + run)).json().status, 'running');
});

test('TLS transport retains real response bytes independently of browser reader disposal', async () => {
  const reply = new PassThrough(); reply.statusCode = 200; reply.headers = { 'content-type': 'application/json' };
  const f = fixture(new Map(), (_options, callback) => { callback(reply); return new PassThrough(); });
  const req = new PassThrough(); req.url = '/api/live/runs'; req.method = 'POST'; req.headers = {};
  const res = new PassThrough(); res.writeHead = () => {};
  f.transport(req, res);
  req.end('{"clientRequestId":"submitted"}');
  reply.end('{"publicRunId":"serialized"}');
  await new Promise(resolve => reply.on('end', resolve));
  const records = (await f.request('GET', '/fixture-counts')).json().transport;
  assert.equal(records.length, 1);
  assert.equal(records[0].text, '{"publicRunId":"serialized"}');
  assert.equal(records[0].requestText, '{"clientRequestId":"submitted"}');
  assert.equal(records[0].complete, true);
  assert.equal(records[0].status, 200);
});

test('synthetic controls persist independent approval, queued steer and nonterminal stop state', async () => {
  const files = new Map(), f = fixture(files), session_id = 'jc_' + 'a'.repeat(32);
  for (const [index, choice] of ['once', 'deny'].entries()) {
    const run = (await f.request('POST', '/v1/runs', { session_id, input: 'Synthetic container controls' }, 'jc-v1-' + String(index + 1).repeat(64))).json();
    const path = '/v1/runs/' + run.run_id;
    const status = (await f.request('GET', path)).json();
    assert.equal(status.status, 'waiting_for_approval');
    assert.equal(status.approval.command, 'printf synthetic-control ; printf /EXACT_SYNTHETIC_TARGET');
    assert.equal((await f.request('GET', path + '/approval')).status, 405);
    assert.equal((await f.request('POST', path + '/approval', { request_id: 'wrong', choice })).status, 409);
    const body = { request_id: 'synthetic-approval-exact', choice };
    assert.deepEqual((await f.request('POST', path + '/approval', body)).json(), { run_id: run.run_id, ...body, resolved: 1 });
    assert.equal((await f.request('POST', path + '/approval', body)).status, 409);
    assert.equal((await fixture(files).request('GET', path)).json().status, 'running');
    assert.equal((await f.request('POST', path + '/steer', { input: 'Synthetic private queued guidance' })).json().accepted, true);
    assert.equal((await f.request('POST', path + '/stop', {})).json().status, 'stopping');
    const recovered = (await fixture(files).request('GET', path)).json();
    assert.equal(recovered.status, 'stopping');
    assert.equal(recovered.pending_steer, 'Synthetic private queued guidance');
    assert.equal((await f.request('POST', path + '/stop', {})).status, 409);
  }
  assert.equal((await f.request('POST', '/v1/runs/run_' + 'f'.repeat(32) + '/stop', {})).status, 404);
});

test('held synthetic status releases, aborts on disconnect and expires without leaked polling', async () => {
  for (const ending of ['release', 'disconnect', 'deadline']) {
    const files = new Map(), run_id = 'run_' + '1'.padStart(32, '0');
    let ticks = 0, now = 0, disconnected = false;
    const f = fixture(files, undefined, { Date: { now: () => now }, setTimeout: callback => {
      ticks++;
      if (ending === 'release') files.set('/fixture/gate.json', JSON.stringify({ run_id, action: 'release' }));
      if (ending === 'disconnect') disconnected = true;
      now += 6000;
      if (ticks > 2) throw new Error('held handler leaked beyond deadline/disconnect');
      callback();
    } });
    await f.request('POST', '/v1/runs', { session_id: 'jc_' + 'a'.repeat(32), input: 'Synthetic container controls' });
    files.set('/fixture/gate.json', JSON.stringify({ run_id, action: 'hold' }));
    let status, text, sent = false;
    await f.handler({ method: 'GET', url: '/v1/runs/' + run_id, headers: { authorization: 'Bearer synthetic-key' }, async *[Symbol.asyncIterator]() {} }, {
      get destroyed() { return disconnected; }, writeHead(code) { status = code; }, end(value) { text = value; sent = true; },
    });
    assert.equal(ticks, 1);
    if (ending === 'disconnect') assert.equal(sent, false);
    else { assert.equal(status, ending === 'release' ? 200 : 503); assert.ok(text); }
  }
});
