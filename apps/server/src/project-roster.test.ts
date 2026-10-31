import { expect, it, vi } from 'vitest';
import { ProjectRosterSchema, type ProjectRoom } from '@jarvis-command/contracts';
import { createProjectRosterReader } from './project-roster';

const ids = Array.from({ length: 6 }, (_, i) => 'jc_' + String(i).repeat(32));
const project: ProjectRoom = { id: 'room_' + 'a'.repeat(32), name: 'SYNTHETIC', goal: 'Fixture', repository: '', notes: [], sessionIds: ids, lastSessionId: null };
const page = (id: string) => ({ sessionId: id, messages: [{ sessionId: id, id: 'm1', role: 'tool' as const, content: 'x'.repeat(500), timestamp: null, toolName: null, displayKind: null }], pagination: { limit: 2, offset: 0, returned: 1, hasMore: true } });
function fixture() {
  return {
    getSession: vi.fn(async (_subject: string, id: string) => ({ session: { id } }) as never),
    getRosterStatus: vi.fn(async () => ({ status: 'idle' as const, runUpdatedAt: null })),
    getMessages: vi.fn(async (_subject: string, id: string) => page(id)),
  };
}
it('reads only the stored bounded membership as the same actor; clips excerpts and explicitly reports omission', async () => {
  const service = fixture();
  const result = await createProjectRosterReader(service)('actor-a', project);
  expect(ProjectRosterSchema.safeParse(result).success).toBe(true);
  expect(result).toMatchObject({ limit: 4, total: 6, omitted: 2, partial: true });
  expect(service.getSession.mock.calls).toEqual(ids.slice(0, 4).map(id => ['actor-a', id]));
  expect(service.getMessages.mock.calls).toEqual(ids.slice(0, 4).map(id => ['actor-a', id, 2, 0]));
  expect(result.items[0]).toMatchObject({ title: null, archived: null, status: 'idle', messagesTruncated: true, messages: [{ role: 'tool', text: 'x'.repeat(240), truncated: true }] });
});
it('isolates per-item session, status and message failures; accepts external read-only session ids', async () => {
  const service = fixture();
  service.getSession.mockRejectedValueOnce(Error('private upstream details'));
  service.getRosterStatus.mockRejectedValueOnce(Error('status missing'));
  service.getMessages.mockRejectedValueOnce(Error('page missing'));
  const result = await createProjectRosterReader(service)('actor-b', { ...project, sessionIds: ['external:readonly', ids[1]!] });
  expect(result.items.every(item => item.status === 'unknown' && item.messagesUnavailable)).toBe(true);
  expect(result.partial).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private upstream');
});
it('bounds time and outstanding work across retries; late work cannot change the response', async () => {
  const service = fixture();
  let resolve!: (value: never) => void;
  service.getSession.mockImplementation(() => new Promise(done => { resolve = done; }));
  const read = createProjectRosterReader(service, 10);
  const result = await read('actor', project);
  expect(result.items.every(item => item.status === 'unknown')).toBe(true);
  expect(service.getSession).toHaveBeenCalledTimes(2);
  await expect(read('actor', project)).rejects.toMatchObject({ statusCode: 503 });
  const bytes = JSON.stringify(result);
  resolve({ session: { id: ids[1] } } as never);
  await Promise.resolve();
  expect(JSON.stringify(result)).toBe(bytes);
  expect(service.getMessages).not.toHaveBeenCalled();
});
