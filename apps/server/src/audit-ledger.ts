import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

import { ApprovalChoiceSchema, LiveRunStateSchema } from '@jarvis-command/contracts';
import { z } from 'zod';

const MAX_AUDIT_BYTES = 16_777_216;
const ZERO_HASH = '0'.repeat(64);
const SHA256 = /^[a-f0-9]{64}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/;
const PUBLIC_RUN_ID = /^jcr_[a-f0-9]{32}$/;
const UPSTREAM_RUN_ID = /^run_[a-f0-9]{32}$/;

const AuditActionSchema = z.enum([
  'session.created',
  'session.continued',
  'run.requested',
  'run.started',
  'run.replayed',
  'run.approval.once',
  'run.approval.deny',
  'run.steer',
  'run.stop',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.interrupted',
]);

const AuditOutcomeSchema = z.enum(['requested', 'succeeded', 'failed', 'replayed']);

const AuditDraftSchema = z.object({
  action: AuditActionSchema,
  actor: z.string().regex(SHA256),
  sessionId: z.string().regex(SESSION_ID),
  publicRunId: z.string().regex(PUBLIC_RUN_ID).nullable(),
  clientRequestId: z.uuid().nullable(),
  upstreamRunId: z.string().regex(UPSTREAM_RUN_ID).nullable(),
  requestId: z.string().min(1).max(256).nullable(),
  requestFingerprint: z.string().regex(SHA256).nullable().default(null),
  outcome: AuditOutcomeSchema,
  status: LiveRunStateSchema.nullable(),
  choice: ApprovalChoiceSchema.nullable(),
}).strict();

const AuditEntrySchema = AuditDraftSchema.extend({
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime({ offset: true }),
  dedupeKey: z.string().min(1).max(256).nullable(),
  previousHash: z.string().regex(SHA256),
  hash: z.string().regex(SHA256),
}).strict();

export type AuditDraft = z.input<typeof AuditDraftSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export type AuditRunRecord = Readonly<{
  actor: string;
  sessionId: string;
  publicRunId: string;
  clientRequestId: string;
  upstreamRunId: string | null;
  requestFingerprint: string;
  status: z.infer<typeof LiveRunStateSchema>;
  requestedAt: string;
}>;

export class AuditIntegrityError extends Error {
  public constructor(message = 'Jarvis Command audit ledger integrity check failed') {
    super(message);
    this.name = 'AuditIntegrityError';
  }
}

export class AuditLedger {
  readonly #handle: FileHandle;
  readonly #entries: AuditEntry[];
  readonly #dedupe = new Map<string, AuditEntry>();
  readonly #runsByClient = new Map<string, AuditRunRecord>();
  readonly #runsByPublic = new Map<string, AuditRunRecord>();
  readonly #now: () => Date;
  #writeQueue: Promise<unknown> = Promise.resolve();
  #expectedSize: number;
  #expectedBytes: Buffer;
  readonly #path: string;
  readonly #identity: { dev: number; ino: number };
  #healthy = true;
  #closed = false;

  private constructor(handle: FileHandle, entries: AuditEntry[], now: () => Date, bytes: Buffer, path: string, identity: { dev: number; ino: number }) {
    this.#handle = handle;
    this.#expectedSize = bytes.length;
    this.#expectedBytes = bytes;
    this.#path = path;
    this.#identity = identity;
    this.#entries = entries;
    this.#now = now;
    this.#rebuildIndexes();
  }

  public static async open(
    path: string,
    options: Readonly<{ now?: () => Date }> = {},
  ): Promise<AuditLedger> {
    if (!isAbsolute(path)) throw new AuditIntegrityError('Audit path must be absolute');
    await validateParentDirectory(dirname(path));

    let handle: FileHandle;
    try {
      handle = await open(
        path,
        constants.O_CREAT
          | constants.O_RDWR
          | constants.O_APPEND
          | constants.O_NOFOLLOW,
        0o600,
      );
    } catch {
      throw new AuditIntegrityError();
    }

    try {
      const metadata = await handle.stat();
      const expectedUid = typeof process.getuid === 'function' ? process.getuid() : metadata.uid;
      if (
        !metadata.isFile()
        || metadata.nlink !== 1
        || (metadata.mode & 0o777) !== 0o600
        || metadata.uid !== expectedUid
        || metadata.size > MAX_AUDIT_BYTES
      ) {
        throw new AuditIntegrityError();
      }
      const bytes = await handle.readFile();
      const entries = parseLedger(bytes.toString('utf8'));
      const ledger = new AuditLedger(handle, entries, options.now ?? (() => new Date()), bytes, path, metadata);
      await ledger.verifyStorage();
      return ledger;
    } catch (error) {
      await handle.close().catch(() => undefined);
      if (error instanceof AuditIntegrityError) throw error;
      throw new AuditIntegrityError();
    }
  }

  public async append(draft: AuditDraft): Promise<AuditEntry> {
    return this.#enqueueAppend(null, draft);
  }

