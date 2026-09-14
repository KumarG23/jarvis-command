import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { App } from './App';
import { afterEach, expect, it, vi } from 'vitest';
import { useLiveTurn } from './useLiveTurn';
import { readRecovery } from './turnRecovery';

const key = 'jarvis-command:live-turn';
const sessionId = 'jc_reload';
const publicRunId = 'jcr_' + 'a'.repeat(32);
const clientRequestId = '12345678-1234-4234-8234-123456789abc';
const record = { sessionId, clientRequestId, publicRunId };
function readyHook() {
  const hook = renderHook(useLiveTurn);
  act(() => hook.result.current.history(sessionId, [], true));
  return hook;
}
const status = (state = 'running', extra = {}) => ({ publicRunId, sessionId, status: state, updatedAt: '2026-09-04T12:00:00.000Z', approval: null, output: null, error: null, pendingSteer: null, usage: null, ...extra });
it.each(['running', 'completed'])('recovers %s by exact GET only with absent input and conditional terminal clear', async (state) => {
  sessionStorage.setItem(key, JSON.stringify(record));
  const uuid = vi.spyOn(crypto, 'randomUUID');
  const fetchMock = vi.fn(async () => Response.json(status(state, { pendingSteer: state === 'completed' ? 'memory-only guidance' : null })));
  vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = readyHook();
  await act(async () => {});
  expect(result.current.turn?.intent).toEqual({ sessionId, clientRequestId, input: null });
  expect(result.current.turn?.done).toBe(state === 'completed');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]).toEqual([`/api/live/runs/${publicRunId}`, expect.objectContaining({ credentials: 'same-origin' })]);
  expect(uuid).not.toHaveBeenCalled();
  if (state === 'completed') {
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(result.current.refresh?.sessionId).toBe(sessionId);
    expect(result.current.recoveries[0]?.input).toBe('memory-only guidance');
  } else {
    act(() => result.current.send('jc_other', 'never send', 100));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(record);
  }
  unmount();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); vi.useRealTimers(); });

it('carries a verified terminal history binding through reload recovery and releases the local echo only when history confirms it', async () => {
  sessionStorage.setItem(key, JSON.stringify(record));
  const historyBinding = { userMessageId: 'persisted:user', assistantMessageId: 'persisted:answer' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(status('completed', { output: 'same answer', historyBinding }))));
  const { result, unmount } = readyHook();
  await waitFor(() => expect(result.current.turn?.done).toBe(true));
  expect(result.current.turn?.historyBinding).toEqual(historyBinding);
  expect(result.current.turn?.historyMatched).toBe(false);
  const messages = [
    { id: historyBinding.userMessageId, sessionId, role: 'user' as const, content: 'question', timestamp: null, toolName: null, displayKind: null },
    { id: historyBinding.assistantMessageId, sessionId, role: 'assistant' as const, content: 'same answer', timestamp: null, toolName: null, displayKind: null },
  ];
  act(() => result.current.history(sessionId, messages, false));
  expect(result.current.turn?.historyMatched).toBe(false);
  act(() => result.current.history(sessionId, messages, true));
  expect(result.current.turn?.historyMatched).toBe(true);
  expect(sessionStorage.getItem(key)).toBeNull();
  unmount();
});

it.each([true, false])('shows recovered target without fabricating a bootstrap room (present=%s)', async (present) => {
  sessionStorage.setItem(key, JSON.stringify(record));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/rooms' ? { version: 1, rooms: [] } : url.includes('/messages?') ? { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } : status())));
  render(<App loadBootstrap={async () => ({ identity: { provider: 'development' }, command: { version: 'test', environment: 'test', generatedAt: '2026-09-04T12:00:00.000Z', liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: present ? [{ id: sessionId, title: 'Real bootstrap room', source: 'web', ownership: 'command', model: null, lastActive: '2026-09-04T12:00:00.000Z', messageCount: 0, toolCallCount: 0, pinned: false }] : [] })} />);
  await waitFor(() => expect(screen.getByText(/Original message unavailable/)).toBeInTheDocument());
  expect(screen.getByRole('region', { name: 'Current turn' })).toHaveTextContent(clientRequestId);
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(present ? 'Real bootstrap room' : 'Jarvis Command'));
  if (present) expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
  else expect(screen.queryByText('Command-owned session')).not.toBeInTheDocument();
});

