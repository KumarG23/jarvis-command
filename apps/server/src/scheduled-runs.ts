import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProjectRoom } from '@jarvis-command/contracts';
import type { ActorSubject, createLiveRoomService } from './live-room-service';
import type { AppConfig } from './config';
import { DELIVERY_KEY, type DeliveryInput } from './delivery-store';
import { inferArtifactType, type ArtifactStore } from './artifact-store';

/**
 * Scheduled runs: the delivery path for Hermes cron jobs and reminders into Command.
 *
 * A cron script on the Hermes host POSTs a prompt with its own bearer key. Command admits it as an
 * ordinary run in the target project's chat, as the configured owner, so the result appears in
 * chat history and the live room's server-side run watcher fires the inbox entry and reply push. The script's `id` is the
 * run's client request ID, so a retried POST replays the same run instead of starting another.
 *
 * It also receives deliveries (`POST /v1/deliveries`): a message Hermes already composed, such as a
 * reminder or a cron job's result, sent by Hermes' `command` platform plugin. Command stores it and
 * shows it in the target chat; it is not a run and Hermes session history is unchanged.
 *
 * Files go both ways with the deliveries key: `POST /v1/files` stores a file Jarvis wants to send
 * and returns Markdown that shows it in a chat, and `GET /v1/files/:artifactId/:version` lets Jarvis
 * fetch a file Neal attached, over the LAN, without Cloudflare Access.
 *
 * This listener is separate from the Access-protected app port and serves only these routes.
 */

type LiveRoom = ReturnType<typeof createLiveRoomService>;
type Rooms = Readonly<{ list(): Promise<ProjectRoom[]> }>;

const SESSION_ID = /^jc_[a-f0-9]{32}$/;
const ROOM_ID = /^room_[a-f0-9]{32}$/;
export const MAX_SCHEDULED_PROMPT = 8_000;

export const ScheduledRunRequestSchema = z.object({
  /** Idempotency key chosen by the caller, e.g. a UUID derived from the job ID and fire time. */
  id: z.uuid(),
  target: z.union([
    z.object({ projectId: z.string().regex(ROOM_ID) }).strict(),
    z.object({ sessionId: z.string().regex(SESSION_ID) }).strict(),
  ]),
  prompt: z.string().trim().min(1).max(MAX_SCHEDULED_PROMPT),
  /** Short name shown in the chat, e.g. "Morning homelab check". */
  label: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/).optional(),
}).strict();
export type ScheduledRunRequest = z.infer<typeof ScheduledRunRequestSchema>;

export const MAX_DELIVERY_CONTENT = 16_000;
export const DeliveryRequestSchema = z.object({
  /** Idempotency key: an occurrence UUID Hermes persists once per fire and reuses on every retry. */
  id: z.string().regex(DELIVERY_KEY),
  chatId: z.union([z.string().regex(SESSION_ID), z.string().regex(ROOM_ID), z.literal('home')]),
  content: z.string().trim().min(1).max(MAX_DELIVERY_CONTENT),
  title: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/).optional(),
  kind: z.enum(['cron', 'reminder']),
}).strict();
export type DeliveryRequest = z.infer<typeof DeliveryRequestSchema>;
export type DeliveryResult = Readonly<{ deliveryId: string; sessionId: string; replayed: boolean }>;

/** The chat a project's scheduled runs land in: its lead chat, else its most recent chat. */
export function projectChat(room: ProjectRoom): string | null {
  return room.leadSessionId ?? room.lastSessionId ?? null;
}

export function scheduledInput(request: Pick<ScheduledRunRequest, 'prompt' | 'label'>): string {
  const heading = request.label ? `Scheduled task: ${request.label}` : 'Scheduled task';
  return `[${heading}]\n\n${request.prompt}`;
}

function keyMatches(header: string | undefined, key: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const actual = createHash('sha256').update(header.slice(7)).digest();
  const expected = createHash('sha256').update(key).digest();
  return timingSafeEqual(actual, expected);
}

export type ScheduledRunsOptions = Readonly<{
  config: NonNullable<AppConfig['scheduledRuns']>;
  liveRoom: () => LiveRoom | undefined;
  rooms: () => Rooms | undefined;
  log?: (fields: Readonly<Record<string, string | number>>) => void;
  /** Stores a delivery, records its inbox entry and pushes it. Absent: deliveries are unavailable. */
  deliver?: (actor: string, input: DeliveryInput) => Promise<DeliveryResult>;
  /** Artifact store for `/v1/files`. Absent: file routes answer 503. */
  artifactStore?: ArtifactStore | null;
  maxFileBytes?: number;
}>;

export const FileUploadQuerySchema = z.object({
  name: z.string().trim().min(1).max(160).regex(/^[^\r\n/\\]+$/),
  /** Optional idempotency key, like a delivery id: the same id returns the same file. */
  id: z.string().regex(DELIVERY_KEY).optional(),
  /** Optional chat or project the file belongs to, so it also lists under that chat's artifacts. */
  chatId: z.union([z.string().regex(SESSION_ID), z.string().regex(ROOM_ID)]).optional(),
  title: z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/).optional(),
}).strict();

