import type { CommandBootstrap } from '@jarvis-command/contracts';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { useLiveTurn } from './useLiveTurn';

const id = 'jcr_' + 'a'.repeat(32);
const timestamp = '2026-09-04T12:00:00.000Z';
const session = { id: 'jc_test', title: 'Turn room', source: 'web', ownership: 'command' as const, model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
const bootstrap: CommandBootstrap = {
  identity: { provider: 'development' }, command: { version: 'test', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } },
  hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session, { ...session, id: 'jc_second', title: 'Second room' }],
};
class Source {
  static instances: Source[] = [];
  listeners = new Map<string, (event: MessageEvent) => void>();
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(public url: string) { Source.instances.push(this); }
  addEventListener(name: string, listener: (event: MessageEvent) => void) { this.listeners.set(name, listener); }
  emit(type: string, data: object) { this.listeners.get(type)?.({ data: JSON.stringify({ type, publicRunId: id, timestamp, ...data }) } as MessageEvent); }
}
function status(state = 'completed', extra = {}) { return { publicRunId: id, sessionId: session.id, status: state, updatedAt: timestamp, approval: null, output: 'Streamed answer', error: null, pendingSteer: null, usage: null, ...extra }; }
function readyHook() {
  const hook = renderHook(useLiveTurn);
  act(() => hook.result.current.history(session.id, [], true));
  return hook;
}
function setup(admit?: (body: Record<string, string>) => Promise<Response>, final = status()) {
  Source.instances = [];
  vi.stubGlobal('EventSource', Source);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [] });
    if (url.includes('/messages?')) return Response.json({ sessionId: url.includes('jc_second') ? 'jc_second' : session.id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
    if (url === '/api/live/runs') { const body = JSON.parse(init!.body as string); return admit ? admit(body) : Response.json({ ...body, input: undefined, publicRunId: id, status: 'running', replayed: false }); }
    return Response.json(final);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
async function chooseChat(name: string) {
  const button = await screen.findByRole('button', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(name));
}
async function open(value = bootstrap) {
  render(<App loadBootstrap={async () => value} />);
  await chooseChat(session.title);
  await screen.findByText('No saved messages in session history yet.');
}
async function send() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Hello Jarvis' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(Source.instances).toHaveLength(1));
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['wall', 'backward'])('expires retries at exactly 23 hours from first attempt with %s clock', async (clock) => {
  vi.useFakeTimers();
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const start = Date.now();
  const fetchMock = setup(async () => { throw new Error('uncertain'); });
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'exact original', 100));
  elapsed = 23 * 60 * 60 * 1000 - 1;
  vi.setSystemTime(clock === 'wall' ? start + elapsed : start - 100_000);
  await act(async () => result.current.retry());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]![1]!.body).toBe(fetchMock.mock.calls[0]![1]!.body);
  elapsed++;
  if (clock === 'wall') vi.setSystemTime(start + elapsed);
  await act(async () => result.current.retry());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.turn?.phase).toMatch(/retry window expired/);
  act(() => result.current.send('jc_second', 'new payload', 100));
  expect(result.current.turn?.intent.input).toBe('exact original');
  unmount();
});

