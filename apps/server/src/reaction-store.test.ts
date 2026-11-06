import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { ReactionStore } from './reaction-store';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fs>() }));
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const actor = 'a'.repeat(64), sessionId = `jc_${'b'.repeat(32)}`;
const mutation = () => ({ sessionId, messageId: 'stored-1', offset: 0, emoji: '👍' as const, action: 'toggle' as const, clientRequestId: randomUUID() });
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'jc-reaction-fault-')); roots.push(root);
  const store = new ReactionStore(root); const request = mutation();
  await store.mutate(actor, request, 'user');
  const path = join(root, 'reactions.json'); return { root, path, store, before: await fs.readFile(path), request };
}

it.each(['write', 'file-sync', 'rename', 'directory-sync'])('keeps immutable state and mutation identity through %s failure', async kind => {
  const { root, path, store, before } = await fixture(); const request = mutation();
  const originalOpen = fs.open;
  if (kind === 'rename') vi.spyOn(fs, 'rename').mockRejectedValueOnce(Error('SYNTHETIC rename failure'));
  else vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.tmp')) {
      if (kind === 'write') vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(Error('SYNTHETIC write failure'));
      if (kind === 'file-sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(Error('SYNTHETIC sync failure'));
    }
    if (String(args[0]) === root && kind === 'directory-sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(Error('SYNTHETIC uncertain commit'));
    return handle;
  });
  await expect(store.mutate(actor, request, 'user')).rejects.toMatchObject({ statusCode: 503 }); vi.restoreAllMocks();
  if (kind === 'directory-sync') {
    await expect(store.read(actor, sessionId, request.messageId)).rejects.toMatchObject({ statusCode: 503 });
    const restarted = new ReactionStore(root);
    expect(await restarted.mutate(actor, request, 'user')).toMatchObject({ active: false, replayed: true });
  } else {
    expect(await fs.readFile(path)).toEqual(before);
    expect(await new ReactionStore(root).mutate(actor, request, 'user')).toMatchObject({ active: false, replayed: false });
  }
  expect(JSON.parse(await fs.readFile(path, 'utf8')).events.map((e: { action: string }) => e.action)).toEqual(['add', 'remove']);
  expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it('recovers a frozen send after uncertain claim commit, retaining later events for the next identity', async () => {
  const { root, store } = await fixture(); const clientRequestId = randomUUID(), fingerprint = 'f'.repeat(64);
  const originalOpen = fs.open;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]) === root) vi.spyOn(handle, 'sync').mockRejectedValueOnce(Error('SYNTHETIC unknown claim ACK'));
    return handle;
  });
  await expect(store.forSend(actor, sessionId, clientRequestId, fingerprint, 10, true, () => false)).rejects.toMatchObject({ statusCode: 503 });
  vi.restoreAllMocks(); const restarted = new ReactionStore(root);
  await restarted.mutate(actor, mutation(), 'user');
  await expect(restarted.forSend(actor, sessionId, randomUUID(), fingerprint, 10, true, () => false)).rejects.toMatchObject({ statusCode: 409 });
  const note = await restarted.forSend(actor, sessionId, clientRequestId, fingerprint, 10, true, () => false);
  expect(note).toContain('"action":"add"'); expect(note).not.toContain('"action":"remove"');
  expect(await restarted.forSend(actor, sessionId, randomUUID(), fingerprint, 10, true, () => true)).toContain('"action":"remove"');
});

it('serializes multiple instances and concurrent toggles/retries without losing audit facts', async () => {
  const { root, store } = await fixture(); const other = new ReactionStore(root); const request = mutation();
  const receipts = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? store : other).mutate(actor, request, 'user')));
  expect(receipts.filter(r => !r.replayed)).toHaveLength(1);
  expect(receipts.every(r => r.active === false)).toBe(true);
  expect(JSON.parse(await fs.readFile(join(root, 'reactions.json'), 'utf8')).events).toHaveLength(2);
  const differentSession = { ...mutation(), sessionId: `jc_${'c'.repeat(32)}` };
  await other.mutate(actor, differentSession, 'assistant');
  expect((await store.read(actor, sessionId, request.messageId)).emojis).toEqual([]);
  expect((await store.read(actor, differentSession.sessionId, request.messageId)).emojis).toEqual(['👍']);
});

