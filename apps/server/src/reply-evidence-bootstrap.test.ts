import { createECDH, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import webpush from 'web-push';
import { afterEach, expect, it } from 'vitest';
import { createCommandServer } from './bootstrap';
import { loadConfig } from './config';
import type { PushRequest } from './push-service';

// Real createCommandServer + onReady + protected routes against a synthetic loopback proxy and a
// disposable push transport. Nothing here reaches a provider, device or external host.
const sessionId = `jc_${'a'.repeat(32)}`;
const keys = webpush.generateVAPIDKeys();
const receiver = createECDH('prime256v1'); receiver.generateKeys();
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', expirationTime: null, keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
const push = { WEB_PUSH_MODE: 'enabled', WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.invalid' };
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).reverse().map(fn => fn())); });

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'jc-reply-factory-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const runIds = [`run_${'1'.repeat(32)}`, `run_${'2'.repeat(32)}`, `run_${'3'.repeat(32)}`];
  const state = { admitted: 0, bind: [true, true, true], foreign: false, historyGets: 0, runGets: 0, posts: 0 };
  const session = { id: sessionId, title: 'SYNTHETIC', source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-11-06T12:00:00Z', messageCount: 1, toolCallCount: 0, pinned: false };
  const messages = (assistantId: string) => [
    { id: 'u-1', sessionId, role: 'user', content: 'SYNTHETIC question', timestamp: null, toolName: null, displayKind: null },
    { id: assistantId, sessionId, role: 'assistant', content: 'The **synthetic** answer.', timestamp: null, toolName: null, displayKind: null },
  ];
  const proxy = Fastify();
  proxy.get('/_ready', async () => ({ ready: true, durableIdempotency: true, retentionSeconds: 86400, externalContinue: false }));
  proxy.get(`/api/sessions/${sessionId}`, async () => ({ session }));
  proxy.get(`/api/sessions/${sessionId}/messages`, async () => {
    state.historyGets++;
    return { sessionId, messages: messages('a-1'), pagination: { limit: 50, offset: 0, returned: 2, hasMore: false } };
  });
  proxy.post('/v1/runs', async () => { state.posts++; return { runId: runIds[state.admitted++]!, sessionId, status: 'running', replayed: false }; });
  proxy.get('/v1/runs/:runId', async request => {
    state.runGets++;
    const index = runIds.indexOf((request.params as { runId: string }).runId);
    const binding = state.bind[index] ? { historyBinding: { userMessageId: 'u-1', assistantMessageId: state.foreign ? 'a-foreign' : 'a-1' } } : {};
    return { runId: runIds[index], sessionId, status: 'completed', updatedAt: new Date().toISOString(), approval: null, output: null, error: null, pendingSteer: null,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, execution: { requested: { provider: 'p', model: 'requested-m', reasoningEffort: null }, executed: { provider: 'p', model: 'executed-m', reasoningEffort: null, reasoningEffortSource: 'unknown' }, routeSource: null, exact: false, fallbackUsed: false } }, ...binding };
  });
  const address = await proxy.listen({ host: '127.0.0.1', port: 0 });
  cleanup.push(() => proxy.close());
  const sent: PushRequest[] = [];
  const environment = { NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', HERMES_COMMAND_API_BASE_URL: address, HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), PUBLIC_ORIGIN: 'https://command.example', COMMAND_AUDIT_LOG_PATH: join(directory, 'audit.jsonl'), ARTIFACTS_MODE: 'disabled' };
  const headers = { origin: environment.PUBLIC_ORIGIN, 'x-jarvis-command': '1', 'content-type': 'application/json' };
  const open = (extra: Record<string, string>) => {
    const app = createCommandServer(loadConfig({ ...environment, ...extra }), {
      hermes: { readSnapshot: async () => { throw Error('SYNTHETIC unavailable'); } },
      pushTransport: async request => { sent.push(request); return 201; },
    });
    cleanup.push(() => app.close());
    const post = (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, headers, payload: JSON.stringify(payload) });
    const submit = async (n: number) => {
      const response = await post('/api/live/runs', { sessionId, input: 'SYNTHETIC input', clientRequestId: `00000000-0000-4000-8000-00000000000${n}` });
      expect(response.statusCode).toBe(200);
      return response.json().publicRunId as string;
    };
    const observe = async (publicRunId: string) => { const r = await app.inject({ url: `/api/live/runs/${publicRunId}` }); expect([r.statusCode, r.body]).toEqual([200, expect.anything()]); };
    const inbox = async () => (await app.inject({ url: '/api/notifications' })).json();
    return { app, post, submit, observe, inbox };
  };
  return { state, sent, open };
}

it('keeps every partial combination inert and reports each state distinctly', async () => {
  const h = await harness();
  const cases: Array<[Record<string, string>, string]> = [
    [{}, 'disabled'],
    [{ REPLY_EVIDENCE_MODE: 'enabled' }, 'disabled'],
    [{ ...push, REPLY_NOTIFICATIONS_MODE: 'enabled' }, 'unsupported'],
    [{ ...push, REPLY_EVIDENCE_MODE: 'enabled' }, 'disabled'],
    [{ REPLY_NOTIFICATIONS_MODE: 'enabled', REPLY_EVIDENCE_MODE: 'enabled' }, 'available'],
  ];
  for (const [extra, replies] of cases) {
    const s = h.open(extra);
    await s.app.ready();
    const before = await s.inbox();
    expect(before.delivery.replies).toBe(replies);
    expect(before.push.capability.state === 'available').toBe('WEB_PUSH_MODE' in extra);
  }
  // Only the last case (no push transport configured, so no send) reads evidence; inert cases never read history.
  expect(h.state.historyGets).toBe(0);
  expect(h.sent).toEqual([]);
});

it('real factory binds exact evidence after onReady and yields one item and one push across repeats, reconcile and restart', async () => {
  const h = await harness();
  const env = { ...push, REPLY_NOTIFICATIONS_MODE: 'enabled', REPLY_EVIDENCE_MODE: 'enabled' };
  let s = h.open(env);
  await s.app.ready();
  expect((await s.inbox()).delivery.replies).toBe('available');
  expect((await s.post('/api/notifications/push/devices', subscription)).statusCode).toBe(200);
  const first = await s.submit(1);
  await s.observe(first); await s.observe(first);
  expect((await s.post('/api/notifications/reconcile')).statusCode).toBe(200);
  let inbox = await s.inbox();
  const replies = inbox.items.filter((item: { category?: string }) => item.category === 'assistant-reply');
  expect(replies).toHaveLength(1);
  expect(replies[0]).toMatchObject({ sessionId, body: 'The synthetic answer.', reply: { messageId: 'a-1', label: 'executed-m' } });
  expect(h.sent).toHaveLength(1);
  expect(h.state.posts).toBe(1);

  await s.app.close(); s = h.open(env); await s.app.ready();
  await s.observe(first); await s.post('/api/notifications/reconcile');
  inbox = await s.inbox();
  expect(inbox.items.filter((item: { category?: string }) => item.category === 'assistant-reply')).toHaveLength(1);
  expect(h.sent).toHaveLength(1);
  expect(h.state.posts).toBe(1);

  // Missing binding, then a binding naming a message the session history does not contain.
  h.state.bind[1] = false;
  const second = await s.submit(2); await s.observe(second);
  h.state.foreign = true;
  const third = await s.submit(3); await s.observe(third);
  inbox = await s.inbox();
  expect(inbox.items.filter((item: { category?: string }) => item.category === 'assistant-reply')).toHaveLength(1);
  expect(h.sent).toHaveLength(1);
  expect(h.state.posts).toBe(3);
});
