import { createHash } from 'node:crypto';
import {
  NotificationIdSchema,
  NotificationInboxSchema,
  NotificationPreferencesSchema,
  NotificationReadRequestSchema,
  NotificationReconcileResponseSchema,
  NotificationTargetSchema,
  type NotificationInbox,
} from '@jarvis-command/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createLiveRoomService } from './live-room-service';
import { NotificationNotFoundError, NotificationStorageError, type ActorView, type NotificationStore } from './notification-store';

const RECONCILE_LIMIT = 10;
const idParams = z.object({ notificationId: NotificationIdSchema }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw Object.assign(new Error('Invalid request'), { statusCode: 400 });
  return result.data;
}

const toInbox = (value: ActorView): NotificationInbox => NotificationInboxSchema.parse({
  version: 1,
  items: value.items,
  unreadCount: value.items.filter(item => item.readAt === null).length,
  preferences: value.preferences,
  delivery: { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' },
});

/**
 * Registered inside the authenticated live-room scope, so Access verification, same-origin
 * mutation checks and rate limits already ran. The actor is derived only from the verified
 * subject; no request field selects an actor, run owner or session.
 */
export function registerNotificationRoutes(
  routes: FastifyInstance,
  dependencies: Readonly<{
    store: NotificationStore | undefined;
    liveRoom: ReturnType<typeof createLiveRoomService>;
    subjects: WeakMap<FastifyRequest, string>;
  }>,
) {
  const store = () => { if (!dependencies.store) throw new NotificationStorageError(); return dependencies.store; };
  const actorOf = (request: FastifyRequest) => createHash('sha256').update(dependencies.subjects.get(request)!).digest('hex');

  routes.get('/api/notifications', { exposeHeadRoute: false }, async request => (
    toInbox(await store().read(actorOf(request)))
  ));

  // Reconciles only this actor's admitted, non-terminal runs through the same supported status
  // read the chat uses. It never admits, approves, steers or stops anything.
  routes.post('/api/notifications/reconcile', { bodyLimit: 64 }, async request => {
    parse(z.object({}).strict(), request.body);
    const subject = dependencies.subjects.get(request)!;
    const runs = dependencies.liveRoom.listUnsettledRuns(subject, RECONCILE_LIMIT);
    const results = await Promise.allSettled(runs.map(publicRunId => dependencies.liveRoom.getRun(subject, publicRunId)));
    return NotificationReconcileResponseSchema.parse({
      inbox: toInbox(await store().read(actorOf(request))),
      checked: runs.length,
      unavailable: results.filter(result => result.status === 'rejected').length,
    });
  });

  routes.post('/api/notifications/read', { bodyLimit: 8192 }, async request => (
    toInbox(await store().markRead(actorOf(request), parse(NotificationReadRequestSchema, request.body)))
  ));

  routes.post('/api/notifications/preferences', { bodyLimit: 512 }, async request => (
    toInbox(await store().setPreferences(actorOf(request), parse(NotificationPreferencesSchema, request.body)))
  ));

  // Re-checks current authorization (actor-bound run, then the session) and reconciles
  // status before the client may navigate. Only an available target marks the item read.
  routes.post('/api/notifications/:notificationId/open', { bodyLimit: 64 }, async request => {
    const { notificationId } = parse(idParams, request.params);
    parse(z.object({}).strict(), request.body);
    const actor = actorOf(request);
    const subject = dependencies.subjects.get(request)!;
    const item = await store().find(actor, notificationId);
    if (!item) throw new NotificationNotFoundError();
    const classify = (error: unknown) => (
      typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404 ? 'missing' as const : 'unavailable' as const
    );
    let status: Awaited<ReturnType<typeof dependencies.liveRoom.getRun>>;
    let identity: ReturnType<typeof dependencies.liveRoom.getRunIdentity>;
    try {
      identity = dependencies.liveRoom.getRunIdentity(subject, item.publicRunId);
      status = await dependencies.liveRoom.getRun(subject, item.publicRunId);
      if (identity.sessionId !== item.sessionId || status.sessionId !== item.sessionId) return { state: 'missing' };
    } catch (error) { return { state: classify(error) }; }
    let session;
    try { session = (await dependencies.liveRoom.getSession(subject, item.sessionId)).session; } catch (error) { return { state: classify(error) }; }
    if (session.id !== item.sessionId) return { state: 'missing' };
    const inbox = toInbox(await store().markRead(actor, { ids: [item.id] }));
    return NotificationTargetSchema.parse({
      state: 'available',
      sessionId: item.sessionId,
      publicRunId: item.publicRunId,
      clientRequestId: identity.clientRequestId,
      runStatus: status.status,
      approvalPending: status.status === 'waiting_for_approval' && status.approval !== null,
      session,
      inbox,
    });
  });
}
