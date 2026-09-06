/* global process, Buffer, URL, console */
// Synthetic-only upstream and independent HTTP clients for the bounded room smoke.
import { createServer, request, Agent } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [mode, root, phase] = process.argv.slice(2);
const load = name => JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8'));
const save = (name, data) => writeFileSync(`${root}/${name}.json`, JSON.stringify(data), { mode: 0o600 });
const timestamp = '2026-09-06T12:00:00.000Z';
if (mode === 'prepare') {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  save('jwks', { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'room-smoke', alg: 'RS256', use: 'sig' }] });
  const jwt = email => {
    const part = x => Buffer.from(JSON.stringify(x)).toString('base64url');
    const data = part({ alg: 'RS256', kid: 'room-smoke' }) + '.' + part({ email, type: 'app', iss: 'https://synthetic.cloudflareaccess.com', aud: 'a'.repeat(64), sub: 'synthetic-operator', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+1800 });
    return data + '.' + sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
  };
  save('identity', { approved: jwt('approved@example.test'), denied: jwt('denied@example.test'), hash: createHash('sha256').update('approved@example.test').digest('hex') });
} else if (mode === 'upstream') {
  const config = load('config'); const requests = []; const sessions = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/fixture-counts') return send({ requests, sessions });
    requests.push({ method: req.method, path: url.pathname });
    if (req.headers.authorization !== 'Bearer ' + config.upstream || req.headers['cf-access-jwt-assertion']) return send({ error: 'credential_boundary' }, 401);
    if (url.pathname === '/health/detailed') return send({ status: 'ready', version: 'synthetic', gateway_state: 'idle', gateway_busy: false, active_agents: 0, readiness: { status: 'ready', checks: { config: 'pass' } } });
    if (url.pathname === '/v1/capabilities') return send({ model: 'hermes-agent', features: { run_events_sse: true, session_resources: true, runs_idempotency: { supported: true, durable: true, retention_seconds: 86400 } } });
    if (url.pathname === '/api/sessions' && req.method === 'POST') {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      assert.match(body.id, /^jc_[a-f0-9]{32}$/); assert.equal(body.source, 'api_server');
      const session = { ...body, last_active: timestamp, message_count: 0, tool_call_count: 0, pinned: false, model: null };
      sessions.push(session); return send({ session }, 201);
    }
    if (url.pathname === '/api/sessions') {
      // Deliberately exclude the created conversation from exactly 12 recents.
      return send({ object: 'list', data: Array.from({ length: 12 }, (_, i) => ({ id: `external-${i}`, title: `Synthetic recent ${i}`, source: 'cli', last_active: timestamp, message_count: 0 })), limit: 12, offset: 0, has_more: true });
    }
    const session = sessions.find(item => url.pathname === '/api/sessions/' + item.id);
    if (session) return send({ session });
    return send({ error: 'unknown_fixture_route' }, 404);
  });
  server.listen(config.upstreamPort, '127.0.0.1', () => console.log('READY'));
  process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
} else if (mode === 'probe') {
  const config = load('config'); const identity = load('identity');
  const clients = [new Agent({ keepAlive: true }), new Agent({ keepAlive: true })];
  const exchanges = [];
  async function call(client, path, body, overrides = {}, upstream = false) {
    const method = body === undefined ? 'GET' : 'POST';
    const headers = upstream ? {} : { 'cf-access-jwt-assertion': identity.approved, ...(body === undefined ? {} : { origin: 'https://rooms.example.test', 'x-jarvis-command': '1', 'content-type': 'application/json' }), ...overrides };
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: upstream ? config.upstreamPort : config.appPort, path, method, headers, agent: clients[client], timeout: 5000 }, res => {
        let text = ''; const localPort = res.socket.localPort;
        res.on('data', data => { text += data; });
        res.on('end', () => { const value = JSON.parse(text); exchanges.push({ client, method, path, status: res.statusCode, localPort }); resolve({ status: res.statusCode, value }); });
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(Error('probe timeout')));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  try {
    let expected;
    if (phase === 'create') {
      const metadata = { name: 'Synthetic runtime room Ω', goal: 'Exact durable metadata\nNot applied execution context', repository: '/never-read/$(not-executed)', notes: ['vault/Not fetched.md', 'https://example.invalid/not-fetched'] };
      const created = await call(0, '/api/rooms', metadata); assert.equal(created.status, 200);
      const conversation = await call(0, '/api/live/sessions', { title: 'Synthetic durable conversation' }); assert.equal(conversation.status, 200);
      const linked = await call(0, `/api/rooms/${created.value.room.id}/sessions`, { sessionId: conversation.value.session.id }); assert.equal(linked.status, 200);
      expected = { room: linked.value.room, session: conversation.value.session };
      assert.deepEqual(expected.room, { ...metadata, id: created.value.room.id, sessionIds: [expected.session.id], lastSessionId: expected.session.id });
      save('expected', expected);
    } else expected = load('expected');
    for (const client of [0, 1]) {
      const rooms = await call(client, '/api/rooms'); assert.equal(rooms.status, 200); assert.deepEqual(rooms.value.rooms, [expected.room]);
      const bootstrap = await call(client, '/api/bootstrap'); assert.equal(bootstrap.status, 200); assert.equal(bootstrap.value.command.liveRoom.enabled, true); assert.equal(bootstrap.value.sessions.length, 12); assert.ok(!bootstrap.value.sessions.some(s => s.id === expected.session.id));
      const exact = await call(client, `/api/live/sessions/${expected.session.id}`); assert.equal(exact.status, 200); assert.deepEqual(exact.value.session, expected.session);
    }
    const before = (await call(0, '/fixture-counts', undefined, {}, true)).value;
    for (const path of ['/api/rooms', `/api/rooms/${expected.room.id}/sessions`]) {
      for (const [headers, status] of [[{ 'cf-access-jwt-assertion': identity.denied }, 401], [{ 'cf-access-jwt-assertion': '' }, 401], [{ origin: 'https://denied.example.test' }, 403], [{ 'x-jarvis-command': '' }, 403]]) {
        const result = await call(1, path, path.endsWith('/sessions') ? { sessionId: expected.session.id } : { name: 'Denied', goal: 'Must not write', repository: '', notes: [] }, headers);
        assert.equal(result.status, status);
      }
    }
    const after = (await call(0, '/fixture-counts', undefined, {}, true)).value;
    assert.deepEqual(after, before);
    assert.deepEqual((await call(1, '/api/rooms')).value.rooms, [expected.room]);
    assert.equal(after.sessions.length, 1);
    assert.notEqual(exchanges.find(x => x.client === 0).localPort, exchanges.find(x => x.client === 1).localPort);
    console.log(JSON.stringify({ phase, status: 'PASS', expected, exchanges, upstream: after, clients: 'two independent HTTP agents and TCP connections', deniedUpstreamDelta: 0 }));
  } finally { clients.forEach(client => client.destroy()); }
}
