import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import type { ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createCommandServer } from '../apps/server/src/bootstrap';
import { loadConfig } from '../apps/server/src/config';
import { buildReadProxy } from '../apps/read-proxy/src/app';
import { buildCommandProxy } from '../apps/command-proxy/src/app';

// Only the upstream and credentials are synthetic. No fetch/auth/client overrides.
export async function startRealChain(mode: 'completed' | 'controls' = 'completed') {
  const directory = await mkdtemp(join(tmpdir(), 'jc-browser-chain-'));
  const owned: FastifyInstance[] = [];
  const close = async () => {
    try {
      const errors: unknown[] = [];
      for (const server of [...owned].reverse()) {
        try { await server.close(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Synthetic chain cleanup failed');
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
  try {
    const email = 'synthetic-approved@example.test';
    const secrets = ['synthetic-full-hermes-' + 'h'.repeat(40), 'synthetic-read-' + 'r'.repeat(40), 'synthetic-command-' + 'c'.repeat(40)];
    const pair = await generateKeyPair('RS256');
    const jwks = join(directory, 'jwks.json');
    await writeFile(jwks, JSON.stringify({ keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', kid: 'synthetic-browser', use: 'sig' }] }), { mode: 0o600 });
    const sign = (identity: string) => new SignJWT({ email: identity, type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-browser' }).setIssuer('https://synthetic.cloudflareaccess.com').setAudience('a'.repeat(64)).setSubject('synthetic-browser-operator').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const assertion = await sign(email);
    const unapprovedAssertion = await sign('synthetic-unapproved@example.test');
    const seedId = 'jc_' + 'a'.repeat(32);
    const runId = 'run_' + 'b'.repeat(32);
    const prompt = 'Synthetic private browser prompt';
    const output = 'Synthetic streamed answer';
    const timestamp = '2026-09-04T14:00:00.000Z';
    const sessions = [{ id: seedId, title: 'Synthetic existing Command room', source: 'api_server', last_active: timestamp, message_count: 1 }];
    const requests: { method: string; path: string }[] = [];
    const upstreamViolations: string[] = [];
    const payloads: { path: string; text: string }[] = [];
    const browserMutations: { path: string; origin: string | undefined; marker: string | string[] | undefined; contentType: string | undefined }[] = [];
    let runBody: { session_id: string; input: string } | undefined;
    let idempotencyKey: string | undefined;
    let completed = false;
    let approvalPending = true;
    let pendingSteer: string | null = null;
    let cancelled = false;
    let stopping = false;
    let releaseStatus = () => {};
    let statusGate: Promise<void> | undefined;
    let statusEntered = () => {};
    const holdStatus = () => {
      statusGate = new Promise<void>(resolve => { releaseStatus = () => { statusGate = undefined; resolve(); }; });
      return { entered: new Promise<void>(resolve => { statusEntered = resolve; }), release: () => releaseStatus() };
    };
    const approval = { request_id: 'synthetic-approval-exact', command: 'printf synthetic-control ; printf /EXACT_SYNTHETIC_TARGET', description: 'Synthetic display-only command; never executed', tool: 'terminal' };
    const controls: { runId: string; body: unknown; path: string }[] = [];
    const streams = new Set<ServerResponse>();
    const synthetic = Fastify(); owned.push(synthetic);
    synthetic.addHook('preClose', async () => { releaseStatus(); for (const stream of streams) stream.destroy(); });
    synthetic.addHook('onRequest', async (request, reply) => {
      requests.push({ method: request.method, path: request.url.split('?')[0]! });
      if (request.headers['cf-access-jwt-assertion']) upstreamViolations.push('Access assertion forwarded');
      if (request.headers.authorization !== 'Bearer ' + secrets[0]) {
        upstreamViolations.push('Wrong upstream credential');
        return reply.code(401).send({ error: 'synthetic_unauthorized' });
      }
    });
    synthetic.get('/health/detailed', async () => ({ status: 'ready', version: 'synthetic', gateway_state: 'idle', gateway_busy: false, active_agents: 0, readiness: { status: 'ready', checks: { config: 'pass' } } }));
    synthetic.get('/v1/capabilities', async () => ({ model: 'synthetic-model', features: { run_events_sse: true, session_resources: true, runs_idempotency: { supported: true, durable: true, retention_seconds: 86400 } } }));
    synthetic.get('/api/sessions', async () => ({ object: 'list', data: sessions, limit: 12, offset: 0, has_more: false }));
    synthetic.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
      const session = sessions.find(session => session.id === request.params.id);
      return session ? { session } : reply.code(404).send({ error: 'synthetic_unknown_session' });
    });
    synthetic.post<{ Body: { id: string; source: string; title?: string } }>('/api/sessions', async request => {
      // Model the installed gateway, never the imagined echo of a custom source.
      const session = { ...request.body, source: 'api_server', title: request.body.title ?? 'Synthetic created Command room', last_active: timestamp, message_count: 0 };
      sessions.push(session); return { session };
    });
    synthetic.get<{ Params: { id: string }; Querystring: { limit: string; offset: string; order: string } }>('/api/sessions/:id/messages', async request => {
      const data = request.params.id === seedId ? [{ id: 'synthetic-history-1', session_id: seedId, role: 'assistant', content: 'Synthetic historical message', timestamp }] : [];
      return { session_id: request.params.id, data, pagination: { limit: Number(request.query.limit), offset: Number(request.query.offset), returned: data.length, order: request.query.order } };
    });
    synthetic.post<{ Body: { session_id: string; input: string } }>('/v1/runs', async request => {
      runBody = request.body; idempotencyKey = String(request.headers['idempotency-key']);
      return { run_id: runId, status: 'running', replayed: false };
    });
    synthetic.get<{ Params: { id: string } }>('/v1/runs/:id', async (request, reply) => {
      if (statusGate) { statusEntered(); await statusGate; }
      return request.params.id !== runId ? reply.code(404).send({}) : { run_id: runId, session_id: runBody?.session_id, status: cancelled ? 'cancelled' : completed ? 'completed' : stopping ? 'stopping' : mode === 'controls' && approvalPending ? 'waiting_for_approval' : 'running', approval: mode === 'controls' && approvalPending ? approval : null, pending_steer: pendingSteer, updated_at: timestamp, output: completed ? output : null };
    });
    synthetic.post<{ Params: { id: string }; Body: { input: string } }>('/v1/runs/:id/steer', async (request, reply) => {
      controls.push({ runId: request.params.id, body: request.body, path: request.url });
      if (request.params.id !== runId) return reply.code(404).send({});
      pendingSteer = request.body.input;
      return { run_id: runId, accepted: true };
    });
    synthetic.post<{ Params: { id: string } }>('/v1/runs/:id/stop', async (request, reply) => {
      controls.push({ runId: request.params.id, body: request.body, path: request.url });
      if (request.params.id !== runId) return reply.code(404).send({});
      stopping = true;
      return { run_id: runId, status: 'stopping' };
    });
    synthetic.post<{ Params: { id: string }; Body: { request_id: string; choice: 'once' | 'deny' } }>('/v1/runs/:id/approval', async (request, reply) => {
      controls.push({ runId: request.params.id, body: request.body, path: request.url });
      if (request.params.id !== runId || request.body.request_id !== approval.request_id || !['once', 'deny'].includes(request.body.choice) || !approvalPending) return reply.code(409).send({});
      approvalPending = false;
      return { run_id: runId, request_id: approval.request_id, choice: request.body.choice, resolved: 1 };
    });
    synthetic.get('/v1/runs/:id/events', async (_request, reply) => {
      if (mode === 'controls') {
        reply.hijack();
        streams.add(reply.raw);
        reply.raw.once('close', () => streams.delete(reply.raw));
        reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
        reply.raw.write(`data: ${JSON.stringify({ run_id: runId, timestamp, event: 'approval.request', ...approval })}\n\n`);
        return reply;
      }
      completed = true;
      return reply.type('text/event-stream').send([
        { event: 'message.delta', delta: output },
        { event: 'tool.started', tool: 'synthetic-tool', preview: 'Synthetic tool preview' },
        { event: 'run.completed', output, pending_steer: null, usage: null },
      ].map(event => `data: ${JSON.stringify({ run_id: runId, timestamp, ...event })}\n\n`).join(''));
    });
    const upstream = await synthetic.listen({ host: '127.0.0.1', port: 0 });
    const readProxy = buildReadProxy({ config: { host: '127.0.0.1', port: 0, hermesBaseUrl: upstream, readProxyKey: secrets[1]!, hermesApiKey: secrets[0]! } }); owned.push(readProxy);
    const readOrigin = await readProxy.listen({ host: '127.0.0.1', port: 0 });
    const commandProxy = buildCommandProxy({ config: { host: '127.0.0.1', port: 0, hermesBaseUrl: upstream, commandProxyKey: secrets[2]!, hermesApiKey: secrets[0]!, maxStreamSeconds: 60 } }); owned.push(commandProxy);
    const commandOrigin = await commandProxy.listen({ host: '127.0.0.1', port: 0 });
    // Reserve an ephemeral port to configure exact PUBLIC_ORIGIN before composition.
    // If another process wins the close/listen gap, fail; never reuse its listener.
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Synthetic port reservation failed');
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    const origin = 'http://127.0.0.1:' + port;
    const auditPath = join(directory, 'audit.jsonl');
    const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'cloudflare', CF_ACCESS_TEAM_DOMAIN: 'synthetic.cloudflareaccess.com', CF_ACCESS_AUD: 'a'.repeat(64), CF_ACCESS_EMAIL_SHA256: createHash('sha256').update(email).digest('hex'), CF_ACCESS_JWKS_FILE: jwks, HERMES_API_BASE_URL: readOrigin, HERMES_READ_PROXY_KEY: secrets[1], COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: origin, HERMES_COMMAND_API_BASE_URL: commandOrigin, HERMES_COMMAND_PROXY_KEY: secrets[2], COMMAND_AUDIT_LOG_PATH: auditPath, WEB_DIST_DIR: resolve('apps/web/dist') });
    const startBff = async () => {
      const bff = createCommandServer(config); owned.push(bff);
      bff.addHook('onSend', async (request, _reply, payload) => {
        if (request.url.startsWith('/api/') && typeof payload === 'string') payloads.push({ path: request.url, text: payload });
        return payload;
      });
      bff.addHook('onRequest', async request => {
        if (request.method === 'POST') browserMutations.push({ path: request.url, origin: request.headers.origin, marker: request.headers['x-jarvis-command'], contentType: request.headers['content-type'] });
      });
      await bff.listen({ host: '127.0.0.1', port });
      return bff;
    };
    let bff = await startBff();
    const restart = async () => {
      const previous = bff;
      await previous.close();
      if (previous.server.listening) throw new Error('Old synthetic BFF still listening');
      bff = await startBff();
      return { previousStopped: !previous.server.listening, origin };
    };
    return { restart, origin, assertion, unapprovedAssertion, seedId, runId, prompt, output, email, secrets, requests, payloads, upstreamViolations, browserMutations, controls, holdStatus, finish: () => { cancelled = true; }, get runBody() { return runBody; }, get idempotencyKey() { return idempotencyKey; }, count: (method: string, path: string) => requests.filter(request => request.method === method && request.path === path).length, audit: () => readFile(auditPath, 'utf8'), close: async () => { releaseStatus(); await close(); } };
  } catch (error) { await close(); throw error; }
}
