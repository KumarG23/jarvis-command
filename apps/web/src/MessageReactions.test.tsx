import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionMessage } from '@jarvis-command/contracts';
import { LiveRoom } from './LiveRoom';
import { MessageReactions } from './MessageReactions';
import { useMessageReactions } from './useMessageReactions';
import { createReadbackFixture } from './readbackFixture';

const session = { id: `jc_${'a'.repeat(32)}`, title: 'SYNTHETIC reactions', source: 'jarvis-command', ownership: 'command' as const, model: null, lastActive: '2026-11-06T12:00:00Z', messageCount: 2, toolCallCount: 0, pinned: false };
const otherSession = { ...session, id: `jc_${'b'.repeat(32)}` };
const target = { sessionId: session.id, messageId: 'stored:A', offset: 50 };
const messages: SessionMessage[] = ['A', 'B'].map(id => ({ id: `stored:${id}`, sessionId: session.id, role: 'assistant', content: 'SYNTHETIC identical text', timestamp: null, toolName: null, displayKind: null }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function Harness({ id = session.id, shown = true }: { id?: string; shown?: boolean }) {
  const client = useMessageReactions();
  return shown ? <MessageReactions key={id} client={client} target={{ ...target, sessionId: id }} /> : null;
}
function fixture() {
  let emojis: string[] = [];
  const mutations: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    if (url === '/api/live/reactions/read') return Response.json({ sessionId: body.sessionId, messageId: body.messageId, emojis });
    if (url === '/api/live/reactions/mutate') {
      mutations.push(body); emojis = body.action === 'add' ? [body.emoji] : [];
      return Response.json({ sessionId: body.sessionId, messageId: body.messageId, emojis, active: body.action === 'add', changed: true, replayed: false, clientRequestId: body.clientRequestId });
    }
    throw Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, mutations, set: (value: string[]) => { emojis = value; } };
}
async function open() { fireEvent.click(screen.getByRole('button', { name: 'Reactions' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Thumbs up' })).toBeEnabled()); }

it('lazily reads once per explicit open and uses exact target, add/remove intents, strict transport and authoritative readback', async () => {
  const f = fixture(); const view = render(<Harness />);
  expect(f.fetcher).not.toHaveBeenCalled(); await open();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(f.fetcher.mock.calls[0]![1]!.body as string)).toEqual(target);
  fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true'));
  expect(f.mutations[0]).toMatchObject({ ...target, emoji: '👍', action: 'add', clientRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  expect(f.fetcher.mock.calls[1]![1]).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'x-jarvis-command': '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }));
  await waitFor(() => expect(f.mutations).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Thumbs up' })).toBeEnabled());
  expect(f.mutations[1]!.action).toBe('remove'); expect(f.mutations[1]!.clientRequestId).not.toBe(f.mutations[0]!.clientRequestId);
  view.rerender(<Harness />); expect(f.fetcher).toHaveBeenCalledTimes(5);
  fireEvent.keyDown(screen.getByRole('group', { name: 'Choose reaction' }), { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Choose reaction' })).toBeNull(); expect(screen.getByRole('button', { name: 'Reactions' })).toHaveFocus();
  expect(f.fetcher.mock.calls.every(([url]) => url.startsWith('/api/live/reactions/'))).toBe(true);
});

it('does not retry an unknown ACK automatically, locks conflicts, checks state manually then retries the identical UUID after remount', async () => {
  const f = fixture(); const view = render(<Harness />); await open();
  f.fetcher.mockImplementationOnce(async (_url, init) => { f.mutations.push(JSON.parse(init?.body as string)); f.set(['👍']); throw Error('SYNTHETIC committed, lost ACK'); });
  fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }));
  await screen.findByText(/Save unconfirmed/); expect(f.mutations).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Heart' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Retry same reaction intent' })).toBeNull();
  view.rerender(<Harness shown={false} />); view.rerender(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
  await screen.findByRole('button', { name: 'Retry same reaction intent' });
  expect(screen.getByRole('button', { name: 'Heart' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same reaction intent' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heart' })).toBeEnabled());
  expect(f.mutations).toHaveLength(2); expect(f.mutations[1]).toEqual(f.mutations[0]);
  expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true');
});

it('keeps delayed A reads out of session B and bounds concurrent requests without automatic reads on switching', async () => {
  const f = fixture(), gate = createReadbackFixture<Response>(); gate.arm();
  f.fetcher.mockImplementationOnce(() => gate.read('A', () => Response.json({})));
  const view = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
  view.rerender(<Harness id={otherSession.id} />);
  expect(screen.getByRole('button', { name: 'Reactions' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Remove Thumbs up reaction' })).toBeNull();
  await act(async () => gate.resolve('A', Response.json({ sessionId: session.id, messageId: target.messageId, emojis: ['👍'] })));
  expect(f.fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: 'Remove Thumbs up reaction' })).toBeNull();
  await open(); expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'false');
  expect(JSON.parse(f.fetcher.mock.calls[1]![1]!.body as string).sessionId).toBe(otherSession.id);
});

it.each([
  { sessionId: otherSession.id, messageId: target.messageId, emojis: [] },
  { sessionId: session.id, messageId: 'foreign', emojis: [] },
  { sessionId: session.id, messageId: target.messageId, emojis: ['👍', '👍'] },
  { sessionId: session.id, messageId: target.messageId, emojis: ['🚀'] },
  { sessionId: session.id, messageId: target.messageId, emojis: [], author: 'forged' },
])('rejects mismatched/hostile read response %j', async result => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json(result)); render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
  await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Thumbs up' })).toBeDisabled(); expect(f.mutations).toEqual([]);
});

it('reads current persisted state on reload without reusing a different authenticated shell cache', async () => {
  const f = fixture(); f.set(['❤️']); const view = render(<Harness />); await open();
  expect(screen.getByRole('button', { name: 'Heart' })).toHaveAttribute('aria-pressed', 'true'); view.unmount();
  f.set([]); render(<Harness />); expect(screen.queryByRole('button', { name: 'Remove Heart reaction' })).toBeNull(); await open();
  expect(screen.getByRole('button', { name: 'Heart' })).toHaveAttribute('aria-pressed', 'false'); expect(f.mutations).toEqual([]);
});

function History({ external = false, available = true }: { external?: boolean; available?: boolean }) {
  const client = useMessageReactions();
  return <LiveRoom key={external ? 'external' : 'owned'} session={external ? { ...session, ownership: 'external' } : session} reactions={client} reactionsAvailable={available} onHistory={() => {}} />;
}
it('exposes controls only on eligible durable exact A/B rows, keeps repeated text separate, and never probes disabled/external/tool/setup rows', async () => {
  const f = fixture();
  f.fetcher.mockImplementation(async (url, init) => {
    if (url.includes('/messages?')) return Response.json({ sessionId: session.id, messages: [...messages, { ...messages[0], id: 'user', role: 'user' }, { ...messages[0], id: 'tool', role: 'tool', toolName: 'tool' }, { ...messages[0], id: 'setup', role: 'system' }, { ...messages[0], id: 'display', displayKind: 'setup' }], pagination: { limit: 50, offset: 0, returned: 6, hasMore: false } });
    if (url.includes('/reactions/read')) { const body = JSON.parse(init?.body as string); return Response.json({ sessionId: session.id, messageId: body.messageId, emojis: body.messageId === 'stored:A' ? ['👍'] : [] }); }
    return Response.json({});
  });
  const view = render(<History />); await waitFor(() => expect(document.querySelector('[data-message-id="stored:B"]')).not.toBeNull());
  expect(screen.getAllByRole('button', { name: 'Reactions' })).toHaveLength(3);
  expect(f.fetcher.mock.calls.filter(([url]) => url.includes('/reactions/'))).toHaveLength(0);
  const a = within(document.querySelector('[data-message-id="stored:A"]') as HTMLElement), b = within(document.querySelector('[data-message-id="stored:B"]') as HTMLElement);
  fireEvent.click(a.getByRole('button', { name: 'Reactions' })); await a.findByRole('button', { name: 'Remove Thumbs up reaction' });
  expect(b.queryByRole('button', { name: 'Remove Thumbs up reaction' })).toBeNull();
  expect(JSON.parse(f.fetcher.mock.calls.find(([url]) => url.includes('/reactions/'))![1]!.body as string)).toEqual({ sessionId: session.id, messageId: 'stored:A', offset: 0 });
  view.rerender(<History available={false} />); expect(screen.queryByRole('button', { name: 'Reactions' })).toBeNull(); expect(screen.getByText('Reactions unavailable on this server.')).toBeVisible();
  view.rerender(<History external />); await screen.findByText('Reactions unavailable in read-only chats.'); expect(screen.queryByRole('button', { name: 'Reactions' })).toBeNull();
});

it('uses the loaded page offset for durable B while leaving transient turn output without controls', async () => {
  const f = fixture(); const first = Array.from({ length: 50 }, (_, index) => ({ ...messages[0]!, id: `first:${index}` }));
  f.fetcher.mockImplementation(async (url, init) => {
    if (url.includes('/messages?')) {
      const offset = Number(new URL(url, 'http://fixture').searchParams.get('offset'));
      return Response.json({ sessionId: session.id, messages: offset ? messages : first, pagination: { limit: 50, offset, returned: offset ? 2 : 50, hasMore: !offset } });
    }
    if (url.endsWith('/read')) { const body = JSON.parse(init?.body as string); return Response.json({ sessionId: body.sessionId, messageId: body.messageId, emojis: [] }); }
    return Response.json({});
  });
  function Paged() {
    const client = useMessageReactions();
    return <LiveRoom session={session} reactions={client} reactionsAvailable onHistory={() => {}} />;
  }
  const view = render(<Paged />); fireEvent.click(await screen.findByRole('button', { name: 'Load more messages' }));
  await waitFor(() => expect(document.querySelector('[data-message-id="stored:B"]')).not.toBeNull());
  fireEvent.click(within(document.querySelector('[data-message-id="stored:B"]') as HTMLElement).getByRole('button', { name: 'Reactions' }));
  await screen.findByRole('button', { name: 'Thumbs up' });
  const reads = f.fetcher.mock.calls.filter(([url]) => url.endsWith('/read'));
  expect(reads).toHaveLength(1); expect(JSON.parse(reads[0]![1]!.body as string)).toEqual({ ...target, messageId: 'stored:B', offset: 50 });
  view.unmount();
  const { TurnView } = await import('./TurnView');
  render(<TurnView turn={{ intent: { sessionId: session.id, clientRequestId: 'synthetic-transient', input: 'Unconfirmed input' }, publicRunId: null, phase: 'Working', done: false, output: 'Transient answer', outputLimited: false, historyMatched: false, identityVerified: true, approval: null, events: [] }} allowed={false} approve={vi.fn()} stop={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Reactions' })).toBeNull();
});

it('the shell capability wires saved-message controls without changing draft, presence or admitting any work', async () => {
  const { App } = await import('./App');
  sessionStorage.setItem('jarvis-command:selected-session:v1', session.id);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const f = fixture(); const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('/api/live/reactions/')) return f.fetcher(url, init);
    if (url === '/api/notifications/presence') return new Response(null, { status: 204 });
    if (init?.method && init.method !== 'GET') throw Error(`Unexpected write ${url}`);
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [] });
    if (url === '/api/notifications') return Response.json({ version: 1, items: [], unreadCount: 0, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } }, delivery: { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' } });
    if (url.includes('/messages?')) return Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 2, hasMore: false } });
    if (url.endsWith('/context')) return Response.json({ sessionId: session.id, state: 'unavailable', receipt: null, updatedAt: null });
    if (url === '/api/live/model-options') return Response.json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [] });
    if (url === '/api/live/session-controls') return Response.json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
    if (url === `/api/live/sessions/${session.id}`) return Response.json({ session });
    throw Error(`Unexpected read ${url}`);
  }));
  render(<App loadBootstrap={async () => ({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC', environment: 'test', generatedAt: session.lastActive, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'message_reactions'], readinessChecks: {} }, sessions: [session] })} />);
  await screen.findAllByRole('button', { name: 'Reactions' });
  await waitFor(() => expect(calls).toContain('POST /api/notifications/presence'));
  const presence = calls.filter(call => call === 'POST /api/notifications/presence').length;
  const composer = screen.getByRole('textbox', { name: 'Message Jarvis' }); fireEvent.change(composer, { target: { value: 'SYNTHETIC unsent draft' } });
  const a = within(document.querySelector('[data-message-id="stored:A"]') as HTMLElement);
  fireEvent.click(a.getByRole('button', { name: 'Reactions' }));
  await waitFor(() => expect(a.getByRole('button', { name: 'Heart' })).toBeEnabled());
  fireEvent.click(a.getByRole('button', { name: 'Heart' }));
  await waitFor(() => expect(a.getByRole('button', { name: 'Heart' })).toHaveAttribute('aria-pressed', 'true'));
  expect(composer).toHaveValue('SYNTHETIC unsent draft');
  expect(calls.filter(call => call === 'POST /api/notifications/presence')).toHaveLength(presence);
  expect(calls.filter(call => call.startsWith('POST ') && !call.startsWith('POST /api/live/reactions/') && call !== 'POST /api/notifications/presence')).toEqual([]);
});
