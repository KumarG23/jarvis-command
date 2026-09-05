import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { buildCommandProxy } from '../../command-proxy/src/app';
import { createCommandServer } from './bootstrap';
import { loadConfig } from './config';

it('preserves exact identities and redacts metadata through signed Access, BFF, client and proxy sockets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jc-identity-'));
  const pair = await generateKeyPair('RS256');
  const jwksFile = join(directory, 'jwks.json');
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', kid: 'test', use: 'sig' }] }));
  const assertion = await new SignJWT({ email: 'operator@example.com', type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://team.cloudflareaccess.com').setAudience('a'.repeat(64)).setSubject('operator').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const headers = { 'cf-access-jwt-assertion': assertion, origin: 'https://command.example', 'x-jarvis-command': '1', 'content-type': 'application/json' };
  const sessionId = 'jc_' + 'a'.repeat(32), runId = 'run_' + 'b'.repeat(32);
  const synthetic = Fastify();
  let mutations = 0;
  let upstreamEvent: Record<string, unknown> = {};
  synthetic.addHook('onRequest', async (request, reply) => {
    expect(request.headers['cf-access-jwt-assertion']).toBeUndefined();
    if (request.headers.authorization !== 'Bearer ' + 'h'.repeat(32)) return reply.code(401).send({});
  });
  synthetic.get('/v1/capabilities', async () => ({ idempotency: { supported: true, durable: true, retention_seconds: 86400 } }));
  synthetic.get('/api/sessions/:id', async () => ({ session: { id: sessionId, source: 'jarvis-command' } }));
  synthetic.post('/v1/runs', async () => { mutations++; return { run_id: runId, status: 'running' }; });
  synthetic.get('/v1/runs/:id', async () => ({ run_id: runId, session_id: sessionId, status: 'running', updated_at: '2026-09-04T14:00:00Z' }));
  synthetic.get('/v1/runs/:id/events', async (_request, reply) => reply.type('text/event-stream').send(`data: ${JSON.stringify({ run_id: runId, timestamp: '2026-09-04T14:00:00Z', ...upstreamEvent })}\n\n`));
  const hermesAddress = await synthetic.listen({ host: '127.0.0.1', port: 0 });
  const proxy = buildCommandProxy({ config: { host: '127.0.0.1', port: 8644, hermesBaseUrl: hermesAddress, commandProxyKey: 'c'.repeat(32), hermesApiKey: 'h'.repeat(32), maxStreamSeconds: 60 } });
  const proxyAddress = await proxy.listen({ host: '127.0.0.1', port: 0 });
  const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'cloudflare', CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'a'.repeat(64), CF_ACCESS_EMAIL_SHA256: createHash('sha256').update('operator@example.com').digest('hex'), CF_ACCESS_JWKS_FILE: jwksFile, HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: proxyAddress, HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(directory, 'audit.jsonl') });
  const app = createCommandServer(config);
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = { method: 'POST', headers, body: JSON.stringify({ sessionId, input: 'Synthetic identity probe', clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e' }) };
    const denied = await fetch(address + '/api/live/runs', { ...post, headers: { ...headers, 'cf-access-jwt-assertion': 'invalid' } });
    expect(denied.status).toBe(401); await denied.text(); expect(mutations).toBe(0);
    const admitted = await fetch(address + '/api/live/runs', post);
    expect(admitted.status).toBe(200);
    const { publicRunId } = await admitted.json() as { publicRunId: string };
    for (const type of ['approval.responded', 'tool.started', 'tool.completed', 'subagent.start', 'subagent.complete']) {
      const field = type === 'approval.responded' ? 'request_id' : type.startsWith('tool.') ? 'tool' : 'subagent_id';
      const publicField = field === 'request_id' ? 'requestId' : field === 'subagent_id' ? 'subagentId' : field;
      const limit = type === 'approval.responded' ? 256 : 160;
      for (const [identity, valid] of [['x'.repeat(limit), true], ['x'.repeat(limit + 1), false], [' padded', false], ['padded ', false], ['id\n', false], [undefined, false]] as const) {
        upstreamEvent = { event: type, [field]: identity, choice: 'once', duration: 0 };
        const response = await fetch(address + '/api/live/runs/' + publicRunId + '/events', { headers });
        expect(response.status).toBe(200);
        const text = await response.text();
        const data = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as Record<string, unknown>);
        if (valid) {
          expect(data).toContainEqual(expect.objectContaining({ publicRunId, type, [publicField]: identity }));
          expect(text).not.toContain('stream_unavailable');
        } else {
          expect(text, `${type}: ${JSON.stringify(identity)}`).toContain('stream_unavailable');
          expect(data.some(event => event.type === type)).toBe(false);
        }
        expect(text).not.toContain(runId);
        expect(data.some(event => String(event.type).startsWith('run.'))).toBe(false);
      }
    }
    for (const [type, inputField, outputField] of [
      ['tool.started', 'preview', 'preview'],
      ['subagent.start', 'goal', 'goal'],
      ['subagent.start', 'preview', 'goal'],
      ['subagent.complete', 'summary', 'summary'],
      ['subagent.complete', 'preview', 'summary'],
    ] as const) {
      for (const [value, expected] of [
        ['API_KEY="SYNTHETIC_QUOTED_SECRET" curl /exact-target', '[Metadata omitted]'],
        ["password='SYNTHETIC_SINGLE_QUOTED_SECRET' exact-target", '[Metadata omitted]'],
        ['Bearer "SYNTHETIC_BEARER_SECRET" exact-target', '[Metadata omitted]'],
        [String.raw`\"token\": \"SYNTHETIC_ESCAPED_KEY\"`, '[Metadata omitted]'],
        ['token=abc\nSYNTHETIC_CONTINUATION', '[Metadata omitted]'],
        ['token=q ; inspect /exact-target', 'token=[REDACTED] ; inspect /exact-target'],
        ['Inspect the service status', 'Inspect the service status'],
      ] as const) {
        upstreamEvent = { event: type, tool: 'terminal', subagent_id: 'child', [inputField]: value };
        const response = await fetch(address + '/api/live/runs/' + publicRunId + '/events', { headers, signal: AbortSignal.timeout(5_000) });
        expect(response.status).toBe(200);
        const text = await response.text();
        const data = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as Record<string, unknown>);
        expect(data).toContainEqual(expect.objectContaining({ publicRunId, type, [outputField]: expected }));
        expect(text).not.toContain('SYNTHETIC_');
        expect(text).not.toContain('stream_unavailable');
        expect(text).not.toContain(runId);
      }
    }
    const audit = await readFile(config.command!.auditLogPath, 'utf8');
    expect(audit).not.toContain('SYNTHETIC_');
    expect(mutations).toBe(1);
    for (const secret of [assertion, 'operator@example.com', 'Synthetic identity probe']) expect(audit).not.toContain(secret);
    expect(audit).not.toContain('run.completed');
  } finally { await app.close(); await proxy.close(); await synthetic.close(); await rm(directory, { recursive: true, force: true }); }
});

