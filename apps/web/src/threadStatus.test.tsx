import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ThreadState } from '@jarvis-command/contracts';
import { StatusIcon } from './StatusIcon';
import { delegatedRouteUnavailable, threadStatus, sortThreads, summarizeThreads, selectUnread, withVerifiedTurns, mergeThreadState } from './threadStatus';
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

it('uses newer typed retained facts and never transport phase strings or requested routes', () => {
  const old = state('completed');
  const fact = { intent: { sessionId: old.sessionId }, identityVerified: true, statusObservedAt: new Date(now + 1).toISOString(), verifiedStatus: 'waiting_for_approval' };
  expect(threadStatus(withVerifiedTurns({ [old.sessionId]: old }, [fact])[old.sessionId], now + 1)).toBe('needs-you');
  expect(withVerifiedTurns({ [old.sessionId]: old }, [{ ...fact, statusObservedAt: new Date(now - 1).toISOString() }])[old.sessionId]?.runStatus).toBe('completed');
  expect(threadStatus(withVerifiedTurns({ [old.sessionId]: old }, [{ ...fact, identityVerified: false }])[old.sessionId], now)).toBe('unknown');
  expect(threadStatus(withVerifiedTurns({ [old.sessionId]: old }, [{ ...fact, verifiedStatus: undefined }])[old.sessionId], now + 1)).toBe('unknown');
});

it('reverse response delivery with tied timestamps cannot clear newer output or lose a newer read', () => {
  const older = { ...state('completed'), latest: { messageId: 'old', position: 1 }, lastRead: { messageId: 'old', position: 1 }, unread: false };
  const newer = { ...older, latest: { messageId: 'new', position: 2 }, unread: true };
  expect(mergeThreadState(newer, older).unread).toBe(true);
  const cleared = { ...newer, lastRead: newer.latest, unread: false };
  expect(mergeThreadState(cleared, newer).unread).toBe(false);
  expect(mergeThreadState(newer, cleared).unread).toBe(false);
});
