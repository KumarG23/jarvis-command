import { expect, it } from 'vitest';
import { MAX_PROJECT_INSTRUCTIONS, projectInstructions } from './project-context';

const lead = 'jc_' + 'a'.repeat(32), other = 'jc_' + 'b'.repeat(32);
const room = {
  id: 'room_' + 'c'.repeat(32), name: 'Cockpit', goal: 'Replace Discord', instructions: 'Prefer small PRs.', archived: false,
  repository: 'git@github.com:example/repo.git', notes: ['Sol 6.1 is the default'], sessionIds: [lead, other], lastSessionId: lead, leadSessionId: lead,
  threads: [{ sessionId: lead, title: 'Lead', createdAt: '2026-11-12T00:00:00Z', archived: false }, { sessionId: other, title: 'Old', createdAt: '2026-11-12T00:00:00Z', archived: true }],
};

it('describes the project and the chat role, leaving out archived threads', () => {
  const text = projectInstructions(room, lead);
  expect(text).toContain('This conversation is the project lead chat.');
  expect(text).toContain('Repository: git@github.com:example/repo.git');
  expect(text).toContain('Prefer small PRs.');
  expect(text).toContain('- Lead (lead)');
  expect(text).not.toContain('Old');
  expect(projectInstructions(room, other)).toContain('a chat in this project');
});

it('stays within the size bound', () => {
  const big = { ...room, instructions: 'x'.repeat(4000), notes: Array.from({ length: 12 }, () => 'y'.repeat(512)), goal: 'z'.repeat(2000) };
  const text = projectInstructions(big, lead);
  expect(text.length).toBeLessThanOrEqual(MAX_PROJECT_INSTRUCTIONS);
});

it('lists open terminals with only cache-stable fields', () => {
  const at = '2026-11-12T00:00:00.000Z';
  const base = { requestId: 'req-00000001', projectId: room.id, createdBy: 'human' as const, host: 'cockpit-dev', cwd: '/w', repository: null, branch: null, worktree: false, nativeSessionId: null, pid: 1, exitCode: null, failure: null, billing: 'sub', createdAt: at, updatedAt: at, stateAt: at };
  const running = { ...base, id: 'cs_' + 'a'.repeat(24), title: 'Test', kind: 'claude' as const, owner: 'human' as const, state: 'running' as const };
  const ended = { ...base, id: 'cs_' + 'b'.repeat(24), title: 'Old', kind: 'codex' as const, owner: 'none' as const, state: 'exited' as const };
  const text = projectInstructions(room, lead, [running, ended]);
  expect(text).toContain('- Test · claude · id cs_' + 'a'.repeat(24));
  expect(text).not.toContain('Old');
  // Handing a terminal over or a state flip must not change the prompt prefix.
  expect(projectInstructions(room, lead, [{ ...running, owner: 'lead', state: 'waiting_for_input', updatedAt: '2026-11-12T01:00:00.000Z' }, ended])).toBe(text);
  expect(projectInstructions(room, lead, null)).toContain('could not be read');
  expect(projectInstructions(room, lead, [])).toContain('Terminal sessions: none open.');
  expect(projectInstructions(room, lead)).not.toContain('Terminal sessions');
});
