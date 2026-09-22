import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { KeyedSerialQueue } from './keyed-serial-queue';
import {
  ArtifactIdSchema,
  ArtifactMetadataSchema,
  ArtifactSourceRequestIdSchema,
  ArtifactTypeSchema,
  type ArtifactComment,
  type ArtifactCreateTextRequest,
  type ArtifactCreateVersionRequest,
  type ArtifactMetadata,
  type ArtifactSummary,
  type ArtifactType,
} from '@jarvis-command/contracts';

export class ArtifactStorageError extends Error {
  public constructor(message = 'Artifact storage unavailable') {
    super(message);
    this.name = 'ArtifactStorageError';
  }
}

export class ArtifactConflictError extends Error {
  public readonly statusCode = 409;
  public constructor(message = 'Artifact version conflict') {
    super(message);
    this.name = 'ArtifactConflictError';
  }
}

export class ArtifactDeletedError extends Error {
  public readonly statusCode = 410;
  public constructor(message = 'Artifact source request was deleted') {
    super(message);
    this.name = 'ArtifactDeletedError';
  }
}

export class ArtifactNotFoundError extends Error {
  public readonly statusCode = 404;
  public constructor(message = 'Artifact not found') {
    super(message);
    this.name = 'ArtifactNotFoundError';
  }
}

export type ArtifactStoreOptions = Readonly<{
  root: string;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxArtifacts: number;
  now?: () => Date;
}>;

type CreateBlobInput = Readonly<{
  title: string;
  type: ArtifactType;
  mime: string;
  bytes: Buffer;
  creator: ArtifactMetadata['creator'];
  sessionId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  sourceRequestId?: string | null;
  canonical?: boolean;
  originalFilename?: string | null;
  revisionNote?: string | null;
  feedback?: string | null;
}>;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const TEXT_TYPES = new Set<ArtifactType>(['markdown', 'text', 'report', 'log', 'code', 'diff', 'html', 'svg', 'mermaid']);
const GLOBAL_QUEUE_KEY = '__artifact_global__';
const ActiveSourceRequestIndexSchema = z.object({
  status: z.literal('active').default('active'),
  sourceRequestId: ArtifactSourceRequestIdSchema,
  artifactId: ArtifactIdSchema,
}).strict();
const DeletedSourceRequestIndexSchema = z.object({
  status: z.literal('deleted'),
  sourceRequestId: ArtifactSourceRequestIdSchema,
  artifactId: ArtifactIdSchema,
  deletedAt: z.iso.datetime({ offset: true }),
}).strict();
const SourceRequestIndexSchema = z.union([ActiveSourceRequestIndexSchema, DeletedSourceRequestIndexSchema]);
type SourceRequestIndex = z.infer<typeof SourceRequestIndexSchema>;
type SourceRequestLookup = { status: 'active'; artifact: ArtifactMetadata } | { status: 'deleted' } | null;
const MAX_DIFF_CHARS = 262_144;
const MAX_DIFF_OPERATIONS = 20_000;
const DIFF_TRUNCATION_MARKER = '\n... artifact diff truncated ...';

const DEFAULT_MIME_BY_TYPE: Record<ArtifactType, string> = {
  markdown: 'text/markdown',
  text: 'text/plain',
  report: 'text/plain',
  log: 'text/plain',
  code: 'text/plain',
  diff: 'text/x-diff',
  html: 'text/html',
  svg: 'image/svg+xml',
  mermaid: 'text/plain',
  image: 'application/octet-stream',
  pdf: 'application/pdf',
  file: 'application/octet-stream',
};

export class ArtifactStore {
  readonly #root: string;
  readonly #artifactsRoot: string;
  readonly #sourceRequestsRoot: string;
  readonly #maxFileBytes: number;
  readonly #maxTotalBytes: number;
  readonly #maxArtifacts: number;
  readonly #now: () => Date;
  readonly #queue = new KeyedSerialQueue();
  #ready: Promise<void> | null = null;