it.each(['headers', 'body'])('bounds admission through stalled %s and cleans late responses', async (stall) => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  let deliver!: (response: Response) => void;
  const response = new Response(new ReadableStream({ cancel }));
  const fetchMock = vi.fn(() => stall === 'body' ? Promise.resolve(response) : new Promise<Response>((resolve) => { deliver = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = readyHook();
  act(() => result.current.send(session.id, 'exact original', 100));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(result.current.turn?.phase).toMatch(/Admission uncertain/);
  expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
  if (stall === 'headers') await act(async () => { deliver(response); });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(response.body?.locked).toBe(false);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['headers', 'body'])('bounds status through stalled %s without poisoning the next attempt', async (stall) => {
  const fetchMock = setup();
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  vi.useFakeTimers();
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  fetchMock.mockImplementationOnce(() => stall === 'body' ? Promise.resolve(response) : new Promise<Response>(() => {}));
  act(() => Source.instances[0]!.onerror?.());
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(result.current.turn?.phase).not.toBe('Recovering status');
  const firstSignal = fetchMock.mock.calls.at(-1)![1]!.signal!;
  expect(firstSignal.aborted).toBe(true);
  if (stall === 'body') { expect(cancel).toHaveBeenCalled(); expect(response.body?.locked).toBe(false); }
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  act(() => Source.instances.at(-1)!.onerror?.());
  await act(async () => {});
  expect(result.current.turn?.done).toBe(true);
  expect(fetchMock.mock.calls.at(-1)![1]!.signal).not.toBe(firstSignal);
  unmount(); await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
});

it('sends one exact intent, streams partial output and reconciles terminal status exactly once', async () => {
  const fetchMock = setup(); await open(); await send();
  const request = fetchMock.mock.calls.find(([url]) => url === '/api/live/runs')!;
  expect(request[1]).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-jarvis-command': '1' } });
  expect(JSON.parse(request[1]!.body as string)).toEqual({ sessionId: session.id, input: 'Hello Jarvis', clientRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  act(() => Source.instances[0]!.emit('message.delta', { delta: 'Streamed ' }));
  expect(screen.getByText('Streamed')).toBeInTheDocument();
  act(() => Source.instances[0]!.emit('run.completed', { output: 'Streamed answer', pendingSteer: null, usage: null }));
  expect(await screen.findByText('Run completed')).toBeInTheDocument();
  expect(screen.getAllByText('Streamed answer')).toHaveLength(1);
  expect(Source.instances[0]!.close).toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([url]) => url.includes('/messages?'))).toHaveLength(2);
});

it('hands the submitted user and answer to saved history once, in conversation order', async () => {
  const fetchMock = setup(); await open(); await send();
  act(() => Source.instances[0]!.emit('message.delta', { delta: 'Streamed answer' }));
  const messages = [
    { id: 'saved:user', sessionId: session.id, role: 'user', content: 'Hello Jarvis', timestamp, toolName: null, displayKind: null },
    { id: 'saved:answer', sessionId: session.id, role: 'assistant', content: 'Streamed answer', timestamp, toolName: null, displayKind: null },
  ];
  fetchMock.mockImplementation(async (url: string) => Response.json(url.includes('/messages?')
    ? { sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 2, hasMore: false } } : status()));
  await act(async () => Source.instances[0]!.onerror?.());
  await waitFor(() => expect(document.querySelector('[data-message-id="saved:answer"]')).not.toBeNull());
  expect(screen.getAllByText('Hello Jarvis')).toHaveLength(1);
  expect(screen.getAllByText('Streamed answer')).toHaveLength(1);
  expect(screen.queryByText('End of history.')).not.toBeInTheDocument();
  expect(screen.getAllByRole('article').map((node) => node.textContent)).toEqual([
    expect.stringContaining('Hello Jarvis'), expect.stringContaining('Streamed answer'),
  ]);
  expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
});

it('retains unsaved completed turns when another identical message is submitted and sessions switch', async () => {
  setup(); await open(); await send();
  await act(async () => Source.instances[0]!.onerror?.());
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Hello Jarvis' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(Source.instances).toHaveLength(2));
  expect(screen.getAllByText('Hello Jarvis')).toHaveLength(2);
  expect(screen.getByText('Streamed answer')).toBeInTheDocument();
  await chooseChat('Second room');
  expect(screen.queryByText('Streamed answer')).not.toBeInTheDocument();
  await chooseChat(session.title);
  expect(await screen.findByText('Streamed answer')).toBeInTheDocument();
  expect(screen.getAllByText('Hello Jarvis')).toHaveLength(2);
});

it('reconciles two identical turns after delayed persistence without claiming either twice', async () => {
  const fetchMock = setup(); await open(); await send();
  await act(async () => Source.instances[0]!.onerror?.());
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Hello Jarvis' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(Source.instances).toHaveLength(2));
  const messages = ['user', 'assistant', 'user', 'assistant'].map((role, i) => ({
    id: `saved:${i}`, sessionId: session.id, role, content: role === 'user' ? 'Hello Jarvis' : 'Streamed answer', timestamp, toolName: null, displayKind: null,
  }));
  fetchMock.mockImplementation(async (url: string) => Response.json(url.includes('/messages?')
    ? { sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 4, hasMore: false } } : status()));
  await act(async () => Source.instances[1]!.onerror?.());
  // Real run IDs differ; switch forces a fresh history view even with this fixture's reused ID.
  await chooseChat('Second room');
  await chooseChat(session.title);
  await waitFor(() => expect(document.querySelector('[data-message-id="saved:3"]')).not.toBeNull());
  expect(screen.getAllByText('Hello Jarvis')).toHaveLength(2);
  expect(screen.getAllByText('Streamed answer')).toHaveLength(2);
  expect(screen.getAllByRole('article').map((node) => node.textContent)).toEqual([
    expect.stringContaining('Hello Jarvis'), expect.stringContaining('Streamed answer'),
    expect.stringContaining('Hello Jarvis'), expect.stringContaining('Streamed answer'),
  ]);
  fetchMock.mockRejectedValue(new Error('history unavailable'));
  await chooseChat('Second room');
  await chooseChat(session.title);
  await screen.findByRole('alert');
  // Only unconfirmed bodies remain in memory after durable handoff.
  expect(screen.getAllByText('Hello Jarvis')).toHaveLength(1);
  expect(screen.getAllByText('Streamed answer')).toHaveLength(1);
  fetchMock.mockImplementation(async () => Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 4, hasMore: false } }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  await waitFor(() => expect(screen.getAllByText('Hello Jarvis')).toHaveLength(2));
  expect(screen.getAllByText('Streamed answer')).toHaveLength(2);
});

it('keeps the live stream through steer readback so tool completion is not lost in a reconnect gap', async () => {
  const fetchMock = setup(undefined, status('running', { output: null }));
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  vi.useFakeTimers();
  act(() => Source.instances[0]!.emit('tool.started', { tool: 'terminal', preview: 'Harmless test' }));
  fetchMock.mockResolvedValueOnce(Response.json({ publicRunId: id, accepted: true, state: 'queued' }));
  await act(async () => result.current.steer(result.current.turn!, 'Keep testing', 100));
  expect(Source.instances[0]!.close).not.toHaveBeenCalled();
  act(() => Source.instances[0]!.emit('tool.completed', { tool: 'terminal', error: false, durationSeconds: 1 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(Source.instances).toHaveLength(1);
  expect(result.current.turn?.events.map((event) => event.type)).toEqual(['tool.started', 'tool.completed']);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/steer'))).toHaveLength(1);
  unmount();
});

it('does not replace a live preview with a concurrent nonterminal status snapshot', async () => {
  const fetchMock = setup();
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  act(() => Source.instances[0]!.emit('message.delta', { delta: 'Streamed ' }));
  let deliver!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve; }));
  act(() => result.current.refreshStatus(result.current.turn!));
  act(() => Source.instances[0]!.emit('message.delta', { delta: 'answer' }));
  await act(async () => deliver(Response.json(status('running', { output: 'Streamed ' }))));
  expect(result.current.turn?.output).toBe('Streamed answer');
  act(() => Source.instances[0]!.emit('message.delta', { delta: '!' }));
  expect(result.current.turn?.output).toBe('Streamed answer!');
  expect(Source.instances[0]!.close).not.toHaveBeenCalled();
  unmount();
});

it.each(['request', 'responded'])('does not regress newer streamed approval %s with a stale status snapshot', async (kind) => {
  const fetchMock = setup();
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  const approval = { requestId: 'approval-race', command: 'printf test', description: 'Harmless fixture', tool: 'terminal' };
  let deliver!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve; }));
  act(() => result.current.refreshStatus(result.current.turn!));
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  if (kind === 'responded') act(() => Source.instances[0]!.emit('approval.responded', { requestId: approval.requestId, choice: 'deny' }));
  const phase = result.current.turn?.phase;
  await act(async () => deliver(Response.json(status('running', { approval: kind === 'responded' ? approval : null }))));
  expect(result.current.turn?.approval).toEqual(kind === 'request' ? approval : null);
  expect(result.current.turn?.phase).toBe(phase);
  unmount();
});

