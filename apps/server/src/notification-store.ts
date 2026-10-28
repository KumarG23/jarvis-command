import { NotificationStorageError, NotificationNotFoundError } from './notification-errors';
export { NotificationStorageError, NotificationNotFoundError } from './notification-errors';
import { PushStore } from './push-store';
import type { PushSubscription } from '@jarvis-command/contracts';
export { MAX_PUSH_RECEIPTS } from './push-store';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  NotificationIdSchema,
  NotificationItemSchema,
  NotificationPreferencesSchema,
  type NotificationCategory,
  type NotificationItem,
  type NotificationPreferences,
} from '@jarvis-command/contracts';
import { z } from 'zod';

const MAX_BYTES = 2_097_152;
export const MAX_ITEMS = 100;
const MAX_SETTLED = 500;
export const MAX_APPROVAL_RECEIPTS = 1024;
const MAX_ACTORS = 32;
const FILE = 'notifications.json';

export const DEFAULT_PREFERENCES: NotificationPreferences = Object.freeze({
  categories: Object.freeze({ 'run-completed': true, 'run-failed': true, approval: true }),
}) as NotificationPreferences;

const ActorStateSchema = z.object({
  preferences: NotificationPreferencesSchema,
  items: z.array(NotificationItemSchema).max(MAX_ITEMS),
  // Event IDs already created, pruned or suppressed. A bounded set keeps an event from
  // reappearing after pruning or after a disabled category is re-enabled.
  settled: z.array(z.object({ id: NotificationIdSchema, at: z.iso.datetime({ offset: true }) }).strict()).max(MAX_SETTLED),
  // First time this server held state for the actor; reconcile never delivers events before it.
  since: z.iso.datetime({ offset: true }),
  // Newest settle time dropped from `settled`; only stable terminal event times use it.
  horizon: z.iso.datetime({ offset: true }).nullable(),
  // Approvals have a request ID but no supported historical timestamp. Never evict these IDs
  // or use observation time as replay evidence. At capacity, new approval delivery stops.
  approvals: z.object({
    ids: z.array(NotificationIdSchema).max(MAX_APPROVAL_RECEIPTS),
    sealed: z.boolean(),
  }).strict().optional(),
}).strict().transform(actor => ({
  ...actor,
  approvals: actor.approvals ?? {
    // Legacy settled entries don't carry category; conservatively retain all their IDs.
    ids: [...new Set([...actor.settled.map(entry => entry.id), ...actor.items.map(item => item.id)])],
    // Already discarded identities cannot be recovered. Do not replay unknown approvals.
    sealed: actor.horizon !== null,
  },
}));
const StateSchema = z.object({
  version: z.literal(1),
  actors: z.record(z.string().regex(/^[a-f0-9]{64}$/), ActorStateSchema),
}).strict().refine(state => Object.keys(state.actors).length <= MAX_ACTORS);
type ActorState = z.infer<typeof ActorStateSchema>;
type State = z.infer<typeof StateSchema>;

export type NotificationEvent = Readonly<{
  id: string;
  category: NotificationCategory;
  sessionId: string;
  publicRunId: string;
  /** Stable terminal audit time; approvals use observation time and separate durable ID receipts. */
  eventAt: string;
}>;
export type ActorView = Readonly<{ items: NotificationItem[]; preferences: NotificationPreferences; since: string; knownIds: ReadonlySet<string>; approvalsUnavailable: boolean }>;

const TEXT: Record<NotificationCategory, { title: string; body: string }> = {
  'run-completed': { title: 'Run finished', body: 'A run you started has finished. Open the chat to read it.' },
  'run-failed': { title: 'Run failed', body: 'A run you started did not finish. Open the chat for details.' },
  approval: { title: 'Approval needed', body: 'A run is waiting for your approval. Open the chat to review it.' },
};

const view = (actor: ActorState): ActorView => ({
  items: [...actor.items].reverse(), preferences: actor.preferences, since: actor.since,
  knownIds: new Set([...actor.settled.map(entry => entry.id), ...actor.items.map(item => item.id)]),
  approvalsUnavailable: actor.approvals.sealed || actor.approvals.ids.length >= MAX_APPROVAL_RECEIPTS,
});

// Single app writer on the same private mount as the audit ledger; never opens the ledger.
// Every operation is scoped to one actor fingerprint and cannot read or write another's record.
export class NotificationStore {
  #queue: Promise<unknown> = Promise.resolve();
  #seen = false;
  #poisoned = false;
  readonly #push: PushStore;
  constructor(readonly directory: string, private readonly now: () => Date = () => new Date()) { this.#push = new PushStore(directory, now); }

  #emptyActor(): ActorState {
    return { preferences: structuredClone(DEFAULT_PREFERENCES), items: [], settled: [], horizon: null, since: this.now().toISOString(), approvals: { ids: [], sealed: false } };
  }

