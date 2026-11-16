import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ThreadState } from '@jarvis-command/contracts';
import type { Turn } from './useLiveTurn';
import type { useThreadTurns } from './useThreadTurns';
import { App } from './App';

const fixture = vi.hoisted(() => ({ retained: null as (Turn & { verifiedStatus: string }) | null, state: undefined as ThreadState | undefined, now: Date.parse('2026-11-07T13:00:00Z') }));
vi.mock('./useThreadStates', () => ({ useThreadStates: () => ({ states: fixture.state ? { [fixture.state.sessionId]: fixture.state } : {}, clock: fixture.now, viewed: vi.fn() }) }));
vi.mock('./useThreadTurns', async original => {
  const actual = await original<{ useThreadTurns: typeof useThreadTurns }>();
  return { useThreadTurns: (...args: Parameters<typeof actual.useThreadTurns>) => {
    const threads = actual.useThreadTurns(...args);
    return { ...threads, all: fixture.retained ? [...threads.all, { ...threads.get(fixture.retained.intent.sessionId), turn: fixture.retained }] : threads.all };
  } };
});
const session = { id: 'jc_' + 'a'.repeat(32), title: 'Owned source-only status fixture', source: 'jarvis-command', ownership: 'command', model: null, lastActive: new Date(fixture.now).toISOString(), messageCount: 0, toolCallCount: 0, pinned: false };
afterEach(() => { vi.unstubAllGlobals(); fixture.retained = null; fixture.state = undefined; fixture.now = Date.parse('2026-11-07T13:00:00Z'); });

it.each(['completed', 'waiting_for_approval'])('delayed prior run A %s cannot replace run B Working observed from another device', async priorStatus => {
  const timestamp = new Date(fixture.now).toISOString();
  fixture.state = { sessionId: session.id, runStatus: 'running', runObservedAt: timestamp, observedAt: timestamp, recentAt: null, latest: null, lastRead: null, unread: false, historyComplete: true };
  fixture.retained = { intent: { sessionId: session.id, clientRequestId: 'prior-A', input: null }, publicRunId: 'jcr_' + 'a'.repeat(32), verifiedStatus: priorStatus, identityVerified: true, statusObservedAt: new Date(fixture.now + 1).toISOString(), phase: `Run ${priorStatus}`, output: '', outputLimited: false, events: [], approval: null, done: priorStatus === 'completed', historyMatched: false };
  fixture.now += 2;
  sessionStorage.setItem('jarvis-command:selected-session:v1', session.id);
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/bootstrap') return Response.json({ identity: { provider: 'development' }, command: { version: 'source-test', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session] });
    if (path === '/api/rooms') return Response.json({ version: 1, rooms: [] });
    if (path === `/api/live/sessions/${session.id}`) return Response.json({ session });
    if (path.includes('/messages?')) return Response.json({ sessionId: session.id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
    if (path === '/api/live/model-options') return Response.json({ default: { provider: 'openai-codex', model: 'fixture' }, options: [] });
    return new Response('', { status: 503 });
  }));
  const { rerender } = render(<App />);
  await screen.findByLabelText('Selected session');
  const header = () => within(document.querySelector('.header-thread-states') as HTMLElement);
  expect(header().getByRole('img', { name: 'Working' })).toBeInTheDocument();
  fixture.retained = { ...fixture.retained!, identityVerified: false, publicRunId: null };
  rerender(<App />);
  expect(header().getByRole('img', { name: 'Working' })).toBeInTheDocument();
  // A later old-run response, including a locally verified identity, is still not
  // evidence that A is the latest run in this session. It must not revive stale facts.
  fixture.retained = { ...fixture.retained!, identityVerified: true, publicRunId: 'jcr_' + 'a'.repeat(32), statusObservedAt: new Date(fixture.now + 60_002).toISOString() };
  fixture.now += 60_003;
  rerender(<App />);
  expect(document.querySelector('.header-thread-states')).toBeNull();
  fixture.state = undefined;
  rerender(<App />);
  expect(document.querySelector('.header-thread-states')).toBeNull();
  // Same-session read state remains owned by the server snapshot, never A's receipt.
  fixture.state = { sessionId: session.id, runStatus: 'unknown', runObservedAt: null, observedAt: new Date(fixture.now).toISOString(), recentAt: null, latest: { messageId: 'new-output', position: 1 }, lastRead: null, unread: true, historyComplete: true };
  rerender(<App />);
  expect(header().getByRole('img', { name: 'Unread' })).toBeInTheDocument();
});
