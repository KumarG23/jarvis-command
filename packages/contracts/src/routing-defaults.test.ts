import { expect, it } from 'vitest';
import { LiveRunSubmissionRequestSchema, RoutingDefaultSetSchema, RoutingDefaultTargetSchema, FrozenRoutingSchema } from './contracts';
const sessionId = 'jc_' + 'a'.repeat(32), projectId = 'room_' + 'b'.repeat(32);
const inference = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'low' };
const request = { sessionId, input: 'SYNTHETIC', clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e' };
const target = { scope: 'thread', sessionId, projectId };
const set = { target, selection: inference, expectedRevision: 0, clientRequestId: request.clientRequestId };
it('keeps legacy envelopes byte-equivalent and requires explicit defaults mode/context', () => {
  expect(LiveRunSubmissionRequestSchema.parse(request)).toEqual(request);
  expect(LiveRunSubmissionRequestSchema.parse({ ...request, routing: { mode: 'defaults', projectId: null } }).routing).toEqual({ mode: 'defaults', projectId: null });
  for (const routing of [{}, { mode: 'inherit', projectId }, { mode: 'defaults' }, { mode: 'defaults', projectId: 'private' }, { mode: 'defaults', projectId, actor: 'other' }]) expect(LiveRunSubmissionRequestSchema.safeParse({ ...request, routing }).success).toBe(false);
});
it.each([{ target: { ...target, sessionId: 'external' } }, { target: { scope: 'project', projectId, sessionId } }, { actor: 'forged' }, { expectedRevision: -1 }, { expectedRevision: 4097 }, { clientRequestId: 'bad' }, { selection: { provider: 'openrouter', model: 'a/b:free-paid' } }, { selection: { provider: 'openrouter', model: 'a/b:free', reasoningEffort: 'high' } }, { selection: { ...inference, reasoningEffort: 'unknown' } }])('rejects malformed preference %j', delta => {
  expect(RoutingDefaultSetSchema.safeParse({ ...set, ...delta }).success).toBe(false);
});
it('supports nullable clear, explicit global thread and project scope; freezes requested facts only', () => {
  expect(RoutingDefaultSetSchema.parse({ ...set, selection: null }).selection).toBeNull();
  expect(RoutingDefaultTargetSchema.parse({ scope: 'project', projectId })).toEqual({ scope: 'project', projectId });
  expect(RoutingDefaultTargetSchema.parse({ ...target, projectId: null })).toMatchObject({ projectId: null });
  const frozen = { envelopeFingerprint: 'a'.repeat(64), inference, source: 'thread', projectId, threadRevision: 1, projectRevision: 0 };
  expect(FrozenRoutingSchema.parse(frozen)).toEqual(frozen);
  expect(FrozenRoutingSchema.safeParse({ ...frozen, executed: inference }).success).toBe(false);
});
