import type { CommandBootstrap } from '@jarvis-command/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { createReadbackFixture } from './readbackFixture';

const timestamp = '2026-10-31T12:00:00Z';
const sessions = ['a', 'b', 'c'].map((letter, index) => ({ id: `jc_${letter.repeat(32)}`, title: ['SYNTHETIC primary', 'SYNTHETIC side', 'SYNTHETIC target'][index]!, source: 'api_server', ownership: 'command' as const, model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));
const [current, side, target] = sessions;
const project = { id: `room_${'d'.repeat(32)}`, name: 'SYNTHETIC pane lifetime', goal: 'Retain explicit selection', instructions: '', archived: false, repository: '', notes: [], sessionIds: sessions.map(session => session.id), lastSessionId: current!.id, threads: sessions.map(session => ({ sessionId: session.id, title: session.title, archived: false, createdAt: timestamp })) };
const bootstrap: CommandBootstrap = { identity: { provider: 'development' }, command: { version: 'SYNTHETIC', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['close', 'change', 'away-back', 'current', 'primary'] as const)('binds asynchronous links to their source pane lifetime: %s', async mode => {
  sessionStorage.setItem('jarvis-command:selected-session:v1', current!.id);
  sessionStorage.setItem('jarvis-command:project-room:v1', project.id);
  const readbacks = createReadbackFixture<Response>();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') throw Error('SYNTHETIC link must never mutate');
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [project] });
    if (url === `/api/live/sessions/${target!.id}`) return readbacks.read(target!.id, () => Response.json({ session: target }));
    const session = sessions.find(session => url === `/api/live/sessions/${session.id}`);
    if (session) return Response.json({ session });
    if (url.startsWith('/api/sessions/')) {
      const id = new URL(url, 'http://synthetic.test').pathname.split('/')[3]!;
      const link = id === (mode === 'primary' ? current!.id : side!.id);
      return Response.json({ sessionId: id, messages: [{ id: `${id}:answer`, sessionId: id, role: 'assistant', content: link ? `[Open target](thread:${target!.id})` : 'SYNTHETIC ordinary answer', timestamp, toolName: null, displayKind: null }], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } });
    }
    if (url === '/api/live/model-options') return Response.json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [] });
    if (url === '/api/notifications') return Response.json({ version: 1, items: [], unreadCount: 0, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } }, delivery: { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' } });
    return new Response('', { status: 503 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(current!.title));
  const selector = await screen.findByRole('combobox', { name: /^Second conversation$/ });
  fireEvent.change(selector, { target: { value: side!.id } });
  await within(await screen.findByRole('region', { name: 'Second conversation pane' })).findByText(/SYNTHETIC ordinary answer|Open target/);
  await act(async () => {});
  const primaryDraft = within(screen.getByRole('main')).getByRole('textbox', { name: 'Message Jarvis' });
  fireEvent.change(primaryDraft, { target: { value: 'SYNTHETIC retained primary draft' } });
  readbacks.arm();
  // Use the current mounted DOM after the pane's history/effects have settled.
  const source = mode === 'primary' ? screen.getByRole('main') : screen.getByRole('region', { name: 'Second conversation pane' });
  fireEvent.click(within(source).getByRole('button', { name: 'Open target' }));
  await waitFor(() => expect(readbacks.pending(target!.id)).toBe(1));
  if (mode === 'close' || mode === 'primary') fireEvent.click(screen.getByRole('button', { name: 'Close second conversation' }));
  if (mode === 'change' || mode === 'away-back') fireEvent.change(selector, { target: { value: target!.id } });
  if (mode === 'away-back') fireEvent.change(selector, { target: { value: side!.id } });
  await act(async () => { readbacks.resolve(target!.id, Response.json({ session: target })); });
  const succeeds = mode === 'current' || mode === 'primary';
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(succeeds ? target!.title : current!.title));
  if (!succeeds) expect(within(screen.getByRole('main')).getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC retained primary draft');
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