  /** Reads the actor's state, creating it once (recording `since`) on first use. */
  read(actor: string): Promise<ActorView> {
    return this.#transaction(state => {
      const existing = state.actors[actor];
      if (existing) return { result: view(existing) };
      state.actors[actor] = this.#emptyActor();
      return { result: view(state.actors[actor]), write: true };
    });
  }

  /** Records an event once. Returns whether a new item was created. */
  record(actor: string, event: NotificationEvent): Promise<'created' | 'duplicate' | 'suppressed'> {
    return this.#transaction(state => {
      const current = state.actors[actor] ?? this.#emptyActor();
      if (current.settled.some(entry => entry.id === event.id) || current.items.some(item => item.id === event.id)) return { result: 'duplicate' as const };
      if (event.category === 'approval') {
        if (current.approvals.ids.includes(event.id)) return { result: 'duplicate' as const };
        if (current.approvals.sealed || current.approvals.ids.length >= MAX_APPROVAL_RECEIPTS) return { result: 'suppressed' as const };
      } else if (current.horizon !== null && event.eventAt <= current.horizon) {
        // A bounded terminal replay boundary can omit previously unseen older events.
        // The inbox explicitly reports incomplete delivery, never complete history.
        return { result: 'duplicate' as const };
      }
      const approvals = event.category === 'approval'
        ? { ...current.approvals, ids: [...current.approvals.ids, event.id] } : current.approvals;
      const at = this.now().toISOString();
      let settled = [...current.settled, { id: event.id, at }];
      let horizon = current.horizon;
      while (settled.length > MAX_SETTLED) {
        const dropped = settled[0]!;
        horizon = horizon === null || dropped.at > horizon ? dropped.at : horizon;
        settled = settled.slice(1);
      }
      if (!current.preferences.categories[event.category]) {
        state.actors[actor] = { ...current, settled, horizon, approvals };
        return { result: 'suppressed' as const, write: true };
      }
      const item: NotificationItem = {
        id: event.id, category: event.category, observedAt: at,
        sessionId: event.sessionId, publicRunId: event.publicRunId, ...TEXT[event.category], readAt: null,
      };
      state.actors[actor] = { ...current, settled, horizon, approvals, items: [...current.items, item].slice(-MAX_ITEMS) };
      return { result: 'created' as const, write: true };
    });
  }

  markRead(actor: string, selection: Readonly<{ ids: readonly string[] } | { all: true }>): Promise<ActorView> {
    return this.#transaction(state => {
      const current = state.actors[actor] ?? this.#emptyActor();
      const ids = 'ids' in selection ? new Set(selection.ids) : null;
      if (ids) for (const id of ids) if (!current.items.some(item => item.id === id)) throw new NotificationNotFoundError();
      const readAt = this.now().toISOString();
      const items = current.items.map(item => (!ids || ids.has(item.id)) && item.readAt === null ? { ...item, readAt } : item);
      const changed = items.some((item, index) => item !== current.items[index]);
      if (changed) state.actors[actor] = { ...current, items };
      return { result: view(state.actors[actor] ?? current), write: changed };
    });
  }

  setPreferences(actor: string, preferences: NotificationPreferences): Promise<ActorView> {
    return this.#transaction(state => {
      const current = state.actors[actor] ?? this.#emptyActor();
      state.actors[actor] = { ...current, preferences: NotificationPreferencesSchema.parse(preferences) };
      return { result: view(state.actors[actor]), write: true };
    });
  }

  find(actor: string, id: string): Promise<NotificationItem | null> {
    return this.read(actor).then(({ items }) => items.find(item => item.id === id) ?? null);
  }

  readPush(actor: string) { return this.#push.read(actor); }
  async registerDevice(actor: string, subscription: PushSubscription): Promise<ActorView> {
    await this.#push.registerDevice(actor, subscription);
    return this.read(actor);
  }
  async revokeDevice(actor: string, id: string): Promise<ActorView> {
    await this.#push.revokeDevice(actor, id);
    return this.read(actor);
  }
  async claimPush(actor: string, id: string) {
    const current = await this.read(actor);
    const item = current.items.find(item => item.id === id);
    if (!item || !current.preferences.categories[item.category]) return [];
    return this.#push.claimPush(actor, item);
  }
  finishPush(actor: string, id: string, deviceId: string, outcome: 'sent' | 'failed' | 'expired' | 'unknown') {
    return this.#push.finishPush(actor, id, deviceId, outcome);
  }

  #transaction<T>(change: (state: State) => { result: T; write?: boolean }): Promise<T> {
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
        let state: State = { version: 1, actors: {} };
        try {
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new NotificationStorageError();
            const bytes = Buffer.alloc(MAX_BYTES + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== stat.size || bytesRead > MAX_BYTES) throw new NotificationStorageError();
            state = StateSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
            this.#seen = true;
          } finally { await handle.close(); }
        } catch (error) {
          // A file that existed once must never be silently replaced by an empty inbox.
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT' && !this.#seen)) throw error;
        }
        await bound();
        const outcome = change(state);
        if (!outcome.write) return outcome.result;
        const bytes = JSON.stringify(StateSchema.parse(state));
        if (Buffer.byteLength(bytes) > MAX_BYTES) throw new NotificationStorageError();
        staging = join(root, `.notifications-${randomBytes(16).toString('hex')}.tmp`);
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
        if (error instanceof NotificationNotFoundError) throw error;
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
