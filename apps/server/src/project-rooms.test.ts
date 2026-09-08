import { mkdtemp, chmod, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { createCommandProxyClient } from './command-client';
import { loadConfig } from './config';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
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
async function fixture(getSession = vi.fn()) {
  const root = await mkdtemp(join(tmpdir(), 'jc-rooms-')); roots.push(root);
  const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(root, 'events.jsonl') });
  const make = () => buildApp({ config, verifyAccess: async assertion => { if (assertion !== 'valid') throw Error(); return { subject: 'operator', provider: 'cloudflare-access' }; }, hermes: { readSnapshot: vi.fn() }, liveRoom: { getSession } as never });
  return { root, make };
}
it('links and resumes an exact verified session outside bootstrap recents; rejects invalid and substituted identity', async () => {
  const id = 'jc_' + 'a'.repeat(32);
  const session = { id, title: 'Real reference fixture', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
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
  session.id = 'jc_' + 'b'.repeat(32);
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
  for (const payload of [{ ...metadata, name: '' }, { ...metadata, sessionIds: [] }, { ...metadata, id: room.id }, { ...metadata, lastSessionId: null }, { ...metadata, notes: ['bad\nreference'] }, { ...metadata, goal: 'x'.repeat(2001) }]) {
    expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
  }
  expect((await app.inject({ method: 'POST', url, headers, payload: { ...metadata, goal: 'x'.repeat(20000) } })).statusCode).toBe(413);
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
  expect((await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: { ...metadata, goal: 'x'.repeat(20000) } })).statusCode).toBe(413);
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
