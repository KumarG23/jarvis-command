import { LiveRunRequestLookupSchema, ProjectRoomIdSchema } from '@jarvis-command/contracts';

import { appStorageKey } from './appEnvironment';

export const recoveryKey = appStorageKey('jarvis-command:live-turn');
const RecoverySchema = LiveRunRequestLookupSchema.extend({ projectId: ProjectRoomIdSchema.optional() }).strict();
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
    && left.clientRequestId === right.clientRequestId && left.publicRunId === right.publicRunId && left.projectId === right.projectId;
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


// V2 imports the singleton once without removing or rewriting its bytes. All
// records are validated before any writer is allowed, including other sessions.
export const threadRecoveryKey = appStorageKey('jarvis-command:live-threads:v2');
type ThreadRecords = { version: 2; records: RecoveryIdentity[]; legacyImported: boolean };
function threadRecords(): ThreadRecords {
  const raw = sessionStorage.getItem(threadRecoveryKey);
  if (raw === null) {
    const legacy = readRecovery();
    return { version: 2, records: legacy ? [legacy] : [], legacyImported: false };
  }
  if (raw.length > 40_000) throw new Error('thread recovery invalid');
  const data = JSON.parse(raw) as ThreadRecords;
  if (data.version !== 2 || data.legacyImported !== true || !Array.isArray(data.records) || data.records.length > 32) throw new Error('thread recovery invalid');
  const records = data.records.map(record => RecoverySchema.parse(record));
  if (new Set(records.map(record => record.sessionId)).size !== records.length) throw new Error('duplicate thread recovery');
  return { version: 2, records, legacyImported: true };
}
export function readThreadRecoveries() { return threadRecords().records; }
export function readThreadRecovery(sessionId: string) { return readThreadRecoveries().find(record => record.sessionId === sessionId) ?? null; }
export function writeThreadRecovery(sessionId: string, value: RecoveryIdentity | null, expected: RecoveryIdentity | null) {
  const state = threadRecords();
  const record = value === null ? null : RecoverySchema.parse(value);
  if (record && record.sessionId !== sessionId) throw new Error('thread binding');
  if (!sameRecovery(state.records.find(item => item.sessionId === sessionId) ?? null, expected)) throw new Error('thread recovery changed');
  const records = state.records.filter(item => item.sessionId !== sessionId);
  if (record) records.push(record);
  if (records.length > 32) throw new Error('thread recovery capacity');
  sessionStorage.setItem(threadRecoveryKey, JSON.stringify({ version: 2, records, legacyImported: true }));
  if (!sameRecovery(readThreadRecovery(sessionId), record)) throw new Error('thread recovery write unverified');
}
