import { afterEach, expect, it, vi } from 'vitest';
import { artifactSaveKey, consumeArtifactSave, MAX_SAVE_STORAGE_BYTES, persistArtifactSave, readArtifactSave, type PendingArtifactSave } from './artifactSaveRecovery';

const pending: PendingArtifactSave = { key: 'gen_' + 'a'.repeat(32), sourceRequestId: 'gen_' + 'a'.repeat(32), sessionId: 'jc_original', projectId: 'room_' + 'b'.repeat(32), runId: 'jcr_original', title: 'Original', artifactType: 'code', content: '\n  exact λ bytes\n' };
afterEach(() => vi.restoreAllMocks());
it('round trips exact bytes and association without expiring or replacing an unconfirmed identity', () => {
  persistArtifactSave(pending);
  expect(readArtifactSave()).toEqual({ pending, error: null });
  expect(() => persistArtifactSave({ ...pending, content: 'different' })).toThrow();
  expect(() => consumeArtifactSave('wrong')).toThrow();
  expect(readArtifactSave().pending).toEqual(pending);
  consumeArtifactSave(pending.key);
  expect(sessionStorage.getItem(artifactSaveKey())).toBeNull();
});
it.each(['{', JSON.stringify({ version: 1, pending: { ...pending, artifactType: 'pdf' } }), JSON.stringify({ version: 1, pending: { ...pending, key: 'wrong' } }), 'x'.repeat(MAX_SAVE_STORAGE_BYTES + 1)])('retains invalid recovery and refuses to overwrite it', raw => {
  sessionStorage.setItem(artifactSaveKey(), raw);
  expect(readArtifactSave().error).toBeTruthy();
  expect(() => persistArtifactSave(pending)).toThrow();
  expect(sessionStorage.getItem(artifactSaveKey())).toBe(raw);
});
it('handles unavailable, silently dropped and quota-limited writes without claiming persistence', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('denied'); });
  expect(readArtifactSave().error).toBeTruthy(); read.mockRestore();
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  expect(() => persistArtifactSave(pending)).toThrow();
  write.mockImplementation(() => { throw Error('quota'); });
  expect(() => persistArtifactSave(pending)).toThrow(); write.mockRestore();
  expect(() => persistArtifactSave({ ...pending, content: 'x'.repeat(MAX_SAVE_STORAGE_BYTES) })).toThrow();
});
it('preserves the original intent if confirmed cleanup fails', () => {
  persistArtifactSave(pending);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  expect(() => consumeArtifactSave(pending.key)).toThrow();
  expect(readArtifactSave().pending).toEqual(pending);
});
