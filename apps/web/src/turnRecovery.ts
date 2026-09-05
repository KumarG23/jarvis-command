import { LiveRunSubmissionResponseSchema } from '@jarvis-command/contracts';

export const recoveryKey = 'jarvis-command:live-turn';
const RecoverySchema = LiveRunSubmissionResponseSchema.pick({ sessionId: true, clientRequestId: true, publicRunId: true })
  .extend({ publicRunId: LiveRunSubmissionResponseSchema.shape.publicRunId.nullable() }).strict();
export type RecoveryIdentity = ReturnType<typeof RecoverySchema.parse>;
export function readRecovery(): RecoveryIdentity | null {
  const raw = sessionStorage.getItem(recoveryKey);
  if (raw === null) return null;
  // Bounded before JSON parsing; valid identity records fit comfortably in this limit.
  if (raw.length > 1024) throw new Error('recovery record invalid');
  return RecoverySchema.parse(JSON.parse(raw));
}
export function sameRecovery(left: RecoveryIdentity | null, right: RecoveryIdentity | null) {
  return left === null || right === null ? left === right : left.sessionId === right.sessionId
    && left.clientRequestId === right.clientRequestId && left.publicRunId === right.publicRunId;
}
export function writeRecovery(value: RecoveryIdentity, expected: RecoveryIdentity | null) {
  const record = RecoverySchema.parse(value);
  if (!sameRecovery(readRecovery(), expected)) throw new Error('recovery changed');
  sessionStorage.setItem(recoveryKey, JSON.stringify(record));
  if (!sameRecovery(readRecovery(), record)) throw new Error('recovery write unverified');
}
export function clearRecovery(expected: RecoveryIdentity) {
  if (!sameRecovery(readRecovery(), expected)) throw new Error('recovery changed');
  sessionStorage.removeItem(recoveryKey);
  if (readRecovery() !== null) throw new Error('recovery clear unverified');
}
