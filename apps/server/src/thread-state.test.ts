import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createThreadState } from './thread-state';
import { ThreadReadStore } from './thread-read-store';
import type { createLiveRoomService } from './live-room-service';
import type { SessionMessage } from '@jarvis-command/contracts';
const id = 'jc_' + 'a'.repeat(32);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(count = 2) {
  const root = await mkdtemp(join(tmpdir(), 'jc-p13-')); roots.push(root);
  const messages: SessionMessage[] = Array.from({ length: count }, (_, i) => ({ id: `m:${i}`, sessionId: id, role: 'assistant', content: 'test', timestamp: null, toolName: null, displayKind: null }));
  const source = {
    getSession: vi.fn(async () => ({ session: { id, ownership: 'command' } })),
    getMessages: vi.fn(async (_subject: string, sessionId: string, limit: number, offset: number) => ({ sessionId, messages: messages.slice(offset, offset + limit), pagination: { limit, offset, returned: messages.slice(offset, offset + limit).length, hasMore: offset + limit < messages.length } })),
    getRosterStatus: vi.fn(async () => ({ status: 'unknown' as const, runUpdatedAt: null })),
    submitRun: vi.fn(),
  };
  const store = new ThreadReadStore(root);
  const service = () => createThreadState(source as unknown as ReturnType<typeof createLiveRoomService>, new ThreadReadStore(root));
  return { source, root, store, state: service(), service, messages };
}
it('uses canonical latest identity, syncs actors/devices across restart, and never admits a run', async () => {
  const { state, service, source } = await fixture(102);
  expect(await state.read('a', id)).toMatchObject({ latest: { messageId: 'm:101', position: 101 }, unread: true, historyComplete: true });
  expect(source.getMessages.mock.calls.map(c => c[3])).toEqual([0, 100]);
  expect(await state.read('a', id, { messageId: 'm:101', position: 101 })).toMatchObject({ unread: false });
  expect(await service().read('a', id)).toMatchObject({ unread: false });
  expect(await service().read('b', id)).toMatchObject({ unread: true });
  expect(source.submitRun).not.toHaveBeenCalled();
});
it('targets the latest rendered chat record across trailing metadata and page boundaries', async () => {
  const { state, source, messages, service } = await fixture(99);
  messages.splice(0, messages.length,
    ...Array.from({ length: 99 }, (_, i) => ({ id: `old:${i}`, sessionId: id, role: 'assistant' as const, content: 'reply', timestamp: null, toolName: null, displayKind: null })),
    { id: 'answer', sessionId: id, role: 'assistant' as const, content: 'answer', timestamp: null, toolName: null, displayKind: null },
    { id: 'setup', sessionId: id, role: 'system' as const, content: 'Session setup', timestamp: null, toolName: null, displayKind: null },
    { id: 'notice', sessionId: id, role: 'user' as const, content: 'internal', timestamp: null, toolName: null, displayKind: 'internal_notification' },
    { id: 'tool', sessionId: id, role: 'tool' as const, content: 'tool output', timestamp: null, toolName: 'shell', displayKind: null },
    { id: 'empty', sessionId: id, role: 'assistant' as const, content: '', timestamp: null, toolName: null, displayKind: null },
  );
  source.getMessages.mockImplementation(async (_subject, sessionId, limit, offset) => ({ sessionId, messages: messages.slice(offset, offset + limit), pagination: { limit, offset, returned: messages.slice(offset, offset + limit).length, hasMore: offset + limit < messages.length } }));
  expect(await state.read('a', id)).toMatchObject({ latest: { messageId: 'answer', position: 99 }, unread: true, historyComplete: true });
  expect(await state.read('a', id, { messageId: 'answer', position: 99 })).toMatchObject({ latest: { messageId: 'answer', position: 99 }, lastRead: { messageId: 'answer', position: 99 }, unread: false });
  expect(await service().read('a', id)).toMatchObject({ unread: false });
  expect(source.submitRun).not.toHaveBeenCalled();
});
it('keeps the last eligible absolute position across an empty skipped-only trailing page', async () => {
  const { state, source } = await fixture();
  source.getMessages.mockImplementation(async (_subject, sessionId, limit, offset) => offset === 0
    ? { sessionId, messages: [{ id: 'answer:0', sessionId, role: 'assistant', content: 'answer', timestamp: null, toolName: null, displayKind: null }], pagination: { limit, offset, returned: 1, hasMore: true } }
    : { sessionId, messages: [], pagination: { limit, offset, returned: 0, hasMore: false } });
  expect(await state.read('a', id)).toMatchObject({ latest: { messageId: 'answer:0', position: 0 }, unread: true, historyComplete: true });
  expect(await state.read('a', id, { messageId: 'answer:0', position: 0 })).toMatchObject({ latest: { messageId: 'answer:0', position: 0 }, unread: false });
});

