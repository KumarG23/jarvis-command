import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createReadbackFixture } from './readbackFixture';
import { TurnComposer } from './TurnView';
import { useThreadTurns } from './useThreadTurns';
import { readThreadRecoveries, readThreadRecovery, recoveryKey, threadRecoveryKey, writeThreadRecovery } from './turnRecovery';

const a = 'jc_thread_a', b = 'jc_thread_b';
const runA = `jcr_${'a'.repeat(32)}`, runB = `jcr_${'b'.repeat(32)}`;
const requestA = '12345678-1234-4234-8234-123456789abc';
const requestB = '12345678-1234-4234-8234-123456789abd';
const timestamp = '2026-10-31T20:00:00.000Z';
let threads: ReturnType<typeof useThreadTurns>;
function Harness({ visible = [] as string[], composerFor }: { visible?: string[]; composerFor?: string }) {
  threads = useThreadTurns([a, b], visible);
  const live = threads.get(composerFor);
  return <>{threads.supervisors}{composerFor && threads.ready(composerFor) ? <TurnComposer retainedDrafts={live.composerDrafts} sessionId={composerFor} projectId={null} allowed draftsAuthorized imageAttachmentsEnabled max={4000} maxSteer={100} turn={live.turn} send={live.send} retry={live.retry} resume={live.resume} steer={live.steer} recoveries={live.recoveries} consumeRecovery={live.consumeRecovery} /> : null}</>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function status(sessionId: string, extra = {}) {
  return { publicRunId: sessionId === a ? runA : runB, sessionId, status: 'running', updatedAt: timestamp, approval: null, output: null, error: null, pendingSteer: null, usage: null, ...extra };
}
function fixture(admit?: (body: Record<string, string>) => Promise<Response>) {
  const posts: { url: string; body: Record<string, string> }[] = [];
  const states = new Map([[a, status(a)], [b, status(b)]]);
  const reads = vi.fn(async (url: string) => Response.json(states.get(url.includes(runA) ? a : b)));
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push({ url, body });
      if (url === '/api/live/runs') return admit ? admit(body) : Response.json({ sessionId: body.sessionId, clientRequestId: body.clientRequestId, publicRunId: body.sessionId === a ? runA : runB, status: 'running', replayed: false });
      const publicRunId = url.includes(runA) ? runA : runB;
      return Response.json(url.endsWith('/stop') ? { publicRunId, stopped: true, status: 'cancelled' } : url.endsWith('/steer') ? { publicRunId, queued: true } : { publicRunId, requestId: body.requestId, choice: body.choice, accepted: true });
    }
    return reads(url);
  });
  vi.stubGlobal('fetch', fetcher);
  const source = vi.fn(); vi.stubGlobal('EventSource', source);
  return { posts, states, reads, source, fetcher };
}
async function ready() {
  await waitFor(() => expect(threads.ready(a) && threads.ready(b)).toBe(true));
  act(() => { threads.get(a).history(a, [], true); threads.get(b).history(b, [], true); });
}
function sendBoth() {
  act(() => {
    expect(threads.get(a).send(a, 'SYNTHETIC A', 100, undefined, undefined, requestA)).toBe(true);
    expect(threads.get(b).send(b, 'SYNTHETIC B', 100, undefined, undefined, requestB)).toBe(true);
    expect(threads.get(a).send(a, 'duplicate', 100)).toBe(false);
    expect(threads.get(b).send(b, 'duplicate', 100)).toBe(false);
    expect(threads.get(a).send(b, 'wrong supervisor', 100)).toBe(false);
  });
}
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('admits two explicit sends independently, guards each busy session and retains both across pane closure', async () => {
  const f = fixture(); const view = render(<Harness />); await ready(); sendBoth();
  await waitFor(() => expect(threads.get(b).turn?.identityVerified).toBe(true));
  expect(f.posts).toHaveLength(2);
  expect(f.posts.map(post => post.body.sessionId)).toEqual([a, b]);
  expect(readThreadRecoveries()).toHaveLength(2);
  expect(threads.get(a).turn?.intent.input).toBe('SYNTHETIC A');
  expect(threads.get(b).turn?.intent.input).toBe('SYNTHETIC B');
  view.rerender(<Harness visible={[]} />);
  expect(threads.get(a).turn?.publicRunId).toBe(runA);
  expect(threads.get(b).turn?.publicRunId).toBe(runB);
  expect(f.source).not.toHaveBeenCalled();
  expect(f.posts).toHaveLength(2);
});