it.each(['pending', 'foreign', 'valid'])('allows recovered controls only after %s status establishes identity', async (caseName) => {
  sessionStorage.setItem(key, JSON.stringify(record));
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(Response.json({ publicRunId, status: 'stopping' }));
    if (caseName === 'pending') return new Promise<Response>(() => {});
    return Promise.resolve(Response.json(status('running', caseName === 'foreign' ? { sessionId: 'jc_other' } : {})));
  });
  vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = readyHook();
  await act(async () => {});
  await act(async () => { await result.current.stop(result.current.turn!); await result.current.steer(result.current.turn!, 'guidance', 100); });
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length).toBe(caseName === 'valid' ? 2 : 0);
  unmount();
});
it('keeps pending admission unknown with identifiers, no retries and no UUID', async () => {
  sessionStorage.setItem(key, JSON.stringify({ ...record, publicRunId: null }));
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const uuid = vi.spyOn(crypto, 'randomUUID');
  const { result } = readyHook();
  expect(result.current.turn?.phase).toMatch(/Admission unknown.*writer locked/);
  act(() => { result.current.retry(); result.current.send(sessionId, 'never', 100); });
  expect(fetchMock).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled();
});

it.each(['corrupt', 'oversize', 'extra', 'session', 'request', 'run', 'read'])('fails closed on %s recovery without exposing raw content', async (fault) => {
  const raw = fault === 'corrupt' ? '{secret raw' : fault === 'oversize' ? ' '.repeat(1025) : JSON.stringify({ ...record, ...(fault === 'extra' ? { input: 'secret raw' } : fault === 'session' ? { sessionId: ' jc_reload' } : fault === 'request' ? { clientRequestId: 'not-uuid' } : fault === 'run' ? { publicRunId: publicRunId.toUpperCase() } : {}) });
  sessionStorage.setItem(key, raw);
  if (fault === 'read') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('secret raw'); });
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const { result } = readyHook();
  act(() => result.current.send(sessionId, 'never', 100));
  expect(result.current.recoveryError).toMatch(/writer locked/);
  expect(result.current.recoveryError).not.toContain('secret raw');
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['write', 'readback'])('refuses POST on pending %s failure', async (fault) => {
  if (fault === 'write') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  else vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const { result } = readyHook();
  act(() => result.current.send(sessionId, 'never', 100));
  expect(result.current.recoveryError).toMatch(/message not sent/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['foreign-run', 'foreign-session', 'missing', '401', '404', 'unavailable'])('does not complete or clear for %s status', async (fault) => {
  sessionStorage.setItem(key, JSON.stringify(record));
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (fault === 'unavailable') throw new Error('offline');
    return fault === '401' || fault === '404' ? new Response('', { status: Number(fault) }) : Response.json(status('completed', fault === 'foreign-run' ? { publicRunId: 'jcr_' + 'b'.repeat(32) } : fault === 'foreign-session' ? { sessionId: 'jc_other' } : { sessionId: undefined }));
  }));
  const { result, unmount } = readyHook();
  await act(async () => {});
  expect(result.current.turn?.done).toBe(false);
  expect(result.current.turn?.phase).toMatch(/unconfirmed/);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(record);
  unmount();
});

it('unlocks after a failed terminal clear is authoritatively retried and verified', async () => {
  sessionStorage.setItem(key, JSON.stringify(record));
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => { throw new Error('transient'); });
  const fetchMock = vi.fn(async () => Response.json(status('completed'))); vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = readyHook();
  await act(async () => {});
  expect(result.current.recoveryError).toMatch(/writer locked/);
  remove.mockRestore();
  await act(async () => result.current.refreshStatus(result.current.turn!));
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(result.current.recoveryError).toBeNull();
  let sent: boolean | undefined;
  act(() => result.current.history(sessionId, [], true));
  act(() => { sent = result.current.send(sessionId, 'new after verified recovery', 100); });
  expect(sent).toBe(true);
  unmount();
});
it('does not clear a replaced identity on terminal read-back', async () => {
  sessionStorage.setItem(key, JSON.stringify(record));
  let resolve!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
  const { result } = readyHook();
  const replacement = { ...record, clientRequestId: '12345678-1234-4234-8234-123456789abd' };
  sessionStorage.setItem(key, JSON.stringify(replacement));
  await act(async () => resolve(Response.json(status('completed'))));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(replacement);
  expect(result.current.recoveryError).toMatch(/writer locked/);
});

it('cleans StrictMode and unmounted recovered status callbacks without clearing storage', async () => {
  sessionStorage.setItem(key, JSON.stringify(record)); vi.useFakeTimers();
  const responses: ((value: Response) => void)[] = [];
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise<Response>((r) => responses.push(r)));
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = renderHook(useLiveTurn, { wrapper: StrictMode });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => { for (const resolve of responses) resolve(Response.json(status('completed'))); });
  for (const [, init] of fetchMock.mock.calls) expect(init.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(record);
});

