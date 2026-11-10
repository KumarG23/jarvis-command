import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import webpush from 'web-push';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCommandProxy } from '../../command-proxy/src/app';
import { AuditLedger } from './audit-ledger';
import { createCommandProxyClient } from './command-client';
import { NotificationStore } from './notification-store';
import { createPushService, pushConfig, type PushRequest } from './push-service';
import { createReplyNotifier, replyNotificationId, type ReplyRun } from './reply-notifier';
import { createReplyEvidenceSource, REPLY_HISTORY_MAX_CONTENT_BYTES, REPLY_HISTORY_MAX_PAGES } from './reply-evidence-source';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const alice = hash('alice'), bob = hash('bob');
const sessionId = 'jc_' + 'a'.repeat(32);
const otherSession = 'jc_' + 'd'.repeat(32);
const publicIds = ['jcr_' + '1'.repeat(32), 'jcr_' + '2'.repeat(32)];
const upstreamIds = ['run_' + '1'.repeat(32), 'run_' + '2'.repeat(32)];
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };
const endpoint = (model: string | null) => ({ provider: 'synthetic', model, reasoning_effort: null });
const execution = (requested: string, executed: string) => ({ requested: endpoint(requested), executed: { ...endpoint(executed), reasoning_effort_source: 'unknown' }, route_source: null, exact: false, fallback_used: false });
const keys = webpush.generateVAPIDKeys();
const env = { WEB_PUSH_MODE: 'enabled', WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.invalid', REPLY_NOTIFICATIONS_MODE: 'enabled' };

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).reverse().map(fn => fn())); });

type Page = { session_id: string; data: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
type Row = { id: number; role: string; content: string; session_id?: string };
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'jc-evidence-')); await chmod(directory, 0o700);
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const counts = { posts: 0, runGets: 0, pageGets: 0, other: 0 };
  const state: { rows: Row[]; runs: Record<string, Record<string, unknown>>; pageOffsets: number[]; tamper?: (body: Page) => Page } = { rows: [], runs: {}, pageOffsets: [] };
  const hermes = Fastify();
  hermes.addHook('onRequest', async (request, reply) => { if (request.headers.authorization !== 'Bearer ' + 'h'.repeat(32)) return reply.code(401).send({}); });
  hermes.get('/api/sessions/:id/messages', async (request) => {
    const { limit, offset } = request.query as { limit: string; offset: string };
    counts.pageGets++; state.pageOffsets.push(Number(offset));
    const data = state.rows.slice(Number(offset), Number(offset) + Number(limit)).map(row => ({ session_id: sessionId, timestamp: 1_788_530_400 + row.id, ...row }));
    const body = { session_id: sessionId, data, pagination: { limit: Number(limit), offset: Number(offset), returned: data.length, order: 'oldest' } };
    return state.tamper ? state.tamper(body) : body;
  });
  hermes.get('/v1/runs/:id', async (request) => { counts.runGets++; return state.runs[(request.params as { id: string }).id]; });
  hermes.post('/*', async () => { counts.posts++; return {}; });
  hermes.setNotFoundHandler(async (_request, reply) => { counts.other++; return reply.code(404).send({}); });
  const hermesAddress = await hermes.listen({ host: '127.0.0.1', port: 0 });
  cleanup.push(() => hermes.close());
  const proxy = buildCommandProxy({ config: { host: '127.0.0.1', port: 8644, commandProxyKey: 'c'.repeat(32), hermesApiKey: 'h'.repeat(32), hermesBaseUrl: hermesAddress, maxStreamSeconds: 60, anthropicRoutesEnabled: false, openRouterFreeRoutesEnabled: false, historyBindingEnabled: true } });
  const proxyAddress = await proxy.listen({ host: '127.0.0.1', port: 0 });
  cleanup.push(() => proxy.close());
  const client = createCommandProxyClient({ baseUrl: proxyAddress, commandProxyKey: 'c'.repeat(32) });
  const ledger = await AuditLedger.open(join(directory, 'audit.jsonl'));
  cleanup.push(() => ledger.close());
  for (const [index, publicRunId] of publicIds.entries()) {
    const draft = { actor: alice, sessionId, publicRunId, clientRequestId: `00000000-0000-4000-8000-00000000000${index}`, requestId: null, requestFingerprint: 'b'.repeat(64), choice: null };
    await ledger.appendOnce(`request:${publicRunId}`, { ...draft, action: 'run.requested', upstreamRunId: null, outcome: 'requested', status: 'queued' });
    await ledger.appendOnce(`started:${publicRunId}`, { ...draft, action: 'run.started', upstreamRunId: upstreamIds[index]!, outcome: 'succeeded', status: 'running' });
  }
  const sent: PushRequest[] = [];
  const open = () => {
    const store = new NotificationStore(directory);
    return { store, push: createPushService(pushConfig(env), store, async request => { sent.push(request); return 201; }) };
  };
  const status = (index: number, binding: unknown, over: Record<string, unknown> = {}) => {
    state.runs[upstreamIds[index]!] = { run_id: upstreamIds[index], session_id: sessionId, status: 'completed', updated_at: '2026-09-04T14:00:00Z', usage, output: 'same text', history_binding: binding, ...over };
  };
  const bind = (user: number, assistant: number) => ({ version: 1, user_message_id: user, assistant_message_id: assistant });
  const source = createReplyEvidenceSource({ client, ledger });
  const run = (index: number, over: Partial<ReplyRun> = {}): ReplyRun => ({ actor: alice, sessionId, publicRunId: publicIds[index]!, eventAt: new Date(Date.now() + 3_600_000).toISOString(), ...over });
  const notifier = (from = open()) => ({ from, notify: createReplyNotifier({ store: from.store, push: from.push, enabled: true, source }) });
  const reads = () => ({ ...counts });
  return { counts, state, source, run, status, bind, notifier, open, reads, sent };
}
const turns = (): Row[] => [
  { id: 1, role: 'user', content: 'same text' }, { id: 2, role: 'assistant', content: 'same text' },
  { id: 3, role: 'user', content: 'same text' }, { id: 4, role: 'assistant', content: 'same text' },
];