it('accepts reversed ACK/status responses only in their original thread and fails closed on a foreign status', async () => {
  const ackA = deferred<Response>(), ackB = deferred<Response>();
  const f = fixture(body => body.sessionId === a ? ackA.promise : ackB.promise);
  const readbacks = createReadbackFixture<Response>();
  readbacks.arm();
  f.reads.mockImplementation(url => readbacks.read(url.includes(runA) ? a : b, () => Response.json(status(a))));
  render(<Harness />); await ready(); sendBoth();
  await act(async () => { ackB.resolve(Response.json({ sessionId: b, clientRequestId: requestB, publicRunId: runB, status: 'running', replayed: false })); });
  expect(threads.get(a).turn?.publicRunId).toBeNull();
  await act(async () => { ackA.resolve(Response.json({ sessionId: a, clientRequestId: requestA, publicRunId: runA, status: 'running', replayed: false })); });
  await act(async () => { readbacks.resolve(b, Response.json(status(b, { output: 'B only' }))); readbacks.resolve(a, Response.json(status(b, { output: 'must not enter A' }))); });
  expect(threads.get(b).turn?.output).toBe('B only');
  expect(threads.get(a).turn?.output).toBe('');
  expect(threads.get(a).turn?.phase).toContain('unconfirmed');
  expect(readThreadRecovery(a)?.publicRunId).toBe(runA);
});

it('reloads two lost-ACK admissions using GET lookup and status only, without replaying either payload', async () => {
  const f = fixture(async () => { throw new Error('SYNTHETIC ACK loss'); });
  const view = render(<Harness />); await ready(); sendBoth();
  await waitFor(() => expect(threads.get(a).turn?.phase).toContain('uncertain'));
  expect(readThreadRecoveries().every(record => record.publicRunId === null)).toBe(true);
  view.unmount();
  f.fetcher.mockImplementation(async (url: string) => {
    const sessionId = url.includes(a) || url.includes(runA) ? a : b;
    return Response.json(url.includes('/run-requests/') ? { sessionId, clientRequestId: sessionId === a ? requestA : requestB, publicRunId: sessionId === a ? runA : runB } : status(sessionId));
  });
  render(<Harness />);
  await waitFor(() => expect(threads.get(a).turn?.identityVerified && threads.get(b).turn?.identityVerified).toBe(true));
  expect(threads.get(a).turn?.intent.input).toBeNull();
  expect(threads.get(b).turn?.intent.input).toBeNull();
  expect(f.posts).toHaveLength(2);
  expect(readThreadRecoveries().map(record => record.publicRunId).sort()).toEqual([runA, runB]);
});

it('retries only the original captured intent explicitly while the other thread remains active', async () => {
  let attempts = 0;
  const f = fixture(async body => {
    if (body.sessionId === a && ++attempts === 1) throw new Error('lost ACK');
    return Response.json({ sessionId: body.sessionId, clientRequestId: body.clientRequestId, publicRunId: body.sessionId === a ? runA : runB, status: 'running', replayed: body.sessionId === a });
  });
  render(<Harness />); await ready(); sendBoth();
  await waitFor(() => expect(threads.get(a).turn?.phase).toContain('uncertain'));
  act(() => threads.get(a).retry());
  await waitFor(() => expect(threads.get(a).turn?.identityVerified).toBe(true));
  expect(f.posts.filter(post => post.body.sessionId === a).map(post => post.body)).toEqual([f.posts[0]!.body, f.posts[0]!.body]);
  expect(f.posts.filter(post => post.body.sessionId === b)).toHaveLength(1);
});

it('preserves legacy bytes while importing, protects per-session CAS and refuses malformed records globally', () => {
  const legacy = { sessionId: a, clientRequestId: requestA, publicRunId: runA };
  const bytes = JSON.stringify(legacy, null, 2);
  sessionStorage.setItem(recoveryKey, bytes);
  const other = { sessionId: b, clientRequestId: requestB, publicRunId: runB };
  writeThreadRecovery(b, other, null);
  expect(readThreadRecoveries()).toEqual([legacy, other]);
  expect(sessionStorage.getItem(recoveryKey)).toBe(bytes);
  expect(() => writeThreadRecovery(a, { ...legacy, clientRequestId: requestB }, null)).toThrow();
  writeThreadRecovery(a, null, legacy);
  expect(readThreadRecoveries()).toEqual([other]);
  expect(sessionStorage.getItem(recoveryKey)).toBe(bytes);
  sessionStorage.setItem(threadRecoveryKey, '{broken');
  expect(() => writeThreadRecovery(b, null, other)).toThrow();
  expect(sessionStorage.getItem(threadRecoveryKey)).toBe('{broken');
});