it.each(['write', 'readback'])('keeps in-memory supervision on post-ACK storage %s failure', async (fault) => {
  const close = vi.fn(); vi.stubGlobal('EventSource', class { close = close; addEventListener() {} });
  const get = Storage.prototype.getItem;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (fault === 'write') vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    else {
      const pending = sessionStorage.getItem(key);
      vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(function (this: Storage, key: string) { return get.call(this, key); }).mockReturnValueOnce(pending);
    }
    return Response.json({ sessionId, clientRequestId: body.clientRequestId, publicRunId, status: 'running', replayed: false });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(sessionId, 'private payload', 100));
  expect(result.current.turn?.publicRunId).toBe(publicRunId);
  expect(result.current.turn?.done).toBe(false);
  expect(result.current.recoveryError).toMatch(/degraded/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const saved = JSON.parse(get.call(sessionStorage, key)!);
  expect(Object.keys(saved).sort()).toEqual(['clientRequestId', 'publicRunId', 'sessionId']);
  expect(JSON.stringify(saved)).not.toContain('private');
  unmount(); expect(close).toHaveBeenCalled();
});
it('refuses admission when storage read fails after mount but before POST', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const { result } = readyHook();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => { throw new Error('denied'); });
  act(() => result.current.send(sessionId, 'not sent', 100));
  expect(result.current.recoveryError).toMatch(/message not sent/);
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(['remove', 'readback'])('retains the writer lock on terminal clear %s failure', async (fault) => {
  sessionStorage.setItem(key, JSON.stringify(record));
  const remove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
    if (fault === 'remove') throw new Error('denied');
    remove.call(this, key);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => { throw new Error('unverified'); });
  });
  const fetchMock = vi.fn(async () => Response.json(status('completed'))); vi.stubGlobal('fetch', fetchMock);
  const { result } = readyHook();
  await act(async () => {});
  expect(result.current.turn?.done).toBe(true);
  expect(result.current.recoveryError).toMatch(/writer locked/);
  act(() => result.current.send(sessionId, 'not sent', 100));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('pauses bounded unavailable recovered polling without clearing identity or unlocking', async () => {
  sessionStorage.setItem(key, JSON.stringify(record)); vi.useFakeTimers();
  const fetchMock = vi.fn(async () => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = readyHook();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(fetchMock).toHaveBeenCalledTimes(12);
  expect(result.current.turn?.phase).toMatch(/supervision paused/);
  expect(result.current.turn?.done).toBe(false);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(record);
  unmount(); expect(vi.getTimerCount()).toBe(0);
});
it('does not persist a late admission ACK after unmount', async () => {
  let resolve!: (value: Response) => void; let request!: { sessionId: string; clientRequestId: string };
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { request = JSON.parse(init.body as string); return new Promise<Response>((done) => { resolve = done; }); }));
  const { result, unmount } = readyHook();
  act(() => result.current.send(sessionId, 'private payload', 100));
  const pending = sessionStorage.getItem(key);
  unmount();
  await act(async () => resolve(Response.json({ sessionId, clientRequestId: request.clientRequestId, publicRunId, status: 'running', replayed: false })));
  expect(sessionStorage.getItem(key)).toBe(pending);
  expect(JSON.parse(pending!).publicRunId).toBeNull();
});
it.each([160, 161])('validates stored session ID at length %s without normalization', (length) => {
  const identity = { ...record, sessionId: 'jc_'.padEnd(length, 'a') };
  sessionStorage.setItem(key, JSON.stringify(identity));
  if (length === 160) expect(readRecovery()).toEqual(identity);
  else expect(() => readRecovery()).toThrow();
});
it.each(['short', 'long', 'spaced'])('rejects %s stored public run ID exactly', (fault) => {
  sessionStorage.setItem(key, JSON.stringify({ ...record, publicRunId: fault === 'short' ? publicRunId.slice(0, -1) : fault === 'long' ? publicRunId + 'a' : ' ' + publicRunId }));
  expect(() => readRecovery()).toThrow();
});
it('writes and verifies only opaque pending identifiers before POST, then binds the ACK', async () => {
  vi.stubGlobal('EventSource', class { close() {} addEventListener() {} });
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ sessionId, clientRequestId: body.clientRequestId, publicRunId: null });
    return Response.json({ sessionId, clientRequestId: body.clientRequestId, publicRunId, status: 'running', replayed: false });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = readyHook();
  await act(async () => result.current.send(sessionId, 'secret original input', 100));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ sessionId, clientRequestId: result.current.turn!.intent.clientRequestId, publicRunId });
  expect(writes.mock.calls).toHaveLength(2);
  for (const [storedKey, value] of writes.mock.calls) {
    expect(storedKey).toBe(key);
    expect(Object.keys(JSON.parse(value)).sort()).toEqual(['clientRequestId', 'publicRunId', 'sessionId']);
    expect(value).not.toContain('secret');
  }
  unmount();
});
