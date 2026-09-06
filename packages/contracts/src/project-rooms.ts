import { z } from 'zod';
export const ProjectRoomIdSchema = z.string().regex(/^room_[a-f0-9]{32}$/);
export const CommandSessionIdSchema = z.string().regex(/^jc_[a-f0-9]{32}$/);
const reference = z.string().max(512).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
export const ProjectRoomCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  goal: z.string().trim().min(1).max(2000),
  repository: reference,
  notes: z.array(reference.min(1)).max(12),
}).strict();
export const ProjectRoomSchema = ProjectRoomCreateSchema.extend({
  id: ProjectRoomIdSchema,
  sessionIds: z.array(CommandSessionIdSchema).max(100),
  lastSessionId: CommandSessionIdSchema.nullable(),
}).strict().refine(room => new Set(room.sessionIds).size === room.sessionIds.length && (room.lastSessionId === null || room.sessionIds.includes(room.lastSessionId)));
export const ProjectRoomsSchema = z.object({ version: z.literal(1), rooms: z.array(ProjectRoomSchema).max(100) }).strict()
  .refine(store => new Set(store.rooms.map(room => room.id)).size === store.rooms.length);
export type ProjectRoom = z.infer<typeof ProjectRoomSchema>;
export type ProjectRoomCreate = z.infer<typeof ProjectRoomCreateSchema>;