it('rechecks terminal evidence arriving during a nonterminal status read without replaying the stream', async () => {
  const fetchMock = setup();
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  vi.useFakeTimers();
  let deliver!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve; }));
  act(() => result.current.refreshStatus(result.current.turn!));
  act(() => Source.instances[0]!.emit('run.completed', { output: 'Streamed answer', pendingSteer: null, usage: null }));
  await act(async () => deliver(Response.json(status('running', { output: null }))));
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(result.current.turn?.done).toBe(true);
  expect(result.current.turn?.output).toBe('Streamed answer');
  expect(Source.instances).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/live/runs')).toHaveLength(1);
  unmount();
});

it('keeps the composer disabled through delayed and failed history, then unlocks after retry', async () => {
  const fetchMock = setup(); const ordinary = fetchMock.getMockImplementation()!;
  let settle!: (response: Response) => void;
  let attempts = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/messages?') && attempts++ === 0) return new Promise<Response>((resolve) => { settle = resolve; });
    return ordinary(url, init);
  });
  render(<App loadBootstrap={async () => bootstrap} />);
  await chooseChat(session.title);
  expect(await screen.findByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
  await act(async () => settle(new Response('', { status: 503 })));
  expect(await screen.findByRole('button', { name: 'Retry history' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled());
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/live/runs')).toHaveLength(0);
});

it('refuses admission until the selected history baseline is complete', async () => {
  const fetchMock = setup(); const { result, unmount } = renderHook(useLiveTurn);
  await act(async () => { expect(await result.current.send(session.id, 'Hello', 20)).toBe(false); });
  expect(fetchMock).not.toHaveBeenCalled();
  act(() => result.current.history(session.id, [], false));
  await act(async () => { expect(await result.current.send(session.id, 'Hello', 20)).toBe(false); });
  act(() => result.current.history(session.id, [], true));
  await act(async () => { expect(await result.current.send(session.id, 'Hello', 20)).toBe(true); });
  unmount();
});

it('retains the consuming-queue stream prefix and activity across reconnect', async () => {
  vi.useFakeTimers(); setup(undefined, status('running', { output: 'stale' }));
  const { result, unmount } = readyHook();
  act(() => result.current.history(session.id, [], true));
  await act(async () => { await result.current.send(session.id, 'Hello', 20); });
  act(() => {
    Source.instances[0]!.emit('message.delta', { delta: 'Visible prefix ' });
    Source.instances[0]!.emit('tool.started', { tool: 'terminal', preview: 'Harmless test' });
    Source.instances[0]!.onerror?.();
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  expect(Source.instances).toHaveLength(2);
  expect(result.current.turn?.output).toBe('Visible prefix ');
  expect(result.current.turn?.events.map((event) => event.type)).toEqual(['tool.started']);
  act(() => {
    Source.instances[1]!.emit('message.delta', { delta: 'suffix' });
    Source.instances[1]!.emit('tool.completed', { tool: 'terminal', error: false, durationSeconds: 1 });
  });
  expect(result.current.turn?.output).toBe('Visible prefix suffix');
  expect(result.current.turn?.events.map((event) => event.type)).toEqual(['tool.started', 'tool.completed']);
  unmount(); vi.useRealTimers();
});

it('keeps activity limits across explicit supervisor replacement', async () => {
  vi.useFakeTimers(); setup(undefined, status('running', { output: null }));
  const { result, unmount } = readyHook();
  await act(async () => { await result.current.send(session.id, 'Hello', 20); });
  act(() => { for (let index = 0; index < 1000; index++) Source.instances[0]!.emit('run.steered', { accepted: true }); });
  expect(result.current.turn?.events).toHaveLength(1000);
  await act(async () => result.current.refreshStatus(result.current.turn!, false, false));
  await act(async () => result.current.refreshStatus(result.current.turn!));
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  expect(Source.instances).toHaveLength(2);
  act(() => Source.instances[1]!.emit('run.steered', { accepted: true }));
  expect(result.current.turn?.events).toHaveLength(1000);
  unmount(); vi.useRealTimers();
});

it('releases a completed body once complete history owns its pair', async () => {
  setup(); const { result, unmount } = readyHook();
  act(() => result.current.history(session.id, [], true));
  await act(async () => { await result.current.send(session.id, 'Hello', 20); });
  await act(async () => { Source.instances[0]!.emit('run.completed', {}); });
  act(() => result.current.history(session.id, [
    { id: 'user:1', sessionId: session.id, role: 'user', content: 'Hello', timestamp, toolName: null, displayKind: null },
    { id: 'assistant:1', sessionId: session.id, role: 'assistant', content: 'Streamed answer', timestamp, toolName: null, displayKind: null },
  ], true));
  await act(async () => { await result.current.send(session.id, 'Next', 20); });
  expect(result.current.completedTurns).toHaveLength(0); unmount();
});

it('bounds unconfirmed bodies without dropping them and resumes after positive history handoff', async () => {
  setup(); const { result, unmount } = readyHook();
  for (let index = 0; index < 9; index++) {
    act(() => result.current.history(session.id, [], true));
    await act(async () => { expect(await result.current.send(session.id, `turn ${index}`, 20)).toBe(true); });
    await act(async () => { Source.instances.at(-1)!.emit('run.completed', {}); });
  }
  act(() => result.current.history(session.id, [], true));
  await act(async () => { expect(await result.current.send(session.id, 'overflow', 20)).toBe(false); });
  expect(result.current.completedTurns).toHaveLength(8);
  expect(result.current.turn?.intent.input).toBe('turn 8');
  const saved = Array.from({ length: 9 }, (_, index) => [
    { id: `u:${index}`, sessionId: session.id, role: 'user' as const, content: `turn ${index}`, timestamp, toolName: null, displayKind: null },
    { id: `a:${index}`, sessionId: session.id, role: 'assistant' as const, content: 'Streamed answer', timestamp, toolName: null, displayKind: null },
  ]).flat();
  act(() => result.current.history(session.id, saved, false));
  expect(result.current.completedTurns).toHaveLength(8);
  act(() => result.current.history(session.id, saved, true));
  expect(result.current.completedTurns).toHaveLength(0);
  await act(async () => { expect(await result.current.send(session.id, 'Resumed', 20)).toBe(true); });
  unmount();
});

it('keeps monitoring healthy long-running work until its terminal status arrives', async () => {
  const fetchMock = setup(undefined, status('running', { output: null }));
  const { result, unmount } = readyHook();
  vi.useFakeTimers();
  await act(async () => result.current.send(session.id, 'hello', 100));
  await act(async () => result.current.refreshStatus(result.current.turn!));
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
  expect(result.current.turn?.phase).not.toMatch(/supervision paused/);
  expect(result.current.turn?.done).toBe(false);
  fetchMock.mockResolvedValueOnce(Response.json(status()));
  await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
  expect(result.current.turn?.phase).toBe('Run completed');
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/live/runs')).toHaveLength(1);
  unmount();
});

it('bounds reconnection and failed status polling without inventing a terminal state', async () => {
  const fetchMock = setup(undefined, status('running', { output: null })); await open(); await send();
  fetchMock.mockRejectedValue(new Error('network unavailable'));
  vi.useFakeTimers();
  act(() => Source.instances[0]!.onerror?.());
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(Source.instances).toHaveLength(2);
  act(() => Source.instances[1]!.onerror?.());
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(Source.instances).toHaveLength(3);
  act(() => Source.instances[2]!.onerror?.());
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.getAllByText(/Disconnected — supervision paused/).length).toBeGreaterThan(0);
  expect(fetchMock.mock.calls.filter(([url]) => url === `/api/live/runs/${id}`).length).toBeLessThanOrEqual(12);
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  fetchMock.mockResolvedValueOnce(Response.json(status()));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Resume status check' })));
  expect(screen.getAllByText('Run completed').length).toBeGreaterThan(0);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/live/runs')).toHaveLength(1);
  expect(Source.instances).toHaveLength(3);
});

it.each(['admission', 'status-body', 'status-headers', 'stream'])('cleans active %s work on unmount without callbacks or timers leaking', async (stage) => {
  vi.useFakeTimers();
  const fetchMock = setup(undefined, status('running'));
  let late!: (response: Response) => void;
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  if (stage === 'admission') fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { late = resolve; }));
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  if (stage.startsWith('status')) {
    fetchMock.mockImplementationOnce(() => stage === 'status-body' ? Promise.resolve(response) : new Promise<Response>((resolve) => { late = resolve; }));
    await act(async () => Source.instances[0]!.onerror?.());
  }
  const intent = result.current.turn!.intent;
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal!;
  await act(async () => unmount());
  if (late) await act(async () => late(response));
  if (stage !== 'stream') { expect(signal.aborted).toBe(true); expect(cancel).toHaveBeenCalledTimes(1); }
  for (const source of Source.instances) expect(source.close).toHaveBeenCalled();
  // Drain jsdom's zero-delay storage-event dispatch, not application supervision timers.
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(result.current.turn!.intent).toBe(intent);
});

