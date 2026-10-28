import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { PushDeviceIdSchema, PushSubscriptionSchema, NotificationIdSchema, type PushSubscription, type NotificationItem } from '@jarvis-command/contracts';
import { z } from 'zod';
import { NotificationStorageError, NotificationNotFoundError } from './notification-errors';
const MAX_BYTES = 2_097_152;
const FILE = 'push-devices.json';
export const MAX_PUSH_RECEIPTS = 2048;
const DeviceSchema = z.object({
  id: PushDeviceIdSchema, subscription: PushSubscriptionSchema,
  registeredAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).strict();
const PushSchema = z.object({
  devices: z.array(DeviceSchema).max(8),
  // Never evict identities. At capacity stop sending, rather than resurrecting old events.
  receipts: z.array(z.object({
    id: NotificationIdSchema, deviceId: PushDeviceIdSchema,
    outcome: z.enum(['unknown', 'sent', 'failed', 'expired']),
  }).strict()).max(MAX_PUSH_RECEIPTS),
}).strict();
const PushActorSchema = z.object({ push: PushSchema }).strict();
const PushStateSchema = z.object({ version: z.literal(1), actors: z.record(z.string().regex(/^[a-f0-9]{64}$/), PushActorSchema) }).strict()
  .refine(state => Object.keys(state.actors).length <= 32);
type PushState = z.infer<typeof PushStateSchema>;
export type PushView = Readonly<{ devices: Array<{ id: string; registeredAt: string; expiresAt: string }>; full: boolean }>;
const pushView = (actor: z.infer<typeof PushActorSchema>): PushView => ({
  devices: actor.push.devices.map(({ id, registeredAt, expiresAt }) => ({ id, registeredAt, expiresAt })),
  full: actor.push.receipts.length >= MAX_PUSH_RECEIPTS || actor.push.receipts.length + actor.push.devices.length > MAX_PUSH_RECEIPTS,
});

// Single writer, private mount, exact same atomic-file discipline as the inbox, separate file.
export class PushStore {
  #queue: Promise<unknown> = Promise.resolve();
  #seen = false;
  #poisoned = false;
  constructor(readonly directory: string, private readonly now: () => Date = () => new Date()) {}
  #emptyActor(): z.infer<typeof PushActorSchema> { return { push: { devices: [], receipts: [] } }; }
  read(actor: string): Promise<PushView> {
    return this.#transaction(state => ({ result: pushView(state.actors[actor] ?? this.#emptyActor()) }));
  }
  registerDevice(actor: string, input: PushSubscription): Promise<PushView> {
    const subscription = PushSubscriptionSchema.parse(input);
    return this.#transaction(state => {
      const current = state.actors[actor] ?? this.#emptyActor();
      const now = this.now();
      const expires = Math.min(subscription.expirationTime ?? Infinity, now.getTime() + 30 * 86400_000);
      if (expires <= now.getTime()) throw Object.assign(new Error('Expired subscription'), { statusCode: 400 });
      // A subscription belongs to exactly one actor. Do not permit rebinding on shared devices.
      for (const [owner, value] of Object.entries(state.actors)) {
        if (owner !== actor && value.push.devices.some(d => d.subscription.endpoint === subscription.endpoint)) throw new NotificationNotFoundError();
      }
      const existing = current.push.devices.find(d => d.subscription.endpoint === subscription.endpoint);
      if (existing) {
        // Idempotent readback, never replace key material or extend lifetime on a retry.
        if (JSON.stringify(existing.subscription) !== JSON.stringify(subscription)) throw new NotificationNotFoundError();
        return { result: pushView(current) };
      }
      const devices = current.push.devices.filter(d => d.expiresAt > now.toISOString());
      if (devices.length >= 8) throw new NotificationStorageError();
      // Endpoint-derived identity means revoke/re-register cannot resend a claimed event.
      const id = `dev_${createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 32)}`;
      devices.push({ id, subscription, registeredAt: now.toISOString(), expiresAt: new Date(expires).toISOString() });
      state.actors[actor] = { ...current, push: { ...current.push, devices } };
      return { result: pushView(state.actors[actor]), write: true };
    });
  }

  revokeDevice(actor: string, id: string): Promise<PushView> {
    return this.#transaction(state => {
      const current = state.actors[actor];
      if (!current || !current.push.devices.some(d => d.id === id)) throw new NotificationNotFoundError();
      current.push.devices = current.push.devices.filter(d => d.id !== id);
      return { result: pushView(current), write: true };
    });
  }

  /** Reserve all sends durably BEFORE transport. Crash/timeouts stay unknown and are never retried. */
  claimPush(actor: string, item: NotificationItem): Promise<Array<z.infer<typeof DeviceSchema>>> {
    return this.#transaction(state => {
      const current = state.actors[actor];
      const now = this.now();
      if (!current || item.readAt || now.getTime() - Date.parse(item.observedAt) > 86400_000) return { result: [] };
      const devices = current.push.devices.filter(d => d.expiresAt > now.toISOString()
        && d.registeredAt <= item.observedAt
        && !current.push.receipts.some(r => r.id === item.id && r.deviceId === d.id));
      if (current.push.receipts.length + devices.length > MAX_PUSH_RECEIPTS) return { result: [] };
      current.push.receipts.push(...devices.map(d => ({ id: item.id, deviceId: d.id, outcome: 'unknown' as const })));
      return { result: devices, write: devices.length > 0 };
    });
  }

  finishPush(actor: string, id: string, deviceId: string, outcome: 'sent' | 'failed' | 'expired' | 'unknown'): Promise<void> {
    return this.#transaction(state => {
      const current = state.actors[actor];
      const receipt = current?.push.receipts.find(r => r.id === id && r.deviceId === deviceId);
      if (!current || !receipt) throw new NotificationNotFoundError();
      receipt.outcome = outcome;
      if (outcome === 'expired') current.push.devices = current.push.devices.filter(d => d.id !== deviceId);
      return { result: undefined, write: true };
    });
  }

  #transaction<T>(change: (state: PushState) => { result: T; write?: boolean }): Promise<T> {
    const operation = this.#queue.then(async () => {
      if (this.#poisoned) throw new NotificationStorageError();
      let directory: FileHandle | undefined;
      let staging: string | undefined;
      let renamed = false;
      try {
        if (!isAbsolute(this.directory) || resolve(this.directory) !== this.directory) throw new NotificationStorageError();
        for (let path = this.directory; ; path = dirname(path)) {
          const stat = await lstat(path);
          if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== process.getuid!())
            || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) throw new NotificationStorageError();
          if (path === '/') break;
        }
        directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const identity = await directory.stat();
        if (identity.uid !== process.getuid!() || (identity.mode & 0o777) !== 0o700) throw new NotificationStorageError();
        const bound = async () => {
          const current = await lstat(this.directory);
          if (current.dev !== identity.dev || current.ino !== identity.ino || current.mode !== identity.mode || current.uid !== identity.uid) throw new NotificationStorageError();
        };
        const root = `/proc/self/fd/${directory.fd}`;
        const path = join(root, FILE);
        let state: PushState = { version: 1, actors: {} };
        try {
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new NotificationStorageError();
            const bytes = Buffer.alloc(MAX_BYTES + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== stat.size || bytesRead > MAX_BYTES) throw new NotificationStorageError();
            state = PushStateSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
            this.#seen = true;
          } finally { await handle.close(); }
        } catch (error) {
          // A file that existed once must never be silently replaced by an empty inbox.
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT' && !this.#seen)) throw error;
        }
        await bound();
        const outcome = change(state);
        if (!outcome.write) return outcome.result;
        const bytes = JSON.stringify(PushStateSchema.parse(state));
        if (Buffer.byteLength(bytes) > MAX_BYTES) throw new NotificationStorageError();
        staging = join(root, `.push-devices-${randomBytes(16).toString('hex')}.tmp`);
        const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await bound();
        await rename(staging, path); renamed = true; staging = undefined;
        await directory.sync();
        await bound();
        this.#seen = true;
        return outcome.result;
      } catch (error) {
        if (renamed) this.#poisoned = true; // Commit may have landed: require restart/readback, never silently retry.
        if (error instanceof NotificationNotFoundError || (error instanceof Error && 'statusCode' in error && error.statusCode === 400)) throw error;
        throw new NotificationStorageError();
      } finally {
        if (staging) await unlink(staging).catch(() => undefined);
        await directory?.close();
      }
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
