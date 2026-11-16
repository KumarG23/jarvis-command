import { createHash, randomBytes } from 'node:crypto';
import { storageReason } from './storage-reason';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { KeyedSerialQueue } from './keyed-serial-queue';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { DeliveryIdSchema, SessionIdSchema, type ScheduledDelivery } from '@jarvis-command/contracts';

export const DELIVERY_KEY = /^[A-Za-z0-9._:-]{1,160}$/;
const EntrySchema = z.object({
  key: z.string().regex(DELIVERY_KEY),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  actor: z.string().regex(/^[a-f0-9]{64}$/),
  deliveryId: DeliveryIdSchema,
  sessionId: SessionIdSchema,
  kind: z.enum(['cron', 'reminder']),
  title: z.string().min(1).max(80).nullable(),
  content: z.string().min(1).max(16_000),
  deliveredAt: z.iso.datetime({ offset: true }),
}).strict();
const StateSchema = z.object({ version: z.literal(1), entries: z.array(EntrySchema).max(300) }).strict()
  .refine(state => new Set(state.entries.map(entry => `${entry.actor}:${entry.key}`)).size === state.entries.length);
type Entry = z.infer<typeof EntrySchema>;
export type DeliveryInput = Readonly<{ key: string; sessionId: string; kind: 'cron' | 'reminder'; title: string | null; content: string }>;

const transactions = new KeyedSerialQueue();
const MAX_ENTRIES = 300;
const MAX_BYTES = 6_291_456;
export class DeliveryStorageError extends Error {
  readonly statusCode = 503;
  constructor(readonly reason: string = 'unspecified') { super('Delivery storage unavailable'); this.name = 'DeliveryStorageError'; }
}
export class DeliveryConflictError extends Error {
  readonly statusCode = 409;
  constructor() { super('Delivery key was already used for different content'); this.name = 'DeliveryConflictError'; }
}

const view = (entry: Entry): ScheduledDelivery => ({
  deliveryId: entry.deliveryId, sessionId: entry.sessionId, kind: entry.kind, title: entry.title, content: entry.content, deliveredAt: entry.deliveredAt,
});

/**
 * Scheduled messages that Hermes delivered into Command chats. Single app writer, same private mount
 * as the audit ledger; never opens the ledger. Bounded: the oldest deliveries are dropped first.
 */
export class DeliveryStore {
  #queue: Promise<unknown> = Promise.resolve();
  #seen = false;
  #poisoned = false;
  constructor(readonly directory: string, private readonly now: () => Date = () => new Date()) {}

  /** Records once per (actor, key). The same key with the same body replays; different content conflicts. */
  async record(actor: string, input: DeliveryInput): Promise<{ delivery: ScheduledDelivery; replayed: boolean }> {
    const fingerprint = createHash('sha256').update(JSON.stringify([input.sessionId, input.kind, input.title, input.content])).digest('hex');
    let outcome!: { delivery: ScheduledDelivery; replayed: boolean };
    await this.#transaction(entries => {
      const existing = entries.find(entry => entry.actor === actor && entry.key === input.key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new DeliveryConflictError();
        outcome = { delivery: view(existing), replayed: true };
        return null;
      }
      const entry: Entry = {
        key: input.key, fingerprint, actor, sessionId: input.sessionId, kind: input.kind, title: input.title, content: input.content,
        deliveryId: `dlv_${randomBytes(16).toString('hex')}`, deliveredAt: this.now().toISOString(),
      };
      outcome = { delivery: view(entry), replayed: false };
      let next = [...entries, entry];
      while (next.length > MAX_ENTRIES || Buffer.byteLength(JSON.stringify({ version: 1, entries: next })) > MAX_BYTES - 65_536) next = next.slice(1);
      return next;
    });
    return outcome;
  }

  async list(actor: string, sessionId: string): Promise<ScheduledDelivery[]> {
    return (await this.#transaction()).filter(entry => entry.actor === actor && entry.sessionId === sessionId).map(view);
  }

  async find(actor: string, deliveryId: string): Promise<ScheduledDelivery | null> {
    const entry = (await this.#transaction()).find(item => item.actor === actor && item.deliveryId === deliveryId);
    return entry ? view(entry) : null;
  }

  #transaction(change?: (entries: Entry[]) => Entry[] | null): Promise<Entry[]> {
    const operation = this.#queue.then(() => transactions.run(this.directory, async () => {
      if (this.#poisoned) throw new DeliveryStorageError();
      let directory: FileHandle | undefined;
      let staging: string | undefined;
      let renamed = false;
      try {
        if (!isAbsolute(this.directory) || resolve(this.directory) !== this.directory) throw new DeliveryStorageError();
        // Reject symlinks throughout the configured path. Writable ancestors are
        // allowed only for sticky temporary fixture roots, never the private leaf.
        for (let path = this.directory; ; path = dirname(path)) {
          const stat = await lstat(path);
          if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== process.getuid!())
            || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) throw new DeliveryStorageError('unsafe_ancestor_directory');
          if (path === '/') break;
        }
        directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const identity = await directory.stat();
        if (identity.uid !== process.getuid!() || (identity.mode & 0o777) !== 0o700) throw new DeliveryStorageError('directory_owner_or_mode');
        const bound = async () => {
          const current = await lstat(this.directory);
          if (current.dev !== identity.dev || current.ino !== identity.ino || current.mode !== identity.mode || current.uid !== identity.uid) throw new DeliveryStorageError('directory_changed');
        };
        const root = `/proc/self/fd/${directory.fd}`;
        const path = join(root, 'deliveries.json');
        let entries: Entry[] = [];
        try {
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new DeliveryStorageError('file_owner_mode_links_or_size');
            const bytes = Buffer.alloc(MAX_BYTES + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== stat.size || bytesRead > MAX_BYTES) throw new DeliveryStorageError();
            const state = StateSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
            entries = state.entries;
            this.#seen = true;
          } finally { await handle.close(); }
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT' && !this.#seen)) throw error;
        }
        await bound();
        if (!change) return entries;
        const changed = change(entries);
        if (!changed) return entries;
        const next = StateSchema.parse({ version: 1, entries: changed });
        const bytes = JSON.stringify(next);
        if (Buffer.byteLength(bytes) > MAX_BYTES) throw new DeliveryStorageError();
        staging = join(root, `.deliveries-${randomBytes(16).toString('hex')}.tmp`);
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
        if (error instanceof DeliveryConflictError) throw error;
        throw new DeliveryStorageError(storageReason(error));
      } finally {
        if (staging) await unlink(staging).catch(() => undefined);
        await directory?.close();
      }
    }));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
