import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { AuditLedger } from './audit-ledger';
import { CommandProxyUnavailableError, type CommandProxyClient } from './command-client';
import { loadConfig } from './config';
import { createLiveRoomService } from './live-room-service';
import { NotificationNotFoundError, NotificationStorageError, NotificationStore } from './notification-store';
import { createRunNotifier, notificationId } from './run-notifier';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())); });

const actorA = 'a'.repeat(64);
const actorB = 'b'.repeat(64);
const runIds = Array.from({ length: 8 }, (_, i) => `jcr_${String(i).repeat(32)}`);
const upstream = (i: number) => `run_${String(i).repeat(32)}`;
const sessionOf = (i: number) => `jc_${String(i).repeat(32)}`;
const LATER = '2026-10-28T14:30:00.000Z';
const EVENT_AT = '2026-10-28T13:00:00.000Z';
const event = (category: 'run-completed' | 'run-failed' | 'approval' = 'run-completed', i = 1, key?: string) => ({
  actor: actorA, sessionId: sessionOf(i), publicRunId: runIds[i]!, eventAt: EVENT_AT, category, ...(key ? { key } : {}),
});

async function privateDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'jc-notify-'));
  await chmod(directory, 0o700);
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const record = (store: NotificationStore, actor: string, e: ReturnType<typeof event>) => store.record(actor, {
  id: notificationId({ ...e, actor }), category: e.category, sessionId: e.sessionId, publicRunId: e.publicRunId, eventAt: e.eventAt,
});

