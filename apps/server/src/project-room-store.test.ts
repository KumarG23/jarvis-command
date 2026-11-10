import { createHash } from 'node:crypto';
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

it('retains committed thread metadata after uncertain sync and allows exact restart readback', async () => {
  const { root, store } = await fixture();
  const id = 'jc_' + 'a'.repeat(32);
  const next = { ...room, instructions: 'Preserved', sessionIds: [id], lastSessionId: id, leadSessionId: id,
    threads: [{ sessionId: id, title: 'Explicit lead', archived: false, createdAt: '2026-10-31T18:00:00Z' }] };
  const originalOpen = fs.open;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]) === root) vi.spyOn(handle, 'sync').mockRejectedValueOnce(Error('injected postcommit sync failure'));
    return handle;
  });
  await expect(store.update(() => [next])).rejects.toMatchObject({ statusCode: 503 });
  vi.restoreAllMocks();
  await expect(store.update(() => [room])).rejects.toMatchObject({ statusCode: 503 });
  expect(await new ProjectRoomStore(root).list()).toEqual([next]);
});

it('does not commit deletion when retained snapshot creation fails', async () => {
  const { store, path, before } = await fixture();
  const original = fs.open;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    if (String(args[0]).includes('.project-rooms-snapshot-')) throw Error('fixture snapshot failure');
    return original(...args);
  });
  await expect(store.remove(room.id, async () => {})).rejects.toMatchObject({ statusCode: 503 });
  expect(await fs.readFile(path)).toEqual(before);
  expect(await store.list()).toEqual([room]);
});
it('serializes deletion against a second instance and preserves legacy records plus tombstones after restart', async () => {
  const { root, store } = await fixture();
  const second = new ProjectRoomStore(root);
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const removal = store.remove(room.id, async () => { enter(); await pending; });
  await started;
  const update = second.update(rooms => [...rooms, { ...room, id: `room_${'b'.repeat(32)}` }]);
  release(); await removal; await update;
  expect(await new ProjectRoomStore(root).deletedIds()).toEqual([room.id]);
  expect((await new ProjectRoomStore(root).list()).map(item => item.id)).toEqual([`room_${'b'.repeat(32)}`]);
});

it('reader bridge preserves identity-bearing and legacy registry records plus tombstones across an ordinary edit/restart', async () => {
  const { root, path, store } = await fixture();
  const identityRoom = { ...room, id: `room_${'b'.repeat(32)}`, projectIcon: 'orbit', projectColor: 'violet' };
  const deletedRoomIds = [`room_${'c'.repeat(32)}`];
  await fs.writeFile(path, JSON.stringify({ version: 1, rooms: [room, identityRoom], deletedRoomIds }));
  expect(await store.list()).toEqual([room, identityRoom]);
  await store.update(rooms => rooms.map(item => item.id === room.id ? { ...item, name: 'Legacy edit' } : item));
  const expected = { version: 1, rooms: [{ ...room, name: 'Legacy edit' }, identityRoom], deletedRoomIds };
  expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual(expected);
  const restarted = new ProjectRoomStore(root);
  expect(await restarted.list()).toEqual(expected.rooms);
  expect(await restarted.deletedIds()).toEqual(deletedRoomIds);
});
it.each([{ projectIcon: 'x'.repeat(33) }, { projectColor: 'x'.repeat(33) }, { projectIcon: null }])('reader bridge refuses invalid identity metadata without altering registry bytes: %j', async fields => {
  const { path, store } = await fixture();
  await fs.writeFile(path, JSON.stringify({ version: 1, rooms: [{ ...room, ...fields }] }));
  const before = await fs.readFile(path);
  await expect(store.list()).rejects.toMatchObject({ statusCode: 503 });
  await expect(store.update(rooms => rooms)).rejects.toMatchObject({ statusCode: 503 });
  expect(await fs.readFile(path)).toEqual(before);
});

