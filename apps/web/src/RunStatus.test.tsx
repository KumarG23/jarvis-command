import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TurnView } from './TurnView';
import type { Turn } from './useLiveTurn';

const base: Turn = {
  intent: { sessionId: 'jc_status_fixture', clientRequestId: 'status-fixture', input: 'Synthetic status test' },
  publicRunId: 'jcr_' + 'a'.repeat(32), phase: 'Run running', output: '', outputLimited: false,
  events: [], approval: null, done: false, historyMatched: false, identityVerified: true,
};
const props = { allowed: true, approve: vi.fn(), stop: vi.fn() };
const event = { publicRunId: base.publicRunId!, timestamp: '2026-10-28T15:00:00Z' };

it('keeps one compact status disclosure closed, with usage available without execution metadata', () => {
  render(<TurnView {...props} turn={{ ...base, phase: 'Run completed', done: true, usage: { inputTokens: 0, outputTokens: 2, totalTokens: 2, apiCalls: 0 } }} />);
  const summary = screen.getByText('Activity / Usage');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
  const usage = screen.getByRole('region', { name: 'Execution receipt' });
  expect(usage).toHaveTextContent('Run spend');
  expect(usage).toHaveTextContent('2 tokens · 0 in / 2 out');
  expect(usage).toHaveTextContent('0 API calls');
  expect(within(usage).getByRole('img', { name: 'Cache write unavailable: not reported by Hermes' })).toHaveTextContent('—');
  expect(screen.getByText('Executed route unavailable')).toBeInTheDocument();
  fireEvent.click(summary);
  expect(summary.closest('details')).not.toHaveAttribute('open');
});

it('derives working labels from observed activity and treats reconnect as an overlay', () => {
  const { rerender } = render(<TurnView {...props} turn={base} />);
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Working…');
  rerender(<TurnView {...props} turn={{ ...base, events: [{ ...event, type: 'tool.started', tool: 'search', preview: 'Synthetic preview' }] }} />);
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Tool started: search');
  rerender(<TurnView {...props} turn={{ ...base, phase: 'Reconnecting — preview retained', events: [{ ...event, type: 'subagent.start', subagentId: 'Scout', goal: 'Synthetic goal', status: null }] }} />);
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Reconnecting · Last reported: Subagent started: Scout');
  expect(screen.getByText('Activity / Usage').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText(/Agent handoff reported/)).toBeInTheDocument();
});

it.each(['Run failed', 'Run interrupted', 'Run cancelled', 'Run completed'])('terminal %s supersedes prior tool activity', phase => {
  render(<TurnView {...props} turn={{ ...base, phase, done: true, events: [{ ...event, type: 'tool.started', tool: 'search', preview: 'Synthetic' }] }} />);
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent(phase);
});

it('surfaces failed tools without opening ordinary successful details', () => {
  render(<TurnView {...props} turn={{ ...base, done: true, phase: 'Run completed', events: [{ ...event, type: 'tool.completed', tool: 'search', error: true, durationSeconds: 0 }] }} />);
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Tool failure reported');
  fireEvent.click(screen.getByText('Activity / Usage'));
  expect(screen.getByRole('list', { name: 'Run activity' })).toHaveTextContent('Tool failed: search · 0s');
});

it('keeps approval actions identity-bound and visible outside the disclosure', () => {
  const approval = { requestId: 'apr_' + 'b'.repeat(32), command: 'synthetic command', description: 'Synthetic approval', tool: 'shell' };
  render(<TurnView {...props} turn={{ ...base, approval, identityVerified: false }} />);
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Waiting for your approval');
  expect(screen.getByRole('region', { name: 'Awaiting approval' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Approve once' })).not.toBeInTheDocument();
});

it('labels incomplete activity without inventing zero tool calls or historical binding', () => {
  render(<TurnView {...props} turn={{ ...base, intent: { ...base.intent, input: null }, done: true, phase: 'Run completed', output: 'Synthetic recovered output', activityUnavailable: true }} />);
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Activity incomplete');
  expect(screen.getByRole('status', { name: 'Run status' })).not.toHaveTextContent('0 tools');
  expect(screen.getByText('Recovered run output — canonical message link unavailable')).toBeInTheDocument();
});
