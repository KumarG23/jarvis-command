import { mkdtemp, chmod, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { createCommandProxyClient } from './command-client';
import { loadConfig } from './config';
import { KeyedSerialQueue } from './keyed-serial-queue';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const metadata = { name: 'Jarvis Command', goal: 'Persistent project room', repository: '/repo/jarvis-command', notes: ['vault/Jarvis Command.md'] };
const headers = { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example', 'x-jarvis-command': '1', 'content-type': 'application/json' };
it('updates only metadata atomically alongside attachment and persists exact identity on restart', async () => {
  const id = 'jc_' + 'a'.repeat(32);
  const session = { id, title: 'Synthetic conversation', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
  const { make } = await fixture(vi.fn(async () => ({ session }))); const app = make();
  const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })).json().room;
  const updated = { name: 'Renamed room', goal: 'Revised goal', repository: '/never/executed', notes: ['vault/New.md'] };
  const results = await Promise.all([
    app.inject({ method: 'POST', url: `/api/rooms/${room.id}`, headers, payload: updated }),
    app.inject({ method: 'POST', url: `/api/rooms/${room.id}/sessions`, headers, payload: { sessionId: id } }),
  ]);
  expect(results.map(result => result.statusCode)).toEqual([200, 200]);
  const expected = { ...room, ...updated, sessionIds: [id], lastSessionId: id };
  expect((await app.inject({ url: '/api/rooms', headers })).json().rooms).toEqual([expected]);
  await app.close(); const restarted = make();
  expect((await restarted.inject({ url: '/api/rooms', headers })).json().rooms).toEqual([expected]);
  const cleared = await restarted.inject({ method: 'POST', url: `/api/rooms/${room.id}`, headers, payload: { ...updated, repository: '', notes: [] } });
  expect(cleared.json().room).toEqual({ ...expected, repository: '', notes: [] });
  await restarted.close();
});
async function fixture(getSession = vi.fn(), extraLiveRoom: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jc-rooms-')); roots.push(root);
  const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(root, 'events.jsonl') });
  const make = () => buildApp({ config, verifyAccess: async assertion => { if (assertion !== 'valid') throw Error(); return { subject: 'operator', provider: 'cloudflare-access' }; }, hermes: { readSnapshot: vi.fn() }, liveRoom: { getSession, ...extraLiveRoom } as never });
  return { root, make };
}
it('deletes a Command chat and removes it from every project', async () => {
  const id = 'jc_' + 'a'.repeat(32);
  const session = { id, title: 'Disposable chat', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
  const deleteSession = vi.fn(async () => ({ deleted: true, sessionId: id }));
  const { make } = await fixture(vi.fn(async () => ({ session })), { deleteSession });
  const app = make();
  const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })).json().room;
  await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/sessions`, headers, payload: { sessionId: id } });
  const deleteHeaders = { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example', 'x-jarvis-command': '1' };
  for (const changed of [{ origin: 'https://evil.example' }, { 'cf-access-jwt-assertion': '' }, { 'x-jarvis-command': '' }]) {
    expect((await app.inject({ method: 'DELETE', url: `/api/live/sessions/${id}`, headers: { ...deleteHeaders, ...changed } })).statusCode).toBe(changed['cf-access-jwt-assertion'] === '' ? 401 : 403);
  }
  expect((await app.inject({ method: 'DELETE', url: '/api/live/sessions/discord:external', headers: deleteHeaders })).statusCode).toBe(400);
  expect(deleteSession).not.toHaveBeenCalled();
  const response = await app.inject({ method: 'DELETE', url: `/api/live/sessions/${id}`, headers: deleteHeaders });
  expect({ status: response.statusCode, body: response.json() }).toEqual({ status: 200, body: { deleted: true, sessionId: id } });
  expect(deleteSession).toHaveBeenCalledWith('operator', id);
  expect((await app.inject({ url: '/api/rooms', headers })).json().rooms[0]).toMatchObject({ sessionIds: [], lastSessionId: null });
  await app.close();
});
it('routes project attachment and deletion through the same per-session queue', async () => {
  const id = 'jc_' + 'b'.repeat(32);
  const session = { id, title: 'Racing chat', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
  const queueRun = vi.spyOn(KeyedSerialQueue.prototype, 'run');
  const deleteSession = vi.fn(async () => ({ deleted: true, sessionId: id }));
  const { make } = await fixture(vi.fn(async () => ({ session })), { deleteSession });
  const app = make();
  const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })).json().room;

  expect((await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/sessions`, headers, payload: { sessionId: id } })).statusCode).toBe(200);
  expect((await app.inject({
    method: 'DELETE',
    url: `/api/live/sessions/${id}`,
    headers: { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example', 'x-jarvis-command': '1' },
  })).statusCode).toBe(200);

  expect(queueRun.mock.calls.map(([key]) => key)).toEqual([id, id]);
  expect(queueRun.mock.instances[0]).toBe(queueRun.mock.instances[1]);
  expect((await app.inject({ url: '/api/rooms', headers })).json().rooms[0]).toMatchObject({ sessionIds: [], lastSessionId: null });
  await app.close();
});
it('links and resumes an exact verified session outside bootstrap recents; rejects invalid and substituted identity', async () => {
  const id = 'discord:channel+message';
  const session = { id, title: 'Real reference fixture', source: 'discord', ownership: 'external', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ session }));
  const client = createCommandProxyClient({ baseUrl: 'http://127.0.0.1:18643', commandProxyKey: 'c'.repeat(32), fetcher });
  const getSession = vi.fn(async (_subject, value: string) => client.getSession(value));
  const { make } = await fixture(getSession); const app = make();
  const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })).json().room;
  const url = `/api/rooms/${room.id}/sessions`;
  expect((await app.inject({ method: 'POST', url, headers, payload: { sessionId: ' ' + id } })).statusCode).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await app.inject({ method: 'POST', url, headers, payload: { sessionId: id } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url, headers, payload: { sessionId: id } })).json().room.sessionIds).toEqual([id]);
  await app.close(); const restarted = make();
  expect((await restarted.inject({ url: '/api/rooms', headers })).json().rooms[0].lastSessionId).toBe(id);
  expect((await restarted.inject({ url: `/api/live/sessions/${id}`, headers })).json()).toEqual({ session });
  session.id = 'discord:substituted';
  expect((await restarted.inject({ method: 'POST', url, headers, payload: { sessionId: id } })).statusCode).toBe(503);
  expect((await restarted.inject({ url: '/api/rooms', headers })).json().rooms[0].lastSessionId).toBe(id);
  await restarted.close();
});
it('creates, reads and reloads exact durable metadata in a fresh app instance', async () => {
  const { root, make } = await fixture(); const app = make();
  const response = await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata });
  expect(response.statusCode).toBe(200); const room = response.json().room;
  expect(room).toMatchObject({ ...metadata, sessionIds: [], lastSessionId: null });
  await app.close();
  const restarted = make();
  expect((await restarted.inject({ url: '/api/rooms', headers })).json().rooms).toEqual([room]);
  expect(JSON.parse(await readFile(join(root, 'project-rooms.json'), 'utf8')).version).toBe(1);
  await restarted.close();
});
it('denies invalid metadata updates without registry or upstream mutation', async () => {
  const upstream = vi.fn(); const { root, make } = await fixture(upstream); const app = make();
  const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })).json().room;
  const path = join(root, 'project-rooms.json'); const before = await readFile(path);
  const url = `/api/rooms/${room.id}`;
  for (const [changed, status] of [[{ origin: 'https://evil.example' }, 403], [{ 'cf-access-jwt-assertion': '' }, 401], [{ 'cf-access-jwt-assertion': 'denied' }, 401], [{ 'x-jarvis-command': '' }, 403], [{ 'content-type': 'text/plain' }, 415]] as const) {
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, ...changed }, payload: JSON.stringify(metadata) })).statusCode).toBe(status);
  }
  for (const payload of [{ ...metadata, name: '' }, { ...metadata, sessionIds: [] }, { ...metadata, id: room.id }, { ...metadata, lastSessionId: null }, { ...metadata, leadSessionId: null }, { ...metadata, threads: [] }, { ...metadata, notes: ['bad\nreference'] }, { ...metadata, goal: 'x'.repeat(2001) }]) {
    expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
  }
  expect((await app.inject({ method: 'POST', url, headers, payload: { ...metadata, goal: 'x'.repeat(70000) } })).statusCode).toBe(413);
  expect((await app.inject({ method: 'POST', url: '/api/rooms/room_' + 'f'.repeat(32), headers, payload: metadata })).statusCode).toBe(404);
  expect((await app.inject({ method: 'POST', url: '/api/rooms/invalid', headers, payload: metadata })).statusCode).toBe(400);
  expect(await readFile(path)).toEqual(before); expect(upstream).not.toHaveBeenCalled(); await app.close();
});
it('rejects association gates with zero upstream calls or registry writes', async () => {
  const upstream = vi.fn();
  const { root, make } = await fixture(upstream); const app = make();
  const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })).json().room;
  const path = join(root, 'project-rooms.json'); const before = await readFile(path);
  for (const [changed, status] of [[{ origin: 'https://evil.example' }, 403], [{ 'cf-access-jwt-assertion': '' }, 401], [{ 'x-jarvis-command': '' }, 403]] as const) {
    expect((await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/sessions`, headers: { ...headers, ...changed }, payload: { sessionId: 'jc_' + 'a'.repeat(32) } })).statusCode).toBe(status);
  }
  expect(upstream).not.toHaveBeenCalled(); expect(await readFile(path)).toEqual(before);
  await app.close();
});
it('serializes duplicate metadata submissions without losing either room', async () => {
  const { make } = await fixture(); const app = make();
  const results = await Promise.all(Array.from({ length: 2 }, () => app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })));
  expect(results.map(result => result.statusCode)).toEqual([200, 200]);
  const ids = results.map(result => result.json().room.id);
  expect(new Set(ids).size).toBe(2);
  expect((await app.inject({ url: '/api/rooms', headers })).json().rooms.map((room: { id: string }) => room.id).sort()).toEqual(ids.sort());
  await app.close();
});
it('rejects invalid and oversized requests and denied writes without altering persisted state', async () => {
  const { root, make } = await fixture(); const app = make();
  await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata });
  const path = join(root, 'project-rooms.json'); const before = await readFile(path);
  for (const payload of [{ ...metadata, name: '' }, { ...metadata, callback: 'https://example.test' }, { ...metadata, goal: 'x'.repeat(2001) }]) {
    expect((await app.inject({ method: 'POST', url: '/api/rooms', headers, payload })).statusCode).toBe(400);
  }
  expect((await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: { ...metadata, goal: 'x'.repeat(70000) } })).statusCode).toBe(413);
  for (const [changed, status] of [[{ origin: 'https://evil.example' }, 403], [{ 'cf-access-jwt-assertion': '' }, 401], [{ 'x-jarvis-command': '' }, 403]] as const) {
    expect((await app.inject({ method: 'POST', url: '/api/rooms', headers: { ...headers, ...changed }, payload: metadata })).statusCode).toBe(status);
  }
  expect(await readFile(path)).toEqual(before); await app.close();
});
it.each(['corrupt', 'oversize', 'mode', 'symlink', 'missing-root'])('fails closed for %s storage and preserves existing bytes', async kind => {
  const { root, make } = await fixture(); const path = join(root, 'project-rooms.json');
  if (kind === 'missing-root') await rm(root, { recursive: true });
  else if (kind === 'symlink') { await writeFile(join(root, 'target'), 'keep'); await symlink(join(root, 'target'), path); }
  else { await writeFile(path, kind === 'oversize' ? 'x'.repeat(1048577) : 'corrupt', { mode: 0o600 }); if (kind === 'mode') await chmod(root, 0o755); }
  const app = make();
  expect((await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })).statusCode).toBe(503);
  expect((await app.inject({ url: '/api/rooms', headers })).statusCode).toBe(503);
  if (kind === 'symlink') expect(await readFile(join(root, 'target'), 'utf8')).toBe('keep');
  else if (kind !== 'missing-root') expect((await readFile(path)).length).toBe(kind === 'oversize' ? 1048577 : 7);
  await app.close();
});
it('reads legacy metadata then persists bounded instructions and reversible archive with membership across restart', async () => {
  const id = 'jc_' + 'd'.repeat(32);
  const session = { id, title: 'SYNTHETIC project chat', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-10-28T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
  const { make } = await fixture(vi.fn(async () => ({ session })));
  const app = make();
  const legacy = (await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: metadata })).json().room;
  expect(legacy.instructions).toBeUndefined(); expect(legacy.archived).toBeUndefined();
  await app.inject({ method: 'POST', url: `/api/rooms/${legacy.id}/sessions`, headers, payload: { sessionId: id } });
  const next = { ...metadata, instructions: '界'.repeat(4000), archived: true };
  expect((await app.inject({ method: 'POST', url: `/api/rooms/${legacy.id}`, headers, payload: next })).statusCode).toBe(200);
  await app.close(); const restarted = make();
  const saved = (await restarted.inject({ url: '/api/rooms', headers })).json().rooms[0];
  expect(saved).toEqual({ ...legacy, ...next, sessionIds: [id], lastSessionId: id });
  for (const invalid of [{ ...next, instructions: 'x'.repeat(4001) }, { ...next, archived: 'yes' }]) {
    expect((await restarted.inject({ method: 'POST', url: `/api/rooms/${legacy.id}`, headers, payload: invalid })).statusCode).toBe(400);
  }
  const restored = (await restarted.inject({ method: 'POST', url: `/api/rooms/${legacy.id}`, headers, payload: { ...next, archived: false } })).json().room;
  expect(restored).toEqual({ ...saved, archived: false });
  await restarted.close(); const again = make();
  expect((await again.inject({ url: '/api/rooms', headers })).json().rooms).toEqual([restored]);
  await again.close();
});

it.each([false, true])('loads, edits and restarts version-one fixture metadata (threads: %s)', async withThreads => {
  const a = 'jc_' + 'a'.repeat(32), b = 'jc_' + 'b'.repeat(32);
  const thread = (sessionId: string, archived: boolean) => ({ sessionId, title: 'SYNTHETIC thread', archived, createdAt: '2026-10-31T18:00:00.000Z' });
  const legacy = { ...metadata, id: 'room_' + 'c'.repeat(32), instructions: 'Keep instructions', archived: false, sessionIds: [a, b], lastSessionId: b };
  const room = { ...legacy, ...(withThreads ? { leadSessionId: a, threads: [thread(a, false), thread(b, true)] } : {}) };
  const { root, make } = await fixture();
  await writeFile(join(root, 'project-rooms.json'), JSON.stringify({ version: 1, rooms: [room] }), { mode: 0o600 });
  const app = make();
  expect((await app.inject({ url: '/api/rooms', headers })).json()).toEqual({ version: 1, rooms: [room] });
  const updated = { ...metadata, name: 'Edited fixture', instructions: 'Edited instructions', archived: true };
  const response = await app.inject({ method: 'POST', url: `/api/rooms/${room.id}`, headers, payload: updated });
  expect(response.statusCode).toBe(200);
  const expected = { ...room, ...updated };
  expect(response.json().room).toEqual(expected);
  await app.close();
  const restarted = make();
  expect((await restarted.inject({ url: '/api/rooms', headers })).json()).toEqual({ version: 1, rooms: [expected] });
  expect(JSON.parse(await readFile(join(root, 'project-rooms.json'), 'utf8'))).toEqual({ version: 1, rooms: [expected] });
  await restarted.close();
});
it.each(['lead', 'thread', 'failure'])('cleans only removed-session fixture metadata across projects and restart (%s)', async kind => {
  const a = 'jc_' + 'a'.repeat(32), b = 'jc_' + 'b'.repeat(32);
  const removed = kind === 'thread' ? b : a;
  const threads = [a, b].map(sessionId => ({ sessionId, title: 'SYNTHETIC thread', archived: false, createdAt: '2026-10-31T18:00:00.000Z' }));
  const base = { ...metadata, sessionIds: [a, b], lastSessionId: removed, leadSessionId: a, threads };
  const rooms = ['c', 'd'].map(hex => ({ ...base, id: 'room_' + hex.repeat(32) }));
  const unrelated = { ...metadata, id: 'room_' + 'e'.repeat(32), sessionIds: [], lastSessionId: null };
  const deleteSession = vi.fn(async () => {
    if (kind === 'failure') throw Object.assign(Error('Synthetic refusal'), { statusCode: 409 });
    return { deleted: true, sessionId: removed };
  });
  const { root, make } = await fixture(vi.fn(), { deleteSession });
  const path = join(root, 'project-rooms.json');
  await writeFile(path, JSON.stringify({ version: 1, rooms: [...rooms, unrelated] }), { mode: 0o600 });
  const before = await readFile(path);
  const app = make();
  const response = await app.inject({ method: 'DELETE', url: `/api/live/sessions/${removed}`, headers: { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example', 'x-jarvis-command': '1' } });
  expect(response.statusCode).toBe(kind === 'failure' ? 409 : 200);
  expect(deleteSession).toHaveBeenCalledExactlyOnceWith('operator', removed);
  const expected = kind === 'failure' ? rooms : rooms.map(room => ({ ...room,
    sessionIds: room.sessionIds.filter(id => id !== removed),
    lastSessionId: removed === a ? b : a,
    leadSessionId: removed === a ? null : a,
    threads: room.threads.filter(thread => thread.sessionId !== removed),
  }));
  expect((await app.inject({ url: '/api/rooms', headers })).json().rooms).toEqual([...expected, unrelated]);
  if (kind === 'failure') expect(await readFile(path)).toEqual(before);
  await app.close();
  const restarted = make();
  expect((await restarted.inject({ url: '/api/rooms', headers })).json().rooms).toEqual([...expected, unrelated]);
  await restarted.close();
});