it('ignores old stream callbacks after a new run starts', async () => {
  setup();
  const { result } = readyHook();
  await act(async () => result.current.send(session.id, 'first', 100));
  const previous = Source.instances[0]!;
  await act(async () => previous.onerror?.());
  act(() => result.current.history(session.id, [], true));
  await act(async () => result.current.send(session.id, 'second', 100));
  act(() => previous.emit('message.delta', { delta: 'Stale previous run' }));
  expect(result.current.turn!.intent.input).toBe('second');
  expect(result.current.turn!.output).toBe('');
});

it('enforces the event count independently of byte bounds', async () => {
  const fetchMock = setup(undefined, status('running', { output: null }));
  const { result } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  const source = Source.instances[0]!;
  act(() => { for (let i = 0; i < 1000; i++) source.emit('run.steered', { accepted: true }); });
  expect(source.close).not.toHaveBeenCalled();
  await act(async () => source.emit('run.steered', { accepted: true }));
  expect(source.close).toHaveBeenCalled();
  expect(result.current.turn!.events).toHaveLength(1000);
  expect(fetchMock.mock.calls.some(([url]) => url === `/api/live/runs/${id}`)).toBe(true);
});

it.each(['json', 'schema', 'event-name'])('reconciles malformed %s events without projecting their payload', async (fault) => {
  setup();
  const { result } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  const source = Source.instances[0]!;
  const data = fault === 'json' ? '{not-json' : JSON.stringify({ type: fault === 'event-name' ? 'run.steered' : 'message.delta', publicRunId: id, timestamp, delta: 'Never display', unexpected: true });
  await act(async () => source.listeners.get('message.delta')!({ data } as MessageEvent));
  expect(result.current.turn!.output).toBe('Streamed answer');
  expect(result.current.turn!.done).toBe(true);
  expect(source.close).toHaveBeenCalled();
});

it.each(['none', 'partial', 'complete-old', 'complete-new', 'complete-unpaired'])('keeps terminal output identity-safe with a %s history baseline', async (baseline) => {
  setup();
  const { result } = renderHook(useLiveTurn);
  const message = { id: 'history:exact', sessionId: session.id, role: 'assistant' as const, content: 'Streamed answer', timestamp, toolName: null, displayKind: null };
  if (baseline !== 'none') act(() => result.current.history(session.id, baseline === 'complete-old' ? [message] : [], baseline !== 'partial'));
  if (baseline === 'none' || baseline === 'partial') {
    act(() => expect(result.current.send(session.id, 'hello', 100)).toBe(false));
    expect(Source.instances).toHaveLength(0);
    return;
  }
  await act(async () => result.current.send(session.id, 'hello', 100));
  await act(async () => Source.instances[0]!.onerror?.());
  act(() => result.current.history(session.id, baseline === 'complete-new' ? [{ ...message, id: 'history:user', role: 'user', content: 'hello' }, message] : [message], true));
  expect(result.current.turn?.historyMatched).toBe(baseline === 'complete-new');
  act(() => result.current.history(session.id, [], false));
  expect(result.current.turn?.historyMatched).toBe(false);
});