describe('NotificationStore', () => {
  it('creates one item per event under concurrent observation and keeps identity and read state across restart', async () => {
    const directory = await privateDirectory();
    const store = new NotificationStore(directory);
    const results = await Promise.all(Array.from({ length: 20 }, () => record(store, actorA, event())));
    expect(results.filter(r => r === 'created')).toHaveLength(1);
    const [first] = (await store.read(actorA)).items;
    expect(first).toMatchObject({ category: 'run-completed', title: 'Run finished', readAt: null });
    await store.markRead(actorA, { ids: [first!.id] });
    const restarted = new NotificationStore(directory);
    expect(await record(restarted, actorA, event())).toBe('duplicate');
    const { items } = await restarted.read(actorA);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: first!.id, observedAt: first!.observedAt });
    expect(items[0]!.readAt).not.toBeNull();
  });

  it('keeps one approval item per request and a new one for a new request', async () => {
    const store = new NotificationStore(await privateDirectory());
    await record(store, actorA, event('approval', 1, 'req-1'));
    await record(store, actorA, event('approval', 1, 'req-1'));
    await record(store, actorA, event('approval', 1, 'req-2'));
    expect((await store.read(actorA)).items).toHaveLength(2);
  });

  it('isolates items, read markers and preferences per actor', async () => {
    const store = new NotificationStore(await privateDirectory());
    await record(store, actorA, event());
    const [item] = (await store.read(actorA)).items;
    expect((await store.read(actorB)).items).toEqual([]);
    await expect(store.markRead(actorB, { ids: [item!.id] })).rejects.toBeInstanceOf(NotificationNotFoundError);
    await store.markRead(actorB, { all: true });
    await store.setPreferences(actorB, { categories: { 'run-completed': false, 'run-failed': false, approval: false } });
    const a = await store.read(actorA);
    expect(a.items[0]!.readAt).toBeNull();
    expect(a.preferences.categories['run-completed']).toBe(true);
    expect(await store.find(actorB, item!.id)).toBeNull();
    // The same run observed for another actor produces a distinct ID.
    expect(notificationId({ ...event(), actor: actorB })).not.toBe(item!.id);
  });

  it('does not generate for disabled categories, never backfills after re-enabling, and keeps existing items', async () => {
    const store = new NotificationStore(await privateDirectory());
    await record(store, actorA, event('run-failed', 1));
    await store.setPreferences(actorA, { categories: { 'run-completed': true, 'run-failed': false, approval: true } });
    expect(await record(store, actorA, event('run-failed', 2))).toBe('suppressed');
    let view = await store.read(actorA);
    expect(view.items.map(item => item.publicRunId)).toEqual([runIds[1]]);
    await store.setPreferences(actorA, { categories: { 'run-completed': true, 'run-failed': true, approval: true } });
    expect(await record(store, actorA, event('run-failed', 2))).toBe('duplicate');
    view = await store.read(actorA);
    expect(view.items).toHaveLength(1);
  });

  it('bounds retained items and never replays an event older than the pruned horizon, across restart', async () => {
    const directory = await privateDirectory();
    let tick = 0;
    const store = new NotificationStore(directory, () => new Date(Date.UTC(2026, 9, 28, 14, 0, 0) + ++tick * 1000));
    const id = (i: number) => `ntf_${i.toString(16).padStart(32, '0')}`;
    const runAt = (i: number) => new Date(Date.UTC(2026, 9, 28, 14, 0, 0) + i * 1000 - 500).toISOString();
    const make = (i: number) => ({ id: id(i), category: 'run-completed' as const, sessionId: sessionOf(1), publicRunId: runIds[1]!, eventAt: runAt(i) });
    for (let i = 0; i < 502; i++) await store.record(actorA, make(i + 1));
    const restarted = new NotificationStore(directory);
    expect((await restarted.read(actorA)).items).toHaveLength(100);
    // Oldest event (long pruned from items and the settled list) must not return unread.
    expect(await restarted.record(actorA, make(1))).toBe('duplicate');
    expect(await restarted.record(actorA, make(2))).toBe('duplicate');
    expect((await restarted.read(actorA)).items.some(item => item.id === id(1))).toBe(false);
    // A genuinely newer event is still recorded.
    expect(await restarted.record(actorA, make(600))).toBe('created');
  }, 120_000);

  it('does not replay a pruned event after a disabled category is re-enabled beyond the bound', async () => {
    const store = new NotificationStore(await privateDirectory());
    await store.setPreferences(actorA, { categories: { 'run-completed': false, 'run-failed': true, approval: true } });
    const old = { id: `ntf_${'0'.padStart(32, '0')}`, category: 'run-completed' as const, sessionId: sessionOf(1), publicRunId: runIds[1]!, eventAt: EVENT_AT };
    expect(await store.record(actorA, old)).toBe('suppressed');
    for (let i = 1; i <= 501; i++) await store.record(actorA, { ...old, id: `ntf_${i.toString(16).padStart(32, '0')}`, category: 'run-failed', eventAt: LATER });
    await store.setPreferences(actorA, { categories: { 'run-completed': true, 'run-failed': true, approval: true } });
    expect(await new NotificationStore(store.directory).record(actorA, old)).toBe('duplicate');
  }, 120_000);

  it('reports corrupt or unsafe storage honestly and never replaces it with an empty inbox', async () => {
    const directory = await privateDirectory();
    const store = new NotificationStore(directory);
    await record(store, actorA, event());
    const path = join(directory, 'notifications.json');
    const good = await readFile(path, 'utf8');
    await writeFile(path, '{broken'); await chmod(path, 0o600);
    await expect(new NotificationStore(directory).read(actorA)).rejects.toBeInstanceOf(NotificationStorageError);
    await expect(record(new NotificationStore(directory), actorA, event('run-failed', 2))).rejects.toBeInstanceOf(NotificationStorageError);
    expect(await readFile(path, 'utf8')).toBe('{broken');
    await writeFile(path, good); await chmod(path, 0o644);
    await expect(new NotificationStore(directory).read(actorA)).rejects.toBeInstanceOf(NotificationStorageError);
    await chmod(path, 0o600);
    // A file that vanishes after being seen is a fault, not an empty inbox.
    await rm(path);
    await expect(store.read(actorA)).rejects.toBeInstanceOf(NotificationStorageError);
  });
});

function status(i: number, overrides: Record<string, unknown> = {}) {
  return { runId: upstream(i), sessionId: sessionOf(i), status: 'running', updatedAt: '2026-10-28T14:00:01.000Z', approval: null, output: null, error: null, pendingSteer: null, usage: null, ...overrides };
}
const approval = (requestId: string) => ({ requestId, command: 'secret command text', description: 'secret description', tool: 'terminal' });

