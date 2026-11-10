import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { KeyedSerialQueue } from './keyed-serial-queue';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ProjectRoomIdSchema, ProjectRoomsSchema, type ProjectRoom } from '@jarvis-command/contracts';

const transactions = new KeyedSerialQueue();
const MAX_BYTES = 1_048_576;
type RecoverySource = { basename: string; sha256: string };
function recoveryError(statusCode: 400 | 404 | 409, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
export class RoomStorageError extends Error {
  readonly statusCode = 503;
  constructor() { super('Project room storage unavailable'); }
}

// Single app writer, same private mount as the audit ledger; never open the ledger.
export class ProjectRoomStore {
  #queue: Promise<unknown> = Promise.resolve();
  #seen = false;
  #poisoned = false;
  constructor(readonly directory: string) {}
  list() { return this.#transaction(); }
  // Read-only admission guard: keep membership/archive state stable until the
  // existing bounded upstream admission finishes. Never rewrites room metadata.
  async readLocked<T>(operation: (rooms: ProjectRoom[]) => Promise<T>): Promise<T> {
    let result!: T;
    await this.#transaction(undefined, undefined, undefined, async rooms => { result = await operation(rooms); });
    return result;
  }
  async deletedIds() { let ids: string[] = []; await this.#transaction(undefined, undefined, value => { ids = value; }); return ids; }
  remove(id: string, validate: (room: ProjectRoom) => Promise<void>) {
    return this.#transaction(async rooms => {
      const room = rooms.find(item => item.id === id);
      if (room) await validate(room);
      return rooms.filter(item => item.id !== id);
    }, id);
  }
  update(change: (rooms: ProjectRoom[]) => ProjectRoom[]) { return this.#transaction(change); }
  // Internal fixture-only prerequisite. No HTTP/operator authorization or audit
  // contract is implied. Callers must name the retained preimage, never "latest".
  recover(id: string, source: RecoverySource) {
    return this.#transaction(undefined, undefined, undefined, undefined, { ...source, id });
  }
  #transaction(change?: (rooms: ProjectRoom[]) => ProjectRoom[] | Promise<ProjectRoom[]>, deleting?: string, observe?: (ids: string[]) => void, read?: (rooms: ProjectRoom[]) => Promise<void>, recovery?: RecoverySource & { id: string }): Promise<ProjectRoom[]> {
    const operation = this.#queue.then(() => transactions.run(this.directory, async () => {
      if (this.#poisoned) throw new RoomStorageError();
      let directory: FileHandle | undefined;
      let staging: string | undefined;
      let renamed = false;
      let readFailure = false;
      try {
        if (!isAbsolute(this.directory) || resolve(this.directory) !== this.directory) throw new RoomStorageError();
        // Reject symlinks throughout the configured path. Writable ancestors are
        // allowed only for sticky temporary fixture roots, never the private leaf.
        for (let path = this.directory; ; path = dirname(path)) {
          const stat = await lstat(path);
          if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== process.getuid!())
            || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) throw new RoomStorageError();
          if (path === '/') break;
        }
        directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const identity = await directory.stat();
        if (identity.uid !== process.getuid!() || (identity.mode & 0o777) !== 0o700) throw new RoomStorageError();
        const bound = async () => {
          const current = await lstat(this.directory);
          if (current.dev !== identity.dev || current.ino !== identity.ino || current.mode !== identity.mode || current.uid !== identity.uid) throw new RoomStorageError();
        };
        const root = `/proc/self/fd/${directory.fd}`;
        const path = join(root, 'project-rooms.json');
        let rooms: ProjectRoom[] = [];
        let deletedRoomIds: string[] = [];
        try {
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new RoomStorageError();
            const bytes = Buffer.alloc(MAX_BYTES + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== stat.size || bytesRead > MAX_BYTES) throw new RoomStorageError();
            const state = ProjectRoomsSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
            rooms = state.rooms; deletedRoomIds = state.deletedRoomIds ?? [];
            this.#seen = true;
          } finally { await handle.close(); }
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT' && !this.#seen)) throw error;
        }
        await bound();
        observe?.(deletedRoomIds);
        if (read) {
          try { await read(rooms); } catch (error) { readFailure = true; throw error; }
          await bound();
        }
        if (!change && !recovery) return rooms;
        let checkSnapshot: (() => Promise<void>) | undefined;
        let changed: ProjectRoom[];
        if (recovery) {
          const { id, basename, sha256 } = recovery;
          if (!ProjectRoomIdSchema.safeParse(id).success
            || !new RegExp(`^\\.project-rooms-snapshot-${id}-[a-f0-9]{32}\\.json$`).test(basename)
            || !/^[a-f0-9]{64}$/.test(sha256)) throw recoveryError(400, 'Exact room and retained snapshot identity required');
          const snapshotPath = join(root, basename);
          const snapshot = await open(snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          let selected: ProjectRoom | undefined;
          try {
            const stat = await snapshot.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!()
              || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new RoomStorageError();
            const bytes = Buffer.alloc(MAX_BYTES + 1);
            const { bytesRead } = await snapshot.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== stat.size || bytesRead > MAX_BYTES
              || createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex') !== sha256) throw new RoomStorageError();
            const state = ProjectRoomsSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
            selected = state.rooms.find(room => room.id === id);
            checkSnapshot = async () => {
              const current = await lstat(snapshotPath);
              if (current.dev !== stat.dev || current.ino !== stat.ino || current.mode !== stat.mode
                || current.uid !== stat.uid || current.nlink !== 1 || current.size !== stat.size
                || current.mtimeMs !== stat.mtimeMs || current.ctimeMs !== stat.ctimeMs) throw new RoomStorageError();
            };
            await checkSnapshot();
          } finally { await snapshot.close(); }
          if (!selected) throw recoveryError(404, 'Selected room missing from retained snapshot');
          if (rooms.some(room => room.id === id) || !deletedRoomIds.includes(id)) {
            throw recoveryError(409, 'Recovery requires an absent room with its current deletion tombstone');
          }
          changed = [...rooms, selected];
          deletedRoomIds = deletedRoomIds.filter(deleted => deleted !== id);
        } else changed = await change!(rooms);
        if (deleting && !rooms.some(room => room.id === deleting)) return rooms;
        if (deleting) {
          // Retained private preimage; never delete it as temporary trash. Failure
          // to durably snapshot prevents the metadata commit.
          const snapshot = await open(join(root, `.project-rooms-snapshot-${deleting}-${randomBytes(16).toString('hex')}.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try { await snapshot.writeFile(JSON.stringify({ version: 1, rooms, deletedRoomIds })); await snapshot.sync(); } finally { await snapshot.close(); }
          await directory.sync(); await bound();
          deletedRoomIds = [...deletedRoomIds, deleting];
        }
        const next = ProjectRoomsSchema.parse({ version: 1, rooms: changed, ...(deletedRoomIds.length ? { deletedRoomIds } : {}) });
        const bytes = JSON.stringify(next);
        if (Buffer.byteLength(bytes) > MAX_BYTES) throw new RoomStorageError();
        staging = join(root, `.project-rooms-${randomBytes(16).toString('hex')}.tmp`);
        const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await bound();
        await checkSnapshot?.();
        await rename(staging, path); renamed = true; staging = undefined;
        await directory.sync();
        await bound();
        this.#seen = true;
        return next.rooms;
      } catch (error) {
        if (readFailure) throw error;
        if (renamed) this.#poisoned = true; // Commit may have landed: require readback/restart, never silently retry.
        if (error instanceof Error && 'statusCode' in error && [400, 404, 409].includes(error.statusCode as number)) throw error;
        throw new RoomStorageError();
      } finally {
        if (staging) await unlink(staging).catch(() => undefined);
        await directory?.close();
      }
    }));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