it('clears only the matching approval acknowledgement and never retains a terminal approval', async () => {
  const approval = { requestId: 'approval:exact', command: 'Synthetic complete target', description: 'Do not truncate', tool: 'terminal' };
  setup(undefined, status('completed', { approval })); await open(); await send();
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  act(() => Source.instances[0]!.emit('approval.responded', { requestId: 'another:approval', choice: 'deny' }));
  expect(screen.getByRole('region', { name: 'Awaiting approval' })).toBeInTheDocument();
  act(() => Source.instances[0]!.emit('approval.responded', { requestId: approval.requestId, choice: 'once' }));
  expect(screen.queryByRole('region', { name: 'Awaiting approval' })).not.toBeInTheDocument();
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  act(() => Source.instances[0]!.onerror?.());
  await screen.findByText('Run completed');
  expect(screen.queryByRole('region', { name: 'Awaiting approval' })).not.toBeInTheDocument();
});

it('bounds multibyte status output as a visibly labelled preview', async () => {
  setup(undefined, status('completed', { output: '😀'.repeat(50_000) })); await open(); await send();
  act(() => Source.instances[0]!.onerror?.());
  expect(await screen.findByText('Run completed')).toBeInTheDocument();
  expect(screen.getByText('Output preview limited. Full output may be available in session history.')).toBeInTheDocument();
  const text = document.querySelector('.turn-output')!.textContent!;
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(131072);
  expect(text).not.toContain('�');
});

it('bounds preview bytes and event count, switching to authoritative status', async () => {
  setup(undefined, status('running', { output: null })); await open(); await send();
  act(() => { for (let i = 0; i < 20; i++) Source.instances[0]!.emit('message.delta', { delta: 'x'.repeat(32768) }); });
  await waitFor(() => expect(Source.instances[0]!.close).toHaveBeenCalled());
  expect((document.querySelector('.turn-output')?.textContent ?? '').length).toBeLessThanOrEqual(131072);
});

it.each(['sessionId', 'clientRequestId', 'publicRunId', 'network'])('preserves an uncertain %s admission with a stable explicit retry and blocks double submit', async (fault) => {
  const bodies: Record<string, string>[] = [];
  setup(async (body) => { bodies.push(body); if (bodies.length === 1) {
    if (fault === 'network') throw new Error('lost');
    return Response.json({ sessionId: body.sessionId, clientRequestId: body.clientRequestId, publicRunId: id, status: 'running', replayed: false, [fault]: 'wrong' });
  } return Response.json({ sessionId: body.sessionId, clientRequestId: body.clientRequestId, publicRunId: id, status: 'running', replayed: true }); });
  await open();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Same intent' } });
  const button = screen.getByRole('button', { name: 'Send message' }); fireEvent.click(button); fireEvent.click(button);
  const retry = await screen.findByRole('button', { name: 'Retry same intent' });
  expect(bodies).toHaveLength(1); expect(Source.instances).toHaveLength(0);
  fireEvent.click(retry); await waitFor(() => expect(Source.instances).toHaveLength(1));
  expect(bodies[1]).toEqual(bodies[0]);
});

it.each(['failed', 'cancelled', 'interrupted'])('reconciles a lost stream to %s', async (outcome) => {
  setup(undefined, status(outcome)); await open(); await send();
  act(() => Source.instances[0]!.onerror?.());
  expect(await screen.findByText(`Run ${outcome}`)).toBeInTheDocument();
});

it.each(['publicRunId', 'sessionId', 'malformed'])('refuses unbound %s status and retains the writer lock', async (fault) => {
  setup(undefined, status('completed', fault === 'malformed' ? { unexpected: true } : { [fault]: 'wrong' })); await open(); await send();
  act(() => Source.instances[0]!.onerror?.());
  await waitFor(() => expect(screen.getAllByText(/Disconnected/).length).toBeGreaterThan(0));
  expect(screen.queryByText('Run completed')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

it('keeps supervision across rooms, ignores foreign events and closes on unmount', async () => {
  setup(undefined, status('running')); await open(); await send();
  await chooseChat('Second room');
  act(() => Source.instances[0]!.emit('message.delta', { delta: 'Foreign', publicRunId: 'jcr_' + 'b'.repeat(32) }));
  expect(screen.queryByText('Foreign')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

it.each(['offline', 'external', 'capability'])('keeps %s sessions read-only', async (fault) => {
  setup(); await open({ ...bootstrap, hermes: { ...bootstrap.hermes, state: fault === 'offline' ? 'offline' : 'online', capabilities: fault === 'capability' ? [] : ['run_events_sse'] }, sessions: [{ ...session, ownership: fault === 'external' ? 'external' : 'command' }] });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('rejects blank/oversized input, preserves Shift Enter and IME, and renders complete approval details', async () => {
  setup(); await open(); const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: ' '.repeat(2) } }); expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'x'.repeat(101) } }); expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'Hello' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(Source.instances).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter' }); await waitFor(() => expect(Source.instances).toHaveLength(1));
  act(() => Source.instances[0]!.emit('approval.request', { approval: { requestId: 'approval:1', command: 'synthetic command --target exact', description: 'Complete description', tool: 'terminal' } }));
  expect(screen.getByText('synthetic command --target exact')).toBeInTheDocument(); expect(screen.getByText('Complete description')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve once' })).toBeInTheDocument();
});

it('never sends another room draft to the selected session', async () => {
  const fetchMock = setup(); await open();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Only room A' } });
  await chooseChat('Second room');
  expect(screen.getByRole('textbox')).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Only room B' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(Source.instances).toHaveLength(1));
  expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url === '/api/live/runs')![1]!.body as string)).toMatchObject({ sessionId: 'jc_second', input: 'Only room B' });
});

