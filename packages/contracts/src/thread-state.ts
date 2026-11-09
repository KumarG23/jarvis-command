import { z } from 'zod';
import { CommandSessionIdSchema } from './project-rooms';
import { OpaqueIdentifierSchema } from './contracts';
export const ThreadReadRequestSchema = z.object({ messageId: OpaqueIdentifierSchema, position: z.number().int().min(0).max(999) }).strict();
export const ThreadStateSchema = z.object({
  sessionId: CommandSessionIdSchema,
  observedAt: z.iso.datetime(),
  runStatus: z.enum(['unknown', 'idle', 'queued', 'running', 'waiting-approval', 'completed', 'failed', 'cancelled', 'interrupted']),
  recentAt: z.iso.datetime({ offset: true }).nullable(),
  runObservedAt: z.iso.datetime().nullable(),
  latest: ThreadReadRequestSchema.nullable(),
  lastRead: ThreadReadRequestSchema.nullable(),
  unread: z.boolean().nullable(),
  historyComplete: z.boolean(),
}).strict();
export type ThreadState = z.infer<typeof ThreadStateSchema>;
export type ThreadReadRequest = z.infer<typeof ThreadReadRequestSchema>;
