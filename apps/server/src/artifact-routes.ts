import multipart from '@fastify/multipart';
import {
  ArtifactCanonicalRequestSchema,
  ArtifactCommentCreateRequestSchema,
  ArtifactCompareQuerySchema,
  ArtifactCreateTextRequestSchema,
  ArtifactCreateVersionRequestSchema,
  ArtifactDeleteRequestSchema,
  ArtifactCompareResponseSchema,
  ArtifactDeleteResponseSchema,
  ArtifactIdSchema,
  ArtifactListQuerySchema,
  ArtifactListResponseSchema,
  ArtifactMetadataSchema,
  ArtifactMutationResponseSchema,
  ArtifactSourceResponseSchema,
  ArtifactVersionNumberSchema,
  type ArtifactType,
} from '@jarvis-command/contracts';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { dirname } from 'node:path';
import type { AppConfig } from './config';
import { ArtifactStore, inferArtifactType, safeFilename, versionType } from './artifact-store';
import { ProjectRoomStore, RoomStorageError } from './project-room-store';

type Dependencies = Readonly<{
  config: AppConfig;
  verifyAccess: (assertion: string | undefined) => Promise<{ subject: string }>;
  artifactStore?: ArtifactStore | undefined;
}>;

const paramsSchema = z.object({ artifactId: ArtifactIdSchema }).strict();
const versionParamsSchema = z.object({
  artifactId: ArtifactIdSchema,
  version: z.string().regex(/^\d+$/).transform(Number).pipe(ArtifactVersionNumberSchema),
}).strict();

