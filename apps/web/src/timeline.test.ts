import { expect, it } from 'vitest';
import type { SessionMessage } from '@jarvis-command/contracts';
import type { Turn } from './useLiveTurn';
import { matchTurn, projectTurns } from './timeline';
const turn: Turn = { intent: { sessionId: 'jc_test', clientRequestId: 'request', input: 'hello' }, publicRunId: 'jcr_' + 'a'.repeat(32), phase: 'Run completed', done: true, output: 'answer', outputLimited: false, historyMatched: false, identityVerified: true, approval: null, events: [], historyBaseline: ['old:user', 'old:answer'] };
const message = (id: string, role: SessionMessage['role'], content: string): SessionMessage => ({ id, role, content, sessionId: 'jc_test', timestamp: null, toolName: null, displayKind: null });
const old = [message('old:user', 'user', 'hello'), message('old:answer', 'assistant', 'answer')];
const pair = [message('new:user', 'user', 'hello'), message('new:answer', 'assistant', 'answer')];
it.each(['old', 'unpaired', 'reordered', 'foreign', 'unknown', 'limited', 'recovered'])('does not reconcile ambiguous %s history', (kind) => {
  const messages = kind === 'old' ? old : kind === 'unpaired' ? [...old, pair[1]!] : kind === 'reordered' ? [...old].reverse().concat(pair) : [...old, ...pair];
  if (kind === 'foreign') messages[2] = { ...pair[0]!, sessionId: 'jc_other' };
  const candidate = { ...turn, ...(kind === 'unknown' ? { historyBaseline: undefined } : {}), ...(kind === 'limited' ? { outputLimited: true } : {}), ...(kind === 'recovered' ? { intent: { ...turn.intent, input: null } } : {}) };
  expect(matchTurn(candidate as Turn, messages, true).assistant).toBeNull();
});
it('does not remove live or partial-page output', () => {
  expect(matchTurn({ ...turn, done: false }, [...old, ...pair], true).assistant).toBeNull();
  expect(matchTurn(turn, [...old, ...pair], false).assistant).toBeNull();
});
it('preserves distinct identical text by exact ordered IDs and submission order', () => {
  const second = { ...turn, intent: { ...turn.intent, clientRequestId: 'second' } };
  const messages = [...old, ...pair, message('second:user', 'user', 'hello'), message('second:answer', 'assistant', 'answer')];
  const projected = projectTurns([turn, second], messages, true);
  expect(projected.map((item) => item.after)).toEqual([3, 5]);
  expect(projected.every((item) => item.turn.historyMatched && item.turn.userHistoryMatched)).toBe(true);
});
it('does not match a response belonging to the next user', () => {
  const messages = [...old, pair[0]!, message('other:user', 'user', 'different'), pair[1]!];
  expect(matchTurn(turn, messages, true).assistant).toBeNull();
});
