/* global Buffer, process, URL */
import { createServer as http, request as forward } from 'node:http';
import { createServer as https } from 'node:https';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
const directory = process.argv[2];
const config = JSON.parse(readFileSync(directory + '/synthetic.json'));
if (process.argv[3] === '--prepare') {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(directory + '/jwks.json', JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'synthetic', alg: 'RS256', use: 'sig' }] }), { mode: 0o444 });
  const jwt = email => {
    const part = x => Buffer.from(JSON.stringify(x)).toString('base64url');
    const value = part({ alg: 'RS256', kid: 'synthetic' }) + '.' + part({ email, type: 'app', iss: 'https://synthetic.cloudflareaccess.com', aud: 'a'.repeat(64), sub: 'synthetic-operator', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300 });
    return value + '.' + sign('RSA-SHA256', Buffer.from(value), privateKey).toString('base64url');
  };
  writeFileSync(directory + '/browser.json', JSON.stringify({ ...config, assertion: jwt('synthetic-approved@example.test'), unapproved: jwt('synthetic-denied@example.test') }), { mode: 0o600 });
} else {
  const seed = 'jc_' + 'a'.repeat(32), timestamp = '2026-09-05T12:00:00.000Z';
  const requests = [], violations = [], transport = [];
  const statePath = directory + '/runs.json';
  const runs = existsSync(statePath) ? JSON.parse(readFileSync(statePath)) : [];
  const persist = () => writeFileSync(statePath, JSON.stringify(runs), { mode: 0o600, flush: true });
  const server = http({ requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 16384 }, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method !== (url.pathname === '/v1/runs' ? 'POST' : 'GET')) return send({ error: 'method_not_allowed' }, 405);
    if (url.pathname === '/fixture-counts') return send({ requests, violations, runs, transport });
    requests.push({ method: req.method, path: url.pathname });
    if (req.headers['cf-access-jwt-assertion'] || req.headers.authorization !== 'Bearer ' + config.upstream) violations.push('upstream boundary violation');
    if (violations.length) return send({ error: 'boundary' }, 401);
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 65536) { req.destroy(); return; } }
    const session = { id: seed, title: 'Synthetic container room', source: 'jarvis-command', last_active: timestamp, message_count: 1 };
    if (url.pathname === '/health/detailed') return send({ status: 'ready', version: 'synthetic', gateway_state: 'idle', gateway_busy: false, active_agents: 0, readiness: { status: 'ready', checks: { config: 'pass' } } });
    if (url.pathname === '/v1/capabilities') return send({ model: 'synthetic-model', features: { run_events_sse: true, session_resources: true }, idempotency: { supported: true, durable: true, retention_seconds: 86400 } });
    if (url.pathname === '/api/sessions') return send({ object: 'list', data: [session], limit: 12, offset: 0, has_more: false });
    if (url.pathname === '/api/sessions/' + seed) return send({ session });
    if (url.pathname === '/api/sessions/' + seed + '/messages') return send({ session_id: seed, data: [{ id: 'synthetic-history-1', session_id: seed, role: 'assistant', content: 'Synthetic historical message', timestamp }], pagination: { limit: Number(url.searchParams.get('limit')), offset: Number(url.searchParams.get('offset')), returned: 1, order: url.searchParams.get('order') } });
    if (url.pathname === '/v1/runs' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(text); } catch { return send({ error: 'invalid_json' }, 400); }
      const key = req.headers['idempotency-key'];
      if (!/^jc-v1-[a-f0-9]{64}$/.test(key ?? '') || body?.session_id !== seed || typeof body.input !== 'string' || Object.keys(body).sort().join(',') !== 'input,session_id') return send({ error: 'invalid_admission' }, 400);
      const existing = runs.find(record => record.key === key);
      if (existing) {
        if (existing.body.session_id !== body.session_id || existing.body.input !== body.input) return send({ error: 'idempotency_conflict' }, 409);
        return send({ run_id: existing.run_id, status: existing.completed ? 'completed' : 'running', replayed: true });
      }
      const record = { run_id: 'run_' + (runs.length + 1).toString(16).padStart(32, '0'), key, body, completed: false };
      runs.push(record); persist(); return send({ run_id: record.run_id, status: 'running', replayed: false });
    }
    const record = runs.find(record => url.pathname === '/v1/runs/' + record.run_id || url.pathname === '/v1/runs/' + record.run_id + '/events');
    if (record && url.pathname === '/v1/runs/' + record.run_id) return send({ run_id: record.run_id, session_id: record.body.session_id, status: record.completed ? 'completed' : 'running', approval: null, pending_steer: null, updated_at: timestamp, output: record.completed ? 'Synthetic streamed answer' : null });
    if (record && url.pathname.endsWith('/events')) {
      record.completed = true; persist(); res.writeHead(200, { 'content-type': 'text/event-stream' });
      return res.end([{ event: 'message.delta', delta: 'Synthetic streamed answer' }, { event: 'tool.started', tool: 'synthetic-tool', preview: 'Synthetic tool preview' }, { event: 'run.completed', output: 'Synthetic streamed answer', pending_steer: null, usage: null }].map(event => 'data: ' + JSON.stringify({ run_id: record.run_id, timestamp, ...event }) + '\n\n').join(''));
    }
    send({ error: 'synthetic_unknown_route' }, 404);
  });
  server.listen(18640, '127.0.0.1');
  // TLS transport only: no JWT injection, route mocking, or application replacement.
  https({ key: readFileSync(directory + '/tls.key'), cert: readFileSync(directory + '/tls.crt'), requestTimeout: 10000, headersTimeout: 5000, maxHeaderSize: 16384 }, (req, res) => {
    const record = req.url.startsWith('/api/') ? { path: req.url, method: req.method, requestText: '', text: '', status: null, complete: false } : null;
    if (record) {
      if (transport.length >= 128) throw new Error('Transport evidence count exceeded');
      transport.push(record);
      req.on('data', chunk => { record.requestText += chunk; if (record.requestText.length > 65536) throw new Error('Request evidence exceeded'); });
    }
    const upstream = forward({ host: '127.0.0.1', port: 3000, path: req.url, method: req.method, headers: req.headers, timeout: 10000 }, reply => {
      if (record) {
        record.status = reply.statusCode;
        reply.setEncoding('utf8');
        reply.on('data', chunk => { record.text += chunk; if (record.text.length > 262144) throw new Error('Response evidence exceeded'); });
        reply.on('end', () => { record.complete = true; });
      }
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => upstream.destroy()); req.pipe(upstream);
  }).listen(8443, '127.0.0.1');
}
