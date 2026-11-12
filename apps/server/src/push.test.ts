import { createECDH, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import webpush from 'web-push';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import type { createLiveRoomService } from './live-room-service';
import { MAX_PUSH_RECEIPTS, NotificationStore } from './notification-store';
import { createPushService, publicPushAddress, pushConfig, restrictedPushTransport, supportedPushEndpoint, type PushConfig, type PushRequest } from './push-service';
import { createRunNotifier, notificationId } from './run-notifier';
import { createReplyNotifier, replyNotificationId, type ReplyEvidenceSource } from './reply-notifier';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanups.splice(0).map(fn => fn())); });
const actor = createHash('sha256').update('alice').digest('hex');
const other = createHash('sha256').update('bob').digest('hex');
const keys = webpush.generateVAPIDKeys(); // ephemeral local fixture, never persisted/logged
const env = { WEB_PUSH_MODE: 'enabled', WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.invalid' };
const config = pushConfig({ ...env, REPLY_NOTIFICATIONS_MODE: 'enabled' });
const receiver = createECDH('prime256v1'); receiver.generateKeys();
const auth = randomBytes(16).toString('base64url');
const subscription = (token = 'SYNTHETIC') => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${token}`, expirationTime: null, keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth } });
const event = (n = 1) => ({ actor, category: 'run-completed' as const, publicRunId: `jcr_${n.toString(16).padStart(32, '0')}`, sessionId: 'jc_' + 'a'.repeat(32), eventAt: new Date().toISOString() });
// Reply-only release: the sole push category. Synthetic verified evidence per exact message number.
const SESSION = 'jc_' + 'a'.repeat(32);
const replyId = (n: number) => replyNotificationId(actor, SESSION, `assistant:${n}`);
const evidenceFor: ReplyEvidenceSource = async run => ({ userMessageId: 'user:0', assistantMessageId: `assistant:${run.publicRunId.slice(-1)}`, message: { id: `assistant:${run.publicRunId.slice(-1)}`, sessionId: run.sessionId, role: 'assistant', content: 'SYNTHETIC answer' }, executed: { model: 'synthetic' } });
const replyAt = (store: NotificationStore, push: ReturnType<typeof createPushService>, enabled = true) => {
  const notifier = createReplyNotifier({ store, push, enabled, source: evidenceFor });
  return (n = 1) => notifier({ actor, sessionId: SESSION, publicRunId: `jcr_${'0'.repeat(31)}${n}`, eventAt: new Date(Date.now() + 60_000).toISOString() });
};
async function storeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jc-push-')); await chmod(directory, 0o700);
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const clock = { now: new Date() };
  const store = new NotificationStore(directory, () => clock.now);
  return { directory, clock, store };
}
async function routesFixture(push: PushConfig = config) {
  const h = await storeFixture();
  const app = buildApp({
    config: { ...loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:9091', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(h.directory, 'audit.jsonl') }), push },
    notifications: h.store,
    liveRoom: {} as ReturnType<typeof createLiveRoomService>,
    verifyAccess: async assertion => { if (!assertion) throw new Error(); return { subject: assertion, provider: 'cloudflare-access' }; },
    hermes: { readSnapshot: async () => { throw new Error(); } },
  });
  cleanups.push(() => app.close());
  const get = (url: string, who = 'alice') => app.inject({ url, headers: { 'cf-access-jwt-assertion': who } });
  const post = (url: string, body: unknown, who = 'alice') => app.inject({ method: 'POST', url, payload: JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': who, origin: 'https://command.example', 'x-jarvis-command': '1' } });
  return { ...h, app, get, post };
}

it('defaults disabled, tolerates absent/bad enabled configuration, and performs zero push effects', async () => {
  const h = await storeFixture();
  const claim = vi.spyOn(h.store, 'claimReplyPush'); const transport = vi.fn();
  expect(pushConfig({}).capability).toEqual({ state: 'unavailable', reason: 'disabled' });
  expect(pushConfig({ WEB_PUSH_MODE: 'enabled' }).capability).toEqual({ state: 'unavailable', reason: 'configuration' });
  expect(pushConfig({ WEB_PUSH_MODE: 'enabled', WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.invalid' }).capability.state).toBe('unavailable');
  const notify = createRunNotifier(h.store);
  expect(await notify(event())).toBe(true);
  expect((await h.store.read(actor)).items).toHaveLength(1);
  expect(await replyAt(h.store, createPushService(pushConfig({}), h.store, transport), pushConfig({}).replies === true)()).toBe(false); // reply control off too
  expect(claim).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  const r = await routesFixture(pushConfig({}));
  expect((await r.get('/api/notifications/push')).json().capability).toEqual({ state: 'unavailable', reason: 'disabled' });
  expect((await r.post('/api/notifications/push/devices', subscription())).statusCode).toBe(503);
  expect((await r.store.readPush(actor)).devices).toEqual([]);
});

it('uses authenticated actor identity, same-origin checks and strict private DTOs for registration/revocation', async () => {
  const r = await routesFixture();
  expect((await r.app.inject({ url: '/api/notifications/push' })).statusCode).toBe(401);
  expect((await r.app.inject({ method: 'POST', url: '/api/notifications/push/devices', payload: subscription(), headers: { 'cf-access-jwt-assertion': 'alice' } })).statusCode).toBe(403);
  for (const body of [{ ...subscription(), actor: other }, { ...subscription(), keys: { auth: 'bad', p256dh: 'bad' } }, { ...subscription(), endpoint: 'https://127.0.0.1/private' }]) expect((await r.post('/api/notifications/push/devices', body)).statusCode).toBe(400);
  const registered = (await r.post('/api/notifications/push/devices', subscription())).json();
  expect(registered.push.devices).toHaveLength(1);
  expect(JSON.stringify(registered)).not.toContain(subscription().endpoint);
  expect(JSON.stringify(registered)).not.toContain(auth);
  expect(JSON.stringify(registered)).not.toContain(keys.privateKey);
  expect(registered.push.capability.publicKey).toBe(keys.publicKey);
  expect((await r.post('/api/notifications/push/devices', subscription())).json().push.devices).toEqual(registered.push.devices);
  expect((await r.post('/api/notifications/push/devices', subscription(), 'bob')).statusCode).toBe(404);
  const id = registered.push.devices[0].id;
  expect((await r.post(`/api/notifications/push/devices/${id}/revoke`, {}, 'bob')).statusCode).toBe(404);
  expect((await r.get('/api/notifications/push', 'bob')).json().devices).toEqual([]);
  expect((await r.post(`/api/notifications/push/devices/${id}/revoke`, {})).json().push.devices).toEqual([]);
  expect((await r.post('/api/notifications/push/devices', { ...subscription(), expirationTime: 1 })).statusCode).toBe(400);
  await writeFile(join(r.directory, 'push-devices.json'), 'broken');
  expect((await r.get('/api/notifications/push')).json()).toEqual({ capability: { state: 'unavailable', reason: 'storage' }, devices: [] });
  // Private push corruption must not invalidate the inbox, preferences or rollback format.
  const stillWorking = await r.get('/api/notifications');
  expect(stillWorking.statusCode).toBe(200);
  expect(stillWorking.json().push.capability).toEqual({ state: 'unavailable', reason: 'storage' });
  expect((await r.post('/api/notifications/preferences', { categories: { 'run-completed': false, 'run-failed': true, approval: true } })).statusCode).toBe(200);
  const inboxBytes = JSON.parse(await readFile(join(r.directory, 'notifications.json'), 'utf8'));
  expect(inboxBytes.actors[actor]).not.toHaveProperty('push');
});

it.each(['run-completed', 'run-failed', 'approval'] as const)('never pushes retired %s alerts on any configured path, with reply control enabled or disabled, while keeping in-app history', async category => {
  for (const mode of [{ ...env, REPLY_NOTIFICATIONS_MODE: 'enabled' }, env]) {
    const h = await storeFixture(); await h.store.registerDevice(actor, subscription());
    const transport = vi.fn(async () => 201);
    const push = createPushService(pushConfig(mode), h.store, transport);
    const e = { ...event(), category, ...(category === 'approval' ? { key: 'req' } : {}) };
    expect(await createRunNotifier(h.store)(e)).toBe(true);
    // Every sender entry point, including a forged call with the run-state id, refuses.
    expect('deliver' in push).toBe(false);
    await push.deliverReply(actor, notificationId(e));
    expect(transport).not.toHaveBeenCalled();
    expect((await h.store.read(actor)).items.map(item => item.category)).toEqual([category]);
    expect(JSON.parse(await readFile(join(h.directory, 'push-devices.json'), 'utf8')).actors[actor].push.receipts).toEqual([]);
  }
});

it.each([201, 410, 404, 429, 500, 302, 'unknown'] as const)('claims before transport and never resends status %s across concurrent observations/restart', async outcome => {
  const h = await storeFixture(); await h.store.registerDevice(actor, subscription());
  const transport = vi.fn(async () => { if (outcome === 'unknown') throw new Error('SYNTHETIC lost ACK'); return outcome; });
  const notify = replyAt(h.store, createPushService(config, h.store, transport));
  await Promise.all([notify(), notify(), notify()]);
  const restart = new NotificationStore(h.directory);
  await replyAt(restart, createPushService(config, restart, transport))();
  expect(transport).toHaveBeenCalledTimes(1);
  const state = JSON.parse(await readFile(join(h.directory, 'push-devices.json'), 'utf8'));
  expect(state.actors[actor].push.receipts).toEqual([{ id: replyId(1), deviceId: (await h.store.readPush(actor)).devices[0]?.id ?? state.actors[actor].push.receipts[0].deviceId, outcome: outcome === 'unknown' ? 'unknown' : outcome === 201 ? 'sent' : outcome === 410 || outcome === 404 ? 'expired' : 'failed' }]);
  if (outcome === 410 || outcome === 404) expect((await restart.readPush(actor)).devices).toEqual([]);
});

it('keeps unknown claims after a crash or receipt-write fault, and isolates notification failure from notifier success', async () => {
  const h = await storeFixture(); await h.store.registerDevice(actor, subscription());
  const noPush = createPushService(pushConfig({}), h.store, vi.fn());
  await replyAt(h.store, noPush)(1); // item recorded, nothing sent
  const item = (await h.store.read(actor)).items[0]!;
  expect(await h.store.claimReplyPush(actor, item.id)).toHaveLength(1); // crash before transport
  const transport = vi.fn(async () => 201);
  const restart = new NotificationStore(h.directory);
  await createPushService(config, restart, transport).deliverReply(actor, item.id);
  expect(transport).not.toHaveBeenCalled();
  await createPushService(config, restart, transport).deliverReply(other, item.id);
  expect(transport).not.toHaveBeenCalled();
  vi.spyOn(restart, 'finishPush').mockRejectedValue(new Error());
  expect(await replyAt(restart, createPushService(config, restart, transport))(2)).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
  await createPushService(config, new NotificationStore(h.directory), transport).deliverReply(actor, replyId(2));
  expect(transport).toHaveBeenCalledTimes(1);
  vi.spyOn(restart, 'claimReplyPush').mockRejectedValue(new Error());
  expect(await replyAt(restart, createPushService(config, restart, transport))(3)).toBe(true);
});

it('respects expiry, revocation, read state, no registration backfill and finite device/receipt bounds', async () => {
  const h = await storeFixture(); const transport = vi.fn(async () => 201);
  const push = createPushService(config, h.store, transport); const notify = replyAt(h.store, push);
  const device = (await h.store.registerDevice(actor, subscription()), (await h.store.readPush(actor)).devices[0]!);
  await h.store.revokeDevice(actor, device.id); await notify(2); expect(transport).not.toHaveBeenCalled();
  h.clock.now = new Date(h.clock.now.getTime() + 1000);
  await h.store.registerDevice(actor, subscription()); await notify(2); expect(transport).not.toHaveBeenCalled();
  h.clock.now = new Date(h.clock.now.getTime() + 31 * 86400_000); await notify(3); expect(transport).not.toHaveBeenCalled();
  for (let i = 0; i < 8; i++) await h.store.registerDevice(actor, subscription(`fixture-${i}`));
  await expect(h.store.registerDevice(actor, subscription('over-bound'))).rejects.toThrow();
  const path = join(h.directory, 'push-devices.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  state.actors[actor].push.receipts = Array.from({ length: MAX_PUSH_RECEIPTS }, (_, n) => ({ id: `ntf_${n.toString(16).padStart(32, '0')}`, deviceId: device.id, outcome: 'unknown' }));
  await writeFile(path, JSON.stringify(state));
  await notify(4); expect(transport).not.toHaveBeenCalled();
  expect((await h.store.readPush(actor)).full).toBe(true);
  await h.store.markRead(actor, { all: true });
  await push.deliverReply(actor, replyId(4)); expect(transport).not.toHaveBeenCalled();
});

it('allows only bounded exact push-service destinations and public DNS addresses', async () => {
  for (const endpoint of [subscription().endpoint, 'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://web.push.apple.com/Qtoken']) expect(supportedPushEndpoint(endpoint)).toBe(true);
  for (const endpoint of ['http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:444/fcm/send/x', 'https://fcm.googleapis.com.evil.invalid/fcm/send/x', 'https://user:pass@fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com/fcm/send/x?secret=x', 'https://fcm.googleapis.com/fcm/send/%2e%2e', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/x', 'https://web.push.apple.com//evil/x', subscription('a'.repeat(2000)).endpoint]) {
    expect(supportedPushEndpoint(endpoint), endpoint).toBe(false);
    await expect(restrictedPushTransport({ endpoint, headers: {}, body: Buffer.alloc(0) })).rejects.toThrow();
  }
  for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1']) expect(publicPushAddress(ip), ip).toBe(false);
  expect(publicPushAddress('8.8.8.8')).toBe(true);
  expect(publicPushAddress('172.217.1.1')).toBe(true);
});

// The actual encrypted sender payload is decrypted only by an ephemeral local receiver, then
// passed to the production worker script with durable IndexedDB and captured display/navigation.
it('proves local VAPID/encrypted transport → worker display/dedupe/restart → fixed private-safe click', async () => {
  const h = await storeFixture(); await h.store.registerDevice(actor, subscription());
  const captured: PushRequest[] = [];
  await replyAt(h.store, createPushService(config, h.store, async request => { captured.push(request); return 201; }))();
  expect(captured).toHaveLength(1);
  expect(captured[0]!.headers['Content-Encoding']).toBe('aes128gcm');
  expect(JSON.stringify(captured[0]!.headers)).toMatch(/vapid/i);
  const ece = createRequire(import.meta.url)('http_ece') as { decrypt: (body: Buffer, options: unknown) => Buffer };
  const decoded = ece.decrypt(captured[0]!.body, { version: 'aes128gcm', privateKey: receiver, authSecret: auth }).toString();
  expect(JSON.parse(decoded)).toEqual({ version: 2, id: replyId(1), title: 'Reply from synthetic', body: 'SYNTHETIC answer' });
  expect(decoded).not.toMatch(/jc_|jcr_|run_|prompt|approval|actor|endpoint|alice/);
  const db = new IDBFactory();
  const source = await readFile(new URL('../../web/public/push-worker.js', import.meta.url), 'utf8');
  const shown = vi.fn(); const openWindow = vi.fn(); const postMessage = vi.fn(); const focus = vi.fn();
  const worker = (clients: unknown[] = [], database: unknown = db) => {
    const handlers: Record<string, (event: unknown) => void> = {};
    runInNewContext(source, { indexedDB: database, URL, self: { location: { origin: 'https://command.example' }, addEventListener: (type: string, fn: (event: unknown) => void) => { handlers[type] = fn; }, registration: { showNotification: shown }, clients: { matchAll: async () => clients, openWindow } } });
    return async (type: string, value: Record<string, unknown>) => { let work: Promise<unknown> | undefined; handlers[type]!({ ...value, waitUntil: (promise: Promise<unknown>) => { work = promise; } }); await work; };
  };
  const data = { text: () => decoded, json: () => JSON.parse(decoded) };
  await worker()('push', { data });
  await worker()('push', { data }); // new worker with same durable receipt DB
  expect(shown).toHaveBeenCalledTimes(1);
  expect(shown).toHaveBeenCalledWith('Reply from synthetic', expect.objectContaining({ body: 'SYNTHETIC answer', data: { id: replyId(1) }, tag: replyId(1), renotify: false }));
  const close = vi.fn();
  const notification = { close, data: { id: replyId(1), url: 'https://evil.invalid', sessionId: 'private' } };
  await worker()('notificationclick', { notification, action: '' });
  expect(openWindow).toHaveBeenCalledWith(`https://command.example/?notification=${replyId(1)}`);
  await worker([{ url: 'https://command.example/', postMessage, focus }])('notificationclick', { notification, action: '' });
  expect(postMessage).toHaveBeenCalledWith({ type: 'command-notification', id: replyId(1) });
  expect(focus).toHaveBeenCalledTimes(1); expect(openWindow).toHaveBeenCalledTimes(1);
  await worker()('notificationclick', { notification, action: 'approve' });
  await worker()('push', { data: { text: () => '{}', json: () => ({ version: 1, id: 'https://evil.invalid' }) } });
  await worker([], undefined)('push', { data: { text: () => 'x'.repeat(300), json: () => ({}) } });
  await worker([], { open: () => { throw new Error('SYNTHETIC unavailable'); } })('push', { data });
  expect(shown).toHaveBeenCalledTimes(1); expect(openWindow).toHaveBeenCalledTimes(1);
  await new Promise<void>((resolve, reject) => {
    const request = db.open('command-push-receipts', 1);
    request.onerror = () => reject(new Error());
    request.onsuccess = () => {
      const connection = request.result; const tx = connection.transaction('ids', 'readwrite');
      for (let n = 0; n < 2047; n++) tx.objectStore('ids').put(true, `fixture-${n}`);
      tx.oncomplete = () => { connection.close(); resolve(); }; tx.onerror = () => reject(new Error());
    };
  });
  const next = JSON.stringify({ version: 2, id: replyId(2), title: 'T', body: 'B' });
  await worker()('push', { data: { text: () => next, json: () => JSON.parse(next) } });
  expect(shown).toHaveBeenCalledTimes(1); // bounded receipts never evict/replay
});

it('puts the run output’s first line in a fallback push only when reply text is shown, and never stores it', async () => {
  const h = await storeFixture();
  await h.store.registerDevice(actor, subscription());
  h.clock.now = new Date(Date.now() + 1000);
  const bodies: string[] = [];
  vi.spyOn(webpush, 'generateRequestDetails').mockImplementation(((_subscription: unknown, payload: string) => {
    bodies.push(JSON.parse(payload).body as string);
    return { headers: {}, body: Buffer.from('x') } as never;
  }) as never);
  const push = createPushService(config, h.store, vi.fn(async () => 201));
  const notify = createRunNotifier(h.store, push);
  await notify({ ...event(1), pushFallback: true, preview: 'Disk usage is fine on all servers.' });
  await h.store.setPreferences(actor, { categories: { 'run-completed': true, 'run-failed': true, approval: true }, showReplyText: false });
  await notify({ ...event(2), pushFallback: true, preview: 'Hidden answer' });
  expect(bodies).toEqual(['Disk usage is fine on all servers.', 'Jarvis finished your request. Open the chat to read the answer.']);
  expect(JSON.stringify((await h.store.read(actor)).items)).not.toMatch(/Disk usage|Hidden/);
});