export function registerArtifactRoutes(app: FastifyInstance, dependencies: Dependencies) {
  app.register(multipart, {
    limits: {
      files: 1,
      fileSize: dependencies.config.artifacts.maxFileBytes,
      fields: 12,
      fieldSize: 16_384,
    },
  });
  const store = dependencies.artifactStore ?? (dependencies.config.artifacts.enabled && dependencies.config.artifacts.root
    ? new ArtifactStore({
        root: dependencies.config.artifacts.root,
        maxFileBytes: dependencies.config.artifacts.maxFileBytes,
        maxTotalBytes: dependencies.config.artifacts.maxTotalBytes,
        maxArtifacts: dependencies.config.artifacts.maxArtifacts,
      })
    : null);
  const rooms = dependencies.config.command ? new ProjectRoomStore(dirname(dependencies.config.command.auditLogPath)) : null;
  const requireStore = () => {
    if (!store) throw Object.assign(new Error('Artifact storage unavailable'), { statusCode: 503 });
    return store;
  };

  app.register(async (routes) => {
    const subjects = new WeakMap<FastifyRequest, string>();
    const rates = new Map<string, { reset: number; count: number }>();
    routes.addHook('onRequest', async (request, reply) => {
      try {
        const assertion = request.headers['cf-access-jwt-assertion'];
        const identity = await dependencies.verifyAccess(typeof assertion === 'string' ? assertion : undefined);
        subjects.set(request, identity.subject);
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      if (!store) return reply.code(503).send({ error: 'artifact_storage_unavailable' });
      const mutating = request.method === 'POST' || request.method === 'DELETE';
      if (mutating) {
        if (dependencies.config.command?.publicOrigin && request.headers.origin !== dependencies.config.command.publicOrigin) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (request.headers['x-jarvis-command'] !== '1') return reply.code(403).send({ error: 'forbidden' });
      }
      const now = Date.now();
      for (const [key, rate] of rates) if (rate.reset <= now) rates.delete(key);
      const key = `${subjects.get(request)}:${mutating ? 'write' : 'read'}`;
      const rate = rates.get(key) ?? { reset: now + 60_000, count: 0 };
      if (rate.count >= (mutating ? 30 : 240) || (!rates.has(key) && rates.size >= 2048)) {
        return reply.header('retry-after', '60').code(429).send({ error: 'rate_limited' });
      }
      rate.count++;
      rates.set(key, rate);
    });

    routes.get('/api/artifacts', { exposeHeadRoute: false }, async (request) => {
      const query = ArtifactListQuerySchema.parse(request.query);
      const filters: { sessionId?: string; projectId?: string; type?: ArtifactType; search?: string; limit: number } = { limit: query.limit };
      if (query.sessionId !== undefined) filters.sessionId = query.sessionId;
      if (query.projectId !== undefined) filters.projectId = query.projectId;
      if (query.type !== undefined) filters.type = query.type;
      if (query.search !== undefined) filters.search = query.search;
      return ArtifactListResponseSchema.parse({
        artifacts: await requireStore().list(filters),
      });
    });

    routes.post('/api/artifacts/text', { bodyLimit: 1_100_000 }, async (request) => {
      requireJson(request);
      const body = ArtifactCreateTextRequestSchema.parse(request.body);
      await validateKnownAssociation(rooms, body);
      return ArtifactMutationResponseSchema.parse({
        artifact: await requireStore().createText(body, subjects.get(request)!),
      });
    });

    routes.post('/api/artifacts/upload', async (request) => {
      const file = await request.file();
      if (!file) throw Object.assign(new Error('File required'), { statusCode: 400 });
      const metadata = parseMultipartMetadata(file.fields);
      await validateKnownAssociation(rooms, metadata);
      const filename = file.filename ? safeFilename(file.filename) : null;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of file.file) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > dependencies.config.artifacts.maxFileBytes) throw Object.assign(new Error('Artifact file too large'), { statusCode: 413 });
        chunks.push(buffer);
      }
      const bytes = Buffer.concat(chunks);
      const inferred = inferArtifactType(file.mimetype || 'application/octet-stream', filename);
      return ArtifactMutationResponseSchema.parse({
        artifact: await requireStore().createBlob({
          title: metadata.title || filename || 'Uploaded artifact',
          type: metadata.type ?? inferred,
          mime: metadata.mime || file.mimetype || 'application/octet-stream',
          bytes,
          creator: { subject: subjects.get(request)!, source: 'upload' },
          sessionId: metadata.sessionId ?? null,
          projectId: metadata.projectId ?? null,
          runId: metadata.runId ?? null,
          canonical: metadata.canonical ?? false,
          originalFilename: filename,
          revisionNote: metadata.revisionNote ?? null,
          feedback: metadata.feedback ?? null,
        }),
      });
    });

    routes.get('/api/artifacts/:artifactId', { exposeHeadRoute: false }, async (request) => {
      const { artifactId } = paramsSchema.parse(request.params);
      return ArtifactMetadataSchema.parse(await requireStore().readMetadata(artifactId));
    });

    routes.get('/api/artifacts/:artifactId/versions/:version/source', { exposeHeadRoute: false }, async (request) => {
      const { artifactId, version } = versionParamsSchema.parse(request.params);
      const artifactStore = requireStore();
      const artifact = await artifactStore.readMetadata(artifactId);
      const content = await artifactStore.readText(artifactId, version);
      const selected = artifact.versions.find(item => item.version === version)!;
      return ArtifactSourceResponseSchema.parse({
        artifactId,
        version,
        type: versionType(artifact, selected),
        mime: selected.mime,
        size: selected.size,
        sha256: selected.sha256,
        content,
      });
    });

    routes.get('/api/artifacts/:artifactId/versions/:version/blob', { exposeHeadRoute: false }, async (request, reply) => {
      const { artifactId, version } = versionParamsSchema.parse(request.params);
      const { artifact, bytes } = await requireStore().readVersionBytes(artifactId, version);
      const selected = artifact.versions.find(item => item.version === version)!;
      const selectedType = versionType(artifact, selected);
      const active = selectedType === 'html' || selectedType === 'svg';
      return reply
        .type(active ? 'application/octet-stream' : selected.mime)
        .header('x-artifact-type', selectedType)
        .header('content-length', String(bytes.length))
        .header('content-disposition', contentDisposition(active ? 'attachment' : 'inline', artifact, version))
        .header('content-security-policy', active
          ? "default-src 'none'; sandbox"
          : "default-src 'none'; img-src 'self' blob: data:; media-src 'none'; object-src 'none'; script-src 'none'; frame-ancestors 'none'")
        .header('cross-origin-resource-policy', 'same-origin')
        .header('x-content-type-options', 'nosniff')
        .send(bytes);
    });

    routes.get('/api/artifacts/:artifactId/versions/:version/download', { exposeHeadRoute: false }, async (request, reply) => {
      const { artifactId, version } = versionParamsSchema.parse(request.params);
      const { artifact, bytes } = await requireStore().readVersionBytes(artifactId, version);
      const selected = artifact.versions.find(item => item.version === version)!;
      return reply
        .type(selected.mime)
        .header('x-artifact-type', versionType(artifact, selected))
        .header('content-length', String(bytes.length))
        .header('content-disposition', contentDisposition('attachment', artifact, version))
        .header('x-content-type-options', 'nosniff')
        .send(bytes);
    });

    routes.post('/api/artifacts/:artifactId/versions', { bodyLimit: 1_100_000 }, async (request) => {
      requireJson(request);
      const { artifactId } = paramsSchema.parse(request.params);
      return ArtifactMutationResponseSchema.parse({
        artifact: await requireStore().createTextVersion(artifactId, ArtifactCreateVersionRequestSchema.parse(request.body), subjects.get(request)!),
      });
    });

    routes.get('/api/artifacts/:artifactId/compare', { exposeHeadRoute: false }, async (request) => {
      const { artifactId } = paramsSchema.parse(request.params);
      const query = ArtifactCompareQuerySchema.parse(request.query);
      return ArtifactCompareResponseSchema.parse({ artifactId, from: query.from, to: query.to, ...(await requireStore().compareTextVersions(artifactId, query.from, query.to)) });
    });

    routes.post('/api/artifacts/:artifactId/comments', { bodyLimit: 16_384 }, async (request) => {
      requireJson(request);
      const { artifactId } = paramsSchema.parse(request.params);
      const body = ArtifactCommentCreateRequestSchema.parse(request.body);
      return ArtifactMutationResponseSchema.parse({
        artifact: await requireStore().addComment(artifactId, body.version, body.body, subjects.get(request)!),
      });
    });

    routes.post('/api/artifacts/:artifactId/canonical', { bodyLimit: 1024 }, async (request) => {
      requireJson(request);
      const { artifactId } = paramsSchema.parse(request.params);
      const body = ArtifactCanonicalRequestSchema.parse(request.body);
      return ArtifactMutationResponseSchema.parse({
        artifact: await requireStore().setCanonical(artifactId, body.canonical, body.currentVersion),
      });
    });

    routes.delete('/api/artifacts/:artifactId', { bodyLimit: 1024 }, async (request) => {
      requireJson(request);
      const { artifactId } = paramsSchema.parse(request.params);
      const body = ArtifactDeleteRequestSchema.parse(request.body);
      if (body.confirmArtifactId !== artifactId) throw Object.assign(new Error('Confirmation mismatch'), { statusCode: 400 });
      await requireStore().delete(artifactId, body.currentVersion);
      return ArtifactDeleteResponseSchema.parse({ deleted: true, artifactId });
    });
  });
}