it.each(['stop', 'steer', 'approval'] as const)('binds %s to one exact run while the other continues and rejects cross-supervisor controls', async kind => {
  const approval = { requestId: 'approval:synthetic', command: 'SYNTHETIC complete target', description: 'SYNTHETIC owned fixture only', tool: 'terminal' };
  const f = fixture();
  f.states.set(a, status(a, { approval }));
  const control = deferred<Response>();
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation((url, init) => url.endsWith(`/${kind}`) ? control.promise : original(url, init));
  render(<Harness />); await ready(); sendBoth();
  await waitFor(() => expect(threads.get(a).turn?.approval).toEqual(approval));
  const beforeB = threads.get(b).turn;
  const captured = threads.get(a).turn!;
  let outcome: Promise<unknown>;
  act(() => {
    // The B supervisor cannot operate an A card, even with its exact public id.
    void threads.get(b).stop(captured);
    outcome = kind === 'stop' ? threads.get(a).stop(captured) : kind === 'steer' ? threads.get(a).steer(captured, 'SYNTHETIC guidance A', 100) : threads.get(a).approve(captured, 'deny');
  });
  expect(threads.get(a).turn?.controlBusy).toBe(true);
  expect(threads.get(b).turn).toBe(beforeB);
  const call = f.fetcher.mock.calls.find(([url]) => url.endsWith(`/${kind}`));
  expect(call?.[0]).toBe(`/api/live/runs/${runA}/${kind}`);
  expect(JSON.parse(String(call?.[1]?.body))).toEqual(kind === 'stop' ? {} : kind === 'steer' ? { input: 'SYNTHETIC guidance A' } : { requestId: approval.requestId, choice: 'deny' });
  const ack = kind === 'stop' ? { publicRunId: runA, status: 'cancelled' } : kind === 'steer' ? { publicRunId: runA, accepted: true, state: 'queued' } : { publicRunId: runA, requestId: approval.requestId, choice: 'deny', resolved: 1 };
  await act(async () => { control.resolve(Response.json(ack)); await outcome!; });
  expect(threads.get(a).turn?.done).toBe(false); // ACK is not terminal evidence.
  expect(threads.get(b).turn).toBe(beforeB);
  expect(f.posts.filter(post => post.url === '/api/live/runs')).toHaveLength(2);
  expect(readThreadRecoveries()).toHaveLength(2);
});

it('does not let an obsolete status response undo a later control readback', async () => {
  const f = fixture(); const oldRead = deferred<Response>();
  let first = true;
  f.reads.mockImplementation(async url => {
    if (url.includes(runA) && first) { first = false; return oldRead.promise; }
    return Response.json(status(url.includes(runA) ? a : b, url.includes(runA) ? { status: 'cancelled', output: 'SYNTHETIC stopped A' } : {}));
  });
  render(<Harness />); await ready(); sendBoth();
  await waitFor(() => expect(threads.get(a).turn?.identityVerified).toBe(true));
  await act(async () => { await threads.get(a).stop(threads.get(a).turn!); });
  await waitFor(() => expect(threads.get(a).turn?.done).toBe(true));
  await act(async () => { oldRead.resolve(Response.json(status(a, { output: 'obsolete A' }))); });
  expect(threads.get(a).turn?.phase).toBe('Run cancelled');
  expect(threads.get(a).turn?.output).toBe('SYNTHETIC stopped A');
  expect(threads.get(b).turn?.done).toBe(false);
  expect(readThreadRecovery(a)).toBeNull();
  expect(readThreadRecovery(b)?.publicRunId).toBe(runB);
});

it('polls without overlap, backs off in background and aborts readers on unmount', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const pending = deferred<Response>();
  f.reads.mockImplementation(() => pending.promise);
  const view = render(<Harness />);
  await act(async () => {});
  act(() => { threads.get(a).history(a, [], true); threads.get(b).history(b, [], true); });
  sendBoth(); await act(async () => {});
  expect(f.reads).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
  expect(f.reads).toHaveBeenCalledTimes(2);
  view.unmount();
  const signals = f.fetcher.mock.calls.filter(([, init]) => init?.method !== 'POST').map(([, init]) => init?.signal);
  expect(signals.every(signal => signal?.aborted)).toBe(true);
  await act(async () => { pending.resolve(Response.json(status(a))); await vi.advanceTimersByTimeAsync(60_000); });
  expect(f.reads).toHaveBeenCalledTimes(2);
  expect(f.posts).toHaveLength(2);
});

