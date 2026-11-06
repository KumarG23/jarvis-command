import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi, afterEach } from 'vitest';
import type { LiveRunUsage, SessionMessage } from '@jarvis-command/contracts';
import { ModelFamilyMark, modelFamily, boundMessageExecution, verifiedTurnExecution } from './ModelFamilyMark';
import { ExecutionReceipt, TurnView } from './TurnView';
import { LiveRoom } from './LiveRoom';
import type { Turn } from './useLiveTurn';
const execution = (provider: string | null, model: string | null): NonNullable<LiveRunUsage['execution']> => ({
  requested: { provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'high' },
  executed: { provider, model, reasoningEffort: null, reasoningEffortSource: 'unknown' },
  routeSource: 'unknown', exact: false, fallbackUsed: true,
});
const usage: LiveRunUsage = { inputTokens: 3, outputTokens: 2, totalTokens: 5, apiCalls: 1, execution: execution('anthropic', 'claude-sonnet-5-5') };
const turn: Turn = { intent: { sessionId: 'jc_' + 'a'.repeat(32), clientRequestId: 'synthetic', input: 'question' }, publicRunId: 'jcr_' + 'b'.repeat(32), identityVerified: true, done: true, phase: 'Run completed', events: [], approval: null, historyMatched: false, output: 'SYNTHETIC same answer', outputLimited: false, usage };
const messages: SessionMessage[] = [
  { id: 'old:a', sessionId: turn.intent.sessionId, role: 'assistant', content: turn.output, timestamp: null, toolName: null, displayKind: null },
  { id: 'new:u', sessionId: turn.intent.sessionId, role: 'user', content: 'question', timestamp: null, toolName: null, displayKind: null },
  { id: 'new:a', sessionId: turn.intent.sessionId, role: 'assistant', content: turn.output, timestamp: null, toolName: null, displayKind: null },
];
const bound = { ...turn, historyBinding: { userMessageId: 'new:u', assistantMessageId: 'new:a' } };
afterEach(() => vi.unstubAllGlobals());
it.each([
  ['openai-codex', 'gpt-6.1-sol', 'openai'], ['openai', 'o3-mini', 'openai'], ['openai', 'openai/gpt-6-sol', 'openai'],
  ['anthropic', 'claude-opus-5-5', 'claude'], ['openrouter', 'anthropic/claude-sonnet-5-5', 'claude'],
  ['google', 'gemini-2.5-pro', 'gemini'], ['openrouter', 'google/gemini-2.5-pro', 'gemini'], ['xai', 'grok-4.7', 'grok'],
  ['openrouter', 'x-ai/grok-4.7', 'grok'], ['anthropic', 'gpt-6-sol', 'unknown'], ['openai', 'claude-sonnet-5-5', 'unknown'],
  ['openrouter', 'gpt-6-sol', 'unknown'], ['unknown', 'gpt-6-sol', 'unknown'], ['openai', 'unknown', 'unknown'],
  [null, 'gpt-6-sol', 'unknown'], ['openai', null, 'unknown'], ['', '', 'unknown'],
  ['openai', 'gpt-6-sol trailing prose', 'unknown'], ['openai', 'x'.repeat(161), 'unknown'],
])('maps only executed provider/model pair %s / %s to %s', (provider, model, family) => {
  expect(modelFamily(execution(provider, model))).toBe(family);
});
it('does not infer execution from a requested route or exact flag', () => {
  expect(modelFamily(null)).toBe('unknown'); expect(modelFamily(undefined)).toBe('unknown');
  expect(modelFamily({ ...execution(null, null), exact: true })).toBe('unknown');
  expect(modelFamily(usage.execution)).toBe('claude');
});
it('keeps persistent accessible family labels and a neutral unknown mark', () => {
  const view = render(<ModelFamilyMark execution={usage.execution} />);
  expect(screen.getByText('Claude · executed model family')).toBeVisible();
  expect(view.container.querySelector('.model-family-glyph')).toHaveAttribute('aria-hidden', 'true');
  view.rerender(<ModelFamilyMark execution={null} variant="icon" />);
  expect(screen.getByRole('img', { name: 'Model family unknown' })).toHaveAttribute('data-family', 'unknown');
});
it('marks actual execution on receipt/response while retaining mismatch, fallback, spend and copy behavior', () => {
  render(<TurnView turn={turn} allowed={false} approve={vi.fn()} stop={vi.fn()} />);
  const answer = screen.getByRole('article', { name: 'Jarvis response' });
  expect(within(answer).getByText('Claude · executed model family')).toBeVisible();
  expect(within(answer).getByRole('img', { name: 'Claude · executed model family' })).toBeInTheDocument();
  expect(within(answer).getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
  const receipt = screen.getByRole('region', { name: 'Execution receipt' });
  expect(receipt).toHaveTextContent('Claude · executed model family');
  expect(receipt).toHaveTextContent('Requested route changed during execution.');
  expect(receipt).toHaveTextContent('Fallback used'); expect(receipt).toHaveTextContent('5 tokens · 3 in / 2 out');
});
it('keeps unverified turns and conflicting event/run evidence neutral', () => {
  for (const unverified of [{ ...turn, identityVerified: false }, { ...turn, publicRunId: null }, { ...turn, events: [{ type: 'message.delta' as const, publicRunId: 'jcr_' + 'c'.repeat(32), timestamp: '2026-11-06T12:00:00Z', delta: turn.output }] }]) {
    expect(modelFamily(verifiedTurnExecution(unverified))).toBe('unknown');
  }
  const view = render(<TurnView turn={{ ...turn, identityVerified: false }} allowed={false} approve={vi.fn()} stop={vi.fn()} />);
  expect(view.container.querySelector('[data-family="claude"]')).toBeNull();
  view.rerender(<ExecutionReceipt usage={{ ...usage, execution: undefined }} />);
  expect(screen.getByText('Executed route unavailable')).toBeInTheDocument();
  expect(screen.getByText('Model family unknown')).toBeInTheDocument();
});
it('requires exact complete session/run/message binding and rejects ambiguous or text-only joins', () => {
  const reply = messages[2]!;
  expect(modelFamily(boundMessageExecution(reply, [bound], messages, true))).toBe('claude');
  for (const [candidate, complete] of [[bound, false], [{ ...bound, identityVerified: false }, true], [{ ...bound, intent: { ...bound.intent, sessionId: 'jc_foreign' } }, true], [{ ...turn, historyBaseline: ['old:a'] }, true]] satisfies [Turn, boolean][]) {
    expect(modelFamily(boundMessageExecution(reply, [candidate], messages, complete))).toBe('unknown');
  }
  expect(modelFamily(boundMessageExecution(messages[0]!, [bound], messages, true))).toBe('unknown');
  expect(modelFamily(boundMessageExecution(reply, [bound, { ...bound, publicRunId: 'jcr_' + 'c'.repeat(32) }], messages, true))).toBe('unknown');
});
it.each([true, false])('marks only the exactly bound canonical response (binding present=%s)', async hasBinding => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sessionId: turn.intent.sessionId, messages, pagination: { limit: 50, offset: 0, returned: 3, hasMore: false } })));
  const session = { id: turn.intent.sessionId, title: 'SYNTHETIC session.model is not evidence', source: 'api_server', ownership: 'command' as const, model: 'gpt-6-sol', lastActive: '2026-11-06T12:00:00Z', messageCount: 3, toolCallCount: 0, pinned: false };
  const view = render(<LiveRoom session={session} onHistory={vi.fn()} turns={[hasBinding ? bound : { ...turn, historyBaseline: ['old:a'] }]} renderTurn={value => <TurnView turn={value} allowed={false} approve={vi.fn()} stop={vi.fn()} />} />);
  await screen.findByText('question');
  const canonical = view.container.querySelector('[data-message-id="new:a"]')!;
  expect(canonical).not.toBeNull();
  expect(canonical.querySelectorAll('[data-family="claude"]')).toHaveLength(hasBinding ? 2 : 0);
  expect(view.container.querySelector('[data-message-id="old:a"] [data-family="claude"]')).toBeNull();
  expect(view.container.querySelector('[data-message-id="old:a"]')).toHaveTextContent('Model family unknown');
});

it('measures AA text contrast for every family accent and neutral text on existing dark surfaces', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const token = (name: string) => css.match(new RegExp(`--${name}: (#[a-f0-9]{6})`))![1]!;
  const luminance = (hex: string) => {
    const rgb = hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
  };
  for (const family of ['openai', 'claude', 'gemini', 'grok', 'unknown']) {
    const accent = family === 'unknown'
      ? css.match(/\.model-family-mark \{ --family-accent: var\(--([a-z-]+)\)/)![1]!
      : css.match(new RegExp(`data-family="${family}"\\] \\{ --family-accent: var\\(--([a-z-]+)\\)`))![1]!;
    for (const surface of ['bg', 'sidebar', 'panel', 'surface']) {
      const ratio = (luminance(token(accent)) + .05) / (luminance(token(surface)) + .05);
      expect(ratio, `${family} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