describe('reply evidence source (disabled factory, fixtures only)', () => {
  it('binds identical-text turns to their own ids, also older run after newer, with unknown label when no receipt', async () => {
    const h = await harness();
    h.state.rows = turns();
    h.status(0, h.bind(1, 2)); // minimal recovered status: no execution receipt
    h.status(1, h.bind(3, 4), { usage: { ...usage, execution: execution('requested-model', 'executed-model') } });
    const evidenceNew = await h.source(h.run(1));
    const evidenceOld = await h.source(h.run(0));
    expect(evidenceNew).toMatchObject({ assistantMessageId: '4', message: { id: '4', role: 'assistant' }, executed: { model: 'executed-model' } });
    expect(evidenceOld).toMatchObject({ assistantMessageId: '2', message: { id: '2' }, executed: { model: null } });
    expect(h.counts.posts).toBe(0);
    expect(h.counts.other).toBe(0);
  });

  it('delivers once through the existing notifier: exact id, unknown label, concurrent/repeated/reopened dedupe', async () => {
    const h = await harness();
    h.state.rows = turns();
    h.status(0, h.bind(1, 2));
    h.status(1, h.bind(3, 4), { usage: { ...usage, execution: execution('requested-model', 'executed-model') } });
    const { from, notify } = h.notifier();
    expect(await Promise.all([notify(h.run(1)), notify(h.run(1)), notify(h.run(1))])).toContain(true);
    await notify(h.run(1));
    await h.notifier(h.open()).notify(h.run(1)); // store reopened
    await h.notifier(h.open()).notify(h.run(0));
    const items = (await h.open().store.read(alice)).items.filter(item => item.category === 'assistant-reply');
    expect(items.map(item => item.reply?.messageId).sort()).toEqual(['2', '4']);
    expect(items.find(item => item.reply?.messageId === '4')).toMatchObject({ title: 'Reply from executed-model', body: 'same text' });
    expect(items.find(item => item.reply?.messageId === '2')).toMatchObject({ title: 'Jarvis replied' });
    expect(items.map(item => item.id).sort()).toEqual([replyNotificationId(alice, sessionId, '2'), replyNotificationId(alice, sessionId, '4')].sort());
    expect(h.counts.posts).toBe(0);
    expect(from.store).toBeDefined();
  });

  it('finds a target on a later bounded page and fails closed beyond the page bound', async () => {
    const h = await harness();
    h.state.rows = Array.from({ length: 300 }, (_, index) => ({ id: index + 1, role: index % 2 ? 'assistant' : 'user', content: `row ${index + 1}` }));
    h.status(0, h.bind(101, 102));
    expect(await h.source(h.run(0))).toMatchObject({ message: { id: '102', content: 'row 102' } });
    expect(h.state.pageOffsets).toEqual([0, 50, 100, 150]);
    h.state.pageOffsets.length = 0; h.counts.pageGets = 0;
    h.status(1, h.bind(251, 252));
    expect(await h.source(h.run(1))).toBeNull();
    expect(h.counts.pageGets).toBe(REPLY_HISTORY_MAX_PAGES);
    expect(Math.max(...h.state.pageOffsets)).toBeLessThan(REPLY_HISTORY_MAX_PAGES * 50);
  });

  it('returns null for missing, duplicate, non-assistant, empty and foreign evidence', async () => {
    const h = await harness();
    const cases: Array<[string, Row[], unknown, Record<string, unknown>?]> = [
      ['absent target', turns().slice(0, 3), h.bind(1, 2) && h.bind(3, 4)],
      ['user target', turns(), h.bind(2, 3)],
      ['empty target', [{ id: 1, role: 'user', content: 'q' }, { id: 2, role: 'assistant', content: '  ' }], h.bind(1, 2)],
      ['duplicate target', [...turns(), { id: 4, role: 'assistant', content: 'other' }], h.bind(3, 4)],
      ['foreign row session', [{ id: 1, role: 'user', content: 'q' }, { id: 2, role: 'assistant', content: 'a', session_id: otherSession }], h.bind(1, 2)],
      ['no binding', turns(), undefined],
      ['malformed binding', turns(), { version: 2, user_message_id: 1, assistant_message_id: 2 }],
      ['running', turns(), h.bind(1, 2), { status: 'running', usage: {} }],
      ['compaction', turns(), h.bind(1, 2), { kind: 'context_compaction', result: null }],
      ['foreign status session', turns(), h.bind(1, 2), { session_id: otherSession }],
      ['foreign status run', turns(), h.bind(1, 2), { run_id: upstreamIds[1] }],
    ];
    for (const [name, rows, binding, over] of cases) {
      h.state.rows = rows; h.status(0, binding, over);
      expect(await h.source(h.run(0)), name).toBeNull();
    }
    expect(h.counts.posts).toBe(0);
  });

  it('reads nothing upstream for wrong actor, public run, session or unadmitted identity', async () => {
    const h = await harness();
    h.state.rows = turns(); h.status(0, h.bind(1, 2));
    const before = h.reads();
    for (const run of [h.run(0, { actor: bob }), h.run(0, { publicRunId: 'jcr_' + 'f'.repeat(32) }), h.run(0, { sessionId: otherSession }), h.run(1, { actor: bob })]) {
      expect(await h.source(run)).toBeNull();
    }
    expect(h.reads()).toEqual(before);
    expect(await h.source(h.run(0))).not.toBeNull();
  });

  it('rejects a conflicting duplicate of the bound id on a later page inside the bounded window', async () => {
    const h = await harness();
    const rows: Row[] = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, role: index % 2 ? 'assistant' : 'user', content: `row ${index + 1}` }));
    h.state.rows = [...rows, { id: 2, role: 'assistant', content: 'conflicting answer' }];
    h.status(0, h.bind(1, 2));
    expect(await h.source(h.run(0))).toBeNull();
    expect(h.counts.pageGets).toBe(2);
    expect(h.counts.posts).toBe(0);
    h.state.rows = rows; // same window without the conflict resolves
    expect(await h.source(h.run(0))).toMatchObject({ message: { id: '2', content: 'row 2' } });
  });

  it('bounds content by UTF-8 bytes, not string length', async () => {
    const h = await harness();
    const wide = '€'.repeat(20_000); // 3 bytes per character
    const rows: Row[] = [{ id: 1, role: 'user', content: 'q' }, { id: 2, role: 'assistant', content: 'a' }];
    for (let id = 3; id <= 20; id++) rows.push({ id, role: 'tool', content: wide });
    h.state.rows = rows; h.status(0, h.bind(1, 2));
    const bytes = rows.reduce((total, row) => total + Buffer.byteLength(row.content), 0);
    expect(bytes).toBeGreaterThan(REPLY_HISTORY_MAX_CONTENT_BYTES); // under the limit by char count, over by bytes
    expect(rows.reduce((total, row) => total + row.content.length, 0)).toBeLessThan(REPLY_HISTORY_MAX_CONTENT_BYTES);
    expect(await h.source(h.run(0))).toBeNull();
    expect(h.counts.pageGets).toBe(1); // the page itself was valid and read; only the resolver's byte cap refused it
    h.state.rows = rows.slice(0, 12); // 10 * 60k bytes is under the cap
    expect(await h.source(h.run(0))).not.toBeNull();
  });

  it('returns null for malformed or foreign pagination and page rows', async () => {
    const h = await harness();
    h.state.rows = turns(); h.status(0, h.bind(1, 2));
    const tampers: Array<[string, (body: Page) => Page]> = [
      ['wrong offset', body => ({ ...body, pagination: { ...body.pagination, offset: 7 } })],
      ['wrong returned', body => ({ ...body, pagination: { ...body.pagination, returned: 1 } })],
      ['foreign page session', body => ({ ...body, session_id: otherSession })],
      ['foreign row session', body => ({ ...body, data: body.data.map(row => ({ ...row, session_id: otherSession })) })],
    ];
    for (const [name, tamper] of tampers) {
      h.state.tamper = tamper;
      expect(await h.source(h.run(0)), name).toBeNull();
    }
    expect(h.counts.posts).toBe(0);
  });

  it('preserves the notifier unsupported/failure behavior: an unreachable upstream resolves null without throwing', async () => {
    const h = await harness();
    h.state.rows = turns(); // no run status set: upstream returns an invalid body
    expect(await h.source(h.run(0))).toBeNull();
    const { notify } = h.notifier();
    expect(await notify(h.run(0))).toBe(false);
    expect((await h.open().store.read(alice)).items).toEqual([]);
  });
});
