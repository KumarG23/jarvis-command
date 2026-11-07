import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createThreadState } from './thread-state';
import { ThreadReadStore } from './thread-read-store';
import type { createLiveRoomService } from './live-room-service';
const id = 'jc_' + 'a'.repeat(32);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(count = 2) {
  const root = await mkdtemp(join(tmpdir(), 'jc-p13-')); roots.push(root);
  const messages = Array.from({ length: count }, (_, i) => ({ id: `m:${i}`, sessionId: id, role: 'assistant' as const, content: 'test', timestamp: null, toolName: null, displayKind: null }));
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
it('partial bounded history and malformed identities never clear unread', async () => {
  const { state, source } = await fixture(1001);
  expect(await state.read('a', id)).toMatchObject({ unread: null, historyComplete: false, latest: null });
  expect(source.getMessages).toHaveBeenCalledTimes(10);
  await expect(state.read('a', id, { messageId: 'm:999', position: 999 })).rejects.toMatchObject({ statusCode: 409 });
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