it.each(['file-mode', 'hardlink', 'symlink', 'schema', 'missing', 'oversize'])('fails closed for %s storage without replacing retained state', async kind => {
  const { root, path, store } = await fixture();
  if (kind === 'file-mode') await fs.chmod(path, 0o644);
  if (kind === 'hardlink') await fs.link(path, join(root, 'retained-link'));
  if (kind === 'symlink') { await fs.rename(path, join(root, 'retained.json')); await fs.symlink(join(root, 'retained.json'), path); }
  if (kind === 'schema') await fs.writeFile(path, '{invalid');
  if (kind === 'missing') await fs.rename(path, join(root, 'retained.json'));
  if (kind === 'oversize') await fs.writeFile(path, 'x'.repeat(4_194_305));
  await expect(store.read(actor, sessionId, 'stored-1')).rejects.toMatchObject({ statusCode: 503 });
  await expect(store.mutate(actor, mutation(), 'user')).rejects.toMatchObject({ statusCode: 503 });
});

it('caps immutable audit and receipt storage without pruning or replaying old toggles', async () => {
  const { root, path, request } = await fixture();
  const state = JSON.parse(await fs.readFile(path, 'utf8'));
  state.mutations = Array.from({ length: 8192 }, (_, i) => ({ ...state.mutations[0], clientRequestId: i === 0 ? request.clientRequestId : randomUUID() }));
  await fs.writeFile(path, JSON.stringify(state)); const full = new ReactionStore(root);
  expect(await full.mutate(actor, request, 'user')).toMatchObject({ replayed: true, active: true });
  await expect(full.mutate(actor, mutation(), 'user')).rejects.toMatchObject({ statusCode: 409 });
  expect(JSON.parse(await fs.readFile(path, 'utf8')).mutations).toHaveLength(8192);
});

it('bounds note characters independently of event count without consuming pending events', async () => {
  const { root, store } = await fixture();
  for (let i = 0; i < 20; i++) await store.mutate(actor, { ...mutation(), messageId: 'm'.repeat(157) + i.toString().padStart(3, '0') }, 'assistant');
  await expect(store.forSend(actor, sessionId, randomUUID(), 'f'.repeat(64), 10, true, () => false)).rejects.toMatchObject({ statusCode: 409 });
  expect(JSON.parse(await fs.readFile(join(root, 'reactions.json'), 'utf8')).claims).toEqual([]);
});

it.each(['events', 'claims'])('refuses saturated %s without removing immutable identities', async kind => {
  const { root, path } = await fixture(); const state = JSON.parse(await fs.readFile(path, 'utf8'));
  if (kind === 'events') state.events = Array.from({ length: 4096 }, (_, i) => ({ ...state.events[0], sequence: i + 1, clientRequestId: randomUUID() }));
  else state.claims = Array.from({ length: 4096 }, () => ({ actor, sessionId, clientRequestId: randomUUID(), fingerprint: 'f'.repeat(64), sequences: [] }));
  await fs.writeFile(path, JSON.stringify(state)); const before = await fs.readFile(path);
  const full = new ReactionStore(root);
  if (kind === 'events') await expect(full.mutate(actor, mutation(), 'user')).rejects.toMatchObject({ statusCode: 409 });
  else await expect(full.forSend(actor, sessionId, randomUUID(), 'f'.repeat(64), 10, true, () => true)).rejects.toMatchObject({ statusCode: 409 });
  expect(await fs.readFile(path)).toEqual(before);
});

it('claims only the sending actor/session and preserves other actors and sessions for their own sends', async () => {
  const { store } = await fixture();
  const otherActor = 'b'.repeat(64), otherSession = `jc_${'c'.repeat(32)}`;
  await store.mutate(otherActor, { ...mutation(), messageId: 'other-actor' }, 'user');
  await store.mutate(actor, { ...mutation(), sessionId: otherSession, messageId: 'other-session' }, 'user');
  const note = await store.forSend(actor, sessionId, randomUUID(), 'f'.repeat(64), 10, true, () => true);
  expect(note).toContain('stored-1'); expect(note).not.toContain('other-actor'); expect(note).not.toContain('other-session');
  expect(await store.forSend(otherActor, sessionId, randomUUID(), 'f'.repeat(64), 10, true, () => true)).toContain('other-actor');
  expect(await store.forSend(actor, otherSession, randomUUID(), 'f'.repeat(64), 10, true, () => true)).toContain('other-session');
});
