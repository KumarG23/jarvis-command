import { z } from 'zod';
import { SessionIdSchema } from './contracts';
import { ProjectRoomSchema } from './project-rooms';

export const PROJECT_ROSTER_LIMIT = 4;
export const ProjectRosterStatusSchema = z.enum(['running', 'waiting-approval', 'queued', 'completed', 'failed', 'cancelled', 'idle', 'unknown']);
export const ProjectRosterItemSchema = z.object({
  sessionId: SessionIdSchema,
  title: z.string().max(120).nullable(),
  archived: z.boolean().nullable(),
  lead: z.boolean(),
  status: ProjectRosterStatusSchema,
  statusObservedAt: z.iso.datetime().nullable(),
  runUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  messagesObservedAt: z.iso.datetime().nullable(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant', 'system', 'tool']), text: z.string().max(240), truncated: z.boolean() }).strict()).max(2),
  messagesTruncated: z.boolean(),
  messagesUnavailable: z.boolean(),
}).strict();
export const ProjectRosterSchema = z.object({
  project: ProjectRoomSchema,
  observedAt: z.iso.datetime(),
  limit: z.literal(PROJECT_ROSTER_LIMIT),
  total: z.number().int().min(0).max(100),
  omitted: z.number().int().min(0).max(100),
  partial: z.boolean(),
  items: z.array(ProjectRosterItemSchema).max(PROJECT_ROSTER_LIMIT),
}).strict().refine(value => value.total === value.project.sessionIds.length && value.omitted === value.total - value.items.length
  && new Set(value.items.map(item => item.sessionId)).size === value.items.length
  && value.items.every(item => value.project.sessionIds.includes(item.sessionId) && item.lead === (item.sessionId === value.project.leadSessionId)));
export type ProjectRoster = z.infer<typeof ProjectRosterSchema>;
export type ProjectRosterItem = z.infer<typeof ProjectRosterItemSchema>;
// lastSessionId is navigation history, not send context. All other saved fields
// (including membership, lead and local thread facts) require explicit review.
export function projectSendSnapshot(room: z.infer<typeof ProjectRoomSchema>): string {
  return JSON.stringify({ ...ProjectRoomSchema.parse(room), lastSessionId: null });
}
