import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ThreadState } from '@jarvis-command/contracts';
import { StatusIcon } from './StatusIcon';
import { delegatedRouteUnavailable, threadStatus, sortThreads, summarizeThreads, selectUnread, mergeThreadState } from './threadStatus';
const now = Date.parse('2026-11-07T13:00:00Z');
const state = (runStatus: ThreadState['runStatus'], unread: boolean | null = false): ThreadState => ({ sessionId: 'jc_' + 'a'.repeat(32), runStatus, unread, observedAt: new Date(now).toISOString(), runObservedAt: new Date(now).toISOString(), recentAt: null, latest: null, lastRead: null, historyComplete: true });
it.each([['unknown', false, 'unknown'], ['unknown', true, 'unread'], ['completed', false, 'idle'], ['completed', true, 'unread'], ['running', false, 'working'], ['queued', true, 'working'], ['waiting-approval', true, 'needs-you'], ['failed', false, 'needs-you'], ['interrupted', false, 'needs-you'], ['cancelled', false, 'idle']] as const)('derives %s/unread %s as %s with labelled icon', (run, unread, expected) => {
  expect(threadStatus(state(run, unread), now)).toBe(expected);
  render(<StatusIcon state={expected} />);
  expect(screen.getByLabelText({ 'needs-you': 'Needs you', working: 'Working', unread: 'Unread', idle: 'Idle', unknown: 'Unknown' }[expected])).toHaveTextContent(/Needs you|Working|Unread|Idle|Unknown/);
});
it('missing, future or stale observations stay unknown; unread is shared and independent', () => {
  expect(threadStatus(undefined, now)).toBe('unknown');
  expect(threadStatus(state('running'), now + 60_001)).toBe('unknown');
  expect(threadStatus(state('running'), now - 1)).toBe('unknown');
  expect(threadStatus({ ...state('running', true), runObservedAt: null }, now)).toBe('unread');
  expect(selectUnread(state('completed'), now)).toBe(false);
  expect(selectUnread(state('completed'), now + 60_001)).toBe(null);
});
it('sorts urgency then verified message recency, summarizes most urgent verified child', () => {
  const states = { unknown: state('unknown'), idle: state('completed'), working: state('running'), unread: state('completed', true), attention: state('waiting-approval'), recent: { ...state('completed'), recentAt: new Date(now).toISOString() } };
  expect(sortThreads(Object.keys(states), states, now)).toEqual(['attention', 'working', 'unread', 'recent', 'idle', 'unknown']);
  expect(summarizeThreads(['unknown', 'working', 'attention'], states, now)).toBe('needs-you');
  expect(summarizeThreads([], states, now)).toBe('unknown');
});
it('keeps unsupported delegated defaults explicit without claiming requested execution', () => {
  expect(delegatedRouteUnavailable).toContain('unavailable');
  expect(delegatedRouteUnavailable).toContain('exact authorized thread-to-session route binding');
  expect(delegatedRouteUnavailable).toContain('requested settings are not executed-route evidence');
});

it('reverse response delivery with tied timestamps cannot clear newer output or lose a newer read', () => {
  const older = { ...state('completed'), latest: { messageId: 'old', position: 1 }, lastRead: { messageId: 'old', position: 1 }, unread: false };
  const newer = { ...older, latest: { messageId: 'new', position: 2 }, unread: true };
  expect(mergeThreadState(newer, older).unread).toBe(true);
  const cleared = { ...newer, lastRead: newer.latest, unread: false };
  expect(mergeThreadState(cleared, newer).unread).toBe(false);
  expect(mergeThreadState(newer, cleared).unread).toBe(false);
});

it('accepts a newer canonical correction of an excluded-tail marker for the same eligible latest', () => {
  const latest = { messageId: 'assistant', position: 1 };
  const before = { ...state('completed', true), latest, lastRead: { messageId: 'excluded-system', position: 2 } };
  const corrected = { ...before, observedAt: new Date(now + 1).toISOString(), lastRead: latest, unread: false };
  expect(mergeThreadState(before, corrected)).toEqual(corrected);
  expect(mergeThreadState(corrected, before)).toEqual(corrected);
});

