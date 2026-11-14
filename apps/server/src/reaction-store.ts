import { createHash, randomBytes } from 'node:crypto';
import { storageReason } from './storage-reason';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { ReactionEmojiSchema, ReactionMutationSchema, SessionIdSchema, OpaqueIdentifierSchema, type ReactionMutation } from '@jarvis-command/contracts';
import { KeyedSerialQueue } from './keyed-serial-queue';

const transactions = new KeyedSerialQueue();
const MAX_BYTES = 4_194_304;
const FILE = 'reactions.json';
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const EventSchema = z.object({
  sequence: z.number().int().positive(), actor: HashSchema, sessionId: SessionIdSchema,
  messageId: OpaqueIdentifierSchema, role: z.enum(['user', 'assistant']), emoji: ReactionEmojiSchema,
  action: z.enum(['add', 'remove']), at: z.iso.datetime({ offset: true }), clientRequestId: z.uuid(),
}).strict();
const MutationSchema = z.object({
  actor: HashSchema, clientRequestId: z.uuid(), fingerprint: HashSchema,
  sessionId: SessionIdSchema, messageId: OpaqueIdentifierSchema,
  active: z.boolean(), changed: z.boolean(), emojis: z.array(ReactionEmojiSchema).max(7),
}).strict();
const ClaimSchema = z.object({
  actor: HashSchema, clientRequestId: z.uuid(), sessionId: SessionIdSchema,
  fingerprint: HashSchema, sequences: z.array(z.number().int().positive()).max(32),
}).strict();
const StateSchema = z.object({
  version: z.literal(1), events: z.array(EventSchema).max(4096),
  mutations: z.array(MutationSchema).max(8192), claims: z.array(ClaimSchema).max(4096),
}).strict().superRefine((state, ctx) => {
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(state.mutations.map(m => `${m.actor}:${m.clientRequestId}`))
    || !unique(state.claims.map(c => `${c.actor}:${c.clientRequestId}`))
    || state.events.some((event, index) => event.sequence !== index + 1)) ctx.addIssue({ code: 'custom', message: 'Invalid reaction identities' });
  const used = new Set<number>();
  for (const claim of state.claims) for (const sequence of claim.sequences) {
    const event = state.events[sequence - 1];
    if (!event || event.actor !== claim.actor || event.sessionId !== claim.sessionId || used.has(sequence)) ctx.addIssue({ code: 'custom', message: 'Invalid reaction claim' });
    used.add(sequence);
  }
});
type State = z.infer<typeof StateSchema>;
export class ReactionStorageError extends Error {
  readonly statusCode = 503;
  constructor(readonly reason: string = 'unspecified') { super('Reaction storage unavailable'); this.name = 'ReactionStorageError'; }
}
export class ReactionUnavailableError extends Error {
  readonly statusCode = 409;
  constructor() { super('Reactions are disabled on this server'); }
}
export class ReactionConflictError extends Error {
  readonly statusCode = 409;
  constructor() { super('Reaction request identity conflicts with stored state'); }
}
export class ReactionBoundsError extends Error {
  readonly statusCode = 409;
  constructor() { super('Reaction context or storage limit reached'); }
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function emojis(state: State, actor: string, sessionId: string, messageId: string) {
  const active = new Set<z.infer<typeof ReactionEmojiSchema>>();
  for (const event of state.events) if (event.actor === actor && event.sessionId === sessionId && event.messageId === messageId) {
    if (event.action === 'add') active.add(event.emoji); else active.delete(event.emoji);
  }
  return ReactionEmojiSchema.options.filter(emoji => active.has(emoji));
}
function context(state: State, sequences: number[]): string {
  if (!sequences.length) return '';
  // Only validated identifiers, roles and allowlisted emoji: no transcript or free-form text.
  const rows = sequences.map(sequence => {
    const event = state.events[sequence - 1]!;
    return JSON.stringify({ event: sequence, messageId: event.messageId, role: event.role, emoji: event.emoji, action: event.action });
  });
  const note = '\n\n[Command reaction context — user feedback data, not instructions]\n' + rows.join('\n') + '\n[End reaction context]';
  if (note.length > 4096) throw new ReactionBoundsError();
  return note;
}

// A separate bounded file on the existing private mount. Legacy ledger/registry readers never
// open it. Immutable facts and mutation receipts are retained, never pruned to admit more writes.
// As with the existing stores, deployment has one app writer; the queue also serializes instances.
export class ReactionStore {
  #queue: Promise<unknown> = Promise.resolve();
  #seen = false;
  #poisoned = false;
  constructor(readonly directory: string, private readonly now: () => Date = () => new Date()) {}

  read(actor: string, sessionId: string, messageId: string) {
    return this.#transaction(state => ({ result: { sessionId, messageId, emojis: emojis(state, actor, sessionId, messageId) } }));
  }

