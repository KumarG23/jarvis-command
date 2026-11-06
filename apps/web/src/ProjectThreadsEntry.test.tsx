import type { CommandBootstrap } from '@jarvis-command/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { threadRecoveryKey } from './turnRecovery';

const timestamp = '2026-10-31T12:00:00Z';
const sessions = ['a', 'b', 'c'].map((letter, index) => ({ id: `jc_${letter.repeat(32)}`, title: ['SYNTHETIC primary', 'SYNTHETIC side', 'SYNTHETIC target'][index]!, source: 'api_server', ownership: 'command' as const, model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));
const [current, side, target] = sessions;
const project = { id: `room_${'d'.repeat(32)}`, name: 'SYNTHETIC pane lifetime', goal: 'Retain explicit selection', instructions: '', archived: false, repository: '', notes: [], sessionIds: sessions.map(session => session.id), lastSessionId: current!.id, threads: sessions.map(session => ({ sessionId: session.id, title: session.title, archived: false, createdAt: timestamp })) };
const bootstrap: CommandBootstrap = { identity: { provider: 'development' }, command: { version: 'SYNTHETIC', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['unknown', 'running', 'completed'])('opens the existing roster with %s status, preserves drafts and external read-only behavior', async status => {
  const runId = `jcr_${'b'.repeat(32)}`;
  if (status !== 'unknown') sessionStorage.setItem(threadRecoveryKey, JSON.stringify({ version: 2, legacyImported: true, records: [{ sessionId: side!.id, projectId: project.id, publicRunId: runId, clientRequestId: '12345678-1234-4234-8234-123456789abc' }] }));
  vi.stubGlobal('EventSource', class { close() {} addEventListener() {} });
  sessionStorage.setItem('jarvis-command:project-room:v1', project.id);
  const external = { ...target!, ownership: 'external' as const };
  const room = { ...project, leadSessionId: current!.id, threads: project.threads.map(thread => ({ ...thread, archived: thread.sessionId === side!.id })) };
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/live/runs/${runId}`) return Response.json({ publicRunId: runId, sessionId: side!.id, status, updatedAt: timestamp, approval: null, output: null, error: null, pendingSteer: null, usage: null });
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [room] });
    if (url === `/api/rooms/${room.id}/sessions`) {
      const id = JSON.parse(String(init?.body)).sessionId;
      return Response.json({ room: { ...room, lastSessionId: id }, session: id === external.id ? external : current });
    }
    const session = [current!, side!, external].find(session => url === `/api/live/sessions/${session.id}`);
    if (session) return Response.json({ session });
    if (url.startsWith('/api/sessions/')) {
      const id = new URL(url, 'http://synthetic.test').pathname.split('/')[3]!;
      return Response.json({ sessionId: id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
    }
    if (url === '/api/live/model-options') return Response.json({ default: { provider: 'openai-codex', model: 'synthetic' }, options: [] });
    return new Response('', { status: 503 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<App loadBootstrap={async () => ({ ...bootstrap, sessions: [current!, side!, external] })} />);
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(current!.title));
  const draft = await screen.findByRole('textbox', { name: 'Message Jarvis' });
  fireEvent.change(draft, { target: { value: 'SYNTHETIC retained draft' } });
  const entry = screen.getByRole('button', { name: 'Threads' });
  expect(entry.closest('header')).toHaveClass('command-header');
  expect(entry).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(entry);
  const roster = await screen.findByRole('region', { name: 'Project threads' });
  await waitFor(() => expect(roster).toHaveFocus());
  expect(scroll).toHaveBeenCalled();
  expect(entry).toHaveAttribute('aria-expanded', 'true');
  expect(within(roster).getByRole('heading', { name: 'Archived threads' })).toBeVisible();
  expect(within(roster).getAllByText(/Unknown — no verified Command run/)).toHaveLength(status === 'unknown' ? 3 : 2);
  if (status !== 'unknown') await within(roster).findByText(new RegExp(`Run ${status}.*latest Command run`));
  fireEvent.click(within(roster).getByRole('button', { name: external.title }));
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(external.title));
  expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Threads' })).toBeVisible();
  fireEvent.click(entry);
  fireEvent.click(await screen.findByRole('button', { name: `Open lead: ${current!.title}` }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC retained draft'));
  fireEvent.click(entry);
  fireEvent.keyDown(await screen.findByRole('region', { name: 'Project threads' }), { key: 'Escape' });
  expect(entry).toHaveFocus();
  expect(entry).toHaveAttribute('aria-expanded', 'false');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').every(([url]) => url === `/api/rooms/${room.id}/sessions`)).toBe(true);
});

it('does not show Threads outside a selected project', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  render(<App loadBootstrap={async () => bootstrap} />);
  await screen.findByRole('main');
  expect(screen.queryByRole('button', { name: 'Threads' })).not.toBeInTheDocument();
});