it.each(['same', 'different'])('preserves a %s uncertain steer after terminal recovery without duplicate handoff', async (kind) => {
  const fetchMock = setup(undefined, status('completed', { pendingSteer: 'terminal input' }));
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  let reject!: (reason: Error) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((_, fail) => { reject = fail; }));
  const input = kind === 'same' ? 'terminal input' : 'different uncertain input';
  act(() => { void result.current.steer(result.current.turn!, input, 100); });
  await act(async () => Source.instances[0]!.onerror?.());
  expect(result.current.recoveries.map((item) => item.input)).toEqual(['terminal input']);
  act(() => result.current.consumeRecovery(result.current.recoveries[0]!));
  await act(async () => reject(new Error('network')));
  expect(result.current.recoveries.map((item) => item.input)).toEqual(kind === 'same' ? [] : [input]);
  unmount();
});
const approval = { requestId: 'approval:exact', command: 'Synthetic command --target exact', description: 'Complete description', tool: 'terminal' };
it('retains an edited steer draft after a successful queued acknowledgement', async () => {
  const fetchMock = setup(undefined, status('running')); await open(); await send();
  fireEvent.change(screen.getByRole('textbox', { name: 'Steer Jarvis' }), { target: { value: 'original' } });
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Queue steer' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Steer Jarvis' }), { target: { value: 'edited during request' } });
  await act(async () => resolve(Response.json({ publicRunId: id, accepted: true, state: 'queued' })));
  expect(screen.getByRole('textbox', { name: 'Steer Jarvis' })).toHaveValue('edited during request');
  expect(screen.getByText(/Steer queued — not executed/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/steer'))).toHaveLength(1);
});
it.each(['approval', 'stop'] as const)('blocks steer while %s is pending', async (kind) => {
  const fetchMock = setup(); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
  act(() => {
    const run = result.current.turn!;
    if (kind === 'approval') void result.current.approve(run, 'once'); else void result.current.stop(run);
    void result.current.steer(run, 'must not send', 100);
  });
  expect(fetchMock.mock.calls.filter(([url]) => /\/(approval|stop|steer)$/.test(url))).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/steer'))).toHaveLength(0);
  await act(async () => unmount());
});
it('cancels an active steer body on unmount without recovery callbacks', async () => {
  vi.useFakeTimers(); const fetchMock = setup(); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  const cancel = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
  await act(async () => { void result.current.steer(result.current.turn!, 'pending', 100); });
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal!; const requests = fetchMock.mock.calls.length;
  await act(async () => unmount());
  expect(signal.aborted).toBe(true); expect(cancel).toHaveBeenCalledTimes(1);
  expect(Source.instances[0]!.close).toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
  expect(fetchMock.mock.calls).toHaveLength(requests);
});
it.each(['offline', 'capability', 'disabled', 'external'])('removes active controls under %s gating and retains supervision', async (gate) => {
  const fetchMock = setup();
  const initial = structuredClone(bootstrap);
  initial.sessions.push({ ...session, id: 'external:room', title: 'External room', ownership: 'external' });
  const { rerender } = render(<App loadBootstrap={async () => initial} />);
  await chooseChat(session.title);
  await screen.findByText('No saved messages in session history yet.'); await send();
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  expect(screen.getByRole('button', { name: 'Queue steer' })).toBeInTheDocument();
  const changed = structuredClone(initial);
  if (gate === 'offline') changed.hermes.state = 'offline';
  if (gate === 'capability') changed.hermes.capabilities = [];
  if (gate === 'disabled') changed.command.liveRoom.enabled = false;
  await act(async () => rerender(<App loadBootstrap={async () => changed} />));
  if (gate === 'external') await chooseChat('External room');
  for (const name of ['Approve once', 'Deny', 'Stop run', 'Queue steer']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([url]) => /\/(approval|stop|steer)$/.test(url))).toHaveLength(0);
  await act(async () => Source.instances[0]!.onerror?.());
  expect(fetchMock.mock.calls.some(([url]) => url === `/api/live/runs/${id}`)).toBe(true);
});
it('queues exact steer with shared locking and restores authoritative terminal input once', async () => {
  const exact = '  focus here\nexactly  ';
  const fetchMock = setup(undefined, status('completed', { pendingSteer: exact })); await open(); await send();
  const field = screen.getByRole('textbox', { name: 'Steer Jarvis' });
  fireEvent.change(field, { target: { value: ' ' } });
  expect(screen.getByRole('button', { name: 'Queue steer' })).toBeDisabled();
  fireEvent.change(field, { target: { value: 'x'.repeat(101) } });
  expect(screen.getByRole('button', { name: 'Queue steer' })).toBeDisabled();
  fireEvent.change(field, { target: { value: exact } });
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Queue steer' }));
  expect(screen.getByRole('button', { name: 'Stop run' })).toBeDisabled();
  const posts = fetchMock.mock.calls.filter(([url]) => url.endsWith('/steer'));
  expect(posts).toHaveLength(1);
  expect(posts[0]![1]).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: JSON.stringify({ input: exact }) });
  await act(async () => resolve(Response.json({ publicRunId: id, accepted: true, state: 'queued' })));
  expect(screen.queryByText(/Steer queued — not executed/)).not.toBeInTheDocument();
  expect(screen.getByText(/Run ended.*unconsumed guidance/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue(exact);
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: '' } });
  await chooseChat('Second room');
  await chooseChat(session.title);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('');
});
it('offers explicit recovery for an edited room draft and does not auto-restore after clearing it', async () => {
  setup(undefined, status('completed', { pendingSteer: '  pending\nexact  ' })); await open(); await send();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Existing draft' } });
  await chooseChat('Second room');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Room B only' } });
  await act(async () => Source.instances[0]!.onerror?.());
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Room B only');
  await chooseChat(session.title);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Existing draft');
  expect(screen.getByRole('button', { name: 'Restore to empty draft' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: '' } });
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Restore to empty draft' })).toBeEnabled();
  await chooseChat('Second room');
  await chooseChat(session.title);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'New edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Append to draft' }));
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('New edit\n  pending\nexact  ');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('');
  expect(screen.queryByRole('region', { name: 'Recover steer draft' })).not.toBeInTheDocument();
});