const ARTIFACT_ID = /^art_[a-f0-9]{32}$/;

/** Markdown that shows a stored file in a chat: an inline image, or a download card for anything else. */
export function fileMarkdown(artifactId: string, version: number, name: string, type: string): string {
  const label = name.replace(/[[\]\r\n]/g, ' ');
  return type === 'image'
    ? `![${label}](/api/artifacts/${artifactId}/versions/${version}/blob)`
    : `[${label}](/api/artifacts/${artifactId}/versions/${version}/download)`;
}

export function createScheduledRunsServer(options: ScheduledRunsOptions): FastifyInstance {
  const owner: ActorSubject = Object.freeze({ actor: options.config.ownerActor });
  // Never logs the key, prompt, label, identity or output: route, status and error type only.
  const log = options.log ?? (fields => console.info(JSON.stringify({ event: 'scheduled-run', ...fields })));
  // 16 000 characters of content can be up to 64 KB of UTF-8, plus JSON escaping.
  const app = Fastify({ logger: false, bodyLimit: 196_608 });
  // Each key is scoped: the scheduled-runs key serves only the run routes, and the deliveries key
  // serves only POST /v1/deliveries. Without a deliveries key, deliveries refuse every request.
  app.addHook('onRequest', async (request, reply) => {
    const url = request.routeOptions.url ?? '';
    const delivery = url === '/v1/deliveries' || url.startsWith('/v1/files');
    const key = delivery ? options.config.deliveriesKey ?? null : options.config.key;
    if (!key || !keyMatches(request.headers.authorization, key)) {
      log({ route: request.routeOptions.url ?? 'unknown', status: 401 });
      return reply.code(401).header('cache-control', 'no-store').send({ error: 'unauthorized' });
    }
  });

  const maxFileBytes = options.maxFileBytes ?? 52_428_800;
  // Raw bytes for POST /v1/files, text included; JSON routes keep the JSON parser.
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: maxFileBytes }, (_request, body, done) => done(null, body));

  const readRooms = async (): Promise<ProjectRoom[] | null> => {
    const store = options.rooms();
    if (!store) return null;
    return (await store.list()).filter(room => !room.archived);
  };

  app.get('/v1/scheduled-runs/targets', async (_request, reply) => {
    const rooms = await readRooms().catch(() => null);
    if (!rooms) return reply.code(503).header('cache-control', 'no-store').send({ error: 'unavailable' });
    return reply.header('cache-control', 'no-store').send({
      targets: rooms.map(room => ({ projectId: room.id, name: room.name, sessionId: projectChat(room) })),
    });
  });

  app.post('/v1/scheduled-runs', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const parsed = ScheduledRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      log({ route: '/v1/scheduled-runs', status: 400 });
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const body = parsed.data;
    const liveRoom = options.liveRoom();
    const rooms = await readRooms().catch(() => null);
    if (!liveRoom || !rooms) {
      log({ route: '/v1/scheduled-runs', status: 503 });
      return reply.code(503).send({ error: 'unavailable' });
    }
    // Only chats that belong to a visible project: a scheduled run must land where Neal looks.
    const room = 'projectId' in body.target
      ? rooms.find(item => item.id === (body.target as { projectId: string }).projectId)
      : rooms.find(item => item.sessionIds.includes((body.target as { sessionId: string }).sessionId));
    const sessionId = room && ('sessionId' in body.target ? body.target.sessionId : projectChat(room));
    if (!room || !sessionId) {
      log({ route: '/v1/scheduled-runs', status: 404 });
      return reply.code(404).send({ error: room ? 'project_has_no_chat' : 'target_not_found' });
    }
    try {
      const result = await liveRoom.submitRun(owner, {
        sessionId,
        clientRequestId: body.id,
        input: scheduledInput(body),
        routing: { mode: 'defaults', projectId: room.id },
      });
      log({ route: '/v1/scheduled-runs', status: 200, replayed: result.replayed ? 1 : 0 });
      return reply.send({ publicRunId: result.publicRunId, projectId: room.id, sessionId: result.sessionId, status: result.status, replayed: result.replayed });
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
      const status = [409, 422, 503].includes(statusCode) ? statusCode : statusCode === 404 ? 404 : 502;
      const errorType = error instanceof Error ? error.name : 'unknown';
      log({ route: '/v1/scheduled-runs', status, errorType });
      const code = status === 409 ? 'conflict' : status === 422 ? 'routing_refused' : status === 404 ? 'not_found' : 'unavailable';
      return reply.code(status).send({ error: code });
    }
  });

  app.post('/v1/deliveries', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const route = '/v1/deliveries';
    const parsed = DeliveryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      log({ route, status: 400 });
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const body = parsed.data;
    const liveRoom = options.liveRoom();
    const rooms = await readRooms().catch(() => null);
    if (!liveRoom || !rooms || !options.deliver) {
      log({ route, status: 503 });
      return reply.code(503).send({ error: 'unavailable' });
    }
    const target = body.chatId === 'home' ? options.config.home ?? null : body.chatId;
    if (!target) {
      log({ route, status: 404 });
      return reply.code(404).send({ error: 'home_not_set' });
    }
    let sessionId: string | null;
    if (ROOM_ID.test(target)) {
      const room = rooms.find(item => item.id === target);
      if (!room) { log({ route, status: 404 }); return reply.code(404).send({ error: 'target_not_found' }); }
      sessionId = projectChat(room);
      if (!sessionId) { log({ route, status: 404 }); return reply.code(404).send({ error: 'project_has_no_chat' }); }
    } else {
      // A chat in an archived project is refused; a chat outside any project is allowed if it exists.
      const archived = await options.rooms()?.list().then(all => all.some(room => room.archived && room.sessionIds.includes(target))).catch(() => false);
      if (archived) { log({ route, status: 404 }); return reply.code(404).send({ error: 'target_not_found' }); }
      sessionId = target;
    }
    try {
      const { session } = await liveRoom.getSession(owner, sessionId);
      if (session.id !== sessionId) throw Object.assign(new Error('Session mismatch'), { statusCode: 404 });
      const result = await options.deliver(owner.actor, { key: body.id, sessionId, kind: body.kind, title: body.title ?? null, content: body.content });
      log({ route, status: 200, replayed: result.replayed ? 1 : 0 });
      return reply.send(result);
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
      const status = statusCode === 404 ? 404 : statusCode === 409 ? 409 : 503;
      log({ route, status, errorType: error instanceof Error ? error.name : 'unknown' });
      return reply.code(status).send({ error: status === 404 ? 'target_not_found' : status === 409 ? 'conflict' : 'unavailable' });
    }
  });

  app.post('/v1/files', { bodyLimit: maxFileBytes }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const route = '/v1/files';
    const query = FileUploadQuerySchema.safeParse(request.query);
    const bytes = Buffer.isBuffer(request.body) ? request.body : null;
    if (!query.success || !bytes?.length) {
      log({ route, status: 400 });
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const store = options.artifactStore;
    if (!store) { log({ route, status: 503 }); return reply.code(503).send({ error: 'unavailable' }); }
    const { name, id, chatId, title } = query.data;
    const contentType = String(request.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
    const inferred = inferArtifactType(contentType, name);
    // Only images and PDFs that pass their content checks keep their type; anything else is a plain file.
    const type = inferred === 'image' || inferred === 'pdf' ? inferred : 'file';
    const create = (kind: 'image' | 'pdf' | 'file') => store.createBlob({
      title: title ?? name, type: kind, mime: kind === 'file' ? 'application/octet-stream' : contentType, bytes,
      creator: { subject: 'jarvis', source: 'assistant-response' },
      sessionId: chatId && SESSION_ID.test(chatId) ? chatId : null,
      projectId: chatId && ROOM_ID.test(chatId) ? chatId : null,
      sourceRequestId: id ? `gen_${createHash('sha256').update(`file:${id}`).digest('hex').slice(0, 32)}` : null,
      originalFilename: name,
    });
    try {
      const artifact = await create(type).catch(error => {
        if (type !== 'file' && (error as { statusCode?: number }).statusCode === 415) return create('file');
        throw error;
      });
      const version = artifact.currentVersion;
      log({ route, status: 200 });
      return reply.send({
        artifactId: artifact.id, version, type: artifact.type, name, size: artifact.size,
        url: `/api/artifacts/${artifact.id}/versions/${version}/download`,
        markdown: fileMarkdown(artifact.id, version, name, artifact.type),
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown }).statusCode;
      const status = statusCode === 413 ? 413 : statusCode === 400 || statusCode === 415 ? 400 : 503;
      log({ route, status, errorType: error instanceof Error ? error.name : 'unknown' });
      return reply.code(status).send({ error: status === 413 ? 'too_large' : status === 400 ? 'invalid_request' : 'unavailable' });
    }
  });

  app.get('/v1/files/:artifactId/:version', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const route = '/v1/files/:artifactId/:version';
    const params = request.params as { artifactId?: string; version?: string };
    const version = Number(params.version);
    if (!params.artifactId || !ARTIFACT_ID.test(params.artifactId) || !Number.isInteger(version) || version < 1) {
      log({ route, status: 400 });
      return reply.code(400).send({ error: 'invalid_request' });
    }
    if (!options.artifactStore) { log({ route, status: 503 }); return reply.code(503).send({ error: 'unavailable' }); }
    try {
      const { artifact, bytes } = await options.artifactStore.readVersionBytes(params.artifactId, version);
      const selected = artifact.versions.find(item => item.version === version)!;
      log({ route, status: 200 });
      return reply.type(selected.mime).header('content-length', String(bytes.length)).send(bytes);
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode === 404 ? 404 : 503;
      log({ route, status, errorType: error instanceof Error ? error.name : 'unknown' });
      return reply.code(status).send({ error: status === 404 ? 'not_found' : 'unavailable' });
    }
  });

  return app;
}