it('keeps at most two foreground streams and never appends stream deltas to a polled snapshot after pane/visibility changes', async () => {
  class Source {
    static instances: Source[] = [];
    closed = false;
    listeners = new Map<string, (event: MessageEvent) => void>();
    onerror: (() => void) | null = null;
    constructor(public url: string) { Source.instances.push(this); }
    addEventListener(name: string, listener: (event: MessageEvent) => void) { this.listeners.set(name, listener); }
    close() { this.closed = true; }
  }
  const f = fixture(); vi.stubGlobal('EventSource', Source);
  f.states.set(a, status(a, { output: 'SYNTHETIC canonical snapshot A' }));
  const view = render(<Harness visible={[a, b]} />); await ready(); sendBoth();
  await waitFor(() => expect(Source.instances).toHaveLength(2));
  const aStream = Source.instances.find(source => source.url.includes(runA))!;
  act(() => aStream.listeners.get('message.delta')!({ data: JSON.stringify({ type: 'message.delta', publicRunId: runA, timestamp, delta: 'prefix A' }) } as MessageEvent));
  expect(threads.get(a).turn?.output).toBe('prefix A');
  view.rerender(<Harness visible={[b]} />);
  await waitFor(() => expect(threads.get(a).turn?.output).toBe('SYNTHETIC canonical snapshot A'));
  expect(aStream.closed).toBe(true);
  view.rerender(<Harness visible={[a, b]} />);
  await act(async () => {});
  expect(Source.instances).toHaveLength(2);
  expect(threads.get(a).turn?.output).toBe('SYNTHETIC canonical snapshot A');
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(Source.instances.every(source => source.closed)).toBe(true));
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => {});
  expect(Source.instances).toHaveLength(2);
  expect(f.posts).toHaveLength(2);
});

it.each(['malformed', 'duplicate-session', 'foreign-lookup', 'expired-access'] as const)('keeps both identities locked without replay for %s recovery', async fault => {
  const records = [{ sessionId: a, clientRequestId: requestA, publicRunId: fault === 'foreign-lookup' ? null : runA }, { sessionId: b, clientRequestId: requestB, publicRunId: runB }];
  const bytes = fault === 'malformed' ? '{invalid' : JSON.stringify({ version: 2, legacyImported: true, records: fault === 'duplicate-session' ? [records[0], records[0]] : records });
  sessionStorage.setItem(threadRecoveryKey, bytes);
  const f = fixture();
  f.fetcher.mockImplementation(async url => fault === 'expired-access' ? new Response('', { status: 401 }) : Response.json(url.includes('run-requests') ? { ...records[1] } : status(url.includes(runA) ? a : b)));
  render(<Harness />); await ready();
  await act(async () => {});
  act(() => {
    expect(threads.get(a).send(a, 'do not replay', 100)).toBe(false);
    expect(threads.get(b).send(b, 'do not replay', 100)).toBe(false);
  });
  expect(f.posts).toHaveLength(0);
  expect(sessionStorage.getItem(threadRecoveryKey)).toBe(bytes);
  if (fault === 'malformed' || fault === 'duplicate-session') expect(threads.get(a).recoveryError).toContain('writer locked');
  else expect(threads.get(a).turn?.phase).toMatch(/unknown|unconfirmed/);
});

it('retains unsent guidance and image references when its composer closes and reopens in another pane', async () => {
  const f = fixture(); const view = render(<Harness composerFor={a} />); await ready(); sendBoth();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Steer Jarvis' })).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox', { name: 'Steer Jarvis' }), { target: { value: 'SYNTHETIC unsent A guidance' } });
  act(() => threads.get(a).composerDrafts.setImagesBySession({ [a]: [{ artifactId: `art_${'c'.repeat(32)}`, version: 1, name: 'SYNTHETIC-A.png', size: 100 }] }));
  expect(screen.getByText('SYNTHETIC-A.png')).toBeInTheDocument();
  view.rerender(<Harness />);
  view.rerender(<Harness composerFor={b} />);
  expect(screen.getByRole('textbox', { name: 'Steer Jarvis' })).toHaveValue('');
  expect(screen.queryByText('SYNTHETIC-A.png')).not.toBeInTheDocument();
  view.rerender(<Harness />);
  view.rerender(<Harness composerFor={a} />);
  expect(screen.getByRole('textbox', { name: 'Steer Jarvis' })).toHaveValue('SYNTHETIC unsent A guidance');
  expect(screen.getByText('SYNTHETIC-A.png')).toBeInTheDocument();
  expect(f.posts).toHaveLength(2); // Opening/closing never sends guidance or images.
});

it('retains a failed-storage text draft across composer unmount without sending it', async () => {
  const f = fixture(); const view = render(<Harness composerFor={a} />); await ready();
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.includes('text-drafts')) throw new Error('SYNTHETIC storage full');
    original.call(this, key, value);
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'SYNTHETIC unsaved memory A' } });
  view.rerender(<Harness />);
  view.rerender(<Harness composerFor={b} />);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('');
  view.rerender(<Harness />);
  view.rerender(<Harness composerFor={a} />);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC unsaved memory A');
  expect(screen.getByText(/Draft storage unavailable or full/)).toBeInTheDocument();
  expect(f.posts).toHaveLength(0);
});