  public async appendOnce(dedupeKey: string, draft: AuditDraft): Promise<AuditEntry> {
    this.assertHealthy();
    if (!dedupeKey || dedupeKey.length > 256) throw new AuditIntegrityError('Invalid audit dedupe key');
    const parsedDraft = AuditDraftSchema.parse(draft);
    const existing = this.#dedupe.get(dedupeKey);
    if (existing) {
      if (!sameDraft(existing, parsedDraft)) {
        throw new AuditIntegrityError('Audit dedupe key reused with different event');
      }
      return existing;
    }
    return this.#enqueueAppend(dedupeKey, parsedDraft);
  }

  public findRunByClientRequest(actor: string, clientRequestId: string): AuditRunRecord | null {
    this.assertHealthy();
    return this.#runsByClient.get(runClientKey(actor, clientRequestId)) ?? null;
  }

  public findRunByPublicId(actor: string, publicRunId: string): AuditRunRecord | null {
    this.assertHealthy();
    return this.#runsByPublic.get(runPublicKey(actor, publicRunId)) ?? null;
  }

  public activeRunsForSession(sessionId: string): AuditRunRecord[] {
    this.assertHealthy();
    const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
    return [...this.#runsByPublic.values()].filter((record) => (
      record.sessionId === sessionId
      && !terminal.has(record.status)
    ));
  }

  public assertHealthy(): void {
    if (!this.#healthy || this.#closed) throw new AuditIntegrityError();
  }

  public async verifyStorage(): Promise<void> {
    this.assertHealthy();
    const operation = this.#writeQueue.then(async () => {
      this.assertHealthy();
      await this.#verifyPersistedBytes();
    });
    this.#writeQueue = operation.catch(() => { this.#healthy = false; });
    return operation;
  }

  async #verifyPersistedBytes(): Promise<void> {
    try {
      await validateParentDirectory(dirname(this.#path));
      const check = async () => {
        const [current, named] = await Promise.all([this.#handle.stat(), lstat(this.#path)]);
        for (const metadata of [current, named]) {
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.dev !== this.#identity.dev
            || metadata.ino !== this.#identity.ino || metadata.size !== this.#expectedSize
            || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600
            || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) throw new AuditIntegrityError();
        }
      };
      await check();
      // Positional reads do not share the append descriptor's current offset.
      const bytes = Buffer.alloc(this.#expectedSize);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await this.#handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new AuditIntegrityError();
        offset += bytesRead;
      }
      if (!bytes.equals(this.#expectedBytes)) throw new AuditIntegrityError();
      await check();
    } catch { throw new AuditIntegrityError('Audit file changed outside the ledger'); }
  }

  public async fileMetadata(): Promise<Readonly<{ mode: number; size: number }>> {
    this.assertHealthy();
    const metadata = await this.#handle.stat();
    return { mode: metadata.mode & 0o777, size: metadata.size };
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    await this.#writeQueue.catch(() => undefined);
    this.#closed = true;
    await this.#handle.close();
  }

  async #enqueueAppend(dedupeKey: string | null, draft: AuditDraft): Promise<AuditEntry> {
    const parsedDraft = AuditDraftSchema.parse(draft);
    this.assertHealthy();
    const operation = this.#writeQueue.then(async () => {
      this.assertHealthy();
      if (dedupeKey) {
        const existing = this.#dedupe.get(dedupeKey);
        if (existing) {
          if (!sameDraft(existing, parsedDraft)) {
            throw new AuditIntegrityError('Audit dedupe key reused with different event');
          }
          return existing;
        }
      }

      this.#validateMapping(parsedDraft);
      const previous = this.#entries.at(-1);
      const unhashed = {
        schemaVersion: 1 as const,
        sequence: (previous?.sequence ?? 0) + 1,
        timestamp: this.#now().toISOString(),
        dedupeKey,
        ...parsedDraft,
        previousHash: previous?.hash ?? ZERO_HASH,
      };
      const entry = AuditEntrySchema.parse({
        ...unhashed,
        hash: sha256(canonicalJson(unhashed)),
      });
      const line = `${JSON.stringify(entry)}\n`;
      await this.#verifyPersistedBytes();
      if (this.#expectedSize + Buffer.byteLength(line) > MAX_AUDIT_BYTES) {
        throw new AuditIntegrityError('Audit ledger size limit reached');
      }
      await this.#handle.appendFile(line, { encoding: 'utf8' });
      await this.#handle.sync();
      this.#expectedBytes = Buffer.concat([this.#expectedBytes, Buffer.from(line)]);
      this.#expectedSize = this.#expectedBytes.length;
      this.#entries.push(entry);
      if (entry.dedupeKey) this.#dedupe.set(entry.dedupeKey, entry);
      this.#indexEntry(entry);
      return entry;
    });
    this.#writeQueue = operation.catch(() => {
      this.#healthy = false;
    });
    return operation;
  }

  #rebuildIndexes(): void {
    for (const entry of this.#entries) {
      if (entry.dedupeKey) {
        if (this.#dedupe.has(entry.dedupeKey)) {
          throw new AuditIntegrityError('Duplicate audit dedupe key');
        }
        this.#dedupe.set(entry.dedupeKey, entry);
      }
      this.#validateMapping(entry);
      this.#indexEntry(entry);
    }
  }

  #validateMapping(entry: z.infer<typeof AuditDraftSchema>): void {
    if (entry.action === 'run.requested' || entry.action === 'run.started') {
      if (!entry.publicRunId || !entry.clientRequestId || !entry.requestFingerprint || !entry.status
        || (entry.action === 'run.started' && !entry.upstreamRunId)) throw new AuditIntegrityError();
    }
    for (const record of this.#runsByPublic.values()) {
      if ((entry.actor === record.actor && entry.clientRequestId === record.clientRequestId)
        || entry.publicRunId === record.publicRunId
        || (entry.upstreamRunId && entry.upstreamRunId === record.upstreamRunId)) {
        if (entry.actor !== record.actor || entry.sessionId !== record.sessionId
          || entry.publicRunId !== record.publicRunId || entry.clientRequestId !== record.clientRequestId
          || entry.requestFingerprint !== record.requestFingerprint
          || (record.upstreamRunId && entry.upstreamRunId !== record.upstreamRunId)) {
          throw new AuditIntegrityError('Conflicting audit run mapping');
        }
      }
    }
  }

  #indexEntry(entry: AuditEntry): void {
    if (
      (entry.action === 'run.requested' || entry.action === 'run.started')
      && entry.publicRunId
      && entry.clientRequestId
      && entry.requestFingerprint
      && entry.status
    ) {
      if (entry.action === 'run.started' && !entry.upstreamRunId) {
        throw new AuditIntegrityError('Started run is missing upstream identity');
      }
      const record: AuditRunRecord = Object.freeze({
        actor: entry.actor,
        sessionId: entry.sessionId,
        publicRunId: entry.publicRunId,
        clientRequestId: entry.clientRequestId,
        upstreamRunId: entry.upstreamRunId,
        requestFingerprint: entry.requestFingerprint,
        status: entry.status,
        requestedAt: this.#runsByPublic.get(runPublicKey(entry.actor, entry.publicRunId))?.requestedAt ?? entry.timestamp,
      });
      this.#runsByClient.set(runClientKey(entry.actor, entry.clientRequestId), record);
      this.#runsByPublic.set(runPublicKey(entry.actor, entry.publicRunId), record);
      return;
    }

    if (entry.publicRunId && entry.status) {
      const key = runPublicKey(entry.actor, entry.publicRunId);
      const existing = this.#runsByPublic.get(key);
      if (existing) {
        const updated = Object.freeze({ ...existing, status: entry.status });
        this.#runsByPublic.set(key, updated);
        this.#runsByClient.set(runClientKey(existing.actor, existing.clientRequestId), updated);
      }
    }
  }
}

