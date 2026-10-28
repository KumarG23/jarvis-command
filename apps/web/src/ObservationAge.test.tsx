import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TurnView } from './TurnView';
import type { Turn } from './useLiveTurn';

const active: Turn = {
  intent: { sessionId: 'jc_clock_fixture', clientRequestId: 'clock-request', input: 'Synthetic quiet run' },
  publicRunId: 'jcr_' + 'a'.repeat(32), phase: 'Run running', output: '', outputLimited: false,
  events: [], approval: null, done: false, historyMatched: false, identityVerified: true,
};
const props = { allowed: true, approve: vi.fn(), stop: vi.fn() };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const age = () => screen.getByRole('timer', { name: 'Current-tab observation age' });
const advance = (milliseconds: number) => act(() => vi.advanceTimersByTime(milliseconds));

it('advances for a quiet run using monotonic observation time rather than the wall clock', () => {
  render(<TurnView {...props} turn={active} />);
  expect(age()).toHaveTextContent('Current-tab observation age · 0s');
  advance(3000);
  expect(age()).toHaveTextContent('3s');
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Working…');
  act(() => vi.setSystemTime(new Date('2099-01-01T00:00:00Z')));
  advance(2000);
  expect(age()).toHaveTextContent('5s');
  advance(60000);
  expect(age()).toHaveTextContent('1m 5s');
  expect(age()).toHaveAttribute('title', expect.stringContaining('Provider start time and duration are unknown'));
});

it('keeps observation age and the last verified event across reconnect and status recovery', () => {
  const event = { type: 'tool.started' as const, tool: 'synthetic_tool', preview: 'Fixture', publicRunId: active.publicRunId!, timestamp: '2000-01-01T00:00:00.000Z' };
  const run = { ...active, events: [event] };
  const view = render(<TurnView {...props} turn={run} />);
  advance(4000);
  view.rerender(<TurnView {...props} turn={{ ...run, phase: 'Reconnecting — preview retained', activityUnavailable: true }} />);
  advance(2000);
  expect(age()).toHaveTextContent('6s');
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Reconnecting · Last reported: Tool started: synthetic_tool');
  view.rerender(<TurnView {...props} turn={run} />);
  advance(1000);
  expect(age()).toHaveTextContent('7s');
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent('Tool started: synthetic_tool');
});

it('resets on restored view and a different request, without deriving start time from old events', () => {
  const view = render(<TurnView {...props} turn={active} />);
  advance(8000);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  const restored = render(<TurnView {...props} turn={{ ...active, intent: { ...active.intent, input: null }, phase: 'Recovering status', activityUnavailable: true }} />);
  expect(age()).toHaveTextContent('0s');
  advance(2000);
  expect(age()).toHaveTextContent('2s');
  restored.rerender(<TurnView {...props} turn={{ ...active, intent: { ...active.intent, clientRequestId: 'different-request' } }} />);
  expect(age()).toHaveTextContent('0s');
});

it.each(['completed', 'failed', 'cancelled', 'interrupted'])('stops and removes observation age at terminal %s', status => {
  const view = render(<TurnView {...props} turn={active} />);
  advance(3000);
  expect(age()).toHaveTextContent('3s');
  view.rerender(<TurnView {...props} turn={{ ...active, done: true, phase: `Run ${status}` }} />);
  expect(screen.queryByRole('timer')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  advance(10000);
  expect(screen.getByRole('status', { name: 'Run status' })).toHaveTextContent(`Run ${status}`);
  view.unmount();
  render(<TurnView {...props} turn={{ ...active, intent: { ...active.intent, input: null }, done: true, phase: `Run ${status}` }} />);
  expect(screen.queryByRole('timer')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