async function harness(overrides: Partial<CommandProxyClient> = {}, existing?: { directory: string }) {
  const directory = existing?.directory ?? await privateDirectory();
  const clock = { now: new Date('2026-10-28T14:00:10.000Z') };
  const ledger = await AuditLedger.open(join(directory, 'events.jsonl'), { now: () => clock.now });
  cleanup.push(() => ledger.close());
  const store = new NotificationStore(directory, () => new Date('2026-10-28T14:00:05.000Z'));
  const getRun = vi.fn(async (runId: string) => status(Number(runId[4])));
  const client = {
    readReadiness: vi.fn().mockResolvedValue({ ready: true, idempotencyRetentionSeconds: 86_400, sessionForkPreservesSource: true, sessionCompactionRuns: true }),
    getSession: vi.fn(async (sessionId: string) => ({ session: { id: sessionId, title: 'Chat', source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-10-28T14:00:00.000Z', messageCount: 0, toolCallCount: 0, pinned: false } })),
    startRun: vi.fn(async (request: { sessionId: string }) => ({ runId: upstream(Number(request.sessionId[3])), sessionId: request.sessionId, status: 'running', replayed: false })),
    startContextCompaction: vi.fn(),
    getRun,
    streamRunEvents: vi.fn(async function* () {}),
    approveRun: vi.fn(), steerRun: vi.fn(), stopRun: vi.fn(), deleteSession: vi.fn(),
    ...overrides,
  } as unknown as CommandProxyClient;
  let next = 0;
  const service = createLiveRoomService({ client, ledger, notify: createRunNotifier(store), createPublicRunId: () => runIds[++next]! });
  const submit = (subject: string, i: number) => service.submitRun(subject, { sessionId: sessionOf(i), input: 'private prompt', clientRequestId: `00000000-0000-4000-8000-00000000000${i}` });
  return { directory, ledger, clock, store, client, getRun, service, submit };
}
const actorHash = async (subject: string) => (await import('node:crypto')).createHash('sha256').update(subject).digest('hex');

describe('server-observed run notifications', () => {
  it('creates one terminal notification across status polls, SSE and a restart, with generic text', async () => {
    const h = await harness({
      streamRunEvents: vi.fn(async function* () {
        yield { runId: upstream(1), type: 'run.completed' as const, timestamp: '2026-10-28T14:00:02.000Z', output: 'private answer', pendingSteer: null, usage: null };
      }) as never,
    });
    const run = await h.submit('alice', 1);
    h.getRun.mockResolvedValue(status(1, { status: 'completed', output: 'private answer' }) as never);
    await Promise.all([
      h.service.getRun('alice', run.publicRunId), h.service.getRun('alice', run.publicRunId),
      (async () => { for await (const _ of h.service.streamRunEvents('alice', run.publicRunId, new AbortController().signal)) void _; })(),
    ]);
    // A fresh store over the same directory models a process restart.
    const { items } = await new NotificationStore(h.directory).read(await actorHash('alice'));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: 'run-completed', sessionId: sessionOf(1), publicRunId: run.publicRunId, observedAt: '2026-10-28T14:00:05.000Z' });
    expect(JSON.stringify(items)).not.toMatch(/private/);
    expect((await h.store.read(await actorHash('bob'))).items).toEqual([]);
  });

  it('records failed runs, and one approval per request with generic text; ignores cancelled and compaction', async () => {
    const h = await harness();
    const alice = await actorHash('alice');
    const failing = await h.submit('alice', 1);
    h.getRun.mockResolvedValueOnce(status(1, { status: 'waiting_for_approval', approval: approval('req-1') }) as never)
      .mockResolvedValueOnce(status(1, { status: 'waiting_for_approval', approval: approval('req-1') }) as never)
      .mockResolvedValueOnce(status(1, { status: 'waiting_for_approval', approval: approval('req-2') }) as never)
      .mockResolvedValueOnce(status(1, { status: 'failed', error: 'secret failure' }) as never);
    for (let n = 0; n < 4; n++) await h.service.getRun('alice', failing.publicRunId);
    const items = (await h.store.read(alice)).items;
    expect(items.map(item => item.category).sort()).toEqual(['approval', 'approval', 'run-failed']);
    expect(JSON.stringify(items)).not.toMatch(/secret/);

    const cancelled = await h.submit('alice', 2);
    h.getRun.mockResolvedValueOnce(status(2, { status: 'cancelled' }) as never);
    await h.service.getRun('alice', cancelled.publicRunId);
    const compaction = await h.submit('alice', 3);
    h.getRun.mockResolvedValueOnce(status(3, { status: 'completed', kind: 'context_compaction' }) as never);
    await h.service.getRun('alice', compaction.publicRunId);
    expect((await h.store.read(alice)).items).toHaveLength(3);
  });

  it('keeps terminal audit and chat deletion independent of a notification write failure, then re-delivers from the ledger', async () => {
    const h = await routeHarness();
    const alice = await actorHash('alice');
    await h.store.read(alice); // the app loads the inbox on startup, anchoring the actor
    const run = await h.submit('alice', 1);
    h.getRun.mockResolvedValue(status(1, { status: 'completed' }) as never);
    (h.client.deleteSession as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted: true, sessionId: sessionOf(1) });
    const original = h.store.record.bind(h.store);
    let failures = 1;
    h.store.record = async (...args) => { if (failures-- > 0) throw new NotificationStorageError(); return original(...args); };
    await expect(h.service.getRun('alice', run.publicRunId)).resolves.toMatchObject({ status: 'completed' });
    // The authoritative audit landed and the session is not held active by notification health.
    expect(await readFile(join(h.directory, 'events.jsonl'), 'utf8')).toContain('"action":"run.completed"');
    expect(h.service.listUnsettledRuns('alice', 10)).toEqual([]);
    expect((await h.store.read(alice)).items).toEqual([]);
    // Reconcile re-delivers the missing event once, then is idempotent (also across restart).
    const first = (await h.post('/api/notifications/reconcile', 'alice')).json();
    expect(first).toMatchObject({ checked: 1, unavailable: 0 });
    expect(first.inbox.items).toHaveLength(1);
    await h.post('/api/notifications/reconcile', 'alice');
    expect((await new NotificationStore(h.directory).read(alice)).items).toHaveLength(1);
    await expect(h.service.deleteSession('alice', sessionOf(1))).resolves.toEqual({ deleted: true, sessionId: sessionOf(1) });
  });

  it('delivers a never-seen event of an old long-running run after the replay horizon has advanced', async () => {
    const h = await routeHarness();
    const alice = await actorHash('alice');
    const run = await h.submit('alice', 1); // admitted long before the horizon below
    await h.store.read(alice);
    // Advance the horizon far past the run's admission with unrelated, pruned events.
    let tick = 0;
    const store = new NotificationStore(h.directory, () => new Date(Date.UTC(2026, 9, 28, 15, 0, 0) + ++tick * 1000));
    for (let i = 0; i < 502; i++) await store.record(alice, { id: `ntf_${(i + 1).toString(16).padStart(32, '0')}`, category: 'run-failed', sessionId: sessionOf(2), publicRunId: runIds[2]!, eventAt: new Date(Date.UTC(2026, 9, 28, 15, 0, 0) + (i + 1) * 1000 - 500).toISOString() });
    h.getRun.mockResolvedValue(status(1, { status: 'completed' }) as never);
    h.clock.now = new Date('2026-10-28T16:00:00.000Z'); // the old run finishes only now
    await h.service.getRun('alice', run.publicRunId);
    const created = (await new NotificationStore(h.directory).read(alice)).items.filter(item => item.publicRunId === run.publicRunId);
    expect(created).toHaveLength(1);
  }, 120_000);

  it('does not duplicate or un-read a settled terminal run when it is read again', async () => {
    const h = await harness();
    const alice = await actorHash('alice');
    const run = await h.submit('alice', 1);
    h.getRun.mockResolvedValue(status(1, { status: 'completed' }) as never);
    await h.service.getRun('alice', run.publicRunId);
    await h.store.markRead(alice, { all: true });
    await h.service.getRun('alice', run.publicRunId);
    const { items } = await h.store.read(alice);
    expect(items).toHaveLength(1);
    expect(items[0]!.readAt).not.toBeNull();
  });

  it('keeps run status and terminal audit working when notification storage is broken', async () => {
    const h = await harness();
    const run = await h.submit('alice', 1);
    await writeFile(join(h.directory, 'notifications.json'), '{broken', { mode: 0o600 });
    h.getRun.mockResolvedValue(status(1, { status: 'completed' }) as never);
    await expect(h.service.getRun('alice', run.publicRunId)).resolves.toMatchObject({ status: 'completed' });
    expect(await readFile(join(h.directory, 'events.jsonl'), 'utf8')).toContain('"action":"run.completed"');
    await expect(h.store.read(await actorHash('alice'))).rejects.toBeInstanceOf(NotificationStorageError);
  });
});

const config = (directory: string) => loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(directory, 'events.jsonl') });
const write = { origin: 'https://command.example', 'x-jarvis-command': '1', 'content-type': 'application/json' };
const as = (subject: string) => ({ 'cf-access-jwt-assertion': subject });