async function recoveryFixture() {
  const f = await fixture();
  await f.store.remove(room.id, async () => {});
  const basename = (await fs.readdir(f.root)).find(name => name.startsWith('.project-rooms-snapshot-'))!;
  const bytes = await fs.readFile(join(f.root, basename));
  return { ...f, source: { basename, sha256: createHash('sha256').update(bytes).digest('hex') }, snapshotBytes: bytes };
}
it('recovers only selected metadata after unrelated edits, creation and deletion, surviving restart', async () => {
  const { root, path, store } = await fixture();
  const sessionId = `jc_${'a'.repeat(32)}`;
  const a = { ...room, instructions: 'Exact standing instructions', projectIcon: 'orbit', projectColor: 'violet',
    sessionIds: [sessionId, 'discord:fixture'], lastSessionId: sessionId, leadSessionId: sessionId,
    threads: [{ sessionId, title: 'Retained lead', archived: false, createdAt: '2026-11-10T13:00:00Z' }] };
  const b = { ...room, id: `room_${'b'.repeat(32)}` };
  const c = { ...room, id: `room_${'c'.repeat(32)}` };
  await store.update(() => [a, b, c]);
  await store.remove(a.id, async () => {});
  const basename = (await fs.readdir(root)).find(name => name.startsWith(`.project-rooms-snapshot-${a.id}-`))!;
  const bytes = await fs.readFile(join(root, basename));
  const source = { basename, sha256: createHash('sha256').update(bytes).digest('hex') };
  const editedB = { ...b, name: 'Later edit', instructions: 'Keep later state' };
  const d = { ...room, id: `room_${'d'.repeat(32)}`, name: 'New after snapshot' };
  await store.update(() => [editedB, c, d]);
  await store.remove(c.id, async () => {});
  const unrelatedBefore = JSON.parse(await fs.readFile(path, 'utf8'));
  await store.recover(a.id, source);
  const restarted = new ProjectRoomStore(root);
  expect(await restarted.list()).toEqual([editedB, d, a]);
  expect(await restarted.deletedIds()).toEqual([c.id]);
  const after = JSON.parse(await fs.readFile(path, 'utf8'));
  expect(JSON.stringify(after.rooms.filter((item: { id: string }) => item.id !== a.id))).toBe(JSON.stringify(unrelatedBefore.rooms));
  expect(await fs.readFile(join(root, basename))).toEqual(bytes);
  const committed = await fs.readFile(path);
  await expect(restarted.recover(a.id, source)).rejects.toMatchObject({ statusCode: 409 });
  expect(await fs.readFile(path)).toEqual(committed);
  await restarted.update(rooms => rooms.map(item => item.id === a.id ? { ...item, name: 'New A' } : item));
  const edited = await fs.readFile(path);
  await expect(store.recover(a.id, source)).rejects.toMatchObject({ statusCode: 409 });
  expect(await fs.readFile(path)).toEqual(edited);
});