function parseLedger(text: string): AuditEntry[] {
  if (!text) return [];
  if (!text.endsWith('\n')) throw new AuditIntegrityError('Audit ledger has a partial final record');
  const lines = text.slice(0, -1).split('\n');
  const entries: AuditEntry[] = [];
  let previousHash = ZERO_HASH;

  for (const [index, line] of lines.entries()) {
    if (!line || Buffer.byteLength(line) > 65_536) throw new AuditIntegrityError();
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new AuditIntegrityError();
    }
    const entry = AuditEntrySchema.parse(parsed);
    const { hash, ...unhashed } = entry;
    if (
      entry.sequence !== index + 1
      || entry.previousHash !== previousHash
      || hash !== sha256(canonicalJson(unhashed))
    ) {
      throw new AuditIntegrityError();
    }
    entries.push(entry);
    previousHash = hash;
  }
  return entries;
}

async function validateParentDirectory(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : metadata.uid;
    if (
      !metadata.isDirectory()
      || metadata.isSymbolicLink()
      || (metadata.mode & 0o022) !== 0
      || (metadata.uid !== currentUid && metadata.uid !== 0)
    ) {
      throw new AuditIntegrityError('Unsafe audit parent directory');
    }
  } catch (error) {
    if (error instanceof AuditIntegrityError) throw error;
    throw new AuditIntegrityError('Audit parent directory is unavailable');
  }
}

function sameDraft(entry: AuditEntry, draft: z.infer<typeof AuditDraftSchema>): boolean {
  return canonicalJson(projectDraft(entry)) === canonicalJson(draft);
}

function projectDraft(entry: AuditEntry): z.infer<typeof AuditDraftSchema> {
  return {
    action: entry.action,
    actor: entry.actor,
    sessionId: entry.sessionId,
    publicRunId: entry.publicRunId,
    clientRequestId: entry.clientRequestId,
    upstreamRunId: entry.upstreamRunId,
    requestId: entry.requestId,
    requestFingerprint: entry.requestFingerprint,
    outcome: entry.outcome,
    status: entry.status,
    choice: entry.choice,
  };
}

function runClientKey(actor: string, clientRequestId: string): string {
  return `${actor}\0${clientRequestId}`;
}

function runPublicKey(actor: string, publicRunId: string): string {
  return `${actor}\0${publicRunId}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
