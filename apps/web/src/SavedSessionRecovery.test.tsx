import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CommandBootstrap, ProjectRoom } from '@jarvis-command/contracts';
import { App } from './App';
import { StrictMode } from 'react';
const key = 'jarvis-command:selected-session:v1', projectKey = 'jarvis-command:project-room:v1';
const sessions = ['a', 'b'].map(letter => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC saved ${letter}`, source: 'jarvis-command', ownership: 'command' as const, model: null, lastActive: '2026-11-09T15:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false }));
const [a, b] = sessions;
const bootstrap: CommandBootstrap = { identity: { provider: 'development' }, command: { version: 'SYNTHETIC recovery', environment: 'test', generatedAt: '2026-11-09T15:00:00Z', liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [b!] };
let mutations: string[] = [];
afterEach(() => { expect(mutations).toEqual([]); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture(rooms: ProjectRoom[] = []) {
  mutations = [];
  sessionStorage.setItem(key, a!.id);
  sessionStorage.setItem('jarvis-command:text-drafts:v1', JSON.stringify({ [a!.id]: 'SYNTHETIC draft A', [b!.id]: 'SYNTHETIC draft B' }));
  let release!: (response: Response) => void;
  let next: Response | undefined;
  const response = new Promise<Response>(resolve => { release = resolve; });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') { mutations.push(`${init.method} ${url}`); throw Error('No mutation authorized'); }
    if (url === '/api/rooms') return Response.json({ version: 1, rooms });
    if (url === `/api/live/sessions/${a!.id}`) return next ? next.clone() : response.then(value => value.clone());
    if (url.includes('/messages?')) { const id = url.split('/')[3]; return Response.json({ sessionId: id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } }); }
    if (url === '/api/live/model-options') return Response.json({ default: { provider: 'openai-codex', model: 'synthetic' }, options: [] });
    return new Response('', { status: 503 });
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, release, next: (value: Response) => { next = value; }, lookup: () => fetcher.mock.calls.filter(([url]) => url === `/api/live/sessions/${a!.id}`), history: () => fetcher.mock.calls.filter(([url]) => url.includes(`/api/sessions/${a!.id}/messages`)) };
}
it('verifies a missing-bootstrap hint before history; keeps it across reload and restores only its draft', async () => {
  const f = fixture();
  let view = render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(f.lookup()).toHaveLength(1));
  expect(f.lookup()[0]![1]).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  expect(sessionStorage.getItem(key)).toBe(a!.id); expect(f.history()).toHaveLength(0);
  view.unmount();
  view = render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(f.lookup()).toHaveLength(2));
  await act(async () => f.release(Response.json({ session: a })));
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(a!.title));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft A'));
  expect(sessionStorage.getItem(key)).toBe(a!.id);
  expect(f.fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  view.unmount();
});
it.each([401, 403, 404, 503, 'malformed', 'external', 'mismatch'])('retains an honest retryable hint after %s without reading its history', async failure => {
  const f = fixture(); render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(f.lookup()).toHaveLength(1));
  await act(async () => f.release(typeof failure === 'number' ? new Response('', { status: failure }) : Response.json(failure === 'malformed' ? {} : { session: failure === 'external' ? { ...a, ownership: 'external' } : b })));
  await screen.findByRole('button', { name: 'Retry saved chat' });
  expect(sessionStorage.getItem(key)).toBe(a!.id); expect(f.history()).toHaveLength(0);
  expect(f.lookup()).toHaveLength(1);
});
it.each(['success', 'denial'])('ignores late %s after selecting B, preserving B draft and identity', async result => {
  const f = fixture(); render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(f.lookup()).toHaveLength(1));
  const chooseB = screen.getAllByRole('button', { name: /SYNTHETIC saved b/ })[0]!;
  await waitFor(() => expect(chooseB).toBeEnabled());
  fireEvent.click(chooseB);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft B'));
  await act(async () => f.release(result === 'success' ? Response.json({ session: a }) : new Response('', { status: 403 })));
  expect(screen.getByLabelText('Selected session')).toHaveTextContent(b!.title);
  expect(sessionStorage.getItem(key)).toBe(b!.id); expect(f.history()).toHaveLength(0);
});
it.each(['invalid', 'project', 'offline', 'disabled'])('does not probe or globally restore %s hints', async mode => {
  const f = fixture();
  if (mode === 'invalid') sessionStorage.setItem(key, '../private');
  if (mode === 'project') sessionStorage.setItem(projectKey, 'room_' + 'c'.repeat(32));
  const data = structuredClone(bootstrap);
  if (mode === 'offline') data.hermes.state = 'offline';
  if (mode === 'disabled') data.command.liveRoom.enabled = false;
  render(<App loadBootstrap={async () => data} />);
  await screen.findByLabelText('Selected session');
  if (mode !== 'disabled') await waitFor(() => expect(f.fetcher).toHaveBeenCalled());
  expect(f.lookup()).toHaveLength(0); expect(f.history()).toHaveLength(0);
  expect(sessionStorage.getItem(key)).toBe(mode === 'invalid' ? '../private' : a!.id);
  if (mode === 'project') expect(sessionStorage.getItem(projectKey)).toBe('room_' + 'c'.repeat(32));
});

it('retries only on explicit action and opens the newly verified exact session', async () => {
  const f = fixture(); render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(f.lookup()).toHaveLength(1));
  await act(async () => f.release(new Response('', { status: 503 })));
  const retry = await screen.findByRole('button', { name: 'Retry saved chat' });
  expect(f.lookup()).toHaveLength(1); expect(f.history()).toHaveLength(0);
  f.next(Response.json({ session: a })); fireEvent.click(retry);
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(a!.title));
  expect(f.lookup()).toHaveLength(2);
});
it('keeps a missing project hint through project reload without a global chat lookup', async () => {
  const f = fixture(), project = 'room_' + 'c'.repeat(32);
  sessionStorage.setItem(projectKey, project);
  render(<App loadBootstrap={async () => bootstrap} />);
  const retry = (await screen.findAllByRole('button', { name: 'Reload projects' }))[0]!;
  fireEvent.click(retry);
  await waitFor(() => expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/rooms')).toHaveLength(2));
  expect(sessionStorage.getItem(key)).toBe(a!.id); expect(sessionStorage.getItem(projectKey)).toBe(project);
  expect(f.lookup()).toHaveLength(0); expect(f.history()).toHaveLength(0);
});
it('pauses a late recovery when Studio is opened without moving focus or replacing its view', async () => {
  const f = fixture(); render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(f.lookup()).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: /Studio crew/ }));
  const studio = await screen.findByRole('region', { name: 'Studio crew' });
  await waitFor(() => expect(studio).toHaveFocus());
  await act(async () => f.release(Response.json({ session: a })));
  expect(studio).toBeVisible(); expect(studio).toHaveFocus();
  expect(f.history()).toHaveLength(0); expect(sessionStorage.getItem(key)).toBe(a!.id);
});

it.each(['success', 'denial'])('ignores late %s after choosing a verified project and keeps its session draft', async result => {
  const room: ProjectRoom = { id: 'room_' + 'c'.repeat(32), name: 'SYNTHETIC new project', goal: 'Scoped recovery', instructions: '', repository: '', notes: [], archived: false, sessionIds: [b!.id], lastSessionId: b!.id };
  const f = fixture([room]);
  // Existing project restoration must resolve its member independently of the saved global hint.
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation((url, init) => url === `/api/live/sessions/${b!.id}` ? Promise.resolve(Response.json({ session: b })) : original(url, init));
  render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(f.lookup()).toHaveLength(1));
  const choose = (await screen.findAllByRole('button', { name: /SYNTHETIC new project/ }))[0]!;
  await waitFor(() => expect(choose).toBeEnabled()); fireEvent.click(choose);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft B'));
  await act(async () => f.release(result === 'success' ? Response.json({ session: a }) : new Response('', { status: 403 })));
  expect(screen.getByLabelText('Selected session')).toHaveTextContent(b!.title);
  expect(sessionStorage.getItem(projectKey)).toBe(room.id); expect(sessionStorage.getItem(key)).toBe(b!.id);
  expect(f.history()).toHaveLength(0);
});
it('does not expose a bootstrap session while its saved project membership is unresolved', async () => {
  const f = fixture(); sessionStorage.setItem(key, b!.id); sessionStorage.setItem(projectKey, 'room_' + 'c'.repeat(32));
  render(<App loadBootstrap={async () => bootstrap} />);
  await screen.findAllByRole('button', { name: 'Reload projects' });
  expect(screen.getByLabelText('Selected session')).not.toHaveTextContent(b!.title);
  expect(f.fetcher.mock.calls.some(([url]) => url.includes('/messages?'))).toBe(false);
  expect(sessionStorage.getItem(key)).toBe(b!.id);
});

it('waits for the initial project adapter before a fast metadata recovery, including reload', async () => {
  const f = fixture(); let inventory!: () => void;
  const ready = new Promise<void>(resolve => { inventory = resolve; });
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async (url, init) => {
    if (url === '/api/rooms') { await ready; return Response.json({ version: 1, rooms: [] }); }
    return original(url, init);
  });
  f.next(Response.json({ session: a }));
  const view = render(<StrictMode><App loadBootstrap={async () => bootstrap} /></StrictMode>);
  await waitFor(() => expect(f.fetcher.mock.calls.some(([url]) => url === '/api/rooms')).toBe(true));
  expect(f.lookup()).toHaveLength(0); expect(sessionStorage.getItem(key)).toBe(a!.id);
  await act(async () => inventory());
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(a!.title));
  view.unmount(); render(<App loadBootstrap={async () => bootstrap} />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft A'));
  expect(screen.queryByRole('button', { name: 'Retry saved chat' })).not.toBeInTheDocument();
});

it('does not start delayed startup recovery after the user enters Studio', async () => {
  const f = fixture(); let inventory!: () => void;
  const ready = new Promise<void>(resolve => { inventory = resolve; });
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async (url, init) => {
    if (url === '/api/rooms') { await ready; return Response.json({ version: 1, rooms: [] }); }
    return original(url, init);
  });
  f.next(Response.json({ session: a })); render(<App loadBootstrap={async () => bootstrap} />);
  fireEvent.click(await screen.findByRole('button', { name: /Studio crew/ }));
  const studio = await screen.findByRole('region', { name: 'Studio crew' });
  await act(async () => inventory());
  expect(studio).toHaveFocus(); expect(f.lookup()).toHaveLength(0);
  expect(sessionStorage.getItem(key)).toBe(a!.id);
});
