import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectRoomStore } from './project-room-store';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fs>() }));

const roots: string[] = [];
const room = { id: 'room_' + 'a'.repeat(32), name: 'Original', goal: 'Precommit state', repository: '', notes: [], sessionIds: [], lastSessionId: null };
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'jc-room-fault-')); roots.push(root);
  const store = new ProjectRoomStore(root); await store.update(() => [room]);
  const path = join(root, 'project-rooms.json'); const before = await fs.readFile(path);
  return { root, path, before, store };
}
it.each(['write', 'file-sync', 'rename', 'directory-sync'])('handles injected %s failure without misreporting commit state', async kind => {
  const { root, path, before, store } = await fixture();
  const originalOpen = fs.open;
  if (kind === 'rename') vi.spyOn(fs, 'rename').mockRejectedValueOnce(Error('injected rename failure'));
  else vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.tmp')) {
      if (kind === 'write') vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(Error('injected write failure'));
      if (kind === 'file-sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(Error('injected file sync failure'));
    }
    if (String(args[0]) === root && kind === 'directory-sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(Error('injected directory sync failure'));
    return handle;
  });
  await expect(store.update(() => [{ ...room, name: 'Next' }])).rejects.toMatchObject({ statusCode: 503 });
  vi.restoreAllMocks();
  if (kind === 'directory-sync') {
    // Rename succeeded, durability is uncertain: do NOT claim precommit preservation.
    expect(JSON.parse(await fs.readFile(path, 'utf8')).rooms[0].name).toBe('Next');
    await expect(store.list()).rejects.toMatchObject({ statusCode: 503 });
    await expect(store.update(() => [room])).rejects.toMatchObject({ statusCode: 503 });
    expect((await new ProjectRoomStore(root).list())[0]!.name).toBe('Next');
  } else {
    expect(await fs.readFile(path)).toEqual(before);
    expect(await store.list()).toEqual([room]);
    await store.update(() => [{ ...room, name: 'Retry' }]);
  }
  expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});
it.each(['file-mode', 'hardlink', 'schema', 'file-owner', 'directory-owner'])('refuses %s without altering registry bytes', async kind => {
  const { root, path, store } = await fixture();
  if (kind === 'file-mode') await fs.chmod(path, 0o644);
  if (kind === 'hardlink') await fs.link(path, join(root, 'second-link'));
  if (kind === 'schema') await fs.writeFile(path, JSON.stringify({ version: 1, rooms: [{ ...room, lastSessionId: 'not-a-session' }] }));
  const before = await fs.readFile(path);
  if (kind.endsWith('owner')) {
    // Unprivileged UID rejection probe: only the stat UID is injected; real bytes/handles remain real.
    const original = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      if ((kind === 'directory-owner' && String(args[0]) === root) || (kind === 'file-owner' && String(args[0]).endsWith('/project-rooms.json'))) {
        const stat = await handle.stat(); vi.spyOn(handle, 'stat').mockResolvedValue(Object.assign(stat, { uid: process.getuid!() + 10000 }));
      }
      return handle;
    });
  }
  await expect(store.list()).rejects.toMatchObject({ statusCode: 503 });
  await expect(store.update(() => [])).rejects.toMatchObject({ statusCode: 503 });
  expect(await fs.readFile(path)).toEqual(before);
});
