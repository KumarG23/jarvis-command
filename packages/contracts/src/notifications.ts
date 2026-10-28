import { z } from 'zod';
import { LiveRunStateSchema, SessionIdSchema, SessionSummarySchema } from './contracts';

// Private in-app inbox (MASTER_PLAN P6, first slice). Text is generic by design: no prompt,
// output, command or approval detail is stored in a notification.
export const NotificationCategorySchema = z.enum(['run-completed', 'run-failed', 'approval']);
export const NotificationIdSchema = z.string().regex(/^ntf_[a-f0-9]{32}$/);
const IsoTimestampSchema = z.iso.datetime({ offset: true });

export const NotificationItemSchema = z.object({
  id: NotificationIdSchema,
  category: NotificationCategorySchema,
  // When this server first observed the event; not Hermes' completion time.
  observedAt: IsoTimestampSchema,
  sessionId: SessionIdSchema,
  publicRunId: z.string().regex(/^jcr_[a-f0-9]{32}$/),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(160),
  readAt: IsoTimestampSchema.nullable(),
}).strict();

export const NotificationPreferencesSchema = z.object({
  categories: z.object({
    'run-completed': z.boolean(),
    'run-failed': z.boolean(),
    approval: z.boolean(),
  }).strict(),
}).strict();

export const NotificationInboxSchema = z.object({
  version: z.literal(1),
  items: z.array(NotificationItemSchema).max(100),
  unreadCount: z.number().int().min(0).max(100),
  preferences: NotificationPreferencesSchema,
  // Static capability statement so the UI never implies delivery that does not exist.
  delivery: z.object({
    inApp: z.enum(['available', 'incomplete']),
    approvals: z.enum(['available', 'unavailable']).optional(),
    push: z.literal('unavailable'),
    externalSurfaces: z.literal('unavailable'),
  }).strict(),
}).strict();

export const NotificationReconcileResponseSchema = z.object({
  inbox: NotificationInboxSchema,
  checked: z.number().int().min(0).max(20),
  unavailable: z.number().int().min(0).max(20),
}).strict();

export const NotificationReadRequestSchema = z.union([
  z.object({ ids: z.array(NotificationIdSchema).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export const NotificationTargetSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('available'),
    sessionId: SessionIdSchema,
    publicRunId: z.string().regex(/^jcr_[a-f0-9]{32}$/),
    clientRequestId: z.uuid(),
    runStatus: LiveRunStateSchema,
    approvalPending: z.boolean(),
    session: SessionSummarySchema,
    inbox: NotificationInboxSchema,
  }).strict(),
  z.object({ state: z.literal('missing') }).strict(),
  z.object({ state: z.literal('unavailable') }).strict(),
]);

export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;
export type NotificationItem = z.infer<typeof NotificationItemSchema>;
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export type NotificationInbox = z.infer<typeof NotificationInboxSchema>;
export type NotificationReconcileResponse = z.infer<typeof NotificationReconcileResponseSchema>;
export type NotificationReadRequest = z.infer<typeof NotificationReadRequestSchema>;
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
