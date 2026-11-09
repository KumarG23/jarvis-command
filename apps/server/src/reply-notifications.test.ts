import { createECDH, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { AuditLedger } from './audit-ledger';
import { loadConfig } from './config';
import type { CommandProxyClient } from './command-client';
import { createLiveRoomService } from './live-room-service';
import { NotificationStore } from './notification-store';
import { createPushService, pushConfig, replyPushPayload, type PushRequest } from './push-service';
import { createPresence, createReplyNotifier, replyNotificationId, replyState, verifyReply, type ReplyEvidence, type ReplyRun } from './reply-notifier';
import { GENERIC_REPLY_BODY, replyPreview } from './reply-preview';
import { createRunNotifier, notificationId } from './run-notifier';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanup.splice(0).map(fn => fn())); });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const alice = hash('alice'), bob = hash('bob');
const keys = webpush.generateVAPIDKeys();
const env = { WEB_PUSH_MODE: 'enabled', WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.invalid' };
const receiver = createECDH('prime256v1'); receiver.generateKeys();
const auth = randomBytes(16).toString('base64url');
const device = (token: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${token}`, expirationTime: null, keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth } });
const sessionId = `jc_${'a'.repeat(32)}`;
const publicRunId = `jcr_${'b'.repeat(32)}`;
// Fresh terminal time (the store refuses historical events); a small lead keeps it after the actor's first state.
const run: ReplyRun = { actor: alice, sessionId, publicRunId, eventAt: new Date(Date.now() + 3_600_000).toISOString() };
const evidence = (over: Partial<ReplyEvidence['message']> = {}, rest: Partial<ReplyEvidence> = {}): ReplyEvidence => ({
  userMessageId: 'user:1', assistantMessageId: 'assistant:1',
  message: { id: 'assistant:1', sessionId, role: 'assistant', content: 'The **answer** is [here](https://x.invalid/secret-token).', ...over },
  executed: { model: 'synthetic-model' }, ...rest,
});

async function fixture(env_: NodeJS.ProcessEnv = { ...env, REPLY_NOTIFICATIONS_MODE: 'enabled' }) {
  const directory = await mkdtemp(join(tmpdir(), 'jc-reply-')); await chmod(directory, 0o700);
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const config = pushConfig(env_);
  const sent: PushRequest[] = [];
  const outcome = { status: 201, throws: false };
  const transport = async (request: PushRequest) => { sent.push(request); if (outcome.throws) throw new Error('SYNTHETIC unknown'); return outcome.status; };
  const open = () => {
    const store = new NotificationStore(directory);
    return { store, push: createPushService(config, store, transport) };
  };
  const first = open();
  const notifier = (source: (r: ReplyRun) => Promise<ReplyEvidence | null>, over: { enabled?: boolean; presence?: ReturnType<typeof createPresence>; from?: ReturnType<typeof open> } = {}) => {
    const from = over.from ?? first;
    return createReplyNotifier({ store: from.store, push: from.push, enabled: over.enabled ?? config.replies === true, source, presence: over.presence });
  };
  const payloads = () => sent.map(request => (createRequire(import.meta.url)('http_ece') as { decrypt: (b: Buffer, o: unknown) => Buffer })
    .decrypt(request.body, { version: 'aes128gcm', privateKey: receiver, authSecret: auth }).toString());
  return { directory, config, sent, outcome, open, first, notifier, payloads };
}

describe('replyPreview', () => {
  it('collapses whitespace and strips markdown, controls and bidi characters into one bounded line', () => {
    expect(replyPreview('# Title\n\n- item **one**\n> quote\n\n```js\nconst x = 1;\n```\nSee [docs](https://a.invalid/?t=secret) and ![img](https://b.invalid/p.png)‮\u0007 end')).toBe('Title item one quote const x = 1; See docs and img end');
    expect(replyPreview('<script>alert(1)</script> hi')).toBe('alert(1) hi');
  });
  it('bounds to the limit on a code point boundary and returns null when nothing readable remains', () => {
    const long = replyPreview('😀'.repeat(300))!;
    expect(Array.from(long)).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
    for (const empty of ['', '   \n\t ', '```\n```', '​‮', '**', '[](x)']) expect(replyPreview(empty)).toBeNull();
  });
});

describe('verifyReply', () => {
  it('accepts only the bound assistant message of the same session', () => {
    expect(verifyReply(run, evidence())).toEqual({ messageId: 'assistant:1', preview: 'The answer is here.', label: 'synthetic-model' });
    for (const bad of [
      evidence({ sessionId: `jc_${'c'.repeat(32)}` }), evidence({ role: 'user' }), evidence({ role: 'tool' }), evidence({ id: 'assistant:2' }),
      evidence({ content: '   ' }), evidence({}, { assistantMessageId: 'user:1', message: { id: 'user:1', sessionId, role: 'assistant', content: 'x' } }),
      evidence({}, { userMessageId: '' }),
    ]) expect(verifyReply(run, bad)).toBeNull();
  });
  it('keeps the executed label unknown instead of using anything else', () => {
    expect(verifyReply(run, evidence({}, { executed: null }))!.label).toBeNull();
    expect(verifyReply(run, evidence({}, { executed: { model: null } }))!.label).toBeNull();
  });
});

describe('reply notifications', () => {
  it('is disabled by default, and unsupported when enabled without a verified binding source', async () => {
    expect(pushConfig(env).replies).toBe(false);
    expect(pushConfig({}).replies).toBe(false);
    expect(replyState(false, undefined)).toBe('disabled');
    expect(replyState(true, undefined)).toBe('unsupported');
    expect(replyState(true, async () => null)).toBe('available');
    const h = await fixture({ ...env });
    const source = vi.fn(async () => evidence());
    expect(await h.notifier(source)(run)).toBe(false);
    expect(source).not.toHaveBeenCalled();
    const on = await fixture();
    expect(await on.notifier(undefined as never)(run)).toBe(false);
    expect((await on.first.store.read(alice)).items).toEqual([]);
    expect(on.sent).toEqual([]);
  });

  it('sends one encrypted reply push with sanitized text, executed label and no run/auth identifiers', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('one'));
    expect(await h.notifier(async () => evidence())(run)).toBe(true);
    expect(h.sent).toHaveLength(1);
    const [payload] = h.payloads();
    const id = replyNotificationId(alice, sessionId, 'assistant:1');
    expect(JSON.parse(payload!)).toEqual({ version: 2, id, title: 'Reply from synthetic-model', body: 'The answer is here.' });
    expect(payload).not.toMatch(/jcr_|jc_|alice|run_|secret-token|https:/);
    const [item] = (await h.first.store.read(alice)).items;
    expect(item).toMatchObject({ id, category: 'assistant-reply', publicRunId, sessionId, reply: { messageId: 'assistant:1', label: 'synthetic-model' } });
    expect(payload).toBe(replyPushPayload(item!));
  });

  it('shows only a generic reply notice when "Show reply text" is off, while keeping default ON', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('one'));
    await h.first.store.setPreferences(alice, { categories: { 'run-completed': true, 'run-failed': true, approval: true }, showReplyText: false });
    await h.notifier(async () => evidence())(run);
    expect(JSON.parse(h.payloads()[0]!)).toMatchObject({ body: GENERIC_REPLY_BODY });
    expect(h.payloads()[0]).not.toContain('answer');
    expect((await h.first.store.read(alice)).items[0]!.body).toBe(GENERIC_REPLY_BODY);
  });

  it('sends nothing for failed, unbound, wrong-session, empty or non-assistant evidence', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('one'));
    for (const value of [null, evidence({ content: '' }), evidence({ role: 'user' }), evidence({ sessionId: `jc_${'d'.repeat(32)}` }), evidence({ id: 'other' })]) {
      expect(await h.notifier(async () => value)({ ...run, publicRunId: `jcr_${randomBytes(16).toString('hex')}` })).toBe(false);
    }
    const failing = h.notifier(async () => { throw new Error('SYNTHETIC source fault'); });
    expect(await failing(run)).toBe(false);
    expect((await h.first.store.read(alice)).items).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it('delivers once per exact message across retries, a different run id, restart and concurrent observers', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('one'));
    const source = async () => evidence();
    await Promise.all([h.notifier(source)(run), h.notifier(source)(run), h.notifier(source)(run)]);
    await h.notifier(source, { from: h.open() })(run); // restart: a fresh store and notifier over the same private files
    await h.notifier(source, { from: h.open() })({ ...run, publicRunId: `jcr_${'e'.repeat(32)}`, eventAt: new Date(Date.now() + 3_700_000).toISOString() });
    expect(h.sent).toHaveLength(1);
    expect((await h.open().store.read(alice)).items).toHaveLength(1);
    // A different message is a different notification.
    await h.notifier(async () => evidence({ id: 'assistant:2' }, { assistantMessageId: 'assistant:2' }))({ ...run, publicRunId: `jcr_${'f'.repeat(32)}` });
    expect(h.sent).toHaveLength(2);
  });

  it('sends once per registered device and never auto-resends an unknown outcome', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('one'));
    await h.first.store.registerDevice(alice, device('two'));
    h.outcome.throws = true;
    await h.notifier(async () => evidence())(run);
    expect(h.sent).toHaveLength(2);
    h.outcome.throws = false;
    await h.notifier(async () => evidence(), { from: h.open() })(run);
    const id = replyNotificationId(alice, sessionId, 'assistant:1');
    await h.first.push.deliverReply(alice, id);
    expect(h.sent).toHaveLength(2);
  });

  it('prunes an expired subscription and keeps the in-app item when the push endpoint reports 410', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('gone'));
    h.outcome.status = 410;
    await h.notifier(async () => evidence())(run);
    expect((await h.first.store.readPush(alice)).devices).toEqual([]);
    expect((await h.first.store.read(alice)).items).toHaveLength(1);
  });

  it('keeps actors isolated: same message id yields separate ids, items and device sends', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('alice'));
    await h.first.store.registerDevice(bob, device('bob'));
    await h.notifier(async () => evidence())(run);
    await h.notifier(async () => evidence())({ ...run, actor: bob });
    expect(replyNotificationId(alice, sessionId, 'assistant:1')).not.toBe(replyNotificationId(bob, sessionId, 'assistant:1'));
    expect((await h.first.store.read(alice)).items).toHaveLength(1);
    expect((await h.first.store.read(bob)).items).toHaveLength(1);
    expect(h.sent).toHaveLength(2);
    expect(await h.first.store.find(bob, replyNotificationId(alice, sessionId, 'assistant:1'))).toBeNull();
  });

  it('suppresses the push only on a fresh visible mark and still records the item', async () => {
    let time = 1_000_000;
    const presence = createPresence(() => time);
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('one'));
    presence.mark(alice, `jc_${'9'.repeat(32)}`, true); // another session does not suppress
    presence.mark(bob, sessionId, true); // another actor does not suppress
    await h.notifier(async () => evidence(), { presence })(run);
    expect(h.sent).toHaveLength(1);
    presence.mark(alice, sessionId, true);
    await h.notifier(async () => evidence({ id: 'assistant:2' }, { assistantMessageId: 'assistant:2' }), { presence })({ ...run, publicRunId: `jcr_${'1'.repeat(32)}` });
    expect(h.sent).toHaveLength(1);
    expect((await h.first.store.read(alice)).items).toHaveLength(2);
    // Stale marks and explicit hidden marks never suppress.
    time += 21_000;
    expect(presence.visible(alice, sessionId)).toBe(false);
    presence.mark(alice, sessionId, true); presence.mark(alice, sessionId, false);
    await h.notifier(async () => evidence({ id: 'assistant:3' }, { assistantMessageId: 'assistant:3' }), { presence })({ ...run, publicRunId: `jcr_${'2'.repeat(32)}` });
    expect(h.sent).toHaveLength(2);
  });

  it('bounds presence marks', () => {
    const presence = createPresence(() => 0, 1000, 4);
    for (let n = 0; n < 10; n++) presence.mark(alice, `jc_${String(n).repeat(32)}`, true);
    expect(presence.visible(alice, `jc_${'0'.repeat(32)}`)).toBe(false);
    expect(presence.visible(alice, `jc_${'9'.repeat(32)}`)).toBe(true);
  });

  it('keeps the sender reply-only: run-state/approval items never push and reply items need the reply sender', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('one'));
    const presence = createPresence(() => 0); presence.mark(alice, sessionId, true); // record the reply without sending it
    await h.notifier(async () => evidence(), { presence })(run);
    expect('deliver' in h.first.push).toBe(false); // no run-state sender exists
    const stateEvent = { actor: alice, sessionId, publicRunId, eventAt: run.eventAt, category: 'run-completed' as const };
    await createRunNotifier(h.first.store)(stateEvent); // no push service: record only
    await h.first.push.deliverReply(alice, notificationId(stateEvent));
    expect(h.sent).toEqual([]);
    expect(h.sent).toEqual([]); // retired run-state alerts stay in-app only
  });

  it('does nothing when Web Push is unavailable, but still records the in-app reply', async () => {
    const h = await fixture({ REPLY_NOTIFICATIONS_MODE: 'enabled' });
    await h.first.store.registerDevice(alice, device('one')).catch(() => undefined);
    await h.notifier(async () => evidence(), { enabled: true })(run);
    expect(h.sent).toEqual([]);
    expect((await h.first.store.read(alice)).items).toHaveLength(1);
  });
});

describe('historical reply refusal', () => {
  const NOW = new Date('2026-11-06T19:30:00.000Z');
  const store = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jc-reply-fresh-')); await chmod(directory, 0o700);
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    return { directory, open: () => new NotificationStore(directory, () => NOW) };
  };
  const record = (s: NotificationStore, eventAt: string, messageId = 'assistant:1') => s.recordReply(alice, { id: replyNotificationId(alice, sessionId, messageId), sessionId, publicRunId, eventAt, messageId, preview: 'SYNTHETIC', label: null });
  it.each(['2020-01-01T00:00:00.000Z', '2026-11-05T19:29:59.000Z'])('never turns a historical terminal event (%s) into a new alert, across reload and restart', async eventAt => {
    const h = await store();
    const first = h.open(); await first.read(alice); // actor state exists since before the event
    expect(await record(first, eventAt)).toBe('stale');
    expect(await record(first, eventAt)).toBe('stale'); // terminal status reload
    expect(await record(h.open(), eventAt)).toBe('stale'); // restart
    expect((await h.open().read(alice)).items).toEqual([]);
  });
  it('refuses an event before this actor first had state, even inside the freshness window', async () => {
    const h = await store();
    await h.open().read(alice);
    expect(await record(h.open(), '2026-11-06T19:00:00.000Z')).toBe('stale');
  });
  it('still records a fresh event once and dedupes it across reload and restart', async () => {
    const h = await store();
    await h.open().read(alice);
    expect(await record(h.open(), '2026-11-06T19:30:00.000Z')).toBe('created');
    expect(await record(h.open(), '2026-11-06T19:30:00.000Z')).toBe('duplicate');
    expect((await h.open().read(alice)).items).toHaveLength(1);
  });
  it('sends no push for a historical event through the full notifier path', async () => {
    const h = await fixture();
    await h.first.store.registerDevice(alice, device('one'));
    await h.notifier(async () => evidence())({ ...run, eventAt: '2020-01-01T00:00:00.000Z' });
    expect(h.sent).toEqual([]);
    expect((await h.first.store.read(alice)).items).toEqual([]);
  });
});

describe('service worker reply rendering', () => {
  async function worker() {
    const source = await readFile(new URL('../../web/public/push-worker.js', import.meta.url), 'utf8');
    const shown = vi.fn(); let handler: ((event: unknown) => void) | undefined;
    runInNewContext(source, { indexedDB: new IDBFactory(), URL, self: { location: { origin: 'https://command.example' }, addEventListener: (type: string, fn: (event: unknown) => void) => { if (type === 'push') handler = fn; }, registration: { showNotification: shown }, clients: {} } });
    const push = async (payload: unknown) => { let work: Promise<unknown> | undefined; const text = JSON.stringify(payload); handler!({ data: { text: () => text, json: () => payload }, waitUntil: (p: Promise<unknown>) => { work = p; } }); await work; };
    return { shown, push };
  }
  const id = `ntf_${'1'.repeat(32)}`;
  it('renders only a strict version 2 reply and still renders the generic version 1 payload', async () => {
    const w = await worker();
    await w.push({ version: 2, id, title: 'Reply from m', body: 'Hello there.' });
    expect(w.shown).toHaveBeenCalledWith('Reply from m', expect.objectContaining({ body: 'Hello there.', tag: id, data: { id } }));
    await w.push({ version: 1, id: `ntf_${'2'.repeat(32)}` });
    expect(w.shown).toHaveBeenLastCalledWith('Jarvis Command', expect.objectContaining({ body: 'An update is available. Sign in to Command to review it.' }));
  });
  it.each([
    { version: 2, id: `ntf_${'3'.repeat(32)}`, title: 'T', body: 'B', url: 'https://evil.invalid' },
    { version: 2, id: `ntf_${'3'.repeat(32)}`, title: 'T' },
    { version: 2, id: `ntf_${'3'.repeat(32)}`, title: '', body: 'B' },
    { version: 2, id: `ntf_${'3'.repeat(32)}`, title: 'T', body: 'line\nbreak' },
    { version: 2, id: `ntf_${'3'.repeat(32)}`, title: 'T', body: 'x'.repeat(161) },
    { version: 2, id: 'run_private', title: 'T', body: 'B' },
    { version: 3, id: `ntf_${'3'.repeat(32)}`, title: 'T', body: 'B' },
  ])('refuses malformed reply payload %j', async payload => {
    const w = await worker();
    await w.push(payload);
    expect(w.shown).not.toHaveBeenCalled();
  });
});

describe('live-room plumbing', () => {
  async function harness() {
    const directory = await mkdtemp(join(tmpdir(), 'jc-reply-live-')); await chmod(directory, 0o700);
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const ledger = await AuditLedger.open(join(directory, 'events.jsonl'));
    cleanup.push(() => ledger.close());
    const upstream = `run_${'1'.repeat(32)}`;
    const status = (over: Record<string, unknown>) => ({ runId: upstream, sessionId, status: 'completed', updatedAt: '2026-11-06T12:00:01.000Z', approval: null, output: 'RUN OUTPUT must never be the preview', error: null, pendingSteer: null, usage: null, ...over });
    const getRun = vi.fn(async () => status({}));
    const client = {
      readReadiness: vi.fn(), getSession: vi.fn(),
      startRun: vi.fn(async () => ({ runId: upstream, sessionId, status: 'running', replayed: false })),
      getRun, streamRunEvents: vi.fn(async function* () {}),
    } as unknown as CommandProxyClient;
    const notifyReply = vi.fn<(run: ReplyRun) => Promise<boolean>>(async () => true);
    const service = createLiveRoomService({ client, ledger, notifyReply, createPublicRunId: () => publicRunId });
    const submitted = await service.submitRun('alice', { sessionId, input: 'prompt', clientRequestId: '00000000-0000-4000-8000-000000000001' });
    return { service, getRun, notifyReply, status, submitted, client };
  }
  it('offers only identity (no output) once per observation of a completed run, never for failed/cancelled/compaction', async () => {
    const h = await harness();
    await h.service.getRun('alice', publicRunId);
    expect(h.notifyReply).toHaveBeenCalledTimes(1);
    expect(h.notifyReply).toHaveBeenCalledWith({ actor: alice, sessionId, publicRunId, eventAt: expect.any(String) });
    expect(JSON.stringify(h.notifyReply.mock.calls)).not.toMatch(/RUN OUTPUT|run_1/);
    for (const over of [{ status: 'failed', error: 'x' }, { status: 'cancelled' }, { status: 'running' }, { kind: 'context_compaction' }]) {
      const other = await harness(); // terminal audit is per run, so each state needs its own run
      other.getRun.mockResolvedValue(other.status(over) as never);
      await other.service.getRun('alice', publicRunId);
      expect(other.notifyReply).not.toHaveBeenCalled();
    }
  });
  it('offers a completed run once from the event stream after confirming it is a run', async () => {
    const h = await harness();
    (h.client.streamRunEvents as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield { runId: `run_${'1'.repeat(32)}`, type: 'run.completed', timestamp: '2026-11-06T12:00:02.000Z', output: 'RUN OUTPUT', pendingSteer: null, usage: null };
    });
    for await (const event of h.service.streamRunEvents('alice', publicRunId, new AbortController().signal)) void event;
    expect(h.notifyReply).toHaveBeenCalledTimes(1);
  });
});

describe('reply routes', () => {
  async function routes(env_: NodeJS.ProcessEnv) {
    const h = await fixture(env_);
    const presence = createPresence();
    const liveRoom = {
      getRunIdentity: () => ({ sessionId, clientRequestId: '00000000-0000-4000-8000-000000000001' }),
      getRun: async () => ({ sessionId, status: 'completed' }),
      getSession: async () => ({ session: { id: sessionId, title: 'SYNTHETIC', source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-11-06T12:00:00.000Z', messageCount: 0, toolCallCount: 0, pinned: false } }),
    } as unknown as ReturnType<typeof createLiveRoomService>;
    const app = buildApp({
      config: { ...loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:9091', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(h.directory, 'audit.jsonl') }), push: h.config },
      notifications: h.first.store, presence, liveRoom,
      verifyAccess: async assertion => { if (!assertion) throw new Error(); return { subject: assertion, provider: 'cloudflare-access' }; },
      hermes: { readSnapshot: async () => { throw new Error(); } },
    });
    cleanup.push(() => app.close());
    const post = (url: string, body: unknown, who = 'alice') => app.inject({ method: 'POST', url, payload: JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': who, origin: 'https://command.example', 'x-jarvis-command': '1' } });
    const get = (url: string, who = 'alice') => app.inject({ url, headers: { 'cf-access-jwt-assertion': who } });
    return { ...h, app, post, get, presence };
  }
  it('reports disabled, then honestly unsupported (never available) while no verified binding source exists', async () => {
    expect((await (await routes({ ...env })).get('/api/notifications')).json().delivery.replies).toBe('disabled');
    expect((await (await routes({ ...env, REPLY_NOTIFICATIONS_MODE: 'enabled' })).get('/api/notifications')).json().delivery.replies).toBe('unsupported');
  });
  it('accepts a strict per-actor presence mark and rejects widened bodies', async () => {
    const r = await routes({ ...env, REPLY_NOTIFICATIONS_MODE: 'enabled' });
    expect((await r.post('/api/notifications/presence', { sessionId, visible: true })).statusCode).toBe(204);
    expect(r.presence.visible(alice, sessionId)).toBe(true);
    expect(r.presence.visible(bob, sessionId)).toBe(false);
    for (const body of [{ sessionId }, { sessionId, visible: true, actor: bob }, { sessionId: 'bad id', visible: true }]) expect((await r.post('/api/notifications/presence', body)).statusCode).toBe(400);
    expect((await r.app.inject({ method: 'POST', url: '/api/notifications/presence', payload: { sessionId, visible: true } })).statusCode).toBe(401);
    expect((await r.post('/api/notifications/presence', { sessionId, visible: false })).statusCode).toBe(204);
    expect(r.presence.visible(alice, sessionId)).toBe(false);
  });
  it('opens a reply only for its owner after authorization recheck and returns the exact message id', async () => {
    const r = await routes({ ...env, REPLY_NOTIFICATIONS_MODE: 'enabled' });
    await r.notifier(async () => evidence())(run);
    const id = replyNotificationId(alice, sessionId, 'assistant:1');
    expect((await r.post(`/api/notifications/${id}/open`, {}, 'bob')).statusCode).toBe(404);
    const opened = (await r.post(`/api/notifications/${id}/open`, {})).json();
    expect(opened).toMatchObject({ state: 'available', sessionId, messageId: 'assistant:1' });
    expect(JSON.stringify(opened)).not.toMatch(/upstream|run_/);
  });
});
