import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LiveRunStatus, ProjectRoom } from '@jarvis-command/contracts';
import type { ActorSubject, createLiveRoomService } from './live-room-service';
import type { AppConfig } from './config';

/**
 * Scheduled runs: the delivery path for Hermes cron jobs and reminders into Command.
 *
 * A cron script on the Hermes host POSTs a prompt with its own bearer key. Command admits it as an
 * ordinary run in the target project's chat, as the configured owner, so the result appears in
 * chat history and the existing inbox and reply-push paths announce it. The script's `id` is the
 * run's client request ID, so a retried POST replays the same run instead of starting another.
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

const TERMINAL = new Set<LiveRunStatus['status']>(['completed', 'failed', 'cancelled', 'interrupted']);

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
  /** Status poll cadence and limit for the server-side watcher that drives notifications. */
  pollMs?: number;
  watchMs?: number;
  log?: (fields: Readonly<Record<string, string | number>>) => void;
}>;

export function createScheduledRunsServer(options: ScheduledRunsOptions): FastifyInstance {
  const owner: ActorSubject = Object.freeze({ actor: options.config.ownerActor });
  const pollMs = options.pollMs ?? 5_000;
  const watchMs = options.watchMs ?? 30 * 60_000;
  // Never logs the key, prompt, label, identity or output: route, status and error type only.
  const log = options.log ?? (fields => console.info(JSON.stringify({ event: 'scheduled-run', ...fields })));
  const watching = new Set<string>();
  const timers = new Set<NodeJS.Timeout>();
  let closed = false;

  // Polling status is what records the terminal audit and fires the inbox entry and reply push,
  // because no browser may be watching when a scheduled run finishes.
  const watch = (publicRunId: string) => {
    if (watching.has(publicRunId) || watching.size >= 64) return;
    watching.add(publicRunId);
    const deadline = Date.now() + watchMs;
    const tick = async () => {
      if (closed) return;
      let done = Date.now() >= deadline;
      try {
        const status = await options.liveRoom()?.getRun(owner, publicRunId);
        if (status && TERMINAL.has(status.status)) done = true;
      } catch { /* transient: keep polling until the deadline */ }
      if (done || closed) { watching.delete(publicRunId); return; }
      const timer = setTimeout(() => { timers.delete(timer); void tick(); }, pollMs);
      timers.add(timer);
    };
    const timer = setTimeout(() => { timers.delete(timer); void tick(); }, pollMs);
    timers.add(timer);
  };

  const app = Fastify({ logger: false, bodyLimit: 32_768 });
  app.addHook('onClose', async () => {
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });
  app.addHook('onRequest', async (request, reply) => {
    if (!keyMatches(request.headers.authorization, options.config.key)) {
      log({ route: request.routeOptions.url ?? 'unknown', status: 401 });
      return reply.code(401).header('cache-control', 'no-store').send({ error: 'unauthorized' });
    }
  });

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
      if (!TERMINAL.has(result.status)) watch(result.publicRunId);
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

  return app;
}