it.each(['missing', 'run', 'malformed', 'network', 'state', 'accepted'])('retains exact uncertain %s steer separately from newer edits', async (fault) => {
  const fetchMock = setup(undefined, status('running')); await open(); await send();
  const exact = '  original\nsteer  ';
  fireEvent.change(screen.getByRole('textbox', { name: 'Steer Jarvis' }), { target: { value: exact } });
  let resolve!: (response: Response) => void;
  let reject!: (reason: Error) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((yes, no) => { resolve = yes; reject = no; }));
  fireEvent.click(screen.getByRole('button', { name: 'Queue steer' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Steer Jarvis' }), { target: { value: 'Newer edit' } });
  await act(async () => {
    if (fault === 'network') reject(new Error('SECRET'));
    else resolve(Response.json(fault === 'missing' ? {} : { publicRunId: fault === 'run' ? 'jcr_' + 'b'.repeat(32) : id, accepted: fault !== 'accepted', state: fault === 'state' ? 'executed' : 'queued', ...(fault === 'malformed' ? { extra: true } : {}) }));
  });
  expect(screen.getByText(/Steer outcome unconfirmed/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Steer Jarvis' })).toHaveValue('Newer edit');
  expect(screen.getByRole('region', { name: 'Recover steer draft' }).querySelector('pre')!.textContent).toBe(exact);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/steer'))).toHaveLength(1);
  expect(document.body.textContent).not.toContain('SECRET');
});

it.each(['headers', 'body'])('bounds steer %s and keeps exact input for explicit recovery', async (stall) => {
  vi.useFakeTimers(); const fetchMock = setup(undefined, status('running')); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  const cancel = vi.fn(); const response = new Response(new ReadableStream({ cancel }));
  fetchMock.mockImplementationOnce(() => stall === 'body' ? Promise.resolve(response) : new Promise<Response>(() => {}));
  act(() => { void result.current.steer(result.current.turn!, ' exact ', 100); });
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal!;
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(signal.aborted).toBe(true);
  expect(result.current.turn?.controlMessage).toMatch(/Steer outcome unconfirmed/);
  expect(result.current.recoveries).toMatchObject([{ input: ' exact ', kind: 'uncertain' }]);
  expect(result.current.turn?.done).toBe(false);
  if (stall === 'body') expect(cancel).toHaveBeenCalledTimes(1);
  unmount(); expect(vi.getTimerCount()).toBe(0);
});

it('rejects invalid steer in the hook and serializes steer with approval and stop; ignores late new-intent replies', async () => {
  const fetchMock = setup(); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  const run = result.current.turn!;
  await act(async () => { await result.current.steer(run, ' ', 100); await result.current.steer(run, 'x'.repeat(101), 100); });
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/steer'))).toHaveLength(0);
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  act(() => { void result.current.steer(run, 'valid', 100); void result.current.steer(run, 'duplicate', 100); void result.current.approve(run, 'once'); void result.current.stop(run); });
  expect(fetchMock.mock.calls.filter(([url]) => /\/(steer|approval|stop)$/.test(url))).toHaveLength(1);
  await act(async () => Source.instances[0]!.onerror?.());
  act(() => result.current.history('jc_second', [], true));
  await act(async () => result.current.send('jc_second', 'new intent', 100));
  const requests = fetchMock.mock.calls.length;
  await act(async () => resolve(Response.json({ publicRunId: id, accepted: true, state: 'queued' })));
  expect(fetchMock.mock.calls).toHaveLength(requests);
  expect(result.current.turn?.controlMessage).toBeUndefined();
  expect(result.current.recoveries).toEqual([]);
  unmount();
});

it('does not reoffer a handed-off uncertain payload when terminal read-back repeats it', async () => {
  const fetchMock = setup(undefined, status('running')); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  fetchMock.mockRejectedValueOnce(new Error('network'));
  await act(async () => result.current.steer(result.current.turn!, 'exact', 100));
  act(() => result.current.consumeRecovery(result.current.recoveries[0]!));
  fetchMock.mockResolvedValueOnce(Response.json(status('completed', { pendingSteer: 'exact' })));
  await act(async () => result.current.refreshStatus(result.current.turn!));
  expect(result.current.recoveries).toEqual([]);
  unmount();
});

it.each(['missing', 'run', 'request', 'choice', 'malformed', 'network'])('reconciles %s approval acknowledgement without synthetic success', async (fault) => {
  const fetchMock = setup(undefined, status('waiting_for_approval', { approval })); await open(); await send();
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  const ack = { publicRunId: fault === 'run' ? 'jcr_' + 'b'.repeat(32) : id, requestId: fault === 'request' ? 'other' : approval.requestId, choice: fault === 'choice' ? 'deny' : 'once', resolved: 1, ...(fault === 'malformed' ? { unexpected: true } : {}) };
  fetchMock.mockImplementationOnce(async () => { if (fault === 'network') throw new Error('SECRET upstream'); return Response.json(fault === 'missing' ? {} : ack); });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve once' })));
  expect(screen.getByText(/Approval outcome unconfirmed/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Awaiting approval' })).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/approval'))).toHaveLength(1);
  expect(fetchMock.mock.calls.some(([url]) => url === `/api/live/runs/${id}`)).toBe(true);
  expect(document.body.textContent).not.toContain('SECRET');
});

it('preserves a newer approval while an older mutation returns', async () => {
  const newer = { ...approval, requestId: 'approval:new', command: 'New exact command' };
  const fetchMock = setup(undefined, status('running')); const { result } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  act(() => { void result.current.approve(result.current.turn!, 'once'); });
  act(() => Source.instances[0]!.emit('approval.request', { approval: newer }));
  await act(async () => resolve(Response.json({ publicRunId: id, requestId: approval.requestId, choice: 'once', resolved: 1 })));
  expect(result.current.turn?.approval).toEqual(newer);
});

it.each(['headers', 'body'])('bounds approval mutation %s and reconciles its uncertain outcome', async (stall) => {
  const fetchMock = setup(undefined, status('running')); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  vi.useFakeTimers(); const cancel = vi.fn(); const response = new Response(new ReadableStream({ cancel }));
  fetchMock.mockImplementationOnce(() => stall === 'body' ? Promise.resolve(response) : new Promise<Response>(() => {}));
  act(() => { void result.current.approve(result.current.turn!, 'once'); });
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal!;
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(signal.aborted).toBe(true);
  expect(result.current.turn?.controlMessage).toMatch(/outcome unconfirmed/);
  expect(result.current.turn?.controlBusy).toBe(false);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/approval'))).toHaveLength(1);
  if (stall === 'body') expect(cancel).toHaveBeenCalledTimes(1);
  unmount(); expect(vi.getTimerCount()).toBe(0);
});

it.each(['missing', 'run', 'malformed', 'network'])('keeps an uncertain %s stop acknowledgement nonterminal', async (fault) => {
  const fetchMock = setup(undefined, status('running')); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  const ack = { publicRunId: fault === 'run' ? 'jcr_' + 'b'.repeat(32) : id, status: 'stopping', ...(fault === 'malformed' ? { unexpected: true } : {}) };
  fetchMock.mockImplementationOnce(async () => { if (fault === 'network') throw new Error('SECRET upstream'); return Response.json(fault === 'missing' ? {} : ack); });
  await act(async () => result.current.stop(result.current.turn!));
  expect(result.current.turn?.controlMessage).toMatch(/Stop outcome unconfirmed/);
  expect(result.current.turn?.controlMessage).not.toContain('SECRET');
  expect(result.current.turn?.done).toBe(false);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/stop'))).toHaveLength(1);
  expect(fetchMock.mock.calls.some(([url]) => url === `/api/live/runs/${id}`)).toBe(true);
  unmount();
});
it.each(['headers', 'body'])('bounds stop mutation %s without declaring cancellation', async (stall) => {
  vi.useFakeTimers();
  const fetchMock = setup(undefined, status('running')); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  const cancel = vi.fn(); const response = new Response(new ReadableStream({ cancel }));
  fetchMock.mockImplementationOnce(() => stall === 'body' ? Promise.resolve(response) : new Promise<Response>(() => {}));
  act(() => { void result.current.stop(result.current.turn!); });
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal!;
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(signal.aborted).toBe(true);
  expect(result.current.turn?.controlMessage).toMatch(/Stop outcome unconfirmed/);
  expect(result.current.turn?.done).toBe(false);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/stop'))).toHaveLength(1);
  if (stall === 'body') expect(cancel).toHaveBeenCalledTimes(1);
  unmount(); expect(vi.getTimerCount()).toBe(0);
});
it.each(['approval', 'stop'] as const)('serializes %s against the other control and ignores its late response after replacement', async (kind) => {
  const fetchMock = setup(); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  act(() => {
    const run = result.current.turn!;
    if (kind === 'approval') { void result.current.approve(run, 'once'); void result.current.stop(run); }
    else { void result.current.stop(run); void result.current.approve(run, 'once'); }
  });
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal!;
  expect(fetchMock.mock.calls.filter(([url]) => /\/(approval|stop)$/.test(url))).toHaveLength(1);
  await act(async () => Source.instances[0]!.onerror?.());
  expect(result.current.turn?.done).toBe(true);
  act(() => result.current.history(session.id, [], true));
  await act(async () => result.current.send(session.id, 'new intent', 100));
  expect(signal.aborted).toBe(true);
  const requests = fetchMock.mock.calls.length;
  await act(async () => resolve(Response.json(kind === 'approval' ? { publicRunId: id, requestId: approval.requestId, choice: 'once', resolved: 1 } : { publicRunId: id, status: 'stopping' })));
  expect(fetchMock.mock.calls).toHaveLength(requests);
  expect(result.current.turn?.intent.input).toBe('new intent');
  expect(result.current.turn?.controlMessage).toBeUndefined();
  expect(result.current.turn?.done).toBe(false);
  unmount();
});
it.each(['approval', 'stop'] as const)('cancels active %s body and all work on unmount', async (kind) => {
  vi.useFakeTimers();
  const fetchMock = setup(); const { result, unmount } = readyHook();
  await act(async () => result.current.send(session.id, 'hello', 100));
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  const cancel = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
  await act(async () => { if (kind === 'approval') void result.current.approve(result.current.turn!, 'once'); else void result.current.stop(result.current.turn!); });
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal!;
  const requests = fetchMock.mock.calls.length;
  await act(async () => unmount());
  expect(signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(Source.instances[0]!.close).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(fetchMock.mock.calls).toHaveLength(requests);
});
it('confirms the exact stop target, sends nothing on cancel and keeps stopping nonterminal', async () => {
  const fetchMock = setup(undefined, status('stopping')); await open(); await send();
  fireEvent.click(screen.getByRole('button', { name: 'Stop run' }));
  expect(screen.getByRole('region', { name: 'Confirm stop' })).toHaveTextContent(id);
  expect(screen.getByRole('region', { name: 'Confirm stop' })).toHaveTextContent(session.id);
  fireEvent.click(screen.getByRole('button', { name: 'Keep running' }));
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/stop'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Stop run' }));
  fetchMock.mockResolvedValueOnce(Response.json({ publicRunId: id, status: 'stopping' }));
  vi.useFakeTimers();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm stop' })));
  const posts = fetchMock.mock.calls.filter(([url]) => url.endsWith('/stop'));
  expect(posts).toHaveLength(1);
  expect(posts[0]![1]).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{}', headers: { 'content-type': 'application/json', 'x-jarvis-command': '1' } });
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(screen.getAllByText(/Run stopping/).length).toBeGreaterThan(0);
  fetchMock.mockResolvedValueOnce(Response.json(status('cancelled')));
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).not.toBeDisabled();
});

it.each(['once', 'deny'] as const)('submits exact %s approval once and reads back status', async (choice) => {
  const fetchMock = setup(undefined, status('running', { output: null })); await open(); await send();
  act(() => Source.instances[0]!.emit('approval.request', { approval }));
  expect(screen.getByText(`Request: ${approval.requestId}`)).toBeInTheDocument();
  expect(screen.getByText('Tool: terminal')).toBeInTheDocument();
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  const button = screen.getByRole('button', { name: choice === 'once' ? 'Approve once' : 'Deny' });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(screen.getByRole('button', { name: 'Approve once' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  const requests = fetchMock.mock.calls.filter(([url]) => url.endsWith('/approval'));
  expect(requests).toHaveLength(1);
  expect(requests[0]![1]).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: JSON.stringify({ requestId: approval.requestId, choice }) });
  await act(async () => resolve(Response.json({ publicRunId: id, requestId: approval.requestId, choice, resolved: 1 })));
  expect(fetchMock.mock.calls.some(([url]) => url === `/api/live/runs/${id}`)).toBe(true);
  expect(screen.queryByRole('region', { name: 'Awaiting approval' })).not.toBeInTheDocument();
});

