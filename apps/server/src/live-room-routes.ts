import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { ProjectRoomCreateSchema, ProjectRoomIdSchema, CommandSessionIdSchema } from '@jarvis-command/contracts';
import { ProjectRoomStore, RoomStorageError } from './project-room-store';
import { z } from 'zod';
import { LiveRoomSessionCreateRequestSchema, LiveRunSubmissionRequestSchema, LiveRoomSessionContinueRequestSchema, LiveRunApprovalRequestSchema, LiveRunSteerRequestSchema, RunEventSchema, type RunEvent } from '@jarvis-command/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from './config';
import type { createLiveRoomService } from './live-room-service';

export type LiveStreamLimits = Readonly<{ maxStreams?: number; lifetimeMs?: number; keepaliveMs?: number; maximumBytes?: number }>;

type Dependencies = Readonly<{
  config: AppConfig;
  verifyAccess: (assertion: string | undefined) => Promise<{ subject: string }>;
  liveRoom?: ReturnType<typeof createLiveRoomService> | undefined;
  checkLiveRoom?: () => Promise<void>;
  liveStreamLimits?: LiveStreamLimits;
}>;

const sessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/);
const runParamsSchema = z.object({ publicRunId: z.string().regex(/^jcr_[a-f0-9]{32}$/) }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw Object.assign(new Error('Invalid request'), { statusCode: 400 });
  return result.data;
}