function requireJson(request: FastifyRequest): void {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw Object.assign(new Error('JSON required'), { statusCode: 415 });
  }
}

function parseMultipartMetadata(fields: Record<string, unknown>) {
  const value = fieldValue(fields.metadata);
  const parsed = value ? JSON.parse(value) as unknown : {};
  return z.object({
    title: z.string().trim().max(160).optional(),
    type: z.enum(['markdown', 'text', 'report', 'log', 'code', 'diff', 'html', 'svg', 'mermaid', 'image', 'pdf', 'file']).optional(),
    mime: z.string().trim().max(120).optional(),
    sessionId: z.string().trim().max(160).nullable().optional(),
    projectId: z.string().trim().max(160).nullable().optional(),
    runId: z.string().trim().max(160).nullable().optional(),
    canonical: z.boolean().optional(),
    revisionNote: z.string().max(2_000).nullable().optional(),
    feedback: z.string().max(8_000).nullable().optional(),
  }).strict().parse(parsed);
}

function fieldValue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('value' in value)) return null;
  const field = value as { value?: unknown };
  return typeof field.value === 'string' ? field.value : null;
}

function contentDisposition(disposition: 'inline' | 'attachment', artifact: { id: string; title: string; originalFilename: string | null }, version: number): string {
  const raw = artifact.originalFilename ?? `${artifact.title}-v${version}`;
  const safe = safeFilename(raw).replace(/"/g, '_');
  return `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

async function validateKnownAssociation(
  rooms: ProjectRoomStore | null,
  value: { projectId?: string | null | undefined; sessionId?: string | null | undefined },
): Promise<void> {
  if (!rooms || !value.projectId) return;
  let room;
  try {
    room = (await rooms.list()).find(item => item.id === value.projectId);
  } catch (error) {
    if (error instanceof RoomStorageError) return;
    throw error;
  }
  if (!room) throw Object.assign(new Error('Unknown project'), { statusCode: 400 });
  if (value.sessionId && !room.sessionIds.includes(value.sessionId)) {
    throw Object.assign(new Error('Session is not associated with project'), { statusCode: 400 });
  }
}