  public constructor(options: ArtifactStoreOptions) {
    this.#root = resolve(options.root);
    this.#artifactsRoot = join(this.#root, 'artifacts');
    this.#sourceRequestsRoot = join(this.#root, 'source-requests');
    this.#maxFileBytes = options.maxFileBytes;
    this.#maxTotalBytes = options.maxTotalBytes;
    this.#maxArtifacts = options.maxArtifacts;
    this.#now = options.now ?? (() => new Date());
  }

  public async init(): Promise<void> {
    this.#ready ??= this.#prepare();
    await this.#ready;
  }

  public async list(filters: Readonly<{ sessionId?: string; projectId?: string; type?: ArtifactType; search?: string; limit: number }>): Promise<ArtifactSummary[]> {
    await this.init();
    const ids = (await readdir(this.#artifactsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })).filter(entry => entry.isDirectory() && ArtifactIdSchema.safeParse(entry.name).success).map(entry => entry.name);
    const rows = await Promise.all(ids.map(id => this.readMetadata(id).catch(() => null)));
    const search = filters.search?.trim().toLowerCase();
    return rows
      .filter((artifact): artifact is ArtifactMetadata => artifact !== null)
      .filter(artifact => !filters.sessionId || artifact.sessionId === filters.sessionId)
      .filter(artifact => !filters.projectId || artifact.projectId === filters.projectId)
      .filter(artifact => !filters.type || artifact.type === filters.type)
      .filter(artifact => !search || [
        artifact.title,
        artifact.id,
        artifact.originalFilename ?? '',
        artifact.versions.at(-1)?.revisionNote ?? '',
      ].some(value => value.toLowerCase().includes(search)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, filters.limit)
      .map(toSummary);
  }

  public async createText(request: ArtifactCreateTextRequest, subject: string): Promise<ArtifactMetadata> {
    const type = ArtifactTypeSchema.parse(request.type);
    if (!TEXT_TYPES.has(type)) throw Object.assign(new Error('Unsupported artifact type'), { statusCode: 415 });
    const mime = normalizeMime(request.mime ?? DEFAULT_MIME_BY_TYPE[type], type);
    return this.createBlob({
      title: request.title,
      type,
      mime,
      bytes: Buffer.from(TEXT_ENCODER.encode(request.content)),
      creator: { subject, source: request.source },
      sessionId: request.sessionId ?? null,
      projectId: request.projectId ?? null,
      runId: request.runId ?? null,
      sourceRequestId: request.sourceRequestId ?? null,
      canonical: request.canonical,
      revisionNote: request.revisionNote ?? null,
      feedback: request.feedback ?? null,
    });
  }

  public async createBlob(input: CreateBlobInput): Promise<ArtifactMetadata> {
    await this.init();
    const normalized = validatePayload(input.type, input.mime, input.bytes);
    if (input.bytes.length < 1 || input.bytes.length > this.#maxFileBytes) throw Object.assign(new Error('Artifact file too large'), { statusCode: 413 });
    return this.#queue.run(GLOBAL_QUEUE_KEY, async () => {
      if (input.sourceRequestId) {
        const existing = await this.#findBySourceRequestId(input.sourceRequestId);
        if (existing) return existing;
      }
      await this.#assertCapacity(input.bytes.length, true);
      const id = `art_${randomBytes(16).toString('hex')}`;
      const tempId = `.creating-${id}.${process.pid}.${randomBytes(8).toString('hex')}`;
      const createdAt = this.#now().toISOString();
      const sha256 = hash(input.bytes);
      const metadata: ArtifactMetadata = ArtifactMetadataSchema.parse({
        id,
        title: input.title,
        type: input.type,
        mime: normalized,
        createdAt,
        updatedAt: createdAt,
        creator: input.creator,
        sessionId: input.sessionId ?? null,
        projectId: input.projectId ?? null,
        runId: input.runId ?? null,
        sourceRequestId: input.sourceRequestId ?? null,
        size: input.bytes.length,
        sha256,
        currentVersion: 1,
        canonical: input.canonical ?? false,
        privateMode: 'private',
        originalFilename: input.originalFilename ? safeFilename(input.originalFilename) : null,
        versions: [{
          version: 1,
          parentVersion: null,
          baseVersion: null,
          createdAt,
          creator: input.creator,
          type: input.type,
          mime: normalized,
          size: input.bytes.length,
          sha256,
          revisionNote: input.revisionNote ?? null,
          feedback: input.feedback ?? null,
          originalFilename: input.originalFilename ? safeFilename(input.originalFilename) : null,
        }],
        comments: [],
      });
      const directory = this.#artifactDirectory(id);
      const tempDirectory = join(this.#artifactsRoot, tempId);
      try {
        await mkdir(join(tempDirectory, 'versions'), { recursive: true, mode: 0o700 });
        await writeNewFile(join(tempDirectory, 'versions', '1.blob'), input.bytes);
        await atomicWrite(join(tempDirectory, 'metadata.json'), Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`));
        await rename(tempDirectory, directory);
        if (input.sourceRequestId) await this.#writeSourceRequestIndex(input.sourceRequestId, id);
        await fsyncDirectory(this.#artifactsRoot);
        await this.#readMetadataUnchecked(id, true);
        return metadata;
      } catch (error) {
        await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  public async readMetadata(id: string): Promise<ArtifactMetadata> {
    await this.init();
    return this.#readMetadataFile(ArtifactIdSchema.parse(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new ArtifactNotFoundError();
      throw error;
    });
  }

  async #readMetadataFile(artifactId: string): Promise<ArtifactMetadata> {
    const path = join(this.#artifactDirectory(artifactId), 'metadata.json');
    await assertInside(this.#root, path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 1 || info.size > 2_000_000) throw new ArtifactStorageError();
      const artifact = parseStoredMetadata(JSON.parse(await handle.readFile({ encoding: 'utf8' })));
      if (artifact.id !== artifactId) throw new ArtifactStorageError('Artifact metadata identity mismatch');
      return artifact;
    } finally {
      await handle.close();
    }
  }

  public async readVersionBytes(id: string, version: number): Promise<{ artifact: ArtifactMetadata; bytes: Buffer }> {
    const artifact = await this.readMetadata(id);
    if (!artifact.versions.some(item => item.version === version)) throw Object.assign(new Error('Version missing'), { statusCode: 404 });
    const path = this.#versionPath(artifact.id, version);
    await assertInside(this.#root, path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > this.#maxFileBytes) throw new ArtifactStorageError();
      const bytes = await handle.readFile();
      const selected = artifact.versions.find(item => item.version === version)!;
      if (bytes.length !== selected.size || hash(bytes) !== selected.sha256) throw new ArtifactStorageError('Artifact bytes failed verification');
      return { artifact, bytes };
    } finally {
      await handle.close();
    }
  }

  public async createTextVersion(id: string, request: ArtifactCreateVersionRequest, subject: string): Promise<ArtifactMetadata> {
    const artifactId = ArtifactIdSchema.parse(id);
    return this.#queue.run(artifactId, async () => {
      const artifact = await this.readMetadata(artifactId);
      if (artifact.currentVersion !== request.baseVersion) throw new ArtifactConflictError();
      const type = ArtifactTypeSchema.parse(request.type ?? artifact.type);
      if (!TEXT_TYPES.has(type)) throw Object.assign(new Error('Unsupported artifact type'), { statusCode: 415 });
      const bytes = Buffer.from(TEXT_ENCODER.encode(request.content));
      if (bytes.length < 1 || bytes.length > this.#maxFileBytes) throw Object.assign(new Error('Artifact file too large'), { statusCode: 413 });
      const mime = validatePayload(type, request.mime ?? DEFAULT_MIME_BY_TYPE[type], bytes);
      return this.#queue.run(GLOBAL_QUEUE_KEY, async () => {
        await this.#assertCapacity(bytes.length, false);
        const createdAt = this.#now().toISOString();
        const version = artifact.currentVersion + 1;
        const sha256 = hash(bytes);
        const next: ArtifactMetadata = ArtifactMetadataSchema.parse({
          ...artifact,
          type,
          mime,
          updatedAt: createdAt,
          size: bytes.length,
          sha256,
          currentVersion: version,
          versions: [...artifact.versions, {
            version,
            parentVersion: artifact.currentVersion,
            baseVersion: request.baseVersion,
            createdAt,
            creator: { subject, source: 'revision' },
            type,
            mime,
            size: bytes.length,
            sha256,
            revisionNote: request.revisionNote ?? null,
            feedback: request.feedback ?? null,
            originalFilename: artifact.originalFilename,
          }],
        });
        const versionPath = this.#versionPath(artifact.id, version);
        await writeNewFile(versionPath, bytes);
        try {
          await this.#writeMetadata(next);
        } catch (error) {
          await rm(versionPath, { force: true }).catch(() => undefined);
          await fsyncDirectory(resolve(versionPath, '..')).catch(() => undefined);
          throw error;
        }
        return next;
      });
    });
  }

  public async setCanonical(id: string, canonical: boolean, currentVersion: number): Promise<ArtifactMetadata> {
    const artifactId = ArtifactIdSchema.parse(id);
    return this.#queue.run(artifactId, async () => {
      const artifact = await this.readMetadata(artifactId);
      if (artifact.currentVersion !== currentVersion) throw new ArtifactConflictError('Artifact changed');
      const next = ArtifactMetadataSchema.parse({ ...artifact, canonical, updatedAt: this.#now().toISOString() });
      await this.#writeMetadata(next);
      return next;
    });
  }

  public async addComment(id: string, version: number | null | undefined, body: string, subject: string): Promise<ArtifactMetadata> {
    const artifactId = ArtifactIdSchema.parse(id);
    return this.#queue.run(artifactId, async () => {
      const artifact = await this.readMetadata(artifactId);
      const target = version ?? null;
      if (target !== null && !artifact.versions.some(item => item.version === target)) throw Object.assign(new Error('Version missing'), { statusCode: 404 });
      const comment: ArtifactComment = {
        id: `comment_${randomBytes(12).toString('hex')}`,
        artifactId: artifact.id,
        version: target,
        body,
        createdAt: this.#now().toISOString(),
        creator: subject,
      };
      const next = ArtifactMetadataSchema.parse({ ...artifact, updatedAt: comment.createdAt, comments: [...artifact.comments, comment] });
      await this.#writeMetadata(next);
      return next;
    });
  }

  public async delete(id: string, currentVersion: number): Promise<void> {
    const artifactId = ArtifactIdSchema.parse(id);
    await this.#queue.run(artifactId, async () => {
      const artifact = await this.readMetadata(artifactId);
      if (artifact.currentVersion !== currentVersion) throw new ArtifactConflictError('Artifact changed');
      const directory = this.#artifactDirectory(artifact.id);
      const before = await lstat(directory);
      if (!before.isDirectory()) throw new ArtifactStorageError();
      const trash = join(this.#artifactsRoot, `.deleting-${artifact.id}.${process.pid}.${randomBytes(8).toString('hex')}`);
      const latest = await lstat(directory);
      if (before.dev !== latest.dev || before.ino !== latest.ino || !latest.isDirectory()) throw new ArtifactStorageError('Artifact changed during delete');
      await rename(directory, trash);
      await fsyncDirectory(this.#artifactsRoot);
      if (artifact.sourceRequestId) await this.#writeSourceRequestTombstone(artifact.sourceRequestId, artifact.id);
      await rm(trash, { recursive: true, force: false });
      await fsyncDirectory(this.#artifactsRoot);
    });
  }

  public async compareText(id: string, from: number, to: number): Promise<string> {
    const left = await this.readText(id, from);
    const right = await this.readText(id, to);
    return unifiedDiff(left, right);
  }

  public async compareTextVersions(id: string, from: number, to: number): Promise<{ diff: string; fromType: ArtifactType; toType: ArtifactType }> {
    const artifact = await this.readMetadata(id);
    const fromVersion = artifact.versions.find(item => item.version === from);
    const toVersion = artifact.versions.find(item => item.version === to);
    if (!fromVersion || !toVersion) throw Object.assign(new Error('Version missing'), { statusCode: 404 });
    return {
      diff: unifiedDiff(await this.readText(id, from), await this.readText(id, to)),
      fromType: versionType(artifact, fromVersion),
      toType: versionType(artifact, toVersion),
    };
  }

  public async readText(id: string, version: number): Promise<string> {
    const { artifact, bytes } = await this.readVersionBytes(id, version);
    const selected = artifact.versions.find(item => item.version === version)!;
    if (!TEXT_TYPES.has(versionType(artifact, selected)) || bytes.length > 1_048_576) throw Object.assign(new Error('Text unavailable'), { statusCode: 415 });
    return decodeUtf8(bytes);
  }

  public async readiness(): Promise<{ artifacts: 'pass' | 'fail'; initialized: boolean }> {
    try {
      await this.init();
      const entries = await readdir(this.#artifactsRoot, { withFileTypes: true });
      if (entries.length > this.#maxArtifacts + 64) throw new ArtifactStorageError('Artifact root entry limit exceeded');
      return { artifacts: 'pass', initialized: true };
    } catch {
      return { artifacts: 'fail', initialized: false };
    }
  }

  async #prepare(): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const rootStats = await lstat(this.#root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new ArtifactStorageError();
    const rootReal = await realpath(this.#root);
    if (rootReal !== this.#root) throw new ArtifactStorageError('Artifact root must not be a symlink');
    await mkdir(this.#artifactsRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.#sourceRequestsRoot, { recursive: true, mode: 0o700 });
    for (const directory of [this.#artifactsRoot, this.#sourceRequestsRoot]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ArtifactStorageError('Artifact storage directory is unsafe');
    }
    await this.#cleanupIncompleteDirectories();
    await this.#cleanupOrphanVersionFiles();
    await this.#reconcileSourceRequestIndexes();
  }

  async #assertCapacity(additionalBytes: number, countNewArtifact: boolean): Promise<void> {
    const ids = (await readdir(this.#artifactsRoot, { withFileTypes: true }).catch(() => []))
      .filter(entry => entry.isDirectory() && ArtifactIdSchema.safeParse(entry.name).success);
    if (countNewArtifact && ids.length >= this.#maxArtifacts) throw Object.assign(new Error('Artifact limit reached'), { statusCode: 413 });
    let total = 0;
    for (const entry of ids) {
      const metadata = await this.#readMetadataUnchecked(entry.name, true);
      total += metadata.versions.reduce((sum, version) => sum + version.size, 0);
      if (total + additionalBytes > this.#maxTotalBytes) throw Object.assign(new Error('Artifact storage limit reached'), { statusCode: 413 });
    }
  }

  async #readMetadataUnchecked(id: string, verifyBytes: boolean): Promise<ArtifactMetadata> {
    const metadata = await this.#readMetadataFile(ArtifactIdSchema.parse(id));
    if (verifyBytes) {
      for (const version of metadata.versions) {
        const path = this.#versionPath(metadata.id, version.version);
        await assertInside(this.#root, path);
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size !== version.size || info.size > this.#maxFileBytes) throw new ArtifactStorageError();
          const bytes = await handle.readFile();
          if (hash(bytes) !== version.sha256) throw new ArtifactStorageError();
        } finally {
          await handle.close();
        }
      }
    }
    return metadata;
  }

  async #cleanupIncompleteDirectories(): Promise<void> {
    const entries = await readdir(this.#artifactsRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter(entry => entry.isDirectory() && /^\.creating-art_[a-f0-9]{32}\./.test(entry.name))
      .map(entry => rm(join(this.#artifactsRoot, entry.name), { recursive: true, force: true }).catch(() => undefined)));
  }

  async #cleanupOrphanVersionFiles(): Promise<void> {
    const entries = await readdir(this.#artifactsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !ArtifactIdSchema.safeParse(entry.name).success) continue;
      let metadata: ArtifactMetadata;
      try {
        metadata = await this.#readMetadataUnchecked(entry.name, true);
      } catch {
        // Preserve damaged artifacts for recovery. Capacity checks remain fail-closed.
        continue;
      }
      const retained = new Set(metadata.versions.map(version => `${version.version}.blob`));
      const versionsDirectory = join(this.#artifactDirectory(entry.name), 'versions');
      const versions = await readdir(versionsDirectory, { withFileTypes: true }).catch(() => []);
      for (const version of versions) {
        if (!version.isFile() || !/^\d+\.blob$/.test(version.name) || retained.has(version.name)) continue;
        await rm(join(versionsDirectory, version.name), { force: true });
      }
      await fsyncDirectory(versionsDirectory);
    }
  }

  async #findBySourceRequestId(sourceRequestId: string): Promise<ArtifactMetadata | null> {
    const requestId = ArtifactSourceRequestIdSchema.parse(sourceRequestId);
    const indexed = await this.#readSourceRequestIndex(requestId);
    if (indexed?.status === 'deleted') throw new ArtifactDeletedError();
    if (indexed?.status === 'active') return indexed.artifact;
    const entries = await readdir(this.#artifactsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !ArtifactIdSchema.safeParse(entry.name).success) continue;
      const metadata = await this.#readMetadataFile(entry.name).catch(() => null);
      if (metadata?.sourceRequestId === requestId) {
        await this.#writeSourceRequestIndex(requestId, metadata.id);
        return metadata;
      }
    }
    return null;
  }

  async #readSourceRequestIndex(sourceRequestId: string): Promise<SourceRequestLookup> {
    const path = this.#sourceRequestPath(sourceRequestId);
    await assertInside(this.#root, path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!handle) return null;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 1 || info.size > 512) throw new ArtifactStorageError();
      const parsed = SourceRequestIndexSchema.parse(JSON.parse(await handle.readFile({ encoding: 'utf8' })));
      if (parsed.sourceRequestId !== sourceRequestId) throw new ArtifactStorageError('Source request index mismatch');
      if (parsed.status === 'deleted') return { status: 'deleted' };
      const metadata = await this.#readMetadataFile(parsed.artifactId).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!metadata) {
        await this.#writeSourceRequestTombstone(parsed.sourceRequestId, parsed.artifactId);
        return { status: 'deleted' };
      }
      if (metadata.sourceRequestId !== sourceRequestId) throw new ArtifactStorageError('Source request artifact mismatch');
      return { status: 'active', artifact: metadata };
    } finally {
      await handle.close();
    }
  }

  async #writeSourceRequestIndex(sourceRequestId: string, artifactId: string): Promise<void> {
    const requestId = ArtifactSourceRequestIdSchema.parse(sourceRequestId);
    const id = ArtifactIdSchema.parse(artifactId);
    const path = this.#sourceRequestPath(requestId);
    await assertInside(this.#root, path);
    await atomicWrite(path, Buffer.from(`${JSON.stringify({ status: 'active', sourceRequestId: requestId, artifactId: id })}\n`));
  }

  async #writeSourceRequestTombstone(sourceRequestId: string, artifactId: string): Promise<void> {
    const requestId = ArtifactSourceRequestIdSchema.parse(sourceRequestId);
    const id = ArtifactIdSchema.parse(artifactId);
    const path = this.#sourceRequestPath(requestId);
    await assertInside(this.#root, path);
    await atomicWrite(path, Buffer.from(`${JSON.stringify({
      status: 'deleted',
      sourceRequestId: requestId,
      artifactId: id,
      deletedAt: this.#now().toISOString(),
    })}\n`));
  }

  async #reconcileSourceRequestIndexes(): Promise<void> {
    const entries = await readdir(this.#sourceRequestsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const path = join(this.#sourceRequestsRoot, entry.name);
      await assertInside(this.#root, path);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size < 1 || info.size > 512) throw new ArtifactStorageError();
        const parsed: SourceRequestIndex = SourceRequestIndexSchema.parse(JSON.parse(await handle.readFile({ encoding: 'utf8' })));
        if (parsed.status === 'deleted') continue;
        const metadata = await this.#readMetadataFile(parsed.artifactId).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!metadata) await this.#writeSourceRequestTombstone(parsed.sourceRequestId, parsed.artifactId);
      } finally {
        await handle.close();
      }
    }
  }

  #artifactDirectory(id: string): string {
    return join(this.#artifactsRoot, ArtifactIdSchema.parse(id));
  }

  #versionPath(id: string, version: number): string {
    return join(this.#artifactDirectory(id), 'versions', `${version}.blob`);
  }

  #sourceRequestPath(sourceRequestId: string): string {
    return join(this.#sourceRequestsRoot, `${ArtifactSourceRequestIdSchema.parse(sourceRequestId)}.json`);
  }

  async #writeMetadata(metadata: ArtifactMetadata): Promise<void> {
    const path = join(this.#artifactDirectory(metadata.id), 'metadata.json');
    await assertInside(this.#root, path);
    await atomicWrite(path, Buffer.from(`${JSON.stringify(ArtifactMetadataSchema.parse(metadata), null, 2)}\n`));
  }
}

export function inferArtifactType(mime: string, filename: string | null): ArtifactType {
  const lowerName = filename?.toLowerCase() ?? '';
  const lowerMime = mime.toLowerCase();
  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (lowerMime === 'image/svg+xml' || lowerName.endsWith('.svg')) return 'svg';
  if (lowerMime.startsWith('image/')) return 'image';
  if (lowerMime === 'text/html' || lowerName.endsWith('.html') || lowerName.endsWith('.htm')) return 'html';
  if (lowerMime === 'text/markdown' || lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'markdown';
  if (lowerMime === 'text/x-diff' || lowerName.endsWith('.diff') || lowerName.endsWith('.patch')) return 'diff';
  if (lowerName.endsWith('.mmd') || lowerName.endsWith('.mermaid')) return 'mermaid';
  if (lowerName.endsWith('.log')) return 'log';
  if (lowerMime.startsWith('text/')) return 'text';
  return 'file';
}

export function normalizeMime(mime: string, type: ArtifactType): string {
  const value = mime.split(';')[0]!.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\+[a-z0-9][a-z0-9!#$&^_.+-]*)?$/.test(value)) {
    throw Object.assign(new Error('Unsupported MIME type'), { statusCode: 415 });
  }
  if (type === 'image' && !/^image\/(?:png|jpeg|gif|webp|avif)$/.test(value)) throw Object.assign(new Error('Unsupported image MIME type'), { statusCode: 415 });
  if (type === 'pdf' && value !== 'application/pdf') throw Object.assign(new Error('Unsupported PDF MIME type'), { statusCode: 415 });
  if (type === 'svg' && value !== 'image/svg+xml') throw Object.assign(new Error('Unsupported SVG MIME type'), { statusCode: 415 });
  if (type === 'html' && value !== 'text/html') throw Object.assign(new Error('Unsupported HTML MIME type'), { statusCode: 415 });
  if (type === 'mermaid' && value !== 'text/plain') throw Object.assign(new Error('Unsupported Mermaid MIME type'), { statusCode: 415 });
  if (TEXT_TYPES.has(type) && !['text/plain', 'text/markdown', 'text/html', 'image/svg+xml', 'text/x-diff'].includes(value)) {
    throw Object.assign(new Error('Unsupported text MIME type'), { statusCode: 415 });
  }
  return value;
}

export function safeFilename(value: string): string {
  const candidate = basename(value.trim()).replace(/[^\w .()+,@-]/g, '_').slice(0, 160);
  if (!candidate || candidate === '.' || candidate === '..' || candidate.startsWith('.')) {
    throw Object.assign(new Error('Unsafe filename'), { statusCode: 400 });
  }
  return candidate;
}

function toSummary(artifact: ArtifactMetadata): ArtifactSummary {
  const summary = { ...artifact };
  delete (summary as Partial<ArtifactMetadata>).versions;
  delete (summary as Partial<ArtifactMetadata>).comments;
  return summary;
}

function parseStoredMetadata(value: unknown): ArtifactMetadata {
  const artifact = ArtifactMetadataSchema.parse(value);
  return ArtifactMetadataSchema.parse({
    ...artifact,
    versions: artifact.versions.map(version => ({
      ...version,
      type: version.type ?? artifact.type,
    })),
  });
}

export function versionType(artifact: ArtifactMetadata, version: ArtifactMetadata['versions'][number]): ArtifactType {
  return version.type ?? artifact.type;
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function atomicWrite(path: string, bytes: Buffer): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  await fsyncDirectory(resolve(path, '..'));
}

async function writeNewFile(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsyncDirectory(resolve(path, '..'));
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertInside(root: string, path: string): Promise<void> {
  const target = resolve(path);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new ArtifactStorageError();
}

function unifiedDiff(left: string, right: string): string {
  const a = left.split('\n');
  const b = right.split('\n');
  let output = '';
  let truncated = false;
  const append = (text: string): boolean => {
    if (output.length + text.length <= MAX_DIFF_CHARS) {
      output += text;
      return true;
    }
    const markerBudget = Math.min(DIFF_TRUNCATION_MARKER.length, MAX_DIFF_CHARS - output.length);
    const bodyBudget = Math.max(0, MAX_DIFF_CHARS - output.length - markerBudget);
    if (bodyBudget > 0) output += text.slice(0, bodyBudget);
    if (markerBudget > 0) output += DIFF_TRUNCATION_MARKER.slice(0, markerBudget);
    truncated = true;
    return false;
  };
  const appendLine = (line: string): boolean => append(`${output ? '\n' : ''}${line}`);
  appendLine('--- version A');
  appendLine('+++ version B');
  const max = Math.max(a.length, b.length);
  let operations = 0;
  for (let index = 0; index < max; index += 1) {
    if (operations >= MAX_DIFF_OPERATIONS) {
      append(DIFF_TRUNCATION_MARKER);
      break;
    }
    if (a[index] === b[index]) {
      if (!appendLine(` ${a[index] ?? ''}`)) break;
    } else {
      if (a[index] !== undefined && !appendLine(`-${a[index]}`)) break;
      if (b[index] !== undefined && !appendLine(`+${b[index]}`)) break;
    }
    operations += 1;
  }
  if (truncated && output.length > MAX_DIFF_CHARS) return output.slice(0, MAX_DIFF_CHARS);
  return output;
}

export function validatePayload(type: ArtifactType, mime: string, bytes: Buffer): string {
  const normalized = normalizeMime(mime, type);
  if (TEXT_TYPES.has(type)) {
    const text = decodeUtf8(bytes);
    if (type === 'svg' && !isSvgText(text)) throw Object.assign(new Error('SVG content mismatch'), { statusCode: 415 });
    if (type === 'html' && /^\s*(?:<\?xml|<svg[\s>])/i.test(text)) throw Object.assign(new Error('HTML content mismatch'), { statusCode: 415 });
    return normalized;
  }
  if (type === 'pdf') {
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Object.assign(new Error('PDF content mismatch'), { statusCode: 415 });
    if (hasActivePolyglot(bytes) || hasPdfActiveContent(bytes)) throw Object.assign(new Error('Active content rejected'), { statusCode: 415 });
    return normalized;
  }
  if (type === 'image') {
    if (!matchesImageSignature(normalized, bytes)) throw Object.assign(new Error('Image content mismatch'), { statusCode: 415 });
    if (hasActivePolyglot(bytes)) throw Object.assign(new Error('Active content rejected'), { statusCode: 415 });
    return normalized;
  }
  return 'application/octet-stream';
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return TEXT_DECODER.decode(bytes);
  } catch {
    throw Object.assign(new Error('Text artifact must be valid UTF-8'), { statusCode: 415 });
  }
}

function isSvgText(text: string): boolean {
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text);
}

function matchesImageSignature(mime: string, bytes: Buffer): boolean {
  if (mime === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/gif') return bytes.subarray(0, 6).equals(Buffer.from('GIF87a')) || bytes.subarray(0, 6).equals(Buffer.from('GIF89a'));
  if (mime === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mime === 'image/avif') return bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'));
  return false;
}

function hasActivePolyglot(bytes: Buffer): boolean {
  const text = bytes.toString('latin1').toLowerCase();
  return /<\s*(?:script|html|iframe|object|embed|svg|body|head)\b|<!doctype\s+html|javascript\s*:/.test(text);
}

function hasPdfActiveContent(bytes: Buffer): boolean {
  const text = bytes.toString('latin1').toLowerCase();
  return /\/(?:javascript|js|openaction|aa)\b/.test(text);
}
