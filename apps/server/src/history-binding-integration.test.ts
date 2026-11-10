import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { buildCommandProxy } from '../../command-proxy/src/app';
import { createCommandServer } from './bootstrap';
import { loadConfig } from './config';

const sessionId = 'jc_' + 'a'.repeat(32);
const otherSessionId = 'jc_' + 'd'.repeat(32);
const runIds = ['run_' + '1'.repeat(32), 'run_' + '2'.repeat(32)];
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

async function harness(historyBindingEnabled: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'jc-binding-'));
  const pair = await generateKeyPair('RS256');
  const jwksFile = join(directory, 'jwks.json');
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', kid: 'test', use: 'sig' }] }));
  const assertion = await new SignJWT({ email: 'operator@example.com', type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://team.cloudflareaccess.com').setAudience('a'.repeat(64)).setSubject('operator').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const headers = { 'cf-access-jwt-assertion': assertion, origin: 'https://command.example', 'x-jarvis-command': '1', 'content-type': 'application/json' };
  const hermes = Fastify();
  const counts = { posts: 0, statusGets: 0, otherCalls: 0 };
  // Per-run mutable upstream status body.
  const runs: Record<string, Record<string, unknown>> = {};
  const base = (runId: string, binding: unknown) => ({ run_id: runId, session_id: sessionId, status: 'completed', updated_at: '2026-09-04T14:00:00Z', usage, output: 'same text', ...(binding === undefined ? {} : { history_binding: binding }) });
  hermes.addHook('onRequest', async (request, reply) => { if (request.headers.authorization !== 'Bearer ' + 'h'.repeat(32)) return reply.code(401).send({}); });
  hermes.get('/v1/capabilities', async () => ({ features: { runs_idempotency: { supported: true, durable: true, retention_seconds: 86400 } } }));
  hermes.get('/api/sessions/:id', async () => ({ session: { id: sessionId, source: 'jarvis-command' } }));
  hermes.get('/api/sessions/:id/messages', async () => {
    const row = (id: number, role: string) => ({ id, session_id: sessionId, role, content: 'same text', timestamp: 1_788_530_400 + id });
    return { session_id: sessionId, data: [row(1, 'user'), row(2, 'assistant'), row(3, 'user'), row(4, 'assistant')], pagination: { limit: 100, offset: 0, returned: 4, order: 'oldest' } };
  });
  hermes.post('/v1/runs', async () => { const runId = runIds[counts.posts++]!; runs[runId] = base(runId, undefined); return { run_id: runId, status: 'running', replayed: false }; });
  hermes.get('/v1/runs/:id', async (request) => { counts.statusGets++; return runs[(request.params as { id: string }).id]; });
  hermes.setNotFoundHandler(async (_request, reply) => { counts.otherCalls++; return reply.code(404).send({}); });
  const hermesAddress = await hermes.listen({ host: '127.0.0.1', port: 0 });
  const proxy = buildCommandProxy({ config: { host: '127.0.0.1', port: 8644, commandProxyKey: 'c'.repeat(32), hermesApiKey: 'h'.repeat(32), hermesBaseUrl: hermesAddress, maxStreamSeconds: 60, anthropicRoutesEnabled: false, openRouterFreeRoutesEnabled: false, historyBindingEnabled } });
  const proxyAddress = await proxy.listen({ host: '127.0.0.1', port: 0 });
  const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'cloudflare', CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'a'.repeat(64), CF_ACCESS_EMAIL_SHA256: createHash('sha256').update('operator@example.com').digest('hex'), CF_ACCESS_JWKS_FILE: jwksFile, HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: proxyAddress, HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(directory, 'audit.jsonl') });
  const app = createCommandServer(config, { hermes: { readSnapshot: async () => ({ state: 'online' as const, version: null, model: null, provider: null, gatewayState: 'idle' as const, activeAgents: 0, capabilities: [], readinessChecks: {}, sessions: [] }) } });
  const submit = async (clientRequestId: string) => (await app.inject({ method: 'POST', url: '/api/live/runs', headers, payload: { sessionId, input: 'same text', clientRequestId } })).json().publicRunId as string;
  const status = async (publicRunId: string) => app.inject({ url: '/api/live/runs/' + publicRunId, headers });
  const close = async () => { await app.close(); await proxy.close(); await hermes.close(); await rm(directory, { recursive: true, force: true }); };
  return { app, proxy, runs, counts, base, submit, status, close };
}