it.each(['invalid-id', 'traversal', 'absolute', 'binding', 'hash', 'missing', 'missing-target', 'no-tombstone', 'malformed', 'schema', 'oversized', 'symlink', 'hardlink', 'mode', 'owner', 'replaced'])('refuses unsafe recovery source %s without writes', async kind => {
  const { root, path, store, source, snapshotBytes } = await recoveryFixture();
  const snapshotPath = join(root, source.basename);
  if (kind === 'traversal') source.basename = `../${source.basename}`;
  if (kind === 'absolute') source.basename = snapshotPath;
  if (kind === 'binding') source.basename = source.basename.replace(room.id, `room_${'b'.repeat(32)}`);
  if (kind === 'hash') source.sha256 = '0'.repeat(64);
  if (kind === 'missing') await fs.unlink(snapshotPath);
  if (kind === 'no-tombstone') await fs.writeFile(path, JSON.stringify({ version: 1, rooms: [] }));
  if (['malformed', 'schema', 'missing-target', 'oversized'].includes(kind)) {
    const bytes = kind === 'malformed' ? '{' : kind === 'schema' ? JSON.stringify({ version: 1, rooms: [{ ...room, unknown: true }] })
      : kind === 'oversized' ? ' '.repeat(1_048_577) : JSON.stringify({ version: 1, rooms: [] });
    await fs.writeFile(snapshotPath, bytes);
    source.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  if (kind === 'symlink') { await fs.rename(snapshotPath, join(root, 'saved')); await fs.symlink(join(root, 'saved'), snapshotPath); }
  if (kind === 'hardlink') await fs.link(snapshotPath, join(root, 'second-link'));
  if (kind === 'mode') await fs.chmod(snapshotPath, 0o640);
  if (kind === 'owner') {
    const original = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (String(args[0]).endsWith(source.basename)) {
        const stat = await handle.stat(); vi.spyOn(handle, 'stat').mockResolvedValue(Object.assign(stat, { uid: process.getuid!() + 10000 }));
      }
      return handle;
    });
  }
  if (kind === 'replaced') {
    const original = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('.tmp')) {
        await fs.rename(snapshotPath, join(root, 'saved'));
        await fs.writeFile(snapshotPath, snapshotBytes, { mode: 0o600 });
      }
      return original(...args);
    });
  }
  const before = await fs.readFile(path);
  const sourceBefore = await fs.readFile(snapshotPath).catch(() => null);
  await expect(store.recover(kind === 'invalid-id' ? '../room' : room.id, source)).rejects.toMatchObject({
    statusCode: ['invalid-id', 'traversal', 'absolute', 'binding'].includes(kind) ? 400 : kind === 'missing-target' ? 404 : kind === 'no-tombstone' ? 409 : 503,
  });
  expect(await fs.readFile(path)).toEqual(before);
  expect(await store.list()).toEqual([]);
  if (sourceBefore) expect(await fs.readFile(snapshotPath)).toEqual(sourceBefore);
  expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it.each(['write', 'file-sync', 'rename', 'directory-sync'])('recovery preserves uncertain-state/readback semantics on %s failure', async kind => {
  const { root, path, store, source, snapshotBytes } = await recoveryFixture();
  const before = await fs.readFile(path);
  const original = fs.open;
  if (kind === 'rename') vi.spyOn(fs, 'rename').mockRejectedValueOnce(Error('injected rename failure'));
  else vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith('.tmp')) {
      if (kind === 'write') vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(Error('injected recovery write failure'));
      if (kind === 'file-sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(Error('injected recovery file sync failure'));
    }
    if (String(args[0]) === root && kind === 'directory-sync') vi.spyOn(handle, 'sync').mockRejectedValueOnce(Error('injected recovery directory sync failure'));
    return handle;
  });
  await expect(store.recover(room.id, source)).rejects.toMatchObject({ statusCode: 503 });
  vi.restoreAllMocks();
  expect(await fs.readFile(join(root, source.basename))).toEqual(snapshotBytes);
  if (kind === 'directory-sync') {
    await expect(store.list()).rejects.toMatchObject({ statusCode: 503 });
    await expect(store.recover(room.id, source)).rejects.toMatchObject({ statusCode: 503 });
    const restarted = new ProjectRoomStore(root);
    expect(await restarted.list()).toEqual([room]);
    expect(await restarted.deletedIds()).toEqual([]);
    const committed = await fs.readFile(path);
    await expect(restarted.recover(room.id, source)).rejects.toMatchObject({ statusCode: 409 });
    expect(await fs.readFile(path)).toEqual(committed);
  } else {
    expect(await fs.readFile(path)).toEqual(before);
    expect(await store.deletedIds()).toEqual([room.id]);
    await store.recover(room.id, source);
    expect(await store.list()).toEqual([room]);
  }
  expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it('serializes explicit recovery behind active read admission across store instances', async () => {
  const { root, store, source } = await recoveryFixture();
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const admission = store.readLocked(async rooms => { expect(rooms).toEqual([]); enter(); await pending; });
  await started;
  let recovered = false;
  const recovering = new ProjectRoomStore(root).recover(room.id, source).then(() => { recovered = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(recovered).toBe(false);
  release(); await admission; await recovering;
  expect(await store.list()).toEqual([room]);
});
