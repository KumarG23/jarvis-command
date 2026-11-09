import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { KeyedSerialQueue } from './keyed-serial-queue';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { CommandSessionIdSchema, OpaqueIdentifierSchema } from '@jarvis-command/contracts';
const EntrySchema = z.object({ actor: z.string().regex(/^[a-f0-9]{64}$/), sessionId: CommandSessionIdSchema, messageId: OpaqueIdentifierSchema, position: z.number().int().min(0).max(999) }).strict();
const ReadStateSchema = z.object({ version: z.literal(1), entries: z.array(EntrySchema).max(4096) }).strict().refine(state => new Set(state.entries.map(entry => `${entry.actor}:${entry.sessionId}`)).size === state.entries.length);
type Entry = z.infer<typeof EntrySchema>;

const transactions = new KeyedSerialQueue();
const MAX_BYTES = 1_048_576;
export class ThreadReadStorageError extends Error {
  readonly statusCode = 503;
  constructor() { super('Thread read storage unavailable'); }
}

// Single app writer, same private mount as the audit ledger; never open the ledger.
export class ThreadReadStore {
  #queue: Promise<unknown> = Promise.resolve();
  #seen = false;
  #poisoned = false;
  constructor(readonly directory: string) {}
  list() { return this.#transaction(); }
  advance(entry: Entry) {
    entry = EntrySchema.parse(entry);
    return this.#transaction(entries => {
      const old = entries.find(item => item.actor === entry.actor && item.sessionId === entry.sessionId);
      if (old && old.position >= entry.position) return entries;
      return [...entries.filter(item => item !== old), entry];
    });
  }
  #transaction(change?: (entries: Entry[]) => Entry[]): Promise<Entry[]> {
    const operation = this.#queue.then(() => transactions.run(this.directory, async () => {
      if (this.#poisoned) throw new ThreadReadStorageError();
      let directory: FileHandle | undefined;
      let staging: string | undefined;
      let renamed = false;
      try {
        if (!isAbsolute(this.directory) || resolve(this.directory) !== this.directory) throw new ThreadReadStorageError();
        // Reject symlinks throughout the configured path. Writable ancestors are
        // allowed only for sticky temporary fixture roots, never the private leaf.
        for (let path = this.directory; ; path = dirname(path)) {
          const stat = await lstat(path);
          if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== process.getuid!())
            || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) throw new ThreadReadStorageError();
          if (path === '/') break;
        }
        directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const identity = await directory.stat();
        if (identity.uid !== process.getuid!() || (identity.mode & 0o777) !== 0o700) throw new ThreadReadStorageError();
        const bound = async () => {
          const current = await lstat(this.directory);
          if (current.dev !== identity.dev || current.ino !== identity.ino || current.mode !== identity.mode || current.uid !== identity.uid) throw new ThreadReadStorageError();
        };
        const root = `/proc/self/fd/${directory.fd}`;
        const path = join(root, 'thread-reads.json');
        let entries: Entry[] = [];
        try {
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new ThreadReadStorageError();
            const bytes = Buffer.alloc(MAX_BYTES + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== stat.size || bytesRead > MAX_BYTES) throw new ThreadReadStorageError();
            const state = ReadStateSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
            entries = state.entries;
            this.#seen = true;
          } finally { await handle.close(); }
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT' && !this.#seen)) throw error;
        }
        await bound();
        if (!change) return entries;
        const next = ReadStateSchema.parse({ version: 1, entries: change(entries) });
        const bytes = JSON.stringify(next);
        if (Buffer.byteLength(bytes) > MAX_BYTES) throw new ThreadReadStorageError();
        staging = join(root, `.thread-reads-${randomBytes(16).toString('hex')}.tmp`);
        const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await bound();
        await rename(staging, path); renamed = true; staging = undefined;
        await directory.sync();
        await bound();
        this.#seen = true;
        return next.entries;
      } catch (error) {
        if (renamed) this.#poisoned = true; // Commit may have landed: require readback/restart, never silently retry.
        if (error instanceof Error && 'statusCode' in error && [400, 404, 409].includes(error.statusCode as number)) throw error;
        throw new ThreadReadStorageError();
      } finally {
        if (staging) await unlink(staging).catch(() => undefined);
        await directory?.close();
      }
    }));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
