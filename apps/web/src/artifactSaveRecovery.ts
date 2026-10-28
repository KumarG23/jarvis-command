import { ArtifactCreateTextRequestSchema, type ArtifactType } from '@jarvis-command/contracts';
import { appStorageKey } from './appEnvironment';

export const artifactSaveKey = () => appStorageKey('jarvis-command:artifact-save:v1');
// One tab-owned intent. Never evict an unconfirmed save or expire its identity.
export const MAX_SAVE_STORAGE_BYTES = 2_097_152;
export type PendingArtifactSave = {
  key: string;
  sourceRequestId: string;
  sessionId: string | null;
  projectId: string | null;
  runId: string | null;
  title: string;
  artifactType: ArtifactType | null;
  content: string;
};
export type SaveRecovery = { pending: PendingArtifactSave | null; error: string | null };
export const saveRecoveryError = 'Artifact save recovery storage is unavailable or invalid. No new response save will be sent. Keep this tab and its pending work; reconcile the original save before clearing browser storage.';

function validate(raw: string): PendingArtifactSave {
  if (raw.length > MAX_SAVE_STORAGE_BYTES || new TextEncoder().encode(raw).length > MAX_SAVE_STORAGE_BYTES) throw Error('save limit');
  const record = JSON.parse(raw);
  if (record?.version !== 1 || !record.pending || Object.keys(record).length !== 2) throw Error('save record');
  const value = record.pending;
  if (Object.keys(value).sort().join(',') !== 'artifactType,content,key,projectId,runId,sessionId,sourceRequestId,title') throw Error('save fields');
  if (value.key !== value.sourceRequestId || !/^gen_[a-f0-9]{32}$/.test(value.key) || !value.sessionId) throw Error('save identity');
  ArtifactCreateTextRequestSchema.parse({ title: value.title, type: value.artifactType ?? 'markdown', content: value.content,
    sessionId: value.sessionId, projectId: value.projectId, runId: value.runId, sourceRequestId: value.sourceRequestId });
  // Validation must not normalize the original bytes, title or association.
  return value as PendingArtifactSave;
}
export function readArtifactSave(): SaveRecovery {
  try {
    const raw = sessionStorage.getItem(artifactSaveKey());
    return { pending: raw === null ? null : validate(raw), error: null };
  } catch { return { pending: null, error: saveRecoveryError }; }
}
export function persistArtifactSave(pending: PendingArtifactSave) {
  const raw = JSON.stringify({ version: 1, pending });
  validate(raw);
  // Refuse replacement even if a stale callback or another owner tries it.
  const previous = sessionStorage.getItem(artifactSaveKey());
  if (previous !== null && previous !== raw) throw Error('unconfirmed save');
  sessionStorage.setItem(artifactSaveKey(), raw);
  if (sessionStorage.getItem(artifactSaveKey()) !== raw) throw Error('save write unverified');
}
export function consumeArtifactSave(key: string) {
  const raw = sessionStorage.getItem(artifactSaveKey());
  if (raw === null || validate(raw).key !== key) throw Error('save identity');
  sessionStorage.removeItem(artifactSaveKey());
  if (sessionStorage.getItem(artifactSaveKey()) !== null) throw Error('save removal unverified');
}
