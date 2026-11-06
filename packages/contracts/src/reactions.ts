import { z } from 'zod';
import { OpaqueIdentifierSchema, SessionIdSchema } from './contracts';

export const ReactionEmojiSchema = z.enum(['👍', '👎', '❤️', '🎉', '😄', '😕', '👀']);
// One explicitly supplied page, never a scan. A target absent from it is unavailable.
export const ReactionTargetSchema = z.object({
  sessionId: SessionIdSchema,
  messageId: OpaqueIdentifierSchema,
  offset: z.number().int().min(0).max(1_000_000),
}).strict();
export const ReactionMutationSchema = ReactionTargetSchema.extend({
  emoji: ReactionEmojiSchema,
  action: z.enum(['add', 'remove', 'toggle']),
  clientRequestId: z.uuid(),
}).strict();
export const ReactionViewSchema = ReactionTargetSchema.omit({ offset: true }).extend({
  emojis: z.array(ReactionEmojiSchema).max(7),
}).strict();
export const ReactionMutationResultSchema = ReactionViewSchema.extend({
  active: z.boolean(),
  changed: z.boolean(),
  replayed: z.boolean(),
  clientRequestId: z.uuid(),
}).strict();
export type ReactionTarget = z.infer<typeof ReactionTargetSchema>;
export type ReactionMutation = z.infer<typeof ReactionMutationSchema>;
