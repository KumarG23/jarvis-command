import { expect, it } from 'vitest';
import { ProjectRosterSchema, projectSendSnapshot } from './project-roster';
const id = 'jc_' + 'a'.repeat(32);
const project = { id: 'room_' + 'b'.repeat(32), name: 'Synthetic', goal: 'Fixture', repository: '', notes: [], sessionIds: [id], lastSessionId: null };
const item = { sessionId: id, title: null, archived: null, lead: false, status: 'unknown', statusObservedAt: null, runUpdatedAt: null, messagesObservedAt: null, messages: [], messagesTruncated: false, messagesUnavailable: true };
const roster = { project, observedAt: '2026-10-31T18:00:00.000Z', limit: 4, total: 1, omitted: 0, partial: true, items: [item] };
it('rejects foreign membership, duplicates, unsupported states and oversized excerpts', () => {
  for (const items of [[{ ...item, sessionId: 'foreign' }], [item, item], [{ ...item, status: 'blocked' }], [{ ...item, messages: [{ role: 'assistant', text: 'x'.repeat(241), truncated: false }] }]]) {
    expect(ProjectRosterSchema.safeParse({ ...roster, items }).success).toBe(false);
  }
  expect(ProjectRosterSchema.safeParse(roster).success).toBe(true);
});
it('compares saved send facts independently of property order and navigation history', () => {
  const { name, ...rest } = project;
  expect(projectSendSnapshot({ name, ...rest, lastSessionId: id })).toBe(projectSendSnapshot(project));
  expect(projectSendSnapshot({ ...project, leadSessionId: null })).not.toBe(projectSendSnapshot(project));
});