it.each([-1, 0, 1])('does not restore an excluded-tail marker after a clear (timestamp delta %s)', delta => {
  const latest = { messageId: 'assistant', position: 1 };
  const cleared = { ...state('completed'), latest, lastRead: latest };
  const delayed = { ...cleared, observedAt: new Date(now + delta).toISOString(), lastRead: { messageId: 'excluded-system', position: 2 }, unread: true };
  const merged = mergeThreadState(cleared, delayed);
  expect(merged.lastRead).toEqual(latest);
  expect(merged.unread).toBe(false);
});

it.each([
  ['older observation', {}, { observedAt: new Date(now - 1).toISOString() }],
  ['tied observation', {}, { observedAt: new Date(now).toISOString() }],
  ['previous partial history', { historyComplete: false, unread: null }, {}],
  ['next partial history', {}, { historyComplete: false, unread: null }],
  ['unknown latest', {}, { latest: null, historyComplete: false, unread: null }],
  ['different latest identity', {}, { latest: { messageId: 'other', position: 1 }, lastRead: { messageId: 'other', position: 1 } }],
  ['different latest position', {}, { latest: { messageId: 'assistant', position: 0 }, lastRead: { messageId: 'assistant', position: 0 } }],
  ['unconfirmed clear', {}, { unread: true }],
  ['unknown unread', {}, { unread: null }],
  ['missing read marker', {}, { lastRead: null }],
  ['different read identity', {}, { lastRead: { messageId: 'other', position: 1 } }],
  ['different read position', {}, { lastRead: { messageId: 'assistant', position: 0 } }],
] satisfies [string, Partial<ThreadState>, Partial<ThreadState>][])('does not demote a marker on %s', (_name, oldPatch, nextPatch) => {
  const latest = { messageId: 'assistant', position: 1 };
  const before: ThreadState = { ...state('completed', true), latest, lastRead: { messageId: 'excluded-system', position: 2 }, ...oldPatch };
  const next: ThreadState = { ...state('completed'), latest, lastRead: latest, observedAt: new Date(now + 1).toISOString(), ...nextPatch };
  const merged = mergeThreadState(before, next);
  expect(merged.lastRead).toEqual(before.lastRead);
  expect(merged.unread).toBe(merged.historyComplete ? true : null);
});

it('a delayed correction cannot clear output or demote a valid read beyond its target', () => {
  const latest = { messageId: 'assistant', position: 1 };
  const corrected = { ...state('completed'), latest, lastRead: latest, observedAt: new Date(now + 1).toISOString() };
  const newer = { ...state('completed', true), latest: { messageId: 'new-output', position: 3 }, lastRead: { messageId: 'read-output', position: 2 } };
  expect(mergeThreadState(newer, corrected)).toEqual(newer);
  const read = { ...newer, lastRead: newer.latest, unread: false };
  expect(mergeThreadState(read, corrected)).toEqual(read);
  expect(mergeThreadState(corrected, newer)).toEqual(newer);
});

it.each([-1, 0, 1])('keeps a valid newer read behind the same unseen tail (timestamp delta %s)', delta => {
  const latest = { messageId: 'unseen', position: 3 };
  const before = { ...state('completed', true), latest, lastRead: { messageId: 'viewed', position: 2 } };
  const delayed = { ...before, observedAt: new Date(now + delta).toISOString(), lastRead: { messageId: 'earlier', position: 1 } };
  const merged = mergeThreadState(before, delayed);
  expect(merged.lastRead).toEqual(before.lastRead);
  expect(merged.unread).toBe(true);
});

it('never synthesizes a read marker from a latest target or an unread flag', () => {
  const before = state('completed');
  const next = { ...before, latest: { messageId: 'unseen', position: 1 }, observedAt: new Date(now + 1).toISOString() };
  const merged = mergeThreadState(before, next);
  expect(merged.lastRead).toBeNull();
  expect(merged.unread).toBe(true);
});
