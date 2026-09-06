import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ProjectRoomsSchema, type ProjectRoom } from '@jarvis-command/contracts';

const MAX_BYTES = 1_048_576;
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
  update(change: (rooms: ProjectRoom[]) => ProjectRoom[]) { return this.#transaction(change); }
  #transaction(change?: (rooms: ProjectRoom[]) => ProjectRoom[]): Promise<ProjectRoom[]> {
    const operation = this.#queue.then(async () => {
      if (this.#poisoned) throw new RoomStorageError();
      let directory: FileHandle | undefined;
      let staging: string | undefined;
      let renamed = false;
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
        try {
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new RoomStorageError();
            const bytes = Buffer.alloc(MAX_BYTES + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== stat.size || bytesRead > MAX_BYTES) throw new RoomStorageError();
            rooms = ProjectRoomsSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))).rooms;
            this.#seen = true;
          } finally { await handle.close(); }
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT' && !this.#seen)) throw error;
        }
        await bound();
        if (!change) return rooms;
        const next = ProjectRoomsSchema.parse({ version: 1, rooms: change(rooms) });
        const bytes = JSON.stringify(next);
        if (Buffer.byteLength(bytes) > MAX_BYTES) throw new RoomStorageError();
        staging = join(root, `.project-rooms-${randomBytes(16).toString('hex')}.tmp`);
        const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await bound();
        await rename(staging, path); renamed = true; staging = undefined;
        await directory.sync();
        await bound();
        this.#seen = true;
        return next.rooms;
      } catch (error) {
        if (renamed) this.#poisoned = true; // Commit may have landed: require readback/restart, never silently retry.
        if (error instanceof Error && 'statusCode' in error && error.statusCode === 404) throw error;
        throw new RoomStorageError();
      } finally {
        if (staging) await unlink(staging).catch(() => undefined);
        await directory?.close();
      }
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