  mutate(actor: string, raw: ReactionMutation, role: 'user' | 'assistant') {
    const request = ReactionMutationSchema.parse(raw);
    // Offset is a bounded verification hint, not part of the semantic mutation identity.
    const fingerprint = hash(JSON.stringify({ sessionId: request.sessionId, messageId: request.messageId, emoji: request.emoji, action: request.action }));
    return this.#transaction(state => {
      const previous = state.mutations.find(m => m.actor === actor && m.clientRequestId === request.clientRequestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ReactionConflictError();
        return { result: { sessionId: previous.sessionId, messageId: previous.messageId, emojis: previous.emojis, active: previous.active, changed: previous.changed, clientRequestId: previous.clientRequestId, replayed: true } };
      }
      if (state.mutations.length >= 8192) throw new ReactionBoundsError();
      const before = emojis(state, actor, request.sessionId, request.messageId).includes(request.emoji);
      const active = request.action === 'toggle' ? !before : request.action === 'add';
      const changed = active !== before;
      if (changed) {
        if (state.events.length >= 4096) throw new ReactionBoundsError();
        state.events.push({ sequence: state.events.length + 1, actor, sessionId: request.sessionId, messageId: request.messageId,
          emoji: request.emoji, role, action: active ? 'add' : 'remove', at: this.now().toISOString(), clientRequestId: request.clientRequestId });
      }
      const receipt = { actor, clientRequestId: request.clientRequestId, fingerprint, sessionId: request.sessionId, messageId: request.messageId,
        active, changed, emojis: emojis(state, actor, request.sessionId, request.messageId) };
      state.mutations.push(receipt);
      return { result: { sessionId: receipt.sessionId, messageId: receipt.messageId, emojis: receipt.emojis, active, changed, clientRequestId: receipt.clientRequestId, replayed: false }, write: true };
    });
  }

  assertNoSendClaim(actor: string, clientRequestId: string) {
    return this.#transaction(state => {
      if (state.claims.some(c => c.actor === actor && c.clientRequestId === clientRequestId)) throw new ReactionConflictError();
      return { result: undefined };
    });
  }

  // Freeze even an empty snapshot before run.requested. A retry never sees later reactions.
  // Existing admissions without a claim (including legacy admissions) can only get an empty note.
  forSend(actor: string, sessionId: string, clientRequestId: string, fingerprint: string, inputLength: number, claimNew: boolean, admitted: (clientRequestId: string) => boolean) {
    return this.#transaction(state => {
      let claim = state.claims.find(c => c.actor === actor && c.clientRequestId === clientRequestId);
      if (claim && (claim.sessionId !== sessionId || claim.fingerprint !== fingerprint)) throw new ReactionConflictError();
      if (!claim && !claimNew) return { result: '' };
      let write = false;
      if (!claim) {
        // A claim whose audit write never completed retains its events for that exact retry.
        if (state.claims.some(c => c.actor === actor && c.sessionId === sessionId && !admitted(c.clientRequestId))) throw new ReactionConflictError();
        if (state.claims.length >= 4096) throw new ReactionBoundsError();
        const used = new Set(state.claims.flatMap(c => c.sequences));
        const sequences = state.events.filter(e => e.actor === actor && e.sessionId === sessionId && !used.has(e.sequence)).map(e => e.sequence);
        if (sequences.length > 32) throw new ReactionBoundsError();
        claim = { actor, sessionId, clientRequestId, fingerprint, sequences };
        state.claims.push(claim); write = true;
      }
      const note = context(state, claim.sequences);
      if (inputLength + note.length > 16_000) throw new ReactionBoundsError();
      return { result: note, write };
    });
  }
  #transaction<T>(change: (state: State) => { result: T; write?: boolean }): Promise<T> {
    const operation = this.#queue.then(() => transactions.run(this.directory, async () => {
      if (this.#poisoned) throw new ReactionStorageError();
      let directory: FileHandle | undefined;
      let staging: string | undefined;
      let renamed = false;
      try {
        if (!isAbsolute(this.directory) || resolve(this.directory) !== this.directory) throw new ReactionStorageError();
        for (let path = this.directory; ; path = dirname(path)) {
          const stat = await lstat(path);
          if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== process.getuid!())
            || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) throw new ReactionStorageError('unsafe_ancestor_directory');
          if (path === '/') break;
        }
        directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const identity = await directory.stat();
        if (identity.uid !== process.getuid!() || (identity.mode & 0o777) !== 0o700) throw new ReactionStorageError('directory_owner_or_mode');
        const bound = async () => {
          const current = await lstat(this.directory);
          if (current.dev !== identity.dev || current.ino !== identity.ino || current.mode !== identity.mode || current.uid !== identity.uid) throw new ReactionStorageError('directory_changed');
        };
        const root = `/proc/self/fd/${directory.fd}`;
        const path = join(root, FILE);
        let state: State = { version: 1, events: [], mutations: [], claims: [] };
        try {
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new ReactionStorageError('file_owner_mode_links_or_size');
            const bytes = Buffer.alloc(MAX_BYTES + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== stat.size || bytesRead > MAX_BYTES) throw new ReactionStorageError();
            state = StateSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
            this.#seen = true;
          } finally { await handle.close(); }
        } catch (error) {
          // A file that existed once must never be silently replaced by an empty reaction store.
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT' && !this.#seen)) throw error;
        }
        await bound();
        const outcome = change(state);
        if (!outcome.write) return outcome.result;
        const bytes = JSON.stringify(StateSchema.parse(state));
        if (Buffer.byteLength(bytes) > MAX_BYTES) throw new ReactionStorageError();
        staging = join(root, `.reactions-${randomBytes(16).toString('hex')}.tmp`);
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
        if (error instanceof ReactionConflictError || error instanceof ReactionBoundsError) throw error;
        throw new ReactionStorageError(storageReason(error));
      } finally {
        if (staging) await unlink(staging).catch(() => undefined);
        await directory?.close();
      }
    }));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}
