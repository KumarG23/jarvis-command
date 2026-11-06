import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { createCommandServer } from './bootstrap';
import { loadConfig } from './config';

it('real factory binds reactions after onReady and freezes ordinary sends through client/socket ACK loss and restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jc-reaction-factory-'));
  const sessionId = `jc_${'a'.repeat(32)}`, runId = `run_${'b'.repeat(32)}`;
  const session = { id: sessionId, title: 'SYNTHETIC local fixture', source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-11-06T12:00:00Z', messageCount: 1, toolCallCount: 0, pinned: false };
  const calls: string[] = [], starts: { key: string; body: unknown }[] = [];
  const canonical = new Set<string>();
  const proxy = Fastify();
  proxy.addHook('onRequest', async (request, reply) => {
    calls.push(`${request.method} ${request.url}`);
    expect(request.headers['cf-access-jwt-assertion']).toBeUndefined();
    if (request.headers.authorization !== `Bearer ${'c'.repeat(32)}`) return reply.code(401).send({});
  });
  proxy.get('/_ready', async () => ({ ready: true, durableIdempotency: true, retentionSeconds: 86400, externalContinue: false }));
  proxy.get(`/api/sessions/${sessionId}`, async () => ({ session }));
  proxy.get(`/api/sessions/${sessionId}/messages`, async request => {
    expect(request.query).toEqual({ limit: '100', offset: '0' });
    return { sessionId, messages: [{ id: 'durable-42', sessionId, role: 'user', content: 'SYNTHETIC private transcript', timestamp: null, toolName: null, displayKind: null }], pagination: { limit: 100, offset: 0, returned: 1, hasMore: false } };
  });
  proxy.post('/v1/runs', async (request, reply) => {
    const key = request.headers['idempotency-key'] as string;
    starts.push({ key, body: request.body }); canonical.add(key);
    if (starts.length === 1) return reply.code(503).send({ error: 'SYNTHETIC unknown ACK after canonical commit' });
    return { runId, sessionId, status: 'completed', replayed: true };
  });
  proxy.get(`/v1/runs/${runId}`, async () => ({ runId, sessionId, status: 'completed', updatedAt: '2026-11-06T12:00:00Z', approval: null, output: null, error: null, pendingSteer: null, usage: null }));
  const address = await proxy.listen({ host: '127.0.0.1', port: 0 });
  const environment = { NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', HERMES_COMMAND_API_BASE_URL: address, HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), PUBLIC_ORIGIN: 'https://command.example', COMMAND_AUDIT_LOG_PATH: join(directory, 'audit.jsonl'), ARTIFACTS_MODE: 'disabled' };
  const factory = (enabled: boolean) => createCommandServer(loadConfig({ ...environment, ...(enabled ? { REACTIONS_MODE: 'enabled' } : {}) }), { hermes: { readSnapshot: async () => { throw Error('SYNTHETIC unavailable'); } } });
  let app = factory(false);
  const headers = { origin: environment.PUBLIC_ORIGIN, 'x-jarvis-command': '1', 'content-type': 'application/json' };
  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers, payload: JSON.stringify(payload) });
  const target = { sessionId, messageId: 'durable-42', offset: 0 };
  const mutation = { ...target, emoji: '❤️', action: 'toggle', clientRequestId: '00000000-0000-4000-8000-000000000001' };
  try {
    expect((await post('/api/live/reactions/mutate', mutation)).statusCode).toBe(409);
    expect(starts).toHaveLength(0); await app.close(); app = factory(true);
    expect((await post('/api/live/reactions/mutate', mutation)).json()).toMatchObject({ active: true, replayed: false });
    expect((await post('/api/live/reactions/read', target)).json()).toMatchObject({ emojis: ['❤️'] });
    expect(calls.every(call => call.startsWith('GET '))).toBe(true);
    const request = { sessionId, input: 'SYNTHETIC explicit input', clientRequestId: '00000000-0000-4000-8000-000000000002' };
    expect((await post('/api/live/runs', request)).statusCode).toBe(503);
    expect(starts).toHaveLength(1); expect(starts[0]!.body).toMatchObject({ input: expect.stringContaining('reaction context') });
    await app.close(); app = factory(false);
    const recovered = await post('/api/live/runs', request); expect(recovered.statusCode).toBe(200); expect(recovered.json().replayed).toBe(true);
    expect(starts).toHaveLength(2); expect(starts[1]).toEqual(starts[0]); expect(canonical.size).toBe(1);
    await app.close(); app = factory(true);
    expect((await post('/api/live/reactions/mutate', mutation)).json()).toMatchObject({ replayed: true, active: true });
    expect((await post('/api/live/runs', request)).statusCode).toBe(200); expect(starts).toHaveLength(2);
    expect(await readFile(join(directory, 'reactions.json'), 'utf8')).not.toContain('private transcript');
    expect(await readFile(join(directory, 'audit.jsonl'), 'utf8')).not.toContain(request.input);
  } finally { await app.close(); await proxy.close(); await rm(directory, { recursive: true, force: true }); }
});
