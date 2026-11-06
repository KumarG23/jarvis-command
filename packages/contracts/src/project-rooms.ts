import { z } from 'zod';
import { SessionIdSchema } from './contracts';
export const ProjectRoomIdSchema = z.string().regex(/^room_[a-f0-9]{32}$/);
export const CommandSessionIdSchema = z.string().regex(/^jc_[a-f0-9]{32}$/);
const reference = z.string().max(512).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
export const ProjectRoomCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  goal: z.string().trim().min(1).max(2000),
  instructions: z.string().max(4000).optional(),
  archived: z.boolean().optional(),
  repository: reference,
  notes: z.array(reference.min(1)).max(12),
}).strict();
// Command metadata only. createdAt records when Command first tracked this thread,
// not a claim about the upstream session's creation time.
export const ProjectThreadSchema = z.object({
  sessionId: SessionIdSchema,
  title: z.string().trim().min(1).max(120).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)),
  createdAt: z.iso.datetime(),
  archived: z.boolean(),
}).strict();
export const ProjectThreadUpdateSchema = z.object({
  title: ProjectThreadSchema.shape.title.optional(),
  archived: z.boolean().optional(),
  designateLead: z.literal(true).optional(),
}).strict().refine(value => Object.keys(value).length > 0);
export const ProjectRoomSchema = ProjectRoomCreateSchema.extend({
  id: ProjectRoomIdSchema,
  sessionIds: z.array(SessionIdSchema).max(100),
  lastSessionId: SessionIdSchema.nullable(),
  leadSessionId: CommandSessionIdSchema.nullable().optional(),
  threads: z.array(ProjectThreadSchema).max(100).optional(),
}).strict().refine(room => new Set(room.sessionIds).size === room.sessionIds.length && (room.lastSessionId === null || room.sessionIds.includes(room.lastSessionId))
  && new Set(room.threads?.map(thread => thread.sessionId)).size === (room.threads?.length ?? 0)
  && (room.threads ?? []).every(thread => room.sessionIds.includes(thread.sessionId))
  && (!room.leadSessionId || (room.sessionIds.includes(room.leadSessionId)
    && room.threads?.some(thread => thread.sessionId === room.leadSessionId && !thread.archived))));
export const ProjectRoomsSchema = z.object({ version: z.literal(1), rooms: z.array(ProjectRoomSchema).max(100), deletedRoomIds: z.array(ProjectRoomIdSchema).optional() }).strict()
  .refine(store => new Set(store.rooms.map(room => room.id)).size === store.rooms.length
    && new Set(store.deletedRoomIds ?? []).size === (store.deletedRoomIds?.length ?? 0)
    && !store.rooms.some(room => store.deletedRoomIds?.includes(room.id)));
export type ProjectRoom = z.infer<typeof ProjectRoomSchema>;
export type ProjectRoomCreate = z.infer<typeof ProjectRoomCreateSchema>;

export const ProjectDeletePreviewSchema = z.object({
  roomId: ProjectRoomIdSchema, name: z.string(), chats: z.number().int().nonnegative(),
  artifacts: z.number().int().nonnegative().nullable(), availabilityReason: z.string().optional(), token: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(), contentsAvailable: z.literal(false), reason: z.string(),
}).strict();
export const ProjectDeleteRequestSchema = z.object({ roomId: ProjectRoomIdSchema, mode: z.literal('project-only'), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
