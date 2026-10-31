import { expect, it } from 'vitest';
import { ProjectRoomSchema, ProjectThreadUpdateSchema } from './project-rooms';

const id = 'jc_' + 'a'.repeat(32), other = 'jc_' + 'b'.repeat(32);
const legacy = { id: 'room_' + 'c'.repeat(32), name: 'Fixture', goal: 'Preserve', instructions: 'Keep', repository: '/ref', notes: ['note'], sessionIds: [id], lastSessionId: id };
const thread = { sessionId: id, title: 'Independent work', archived: false, createdAt: '2026-10-31T18:00:00.000Z' };
it('keeps legacy version-one project data without inferring a lead or creation date', () => {
  expect(ProjectRoomSchema.parse(legacy)).toEqual(legacy);
});
it('accepts one linked unarchived Command lead with bounded metadata', () => {
  expect(ProjectRoomSchema.safeParse({ ...legacy, threads: [thread], leadSessionId: id }).success).toBe(true);
});
it.each([
  { threads: [thread, thread] }, { threads: [{ ...thread, sessionId: other }] },
  { threads: [{ ...thread, title: 'x'.repeat(121) }] }, { threads: [{ ...thread, title: ' ' }] },
  { threads: [{ ...thread, title: 'bad\ntitle' }] }, { threads: [{ ...thread, createdAt: 'unknown' }] },
  { threads: [{ ...thread, extra: true }] }, { threads: [thread], leadSessionId: other },
  { threads: [{ ...thread, archived: true }], leadSessionId: id }, { leadSessionId: id },
  { sessionIds: [id, id] }, { sessionIds: ['discord:reference'], threads: [{ ...thread, sessionId: 'discord:reference' }], lastSessionId: null, leadSessionId: 'discord:reference' },
])('rejects invalid metadata %j', fields => {
  expect(ProjectRoomSchema.safeParse({ ...legacy, ...fields }).success).toBe(false);
});
it('bounds narrow updates and rejects ids, timestamps, unknown fields and empty requests', () => {
  for (const body of [{}, { sessionId: other }, { createdAt: thread.createdAt }, { leadSessionId: id }, { title: 'x', unexpected: true }, { designateLead: false }, { title: 'x'.repeat(121) }]) {
    expect(ProjectThreadUpdateSchema.safeParse(body).success).toBe(false);
  }
  expect(ProjectThreadUpdateSchema.parse({ title: '  New title  ' })).toEqual({ title: 'New title' });
});
