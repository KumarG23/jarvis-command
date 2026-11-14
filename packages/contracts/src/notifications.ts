import { z } from 'zod';
import { PushStateSchema } from './push';
import { LiveRunStateSchema, OpaqueIdentifierSchema, SessionIdSchema, SessionSummarySchema } from './contracts';

// Private in-app inbox (MASTER_PLAN P6, first slice). Text is generic by design: no prompt,
// output, command or approval detail is stored in a notification.
// Run-state categories: the only ones the run-state notifier, preferences and sender know.
export const NotificationCategorySchema = z.enum(['run-completed', 'run-failed', 'approval']);
// Rollback reader bridge (#99): a later writer may persist one assistant-reply item. Items of this
// category are readable and preserved here but are never created, toggled or pushed by this code.
// 'delivery': a scheduled message (Hermes cron/reminder) delivered into a chat; not a run.
export const NotificationItemCategorySchema = z.enum([...NotificationCategorySchema.options, 'assistant-reply', 'delivery']);
export const DeliveryIdSchema = z.string().regex(/^dlv_[a-f0-9]{32}$/);
export const NotificationIdSchema = z.string().regex(/^ntf_[a-f0-9]{32}$/);
const IsoTimestampSchema = z.iso.datetime({ offset: true });

export const NotificationReplySchema = z.object({
  // Durable ids from the verified session history pair; never a raw upstream run id.
  messageId: OpaqueIdentifierSchema,
  // Executed model label, or null when the executed identity is not known.
  label: z.string().min(1).max(80).nullable(),
}).strict();

export const NotificationItemSchema = z.object({
  id: NotificationIdSchema,
  category: NotificationItemCategorySchema,
  // When this server first observed the event; not Hermes' completion time.
  observedAt: IsoTimestampSchema,
  sessionId: SessionIdSchema,
  // Absent only for a delivery, which is not a run.
  publicRunId: z.string().regex(/^jcr_[a-f0-9]{32}$/).optional(),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(160),
  readAt: IsoTimestampSchema.nullable(),
  reply: NotificationReplySchema.optional(),
  delivery: z.object({ deliveryId: DeliveryIdSchema }).strict().optional(),
}).strict().refine(item => (item.category === 'assistant-reply') === (item.reply !== undefined)
  && (item.category === 'delivery') === (item.delivery !== undefined)
  && (item.category === 'delivery') === (item.publicRunId === undefined));

export const NotificationPreferencesSchema = z.object({
  categories: z.object({
    'run-completed': z.boolean(),
    'run-failed': z.boolean(),
    approval: z.boolean(),
  }).strict(),
  // "Show reply text in notifications". Absent means the owner default (on). Optional so a store
  // written before or after this field exists stays readable and the field survives edits.
  showReplyText: z.boolean().optional(),
}).strict();

export const NotificationInboxSchema = z.object({
  version: z.literal(1),
  items: z.array(NotificationItemSchema).max(100),
  unreadCount: z.number().int().min(0).max(100),
  preferences: NotificationPreferencesSchema,
  push: PushStateSchema.optional(),
  // Static capability statement so the UI never implies delivery that does not exist.
  delivery: z.object({
    inApp: z.enum(['available', 'incomplete']),
    approvals: z.enum(['available', 'unavailable']).optional(),
    push: z.enum(['available', 'unavailable']),
    externalSurfaces: z.literal('unavailable'),
    // Reply alerts: off by server control, unsupported without an exact final-message binding, or live.
    replies: z.enum(['disabled', 'unsupported', 'available']).optional(),
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
    // Run fields are absent for a delivery target, which only opens its chat.
    publicRunId: z.string().regex(/^jcr_[a-f0-9]{32}$/).optional(),
    // Exact reply to focus for an assistant-reply item; absent for run-state items.
    messageId: OpaqueIdentifierSchema.optional(),
    deliveryId: DeliveryIdSchema.optional(),
    clientRequestId: z.uuid().optional(),
    runStatus: LiveRunStateSchema.optional(),
    approvalPending: z.boolean(),
    session: SessionSummarySchema,
    inbox: NotificationInboxSchema,
  }).strict(),
  z.object({ state: z.literal('missing') }).strict(),
  z.object({ state: z.literal('unavailable') }).strict(),
]);

export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;
export type NotificationItemCategory = z.infer<typeof NotificationItemCategorySchema>;
export type NotificationReply = z.infer<typeof NotificationReplySchema>;
export type NotificationItem = z.infer<typeof NotificationItemSchema>;
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export type NotificationInbox = z.infer<typeof NotificationInboxSchema>;
export type NotificationReconcileResponse = z.infer<typeof NotificationReconcileResponseSchema>;
export type NotificationReadRequest = z.infer<typeof NotificationReadRequestSchema>;
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;

// A scheduled message delivered into a chat by Hermes (cron result or reminder), stored by Command.
export const ScheduledDeliverySchema = z.object({
  deliveryId: DeliveryIdSchema,
  sessionId: SessionIdSchema,
  kind: z.enum(['cron', 'reminder']),
  title: z.string().min(1).max(80).nullable(),
  content: z.string().min(1).max(16_000),
  deliveredAt: IsoTimestampSchema,
}).strict();
export const ScheduledDeliveriesResponseSchema = z.object({
  sessionId: SessionIdSchema,
  deliveries: z.array(ScheduledDeliverySchema).max(200),
}).strict();
export type ScheduledDelivery = z.infer<typeof ScheduledDeliverySchema>;
