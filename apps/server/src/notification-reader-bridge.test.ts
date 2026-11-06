import { createECDH, randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationInboxSchema } from '@jarvis-command/contracts';
import { afterEach, expect, it } from 'vitest';
import { NotificationStorageError, NotificationStore } from './notification-store';
import { notificationId } from './run-notifier';

// Rollback reader bridge (#99): this release can READ and PRESERVE what a later reply writer
// persists, but nothing here creates, toggles or pushes an assistant-reply item.
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())); });
const actor = 'a'.repeat(64);
const other = 'b'.repeat(64);
const AT = '2026-11-06T12:00:00.000Z';
const replyItem = {
  id: `ntf_${'1'.repeat(32)}`, category: 'assistant-reply', observedAt: AT, sessionId: `jc_${'2'.repeat(32)}`,
  publicRunId: `jcr_${'3'.repeat(32)}`, title: 'Jarvis replied', body: 'SYNTHETIC preview', readAt: null,
  reply: { messageId: 'assistant:exact', label: 'synthetic-model' },
};
const categories = { 'run-completed': true, 'run-failed': false, approval: true };
const receiver = createECDH('prime256v1'); receiver.generateKeys();
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/SYNTHETIC', expirationTime: null, keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };

async function fixture(items: unknown[] = [replyItem], preferences: unknown = { categories, showReplyText: false }) {
  const directory = await mkdtemp(join(tmpdir(), 'jc-reader-')); await chmod(directory, 0o700);
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'notifications.json');
  const state = { version: 1, actors: { [actor]: { preferences, items, settled: [{ id: replyItem.id, at: AT }], since: AT, horizon: null } } };
  await writeFile(path, JSON.stringify(state), { mode: 0o600 });
  return { directory, path, state, store: new NotificationStore(directory) };
}

it('reads a writer-produced reply item and preference and projects a valid inbox', async () => {
  const { store } = await fixture();
  const view = await store.read(actor);
  expect(view.items).toEqual([replyItem]);
  expect(view.preferences).toEqual({ categories, showReplyText: false });
  expect(NotificationInboxSchema.safeParse({
    version: 1, items: view.items, unreadCount: 1, preferences: view.preferences,
    delivery: { inApp: 'incomplete', push: 'unavailable', externalSurfaces: 'unavailable' },
  }).success).toBe(true);
});

it('preserves reply items, metadata and the reply preference across read-marking, preference edits, run-state events and restart', async () => {
  const { directory, path, store } = await fixture();
  await store.markRead(actor, { ids: [replyItem.id] });
  // An edit that omits the optional reply setting (as a pre-setting client does) must not erase it.
  await store.setPreferences(actor, { categories: { ...categories, approval: false } });
  const runEvent = { id: notificationId({ actor, category: 'run-completed', publicRunId: `jcr_${'4'.repeat(32)}` }), category: 'run-completed' as const, sessionId: `jc_${'5'.repeat(32)}`, publicRunId: `jcr_${'4'.repeat(32)}`, eventAt: AT };
  expect(await store.record(actor, runEvent)).toBe('created');
  const saved = JSON.parse(await readFile(path, 'utf8')).actors[actor];
  expect(saved.preferences).toEqual({ categories: { ...categories, approval: false }, showReplyText: false });
  expect(saved.items[0]).toEqual({ ...replyItem, readAt: expect.any(String) });
  const restarted = await new NotificationStore(directory).read(actor);
  expect(restarted.items.map(item => item.category).sort()).toEqual(['assistant-reply', 'run-completed']);
  // Writer: an explicit toggle is stored.
  await store.setPreferences(actor, { categories, showReplyText: true });
  expect((await new NotificationStore(directory).read(actor)).preferences.showReplyText).toBe(true);
});

it.each([true, false])('writes the reply setting only when supplied (input %s)', async value => {
  const { path, store } = await fixture([], { categories });
  await store.setPreferences(actor, { categories, showReplyText: value });
  expect(JSON.parse(await readFile(path, 'utf8')).actors[actor].preferences).toEqual({ categories, showReplyText: value });
});

it('keeps a store without the optional setting byte-compatible: no field is invented', async () => {
  const { path, store } = await fixture([], { categories });
  await store.setPreferences(actor, { categories });
  expect(JSON.parse(await readFile(path, 'utf8')).actors[actor].preferences).toEqual({ categories });
});

it('does not claim a stale reply item for a registered device', async () => {
  const { store } = await fixture();
  await store.registerDevice(actor, subscription);
  expect(await store.claimReplyPush(actor, replyItem.id)).toHaveLength(0); // observed far outside the 24 h push window
  expect(await store.readPush(actor)).toMatchObject({ full: false });
});

it('keeps reply items private to their actor', async () => {
  const { store } = await fixture();
  expect((await store.read(other)).items).toEqual([]);
  await expect(store.markRead(other, { ids: [replyItem.id] })).rejects.toBeInstanceOf(Error);
});

it.each([
  ['reply category without metadata', { ...replyItem, reply: undefined }],
  ['metadata on a run-state item', { ...replyItem, category: 'run-completed' }],
  ['raw upstream run id smuggled into metadata', { ...replyItem, reply: { ...replyItem.reply, upstreamRunId: 'run_x' } }],
  ['padded message id', { ...replyItem, reply: { ...replyItem.reply, messageId: ' x' } }],
  ['unknown category', { ...replyItem, category: 'run-started', reply: undefined }],
])('refuses malformed reply state without replacing the stored bytes: %s', async (_name, item) => {
  const { path, store } = await fixture([item]);
  const before = await readFile(path);
  await expect(store.read(actor)).rejects.toBeInstanceOf(NotificationStorageError);
  await expect(store.setPreferences(actor, { categories })).rejects.toBeInstanceOf(NotificationStorageError);
  expect(await readFile(path)).toEqual(before);
});