describe('history binding projection (disabled by default, installed Hermes support UNKNOWN)', () => {
  it('binds each of two identical-text turns to its own native rows with the same IDs as history', async () => {
    const h = await harness(true);
    try {
      const [a, b] = [await h.submit('c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e'), await h.submit('f68e1bc3-d6d8-4eec-b50c-20fbfdafd515')];
      h.runs[runIds[0]!] = h.base(runIds[0]!, { version: 1, user_message_id: 1, assistant_message_id: 2 });
      h.runs[runIds[1]!] = h.base(runIds[1]!, { version: 1, user_message_id: 3, assistant_message_id: 4 });
      const history = (await h.proxy.inject({ url: `/api/sessions/${sessionId}/messages?limit=100`, headers: { authorization: 'Bearer ' + 'c'.repeat(32) } })).json() as { messages?: Array<{ id: string }>; data?: Array<{ id: string }> };
      const ids = (history.messages ?? history.data!).map(m => m.id);
      const posts = h.counts.posts;
      for (let i = 0; i < 3; i++) {
        const first = (await h.status(a)).json(), second = (await h.status(b)).json();
        expect(first.historyBinding).toEqual({ userMessageId: ids[0], assistantMessageId: ids[1] });
        expect(second.historyBinding).toEqual({ userMessageId: ids[2], assistantMessageId: ids[3] });
        expect(JSON.stringify(first)).not.toContain(runIds[0]);
        expect(first.usage).toEqual({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
      }
      expect(h.counts.posts).toBe(posts);
      expect(h.counts.otherCalls).toBe(0);
    } finally { await h.close(); }
  });

  it('omits the binding when the gate is absent even if upstream supplies valid evidence', async () => {
    const h = await harness(false);
    try {
      const a = await h.submit('c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e');
      h.runs[runIds[0]!] = h.base(runIds[0]!, { version: 1, user_message_id: 1, assistant_message_id: 2 });
      const res = await h.status(a);
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('historyBinding');
    } finally { await h.close(); }
  });

  it('fails closed to no binding for invalid evidence while ordinary status still succeeds', async () => {
    const h = await harness(true);
    try {
      const a = await h.submit('c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e');
      const bad: unknown[] = [
        null, {}, 'x', [1, 2], { version: 2, user_message_id: 1, assistant_message_id: 2 },
        { version: 1, user_message_id: 0, assistant_message_id: 2 }, { version: 1, user_message_id: -1, assistant_message_id: 2 },
        { version: 1, user_message_id: 1.5, assistant_message_id: 2 }, { version: 1, user_message_id: true, assistant_message_id: 2 },
        { version: 1, user_message_id: '1', assistant_message_id: 2 },
        { version: 1, user_message_id: 2 ** 53, assistant_message_id: 2 },
        { version: 1, user_message_id: 5, assistant_message_id: 5 },
        { version: 1, user_message_id: 1, assistant_message_id: 2, extra: 'x' },
        { version: 1, user_message_id: 1 },
      ];
      for (const binding of bad) {
        h.runs[runIds[0]!] = h.base(runIds[0]!, binding);
        const res = await h.status(a);
        expect(res.statusCode, JSON.stringify(binding)).toBe(200);
        expect(res.json(), JSON.stringify(binding)).not.toHaveProperty('historyBinding');
        expect(res.json().status).toBe('completed');
      }
      // Legacy completed status with no optional evidence at all.
      h.runs[runIds[0]!] = h.base(runIds[0]!, undefined);
      expect((await h.status(a)).json()).not.toHaveProperty('historyBinding');
      // Non-completed and compaction statuses never carry a binding.
      const valid = { version: 1, user_message_id: 1, assistant_message_id: 2 };
      h.runs[runIds[0]!] = { ...h.base(runIds[0]!, valid), status: 'running', usage: {} };
      expect((await h.status(a)).json()).not.toHaveProperty('historyBinding');
      h.runs[runIds[0]!] = { ...h.base(runIds[0]!, valid), kind: 'context_compaction', result: null };
      expect((await h.status(a)).json()).not.toHaveProperty('historyBinding');
      // Safe maximum is accepted losslessly.
      h.runs[runIds[0]!] = h.base(runIds[0]!, { version: 1, user_message_id: 9007199254740990, assistant_message_id: 9007199254740991 });
      expect((await h.status(a)).json().historyBinding).toEqual({ userMessageId: '9007199254740990', assistantMessageId: '9007199254740991' });
    } finally { await h.close(); }
  });

  it('rejects a foreign upstream session or run even with a valid binding', async () => {
    const h = await harness(true);
    try {
      const a = await h.submit('c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e');
      const valid = { version: 1, user_message_id: 1, assistant_message_id: 2 };
      h.runs[runIds[0]!] = { ...h.base(runIds[0]!, valid), session_id: otherSessionId };
      const wrongSession = await h.status(a);
      expect(wrongSession.statusCode).not.toBe(200);
      expect(wrongSession.body).not.toContain('historyBinding');
      h.runs[runIds[0]!] = h.base(runIds[1]!, valid);
      const wrongRun = await h.status(a);
      expect(wrongRun.statusCode).not.toBe(200);
      expect(wrongRun.body).not.toContain('historyBinding');
      expect((await h.status('jcr_' + 'f'.repeat(32))).statusCode).toBe(404);
    } finally { await h.close(); }
  });
});
