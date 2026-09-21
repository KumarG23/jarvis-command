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
  expect(screen.queryByRole('button', { name: /Copy (response|preview)/ })).not.toBeInTheDocument();
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
  expect(items.map((item) => item.querySelector('span')?.textContent)).toEqual(['Tool started: synthetic — Exact preview', 'Tool completed: synthetic']);
  expect(items.map((item) => item.querySelector('time')?.textContent)).toEqual(['12:00:00', '12:00:00']);
});

it('shows route, recovery and failure details and copies a sanitized run receipt', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const inspected: Turn = {
    ...turn,
    phase: 'Run failed',
    error: 'Provider unavailable.',
    events: [{
      type: 'tool.started', tool: 'synthetic', preview: 'Exact preview',
      publicRunId: turn.publicRunId!, timestamp: '2026-09-04T12:00:00.000Z',
    }],
    telemetry: { admissionAttempts: 2, streamConnections: 3, statusChecks: 4 },
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      execution: {
        requested: { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
        executed: { provider: 'openai-codex', model: 'gpt-5.6-terra', reasoningEffort: 'medium', reasoningEffortSource: 'wire' },
        routeSource: 'fallback',
        exact: false,
        fallbackUsed: true,
      },
    },
  };
  render(<TurnView {...props} turn={inspected} />);
  expect(screen.getByText('Run details').closest('details')).toHaveAttribute('open');
  const inspector = screen.getByRole('region', { name: 'Run inspector' });
  expect(inspector).toHaveTextContent('Provider unavailable.');
  expect(inspector).toHaveTextContent('Admission attempts2');
  expect(inspector).toHaveTextContent('Stream reconnects2');
  expect(within(screen.getByRole('region', { name: 'Route decision' })).getByText('Fallback used · fallback')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy receipt' }));
  await screen.findByText('Run receipt copied');
  expect(writeText).toHaveBeenCalledTimes(1);
  const copied = JSON.parse(writeText.mock.calls[0]![0]);
  expect(copied).toMatchObject({
    version: 1,
    run: { publicRunId: turn.publicRunId, sessionId: turn.intent.sessionId, error: 'Provider unavailable.' },
    recovery: { admissionAttempts: 2, streamConnections: 3, streamReconnects: 2, statusChecks: 4 },
    route: { fallbackUsed: true },
  });
  expect(copied.activity[0]).toEqual({ type: 'tool.started', timestamp: '2026-09-04T12:00:00.000Z', tool: 'synthetic' });
  expect(JSON.stringify(copied.activity)).not.toContain('Exact preview');
  expect(copied.run).not.toHaveProperty('input');
  expect(copied).not.toHaveProperty('output');
});

it('reports receipt clipboard failure without claiming success', async () => {
  vi.stubGlobal('navigator', {});
  render(<TurnView {...props} turn={turn} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy receipt' }));
  await screen.findByText('Could not copy receipt.');
  expect(screen.queryByText('Run receipt copied')).not.toBeInTheDocument();
});

it('presents exact input and answer as distinct labeled conversation cards', () => {
  render(<TurnView {...props} turn={turn} />);
  const input = screen.getByRole('article', { name: 'Your message' });
  const answer = screen.getByRole('article', { name: 'Jarvis response' });
  expect(within(input).getByText('Exact input', { exact: false }).textContent).toBe(turn.intent.input);
  expect(within(answer).getByText('Exact answer', { exact: false }).textContent).toBe(turn.output);
});
