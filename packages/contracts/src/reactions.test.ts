import { expect, it } from 'vitest';
import { ReactionMutationSchema, ReactionTargetSchema } from './reactions';

const target = { sessionId: `jc_${'a'.repeat(32)}`, messageId: 'opaque:id/42', offset: 100 };
it('requires durable session/message ids and one bounded page hint', () => {
  expect(ReactionTargetSchema.parse(target)).toEqual(target);
  for (const change of [{ messageId: '' }, { messageId: ' leading' }, { messageId: 'x'.repeat(161) }, { offset: 1_000_001 }, { offset: -1 }, { actor: 'forged' }, { sessionId: 'a/b' }]) expect(ReactionTargetSchema.safeParse({ ...target, ...change }).success).toBe(false);
});
it('allows only explicit bounded reaction actions and retry identity, never author attribution', () => {
  const request = { ...target, emoji: '👍', action: 'toggle', clientRequestId: '00000000-0000-4000-8000-000000000001' };
  expect(ReactionMutationSchema.parse(request)).toEqual(request);
  for (const change of [{ emoji: '🚀' }, { emoji: '👍👍' }, { action: 'run' }, { clientRequestId: '' }, { model: 'invented' }]) expect(ReactionMutationSchema.safeParse({ ...request, ...change }).success).toBe(false);
});
