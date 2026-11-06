import { expect, it } from 'vitest';
import { ProjectRoomCreateSchema, ProjectRoomsSchema, ProjectDeleteRequestSchema, ProjectRoomSchema, ProjectThreadUpdateSchema } from './project-rooms';

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

it('keeps tombstones distinct from live rooms and rejects unsupported deletion payloads', () => {
  expect(ProjectRoomsSchema.safeParse({ version: 1, rooms: [legacy], deletedRoomIds: [legacy.id] }).success).toBe(false);
  expect(ProjectRoomsSchema.safeParse({ version: 1, rooms: [], deletedRoomIds: [legacy.id, legacy.id] }).success).toBe(false);
  const request = { roomId: legacy.id, token: 'a'.repeat(64), mode: 'project-only' };
  expect(ProjectDeleteRequestSchema.safeParse(request).success).toBe(true);
  expect(ProjectDeleteRequestSchema.safeParse({ ...request, mode: 'contents' }).success).toBe(false);
});

// Synthetic future-writer records; this bridge must read them without admitting writes.
it.each([
  { projectIcon: 'orbit', projectColor: 'violet' },
  { projectIcon: 'auto' }, { projectColor: 'auto' },
  { projectIcon: 'future-glyph', projectColor: 'future-accent' },
  { projectIcon: 'g'.repeat(32), projectColor: 'c'.repeat(32) },
])('reads and retains bounded optional identity metadata %j', fields => {
  const room = { ...legacy, ...fields };
  expect(ProjectRoomSchema.parse(room)).toEqual(room);
  expect(ProjectRoomsSchema.parse({ version: 1, rooms: [room] }).rooms).toEqual([room]);
  const metadata = { name: legacy.name, goal: legacy.goal, repository: legacy.repository, notes: legacy.notes };
  expect(ProjectRoomCreateSchema.safeParse({ ...metadata, ...fields }).success).toBe(false);
});
it.each([
  { projectIcon: 'g'.repeat(33) }, { projectColor: 'c'.repeat(33) },
  { projectIcon: '' }, { projectColor: '#fff' }, { projectIcon: '../private' },
  { projectIcon: null }, { projectColor: [] }, { projectIcon: { glyph: 'orbit' } },
  { unexpectedIdentity: 'orbit' },
])('rejects malformed or unrelated read metadata %j', fields => {
  expect(ProjectRoomSchema.safeParse({ ...legacy, ...fields }).success).toBe(false);
});
