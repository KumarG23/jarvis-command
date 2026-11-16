import { mkdtemp, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { storageReason } from './storage-reason';
import { ProjectRoomStore } from './project-room-store';

it('keeps only fixed inner reason codes', () => {
  expect(storageReason(Object.assign(new Error('x'), { reason: 'unsafe_ancestor_directory' }))).toBe('unsafe_ancestor_directory');
  expect(storageReason(Object.assign(new Error('x'), { reason: 'unspecified', code: 'EACCES' }))).toBe('fs_eacces');
  expect(storageReason(Object.assign(new Error('/home/secret path'), { reason: 'Has /path' }))).toBe('unspecified');
  expect(storageReason('nope')).toBe('unspecified');
});

it('surfaces why a room store refuses an unsafe directory instead of unspecified', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'command-reason-SYNTHETIC-'));
  await chmod(directory, 0o770);
  const rooms = new ProjectRoomStore(directory);
  const error = await rooms.update(() => []).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ name: 'RoomStorageError' });
  expect((error as { reason: string }).reason).not.toBe('unspecified');
});