it.each(['漢'.repeat(16_000), '\u0000'.repeat(16_000)])('composes real Access, BFF, command HTTP client/proxy and durable audit across BFF restart with encoded input', async (input) => {
  const directory = await mkdtemp(join(tmpdir(), 'jc-integration-'));
  const pair = await generateKeyPair('RS256');
  const jwksFile = join(directory, 'jwks.json');
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', kid: 'test', use: 'sig' }] }));
  const assertion = await new SignJWT({ email: 'operator@example.com', type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://team.cloudflareaccess.com').setAudience('a'.repeat(64)).setSubject('operator').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const headers = { 'cf-access-jwt-assertion': assertion, origin: 'https://command.example', 'x-jarvis-command': '1', 'content-type': 'application/json' };
  const syntheticHermes = Fastify();
  const sessionId = 'jc_' + 'a'.repeat(32);
  const upstreamRunId = 'run_' + 'b'.repeat(32);
  let durable = true;
  let mutations = 0;
  const keys: string[] = [];
  syntheticHermes.addHook('onRequest', async (request, reply) => {
    if (request.headers.authorization !== 'Bearer ' + 'h'.repeat(32)) return reply.code(401).send({});
    expect(request.headers['cf-access-jwt-assertion']).toBeUndefined();
  });
  syntheticHermes.get('/v1/capabilities', async () => ({ idempotency: { supported: true, durable, retention_seconds: 86400 } }));
  syntheticHermes.get('/api/sessions/:id', async () => ({ session: { id: sessionId, source: 'jarvis-command' } }));
  syntheticHermes.post('/v1/runs', async (request) => { mutations++; keys.push(String(request.headers['idempotency-key'])); return { run_id: upstreamRunId, status: 'running', replayed: false }; });
  syntheticHermes.get('/v1/runs/:id', async () => ({ run_id: upstreamRunId, session_id: sessionId, status: 'running', updated_at: '2026-09-04T14:00:00.000Z' }));
  const hermesAddress = await syntheticHermes.listen({ host: '127.0.0.1', port: 0 });
  const proxy = buildCommandProxy({ config: { host: '127.0.0.1', port: 8644, commandProxyKey: 'c'.repeat(32), hermesApiKey: 'h'.repeat(32), hermesBaseUrl: hermesAddress, maxStreamSeconds: 60 } });
  const proxyAddress = await proxy.listen({ host: '127.0.0.1', port: 0 });
  const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'cloudflare', CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'a'.repeat(64), CF_ACCESS_EMAIL_SHA256: createHash('sha256').update('operator@example.com').digest('hex'), CF_ACCESS_JWKS_FILE: jwksFile, HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: proxyAddress, HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(directory, 'audit.jsonl') });
  const hermes = { readSnapshot: async () => ({ state: 'online' as const, version: null, model: null, provider: null, gatewayState: 'idle' as const, activeAgents: 0, capabilities: [], readinessChecks: {}, sessions: [] }) };
  let app = createCommandServer(config, { hermes });
  try {
    const bootstrap = await app.inject({ url: '/api/bootstrap', headers });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().command.liveRoom).toMatchObject({ enabled: true, externalContinue: false });
    const payload = { sessionId, input, clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e' };
    expect((await app.inject({ method: 'POST', url: '/api/live/runs', payload })).statusCode).toBe(401);
    expect(mutations).toBe(0);
    for (const [input, status] of [['x'.repeat(16_001), 400], ['x'.repeat(131_073), 413]] as const) {
      expect((await app.inject({ method: 'POST', url: '/api/live/runs', headers, payload: { ...payload, input } })).statusCode).toBe(status);
      expect((await proxy.inject({ method: 'POST', url: '/v1/runs', headers: { authorization: 'Bearer ' + 'c'.repeat(32), 'idempotency-key': 'jc-v1-' + 'a'.repeat(64) }, payload: { sessionId, input } })).statusCode).toBe(status);
    }
    const first = await app.inject({ method: 'POST', url: '/api/live/runs', headers, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json().publicRunId).toMatch(/^jcr_[a-f0-9]{32}$/);
    expect(first.body).not.toContain(upstreamRunId);
    await app.close();
    app = createCommandServer(config, { hermes });
    const replay = await app.inject({ method: 'POST', url: '/api/live/runs', headers, payload });
    expect(replay.json()).toEqual({ ...first.json(), replayed: true });
    expect(mutations).toBe(1);
    expect(keys[0]).toMatch(/^jc-v1-[a-f0-9]{64}$/);
    durable = false;
    expect((await app.inject({ url: '/api/bootstrap', headers })).json().command.liveRoom.enabled).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/live/runs', headers, payload: { ...payload, clientRequestId: 'f68e1bc3-d6d8-4eec-b50c-20fbfdafd515' } })).statusCode).toBe(503);
    expect(mutations).toBe(1);
    const audit = await readFile(config.command!.auditLogPath, 'utf8');
    for (const secret of ['PRIVATE PROMPT', assertion, 'operator@example.com', 'c'.repeat(32)]) expect(audit).not.toContain(secret);
  } finally { await app.close(); await proxy.close(); await syntheticHermes.close(); await rm(directory, { recursive: true, force: true }); }
});