async function* encodeEventStream(events: AsyncIterable<RunEvent>, controller: AbortController, keepaliveMs: number) {
  const iterator = events[Symbol.asyncIterator]();
  const next = () => iterator.next().then(
    (value) => ({ kind: 'event' as const, value }),
    (error: unknown) => ({ kind: 'error' as const, error }),
  );
  let pending = next();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const aborted = new Promise<{ kind: 'abort' }>((resolve) => { stop = () => resolve({ kind: 'abort' }); });
  controller.signal.addEventListener('abort', stop, { once: true });
  try {
    yield ': connected\n\n';
    while (!controller.signal.aborted) {
      const heartbeat = new Promise<{ kind: 'heartbeat' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'heartbeat' }), keepaliveMs);
        timer.unref();
      });
      const result = await Promise.race([pending, heartbeat, aborted]);
      clearTimeout(timer);
      if (result.kind === 'abort') break;
      if (result.kind === 'error') throw result.error;
      if (result.kind === 'heartbeat') { yield ': keepalive\n\n'; continue; }
      if (result.value.done) break;
      const event = RunEventSchema.parse(result.value.value);
      yield `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      pending = next();
    }
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', stop);
    // Transport cancellation releases a pending next(); don't make shutdown wait on an uncooperative iterator.
    void iterator.return?.().catch(() => undefined);
  }
}

export function registerLiveRoomRoutes(app: FastifyInstance, dependencies: Dependencies) {
  const rooms = dependencies.config.command ? new ProjectRoomStore(dirname(dependencies.config.command.auditLogPath)) : undefined;
  app.register(async (routes) => {
    const subjects = new WeakMap<FastifyRequest, string>();
    const activeStreams = new Set<AbortController>();
    routes.addHook('preClose', async () => { for (const controller of activeStreams) controller.abort(); });
    const rates = new Map<string, { reset: number; count: number }>();
    routes.addHook('onRequest', async (request, reply) => {
      try {
        const assertion = request.headers['cf-access-jwt-assertion'];
        const identity = await dependencies.verifyAccess(typeof assertion === 'string' ? assertion : undefined);
        subjects.set(request, identity.subject);
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      if (request.method === 'POST') {
        if (request.headers.origin !== dependencies.config.command?.publicOrigin
          || request.headers['x-jarvis-command'] !== '1') {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
          return reply.code(415).send({ error: 'json_required' });
        }
      }
      const now = Date.now();
      for (const [key, rate] of rates) if (rate.reset <= now) rates.delete(key);
      const key = `${subjects.get(request)}:${request.method === 'POST' ? 'write' : 'read'}`;
      const rate = rates.get(key) ?? { reset: now + 60_000, count: 0 };
      if (rate.count >= (request.method === 'POST' ? 30 : 240) || (!rates.has(key) && rates.size >= 2048)) {
        return reply.header('retry-after', '60').code(429).send({ error: 'rate_limited' });
      }
      rate.count++;
      rates.set(key, rate);
      if (!dependencies.config.command || !dependencies.liveRoom) {
        return reply.code(503).send({ error: 'live_room_unavailable' });
      }
      if (request.routeOptions.url !== '/api/sessions/:sessionId/messages') parse(z.object({}).strict(), request.query);
      if (request.method === 'POST') {
        try { await dependencies.checkLiveRoom?.(); } catch {
          return reply.code(503).send({ error: 'live_room_unavailable' });
        }
      }
    });
    routes.get('/api/rooms', { exposeHeadRoute: false }, async () => {
      if (!rooms) throw new RoomStorageError();
      return { version: 1, rooms: await rooms.list() };
    });
    routes.post('/api/rooms', { bodyLimit: 16_384 }, async (request) => {
      const metadata = parse(ProjectRoomCreateSchema, request.body);
      if (!rooms) throw new RoomStorageError();
      const room = { ...metadata, id: `room_${randomBytes(16).toString('hex')}`, sessionIds: [], lastSessionId: null };
      await rooms.update(previous => [...previous, room]);
      return { room };
    });
    routes.post('/api/rooms/:roomId', { bodyLimit: 16_384 }, async (request) => {
      const { roomId } = parse(z.object({ roomId: ProjectRoomIdSchema }).strict(), request.params);
      // Full metadata replacement uses the same strict fields/limits as creation.
      const metadata = parse(ProjectRoomCreateSchema, request.body);
      if (!rooms) throw new RoomStorageError();
      const updated = await rooms.update(previous => {
        if (!previous.some(room => room.id === roomId)) throw Object.assign(new Error('Room missing'), { statusCode: 404 });
        // Merge inside the existing serialized transaction, never a stale list snapshot.
        return previous.map(room => room.id === roomId ? { ...room, ...metadata } : room);
      });
      return { room: updated.find(room => room.id === roomId)! };
    });
    routes.get('/api/live/sessions/:sessionId', { exposeHeadRoute: false }, async (request) => {
      const { sessionId } = parse(z.object({ sessionId: CommandSessionIdSchema }).strict(), request.params);
      return dependencies.liveRoom!.getSession(subjects.get(request)!, sessionId);
    });
    routes.post('/api/rooms/:roomId/sessions', { bodyLimit: 1024 }, async (request) => {
      const { roomId } = parse(z.object({ roomId: ProjectRoomIdSchema }).strict(), request.params);
      const { sessionId } = parse(z.object({ sessionId: CommandSessionIdSchema }).strict(), request.body);
      if (!rooms) throw new RoomStorageError();
      if (!(await rooms.list()).some(room => room.id === roomId)) throw Object.assign(new Error('Room missing'), { statusCode: 404 });
      const { session } = await dependencies.liveRoom!.getSession(subjects.get(request)!, sessionId);
      if (session.id !== sessionId || session.ownership !== 'command' || !['api_server', 'jarvis-command'].includes(session.source)) throw new RoomStorageError();
      const updated = await rooms.update(previous => previous.map(room => room.id !== roomId ? room : { ...room, sessionIds: [...new Set([...room.sessionIds, sessionId])], lastSessionId: sessionId }));
      return { room: updated.find(room => room.id === roomId)!, session };
    });
    routes.get('/api/sessions/:sessionId/messages', { exposeHeadRoute: false }, async (request) => {
      const { sessionId } = parse(z.object({ sessionId: sessionIdSchema }).strict(), request.params);
      const { limit, offset } = parse(z.object({
        limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(50),
        offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(1_000_000)).default(0),
      }).strict(), request.query);
      return dependencies.liveRoom!.getMessages(subjects.get(request)!, sessionId, limit, offset);
    });
    routes.post('/api/live/runs', async (request) => dependencies.liveRoom!.submitRun(
      subjects.get(request)!, parse(LiveRunSubmissionRequestSchema, request.body),
    ));
    routes.get('/api/live/runs/:publicRunId', { exposeHeadRoute: false }, async (request) => dependencies.liveRoom!.getRun(
      subjects.get(request)!, parse(runParamsSchema, request.params).publicRunId,
    ));
    routes.post('/api/live/sessions/:sessionId/continue', async (request) => dependencies.liveRoom!.continueSession(
      subjects.get(request)!, parse(z.object({ sessionId: sessionIdSchema }).strict(), request.params).sessionId,
      parse(LiveRoomSessionContinueRequestSchema, request.body),
    ));
    routes.post('/api/live/runs/:publicRunId/approval', async (request) => dependencies.liveRoom!.approveRun(
      subjects.get(request)!, parse(runParamsSchema, request.params).publicRunId,
      parse(LiveRunApprovalRequestSchema, request.body),
    ));
    routes.post('/api/live/runs/:publicRunId/steer', async (request) => dependencies.liveRoom!.steerRun(
      subjects.get(request)!, parse(runParamsSchema, request.params).publicRunId,
      parse(LiveRunSteerRequestSchema, request.body),
    ));
    routes.post('/api/live/runs/:publicRunId/stop', async (request) => {
      parse(z.object({}).strict(), request.body);
      return dependencies.liveRoom!.stopRun(subjects.get(request)!, parse(runParamsSchema, request.params).publicRunId);
    });
    routes.get('/api/live/runs/:publicRunId/events', { exposeHeadRoute: false }, async (request, reply) => {
      const publicRunId = parse(runParamsSchema, request.params).publicRunId;
      const subject = subjects.get(request)!;
      if (activeStreams.size >= (dependencies.liveStreamLimits?.maxStreams ?? 4)) {
        return reply.code(429).send({ error: 'stream_limit' });
      }
      const controller = new AbortController();
      activeStreams.add(controller);
      let stream: Readable | undefined = undefined;
      let cancelPreflight!: () => void;
      const cancelled = new Promise<void>(resolve => { cancelPreflight = resolve; });
      const timeout = setTimeout(() => controller.abort(), dependencies.liveStreamLimits?.lifetimeMs ?? 1_800_000);
      timeout.unref();
      const onClose = () => controller.abort();
      const cleanup = () => {
        activeStreams.delete(controller);
        clearTimeout(timeout);
        reply.raw.off('close', onClose);
        controller.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        cancelPreflight();
        stream?.destroy();
        // A disconnected reply cannot finish through Fastify's normal thenable path.
        reply.hijack();
        reply.raw.destroy();
      };
      reply.raw.once('close', onClose);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (reply.raw.destroyed || request.raw.aborted) controller.abort();
      if (controller.signal.aborted) return;
      try {
        // The client bounds its network request; cancellation also releases this handler
        // immediately, even if an upstream implementation ignores cancellation.
        await Promise.race([dependencies.liveRoom!.getRun(subject, publicRunId), cancelled]);
      } catch (error) {
        if (controller.signal.aborted) return;
        cleanup();
        controller.abort();
        throw error;
      }
      if (controller.signal.aborted) return;
      // SSE has an independent hard lifetime; the normal 10s idle limit precedes its heartbeat.
      reply.raw.socket?.setTimeout?.(0);
      stream = Readable.from((async function* () {
        let bytes = 0;
        const maximumBytes = dependencies.liveStreamLimits?.maximumBytes ?? 33_554_432;
        try {
          for await (const frame of encodeEventStream(dependencies.liveRoom!.streamRunEvents(subject, publicRunId, controller.signal), controller, dependencies.liveStreamLimits?.keepaliveMs ?? 15_000)) {
            const size = Buffer.byteLength(frame);
            if (bytes + size > maximumBytes) throw new Error('Stream limit');
            bytes += size;
            yield frame;
          }
        } catch {
          const errorFrame = 'event: error\ndata: {"error":"stream_unavailable"}\n\n';
          if (!controller.signal.aborted && bytes + Buffer.byteLength(errorFrame) <= maximumBytes) yield errorFrame;
        } finally {
          // Normal completion must flush buffered terminal output, not destroy it.
          cleanup();
          controller.abort();
        }
      })(), { objectMode: false, highWaterMark: 16_384 });
      return reply.type('text/event-stream; charset=utf-8').header('x-accel-buffering', 'no').send(stream);
    });
    routes.post('/api/live/sessions', async (request) => {
      const parsed = LiveRoomSessionCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) throw Object.assign(new Error('Invalid request'), { statusCode: 400 });
      return dependencies.liveRoom!.createSession(subjects.get(request)!, parsed.data);
    });
  });
}
