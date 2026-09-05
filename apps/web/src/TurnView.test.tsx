import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnView } from './TurnView';
import type { Turn } from './useLiveTurn';

const turn: Turn = {
  intent: { sessionId: 'jc_usability', clientRequestId: 'synthetic-request', input: 'Exact input\n  keep spacing' },
  publicRunId: 'jcr_' + 'a'.repeat(32), phase: 'Run completed', output: 'Exact answer\n  keep spacing', outputLimited: false,
  events: [], approval: null, done: true, historyMatched: false, identityVerified: true,
};
const props = { allowed: true, approve: vi.fn(), stop: vi.fn() };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('copies the exact displayed answer only after an explicit click', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<TurnView {...props} turn={turn} />);
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
  await screen.findByText('Response copied');
  expect(writeText).toHaveBeenCalledExactlyOnceWith(turn.output);
});

it.each(['missing', 'rejected'])('reports %s clipboard access without claiming success', async (mode) => {
  vi.stubGlobal('navigator', mode === 'missing' ? {} : { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  render(<TurnView {...props} turn={turn} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
  await screen.findByText('Could not copy. Select the response text and copy manually.');
  expect(screen.queryByText('Response copied')).not.toBeInTheDocument();
});

it('labels copying bounded output as a preview and hides history-matched output', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const { rerender } = render(<TurnView {...props} turn={{ ...turn, outputLimited: true }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy preview' }));
  await screen.findByText('Preview copied');
  expect(writeText).toHaveBeenCalledExactlyOnceWith(turn.output);
  rerender(<TurnView {...props} turn={{ ...turn, historyMatched: true }} />);
  expect(screen.queryByRole('article', { name: 'Jarvis response' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument();
});

it('does not label a changed response with a prior clipboard result', async () => {
  let finish!: () => void;
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>((resolve) => { finish = resolve; }) } });
  const { rerender } = render(<TurnView {...props} turn={turn} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
  rerender(<TurnView {...props} turn={{ ...turn, output: 'New output' }} />);
  await act(async () => finish());
  expect(screen.queryByText('Response copied')).not.toBeInTheDocument();
});

it('groups typed activity into an ordered, labeled list without losing event text', () => {
  render(<TurnView {...props} turn={{ ...turn, events: [
    { type: 'tool.started', tool: 'synthetic', preview: 'Exact preview', publicRunId: turn.publicRunId!, timestamp: '2026-09-05T12:00:00.000Z' },
    { type: 'tool.completed', tool: 'synthetic', error: false, durationSeconds: 0, publicRunId: turn.publicRunId!, timestamp: '2026-09-05T12:00:00.000Z' },
  ] }} />);
  const activity = screen.getByRole('list', { name: 'Run activity' });
  expect(activity.tagName).toBe('OL');
  const items = within(activity).getAllByRole('listitem');
  expect(items.map((item) => item.textContent)).toEqual(['Tool started: synthetic — Exact preview', 'Tool completed: synthetic']);
});

it('presents exact input and answer as distinct labeled conversation cards', () => {
  render(<TurnView {...props} turn={turn} />);
  const input = screen.getByRole('article', { name: 'Your message' });
  const answer = screen.getByRole('article', { name: 'Jarvis response' });
  expect(within(input).getByText('Exact input', { exact: false }).textContent).toBe(turn.intent.input);
  expect(within(answer).getByText('Exact answer', { exact: false }).textContent).toBe(turn.output);
});