it('migrates only an exact excluded metadata marker after the eligible message is viewed', async () => {
  const { state, service, store, messages } = await fixture();
  const otherSession = 'jc_' + 'b'.repeat(32);
  const otherActor = 'bb'.repeat(32);
  await store.advance({ actor: otherActor, sessionId: id, messageId: 'other-actor', position: 9 });
  await store.advance({ actor: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', sessionId: otherSession, messageId: 'other-session', position: 9 });
  messages.push({ id: 'setup:tail', sessionId: id, role: 'system', content: 'metadata', timestamp: null, toolName: null, displayKind: null });
  // Simulate the durable pre-repair marker written against the former canonical tail.
  await store.advance({ actor: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', sessionId: id, messageId: 'setup:tail', position: 2 });
  expect(await state.read('a', id)).toMatchObject({ latest: { messageId: 'm:1', position: 1 }, lastRead: { messageId: 'setup:tail', position: 2 }, unread: true });
  await expect(state.read('a', id, { messageId: 'setup:tail', position: 2 })).rejects.toMatchObject({ statusCode: 409 });
  expect((await store.list()).find(entry => entry.actor === 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb' && entry.sessionId === id)?.messageId).toBe('setup:tail');
  await state.read('a', id, { messageId: 'm:1', position: 1 });
  expect(await service().read('a', id)).toMatchObject({ latest: { messageId: 'm:1', position: 1 }, lastRead: { messageId: 'm:1', position: 1 }, unread: false });
  expect(await store.list()).toEqual(expect.arrayContaining([
    expect.objectContaining({ actor: otherActor, sessionId: id, messageId: 'other-actor', position: 9 }),
    expect.objectContaining({ actor: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', sessionId: otherSession, messageId: 'other-session', position: 9 }),
  ]));
});

it('serializes a metadata correction against a concurrent newer valid read', async () => {
  const { store } = await fixture();
  const actor = 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';
  const old = { actor, sessionId: id, messageId: 'setup:tail', position: 2 };
  await store.advance(old);
  const staleCorrection = new ThreadReadStore(store.directory);
  const newerWrite = new ThreadReadStore(store.directory);
  await Promise.all([
    staleCorrection.advance({ actor, sessionId: id, messageId: 'answer:old', position: 1 }, { messageId: old.messageId, position: old.position }),
    newerWrite.advance({ actor, sessionId: id, messageId: 'answer:new', position: 3 }),
  ]);
  expect(await store.list()).toEqual([expect.objectContaining({ messageId: 'answer:new', position: 3 })]);
});

it('does not correct a higher durable marker unless that exact canonical record is excluded metadata', async () => {
  const { state, store, messages } = await fixture();
  messages.push({ id: 'ordinary:tail', sessionId: id, role: 'assistant', content: 'later answer', timestamp: null, toolName: null, displayKind: null });
  await store.advance({ actor: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', sessionId: id, messageId: 'unknown:future', position: 8 });
  expect(await state.read('a', id, { messageId: 'ordinary:tail', position: 2 })).toMatchObject({ unread: true });
  expect((await store.list())[0]?.messageId).toBe('unknown:future');
});
it('keeps metadata-only and empty histories read-neutral without writing a marker', async () => {
  const { state, source, store } = await fixture();
  source.getMessages.mockResolvedValueOnce({ sessionId: id, messages: [
    { id: 'system', sessionId: id, role: 'system', content: 'setup', timestamp: null, toolName: null, displayKind: null },
    { id: 'empty-assistant', sessionId: id, role: 'assistant', content: '', timestamp: null, toolName: null, displayKind: null },
    { id: 'tool', sessionId: id, role: 'tool', content: 'output', timestamp: null, toolName: 'shell', displayKind: null },
  ], pagination: { limit: 100, offset: 0, returned: 3, hasMore: false } });
  expect(await state.read('a', id)).toMatchObject({ latest: null, unread: false, historyComplete: true });
  expect(await store.list()).toEqual([]);
  source.getMessages.mockResolvedValueOnce({ sessionId: id, messages: [], pagination: { limit: 100, offset: 0, returned: 0, hasMore: false } });
  expect(await state.read('a', id)).toMatchObject({ latest: null, unread: false, historyComplete: true });
  expect(await store.list()).toEqual([]);
});
it('a stale device cannot clear new output or regress a newer read', async () => {
  const { state, service, messages, store } = await fixture();
  const old = { messageId: 'm:1', position: 1 };
  await state.read('a', id, old);
  messages.push({ ...messages[0]!, id: 'm:2' });
  await expect(state.read('a', id, old)).rejects.toMatchObject({ statusCode: 409 });
  expect(await service().read('a', id)).toMatchObject({ unread: true });
  const [first, second] = await Promise.all([state.read('a', id, { messageId: 'm:2', position: 2 }), state.read('a', id)]);
  expect(first.unread).toBe(false); expect(second.unread).toBe(false);
  const entry = (await store.list())[0]!;
  await new ThreadReadStore(store.directory).advance({ ...entry, ...old });
  expect((await store.list())[0]?.messageId).toBe('m:2');
});
it('new output arriving during a read commit stays unread on authoritative readback', async () => {
  const { state, messages, source, service } = await fixture();
  source.getRosterStatus.mockImplementationOnce(async () => { messages.push({ ...messages[0]!, id: 'm:2' }); return { status: 'unknown', runUpdatedAt: null }; });
  await state.read('a', id, { messageId: 'm:1', position: 1 });
  expect(await service().read('a', id)).toMatchObject({ unread: true, latest: { messageId: 'm:2' } });
});
it('partial bounded history and malformed identities never clear unread or write a marker', async () => {
  const { state, source, store } = await fixture(1001);
  expect(await state.read('a', id)).toMatchObject({ unread: null, historyComplete: false, latest: null });
  expect(source.getMessages).toHaveBeenCalledTimes(10);
  await expect(state.read('a', id, { messageId: 'm:999', position: 999 })).rejects.toMatchObject({ statusCode: 409 });
  expect(await store.list()).toEqual([]);
  source.getMessages.mockImplementationOnce(async () => ({ sessionId: 'wrong', messages: [], pagination: { offset: 0, limit: 100, returned: 0, hasMore: false } }));
  await expect(state.read('a', id)).rejects.toThrow();
});
it('denied access/external ownership blocks history/storage work', async () => {
  const { state, source, store } = await fixture();
  source.getSession.mockRejectedValueOnce(Object.assign(Error('denied'), { statusCode: 403 }));
  await expect(state.read('a', id)).rejects.toMatchObject({ statusCode: 403 });
  source.getSession.mockResolvedValueOnce({ session: { id, ownership: 'external' } });
  await expect(state.read('a', id)).rejects.toMatchObject({ statusCode: 404 });
  expect(source.getMessages).not.toHaveBeenCalled(); expect(await store.list()).toEqual([]);
});
it('storage bounds fail closed and preserve prior bytes', async () => {
  const { root, store } = await fixture();
  const entries = Array.from({ length: 4096 }, (_, i) => ({ actor: i.toString(16).padStart(64, '0'), sessionId: id, messageId: 'm:0', position: 0 }));
  const path = join(root, 'thread-reads.json');
  await writeFile(path, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
  const before = await readFile(path);
  await expect(store.advance({ ...entries[0]!, actor: 'f'.repeat(64) })).rejects.toMatchObject({ statusCode: 503 });
  expect(await readFile(path)).toEqual(before);
});
it('caps active source observations and preserves unknown on missing run telemetry', async () => {
  const { state, source } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  source.getSession.mockImplementationOnce(async () => { await gate; return { session: { id, ownership: 'command' } }; });
  const first = state.read('a', id), second = state.read('a', id);
  await expect(state.read('b', id)).rejects.toMatchObject({ statusCode: 503 });
  release(); await Promise.all([first, second]);
  source.getRosterStatus.mockRejectedValueOnce(Error('unreachable'));
  expect(await state.read('a', id)).toMatchObject({ runStatus: 'unknown', runObservedAt: null, unread: true });
});
it('rejects duplicate canonical identities and empty continuing pages', async () => {
  const { state, messages, source } = await fixture();
  messages[1]!.id = messages[0]!.id;
  await expect(state.read('a', id)).rejects.toThrow();
  source.getMessages.mockResolvedValueOnce({ sessionId: id, messages: [], pagination: { offset: 0, limit: 100, returned: 0, hasMore: true } });
  await expect(state.read('a', id)).rejects.toThrow();
});
