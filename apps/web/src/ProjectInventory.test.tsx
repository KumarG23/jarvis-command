import type { CommandBootstrap, ProjectRoom } from '@jarvis-command/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { createReadbackFixture } from './readbackFixture';
import { readThreadRecoveries, threadRecoveryKey } from './turnRecovery';

const timestamp = '2026-11-01T12:00:00Z';
const sessions = ['a', 'b', 'c', 'd'].map((letter, index) => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC canonical ${index}`, source: 'api_server', ownership: 'command' as const, model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));
const [a, b, c, d] = sessions;
const runs = sessions.map((_, i) => `jcr_${String(i + 1).repeat(32)}`);
const requests = sessions.map((_, i) => `12345678-1234-4234-8234-123456789ab${i}`);
const room: ProjectRoom = { id: `room_${'e'.repeat(32)}`, name: 'SYNTHETIC selected project', goal: 'Resolve exact authorized threads', instructions: '', archived: false, repository: '', notes: [], sessionIds: sessions.map(session => session.id), lastSessionId: a!.id, threads: sessions.map((session, i) => ({ sessionId: session.id, title: `SYNTHETIC local ${i}`, archived: i === 2, createdAt: timestamp })) };
const otherRoom: ProjectRoom = { ...room, id: `room_${'f'.repeat(32)}`, name: 'SYNTHETIC original retained project', sessionIds: [b!.id], lastSessionId: b!.id, threads: [room.threads![1]!] };
const bootstrap: CommandBootstrap = { identity: { provider: 'development' }, command: { version: 'SYNTHETIC inventory', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [a!] };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture(project = room) {
  sessionStorage.setItem('jarvis-command:project-room:v1', project.id);
  const posts: { sessionId: string; clientRequestId: string; input: string }[] = [];
  const readbacks = createReadbackFixture<Response>();
  const rooms = [project, otherRoom];
  const linkedMessages = new Map<string, string>();
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/live/runs' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); posts.push(body);
      return Response.json({ sessionId: body.sessionId, clientRequestId: body.clientRequestId, publicRunId: runs[sessions.findIndex(session => session.id === body.sessionId)], status: 'running', replayed: false });
    }
    if (init?.method && init.method !== 'GET') throw Error('SYNTHETIC unexpected mutation');
    if (url === '/api/rooms') return Response.json({ version: 1, rooms });
    const index = sessions.findIndex(session => url === `/api/live/sessions/${session.id}`);
    if (index >= 0) return readbacks.read(sessions[index]!.id, () => Response.json({ session: index === 3 ? { ...d, ownership: 'external' } : sessions[index] }));
    const lookupIndex = sessions.findIndex(session => url.startsWith(`/api/live/sessions/${session.id}/run-requests/`));
    if (lookupIndex >= 0) return Response.json({ sessionId: sessions[lookupIndex]!.id, clientRequestId: requests[lookupIndex], publicRunId: runs[lookupIndex] });
    const runIndex = runs.findIndex(run => url === `/api/live/runs/${run}`);
    if (runIndex >= 0) return Response.json({ publicRunId: runs[runIndex], sessionId: sessions[runIndex]!.id, status: 'running', updatedAt: timestamp, approval: null, output: `SYNTHETIC output ${runIndex}`, error: null, pendingSteer: null, usage: null });
    if (url.startsWith('/api/sessions/')) {
      const sessionId = new URL(url, 'http://synthetic.test').pathname.split('/')[3]!;
      const content = linkedMessages.get(sessionId);
      const messages = content ? [{ id: `${sessionId}:answer`, sessionId, role: 'assistant', content, timestamp, toolName: null, displayKind: null }] : [];
      return Response.json({ sessionId, messages, pagination: { limit: 50, offset: 0, returned: messages.length, hasMore: false } });
    }
    if (url === '/api/live/model-options') return Response.json({ default: { provider: 'openai-codex', model: 'synthetic' }, options: [] });
    if (url === '/api/notifications') return Response.json({ version: 1, items: [], unreadCount: 0, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } }, delivery: { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' } });
    return new Response('', { status: 503 });
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('EventSource', class { close() {} addEventListener() {} });
  return { posts, readbacks, fetcher, rooms, linkedMessages };
}
async function primary() {
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(a!.title));
  return within(screen.getByRole('main')).findByRole('textbox', { name: 'Message Jarvis' });
}
function recoverBoth() {
  sessionStorage.setItem(threadRecoveryKey, JSON.stringify({ version: 2, legacyImported: true, records: [
    { sessionId: a!.id, clientRequestId: requests[0], publicRunId: null, projectId: room.id },
    { sessionId: b!.id, clientRequestId: requests[1], publicRunId: null, projectId: otherRoom.id },
  ] }));
}

it('offers an unvisited linked B outside bootstrap with separate local/canonical titles and independent fixture sends', async () => {
  const f = fixture();
  render(<App loadBootstrap={async () => bootstrap} />);
  const draft = await primary();
  const selector = screen.getByRole('combobox', { name: 'Second conversation' });
  const option = await screen.findByRole('option', { name: 'SYNTHETIC local 1 · SYNTHETIC canonical 1' });
  expect(option).toBeEnabled();
  expect(screen.getByRole('option', { name: /SYNTHETIC local 2.*Archived/ })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole('option', { name: /SYNTHETIC local 3.*Read-only external/ })).toBeDisabled());
  expect(f.posts).toHaveLength(0);
  fireEvent.change(selector, { target: { value: b!.id } });
  const second = within(await screen.findByRole('region', { name: 'Second conversation pane' }));
  fireEvent.change(draft, { target: { value: 'SYNTHETIC explicit A' } });
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Send message' }));
  fireEvent.change(await second.findByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'SYNTHETIC explicit B' } });
  fireEvent.click(second.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.posts).toHaveLength(2));
  expect(f.posts.map(post => post.sessionId)).toEqual([a!.id, b!.id]);
  expect(new Set(f.posts.map(post => post.clientRequestId)).size).toBe(2);
  expect(readThreadRecoveries().map(record => record.sessionId).sort()).toEqual([a!.id, b!.id]);
});

it('reloads two opaque records outside recents read-only and opens the retained session in its original project', async () => {
  const f = fixture({ ...room, sessionIds: [a!.id], threads: [room.threads![0]!] });
  recoverBoth();
  render(<App loadBootstrap={async () => bootstrap} />);
  fireEvent.change(await primary(), { target: { value: 'SYNTHETIC draft A stays' } });
  const supervisor = await screen.findByRole('button', { name: `Supervise ${b!.id}` });
  await waitFor(() => expect(supervisor).toHaveTextContent('Run running'));
  await waitFor(() => expect(readThreadRecoveries().every(record => !!record.publicRunId)).toBe(true));
  fireEvent.click(supervisor);
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(b!.title));
  expect(screen.getByLabelText('Selected project')).toHaveTextContent(otherRoom.name);
  expect(f.fetcher.mock.calls.some(([url]) => url === `/api/live/sessions/${b!.id}`)).toBe(true);
  expect(readThreadRecoveries()).toHaveLength(2);
  expect(f.posts).toHaveLength(0);
  expect(f.fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it.each(['denied', 'foreign', 'external', 'membership', 'archived-thread', 'archived-project', 'away-back', 'newer-navigation'] as const)('refuses adverse retained read %s without losing drafts or identities', async mode => {
  const f = fixture({ ...room, sessionIds: [a!.id], threads: [room.threads![0]!] });
  recoverBoth();
  render(<App loadBootstrap={async () => bootstrap} />);
  fireEvent.change(await primary(), { target: { value: 'SYNTHETIC unchanged draft A' } });
  await waitFor(() => expect(readThreadRecoveries().every(record => !!record.publicRunId)).toBe(true));
  const before = sessionStorage.getItem(threadRecoveryKey);
  f.readbacks.arm();
  if (mode === 'membership') f.rooms[1] = { ...otherRoom, sessionIds: [], threads: [], lastSessionId: null };
  if (mode === 'archived-thread') f.rooms[1] = { ...otherRoom, threads: otherRoom.threads!.map(thread => ({ ...thread, archived: true })) };
  if (mode === 'archived-project') f.rooms[1] = { ...otherRoom, archived: true };
  fireEvent.click(screen.getByRole('button', { name: `Supervise ${b!.id}` }));
  await waitFor(() => expect(f.readbacks.pending(b!.id)).toBe(1));
  if (mode === 'newer-navigation') {
    // A later retained click supersedes B, even when the source selection stays A.
    fireEvent.click(screen.getByRole('button', { name: `Supervise ${a!.title}` }));
    await waitFor(() => expect(f.readbacks.pending(a!.id)).toBe(1));
    await act(async () => { f.readbacks.resolve(a!.id, Response.json({ session: a })); });
  }
  if (mode === 'away-back') {
    fireEvent.click(screen.getByRole('button', { name: a!.title }));
    await waitFor(() => expect(screen.queryByLabelText('Selected project')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: room.name }));
    await waitFor(() => expect(f.readbacks.pending(a!.id)).toBe(1));
    await act(async () => { f.readbacks.resolve(a!.id, Response.json({ session: a })); });
    await primary();
  }
  await act(async () => {
    if (mode === 'denied') f.readbacks.resolve(b!.id, new Response('', { status: 403 }));
    else f.readbacks.resolve(b!.id, Response.json({ session: mode === 'foreign' ? c : mode === 'external' ? { ...b, ownership: 'external' } : b }));
  });
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(a!.title));
  expect(within(screen.getByRole('main')).getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC unchanged draft A');
  if (mode !== 'away-back' && mode !== 'newer-navigation') expect(screen.getByText(/kept.*No message was sent/)).toBeVisible();
  expect(sessionStorage.getItem(threadRecoveryKey)).toBe(before);
  expect(f.posts).toHaveLength(0);
});

it('labels failed exact inventory reads unavailable and permits explicit retry without visiting or sending', async () => {
  const f = fixture();
  const original = f.fetcher.getMockImplementation()!;
  let denied = true;
  f.fetcher.mockImplementation((url, init) => url === `/api/live/sessions/${b!.id}` && denied ? Promise.resolve(new Response('', { status: 403 })) : original(url, init));
  render(<App loadBootstrap={async () => bootstrap} />);
  fireEvent.change(await primary(), { target: { value: 'SYNTHETIC draft survives inventory error' } });
  await screen.findByRole('button', { name: 'Retry chat titles' });
  expect(screen.getByRole('option', { name: /SYNTHETIC local 1.*Unavailable/ })).toBeDisabled();
  denied = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry chat titles' }));
  expect(await screen.findByRole('option', { name: 'SYNTHETIC local 1 · SYNTHETIC canonical 1' })).toBeEnabled();
  expect(within(screen.getByRole('main')).getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft survives inventory error');
  expect(f.posts).toHaveLength(0);
});

it('opens an unscoped retained session from the active notice by exact read without attaching the selected project', async () => {
  const f = fixture({ ...room, sessionIds: [a!.id], threads: [room.threads![0]!] });
  recoverBoth();
  sessionStorage.setItem(threadRecoveryKey, JSON.stringify({ version: 2, legacyImported: true, records: readThreadRecoveries().map(({ sessionId, clientRequestId, publicRunId }) => ({ sessionId, clientRequestId, publicRunId })) }));
  render(<App loadBootstrap={async () => bootstrap} />);
  fireEvent.change(await primary(), { target: { value: 'SYNTHETIC preserved unscoped draft A' } });
  await waitFor(() => expect(readThreadRecoveries().every(record => !!record.publicRunId)).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'View active chat' }));
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(b!.title));
  expect(screen.queryByLabelText('Selected project')).toBeNull();
  expect(f.fetcher.mock.calls.some(([url]) => url === `/api/live/sessions/${b!.id}`)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: a!.title }));
  expect(await primary()).toHaveValue('SYNTHETIC preserved unscoped draft A');
  expect(readThreadRecoveries()).toHaveLength(2);
  expect(f.posts).toHaveLength(0);
});

it.each(['retained', 'link'] as const)('gives the newer %s click priority over the other pending navigation kind', async latest => {
  const f = fixture({ ...room, sessionIds: [a!.id, c!.id], threads: [room.threads![0]!, { ...room.threads![2]!, archived: false }] });
  f.linkedMessages.set(a!.id, `[Open C](thread:${c!.id})`);
  recoverBoth();
  render(<App loadBootstrap={async () => bootstrap} />);
  fireEvent.change(await primary(), { target: { value: 'SYNTHETIC cross-navigation draft A' } });
  await screen.findByRole('button', { name: 'Open C' });
  await screen.findByRole('option', { name: 'SYNTHETIC local 2 · SYNTHETIC canonical 2' });
  await waitFor(() => expect(readThreadRecoveries().every(record => !!record.publicRunId)).toBe(true));
  f.readbacks.arm();
  const clickLink = () => fireEvent.click(screen.getByRole('button', { name: 'Open C' }));
  const clickRetained = () => fireEvent.click(screen.getByRole('button', { name: `Supervise ${b!.id}` }));
  if (latest === 'retained') { clickLink(); await waitFor(() => expect(f.readbacks.pending(c!.id)).toBe(1)); clickRetained(); }
  else { clickRetained(); await waitFor(() => expect(f.readbacks.pending(b!.id)).toBe(1)); clickLink(); }
  await waitFor(() => expect(f.readbacks.pending(c!.id)).toBe(1));
  await waitFor(() => expect(f.readbacks.pending(b!.id)).toBe(1));
  const older = latest === 'retained' ? c! : b!, newer = latest === 'retained' ? b! : c!;
  await act(async () => { f.readbacks.resolve(older.id, Response.json({ session: older })); });
  expect(screen.getByLabelText('Selected session')).toHaveTextContent(a!.title);
  expect(within(screen.getByRole('main')).getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC cross-navigation draft A');
  await act(async () => { f.readbacks.resolve(newer.id, Response.json({ session: newer })); });
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(newer.title));
  expect(screen.getByLabelText('Selected project')).toHaveTextContent(latest === 'retained' ? otherRoom.name : room.name);
  expect(readThreadRecoveries()).toHaveLength(2);
  expect(f.posts).toHaveLength(0);
});