async function routeHarness(overrides: Partial<CommandProxyClient> = {}) {
  const h = await harness(overrides);
  const verifyAccess = vi.fn(async (assertion?: string) => {
    if (assertion !== 'alice' && assertion !== 'bob') throw new Error('nope');
    return { subject: assertion, provider: 'cloudflare-access' as const };
  });
  const app = buildApp({ config: config(h.directory), verifyAccess, hermes: { readSnapshot: vi.fn() }, liveRoom: h.service, notifications: h.store });
  cleanup.push(() => app.close());
  return { ...h, app, get: (url: string, who: string) => app.inject({ url, headers: as(who) }),
    post: (url: string, who: string, body: unknown = {}) => app.inject({ method: 'POST', url, headers: { ...as(who), ...write }, payload: JSON.stringify(body) }) };
}

describe('notification routes', () => {
  it('requires Access identity and same-origin JSON for every read and write', async () => {
    const r = await routeHarness();
    expect((await r.app.inject({ url: '/api/notifications' })).statusCode).toBe(401);
    expect((await r.app.inject({ method: 'POST', url: '/api/notifications/read', headers: as('alice'), payload: '{"all":true}' })).statusCode).toBe(403);
    expect((await r.app.inject({ method: 'POST', url: '/api/notifications/preferences', headers: { ...as('alice'), ...write, origin: 'https://evil.example' }, payload: '{}' })).statusCode).toBe(403);
  });

  it('never exposes or alters another actor’s items, counts, read markers, preferences or targets', async () => {
    const r = await routeHarness();
    const run = await r.submit('alice', 1);
    r.getRun.mockResolvedValue(status(1, { status: 'completed' }) as never);
    await r.service.getRun('alice', run.publicRunId);
    const aliceInbox = (await r.get('/api/notifications', 'alice')).json();
    expect(aliceInbox.unreadCount).toBe(1);
    const id = aliceInbox.items[0].id as string;
    expect((await r.get('/api/notifications', 'bob')).json()).toMatchObject({ items: [], unreadCount: 0 });
    expect((await r.post('/api/notifications/read', 'bob', { ids: [id] })).statusCode).toBe(404);
    expect((await r.post('/api/notifications/read', 'bob', { all: true })).statusCode).toBe(200);
    expect((await r.post(`/api/notifications/${id}/open`, 'bob')).statusCode).toBe(404);
    expect((await r.post('/api/notifications/preferences', 'bob', { categories: { 'run-completed': false, 'run-failed': false, approval: false } })).statusCode).toBe(200);
    const calls = r.getRun.mock.calls.length;
    const reconciled = (await r.post('/api/notifications/reconcile', 'bob')).json();
    expect(reconciled).toMatchObject({ checked: 0, unavailable: 0 });
    expect(r.getRun.mock.calls.length).toBe(calls);
    const after = (await r.get('/api/notifications', 'alice')).json();
    expect(after.unreadCount).toBe(1);
    expect(after.preferences.categories).toEqual({ 'run-completed': true, 'run-failed': true, approval: true });
  });

  it('rejects caller-supplied identity and unknown fields', async () => {
    const r = await routeHarness();
    for (const body of [{ ids: ['ntf_' + '0'.repeat(32)], actor: 'x' }, { all: false }, { ids: [] }, { ids: ['nope'] }]) {
      expect((await r.post('/api/notifications/read', 'alice', body)).statusCode).toBe(400);
    }
    expect((await r.post('/api/notifications/preferences', 'alice', { categories: { 'run-completed': true } })).statusCode).toBe(400);
    expect((await r.post('/api/notifications/reconcile', 'alice', { runId: runIds[1] })).statusCode).toBe(400);
    expect((await r.app.inject({ url: '/api/notifications?actor=bob', headers: as('alice') })).statusCode).toBe(400);
  });

  it('reconciles owned unsettled runs on demand without any admission or approval side effect', async () => {
    const r = await routeHarness();
    const run = await r.submit('alice', 1);
    r.getRun.mockResolvedValue(status(1, { status: 'waiting_for_approval', approval: approval('req-9') }) as never);
    const started = (r.client.startRun as ReturnType<typeof vi.fn>).mock.calls.length;
    const first = (await r.post('/api/notifications/reconcile', 'alice')).json();
    const second = (await r.post('/api/notifications/reconcile', 'alice')).json();
    expect(first).toMatchObject({ checked: 1, unavailable: 0 });
    expect(second.inbox.items).toHaveLength(1);
    expect(second.inbox.items[0]).toMatchObject({ category: 'approval', publicRunId: run.publicRunId });
    expect((r.client.startRun as ReturnType<typeof vi.fn>).mock.calls.length).toBe(started);
    for (const method of ['approveRun', 'steerRun', 'stopRun'] as const) expect(r.client[method]).not.toHaveBeenCalled();
    r.getRun.mockRejectedValue(new CommandProxyUnavailableError(503));
    expect((await r.post('/api/notifications/reconcile', 'alice')).json()).toMatchObject({ checked: 1, unavailable: 1 });
  });

  it('saves preferences with authoritative readback and surfaces storage faults', async () => {
    const r = await routeHarness();
    const next = { categories: { 'run-completed': false, 'run-failed': true, approval: true } };
    const saved = await r.post('/api/notifications/preferences', 'alice', next);
    expect(saved.json().preferences).toEqual(next);
    expect((await r.get('/api/notifications', 'alice')).json().preferences).toEqual(next);
    await writeFile(join(r.directory, 'notifications.json'), '{broken', { mode: 0o600 });
    const broken = await r.get('/api/notifications', 'alice');
    expect(broken.statusCode).toBe(503);
    expect(broken.json()).toEqual({ error: 'notification_storage_unavailable' });
  });

  it('opens only after current authorized readback and reports missing or unavailable targets honestly', async () => {
    const r = await routeHarness();
    const run = await r.submit('alice', 1);
    r.getRun.mockResolvedValue(status(1, { status: 'waiting_for_approval', approval: approval('req-1') }) as never);
    await r.service.getRun('alice', run.publicRunId);
    const id = (await r.get('/api/notifications', 'alice')).json().items[0].id as string;

    const opened = (await r.post(`/api/notifications/${id}/open`, 'alice')).json();
    expect(opened).toMatchObject({ state: 'available', sessionId: sessionOf(1), publicRunId: run.publicRunId, runStatus: 'waiting_for_approval', approvalPending: true });
    expect(opened.inbox.unreadCount).toBe(0);
    for (const method of ['approveRun', 'steerRun', 'stopRun'] as const) expect(r.client[method]).not.toHaveBeenCalled();

    // Resolved since: the readback reflects current status, not the stale notification.
    r.getRun.mockResolvedValue(status(1, { status: 'running' }) as never);
    expect((await r.post(`/api/notifications/${id}/open`, 'alice')).json()).toMatchObject({ approvalPending: false, runStatus: 'running' });

    await r.post('/api/notifications/read', 'alice', { all: true });
    r.getRun.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 404 }));
    expect((await r.post(`/api/notifications/${id}/open`, 'alice')).json()).toEqual({ state: 'missing' });
    r.getRun.mockRejectedValue(new CommandProxyUnavailableError(503));
    expect((await r.post(`/api/notifications/${id}/open`, 'alice')).json()).toEqual({ state: 'unavailable' });
    r.getRun.mockResolvedValue(status(1, { status: 'running' }) as never);
    (r.client.getSession as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('deleted'), { statusCode: 404 }));
    expect((await r.post(`/api/notifications/${id}/open`, 'alice')).json()).toEqual({ state: 'missing' });
    // Unavailable and missing targets leave an unread item unread.
    await r.store.markRead(await actorHash('alice'), { all: true });
    expect((await r.post(`/api/notifications/ntf_${'f'.repeat(32)}/open`, 'alice')).statusCode).toBe(404);
  });
});
