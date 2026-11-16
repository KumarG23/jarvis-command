import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BUSY_PHASE, setAdmissionRetryDelays, UNCONFIRMED_PHASE, useLiveTurn } from './useLiveTurn';

const sessionId = 'jc_' + 'a'.repeat(32);
const publicRunId = 'jcr_' + 'a'.repeat(32);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function hook() {
  const result = renderHook(() => useLiveTurn(sessionId));
  act(() => result.result.current.history(sessionId, [], true));
  return result;
}

it('waits out a busy chat and sends the same message once it is free', async () => {
  vi.useFakeTimers();
  setAdmissionRetryDelays([1_000, 2_000]);
  const bodies: Array<{ clientRequestId: string }> = [];
  vi.stubGlobal('EventSource', class { addEventListener() {} close() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/live/runs') return new Response(null, { status: 404 });
    const body = JSON.parse(String(init!.body)) as { clientRequestId: string; sessionId: string };
    bodies.push(body);
    if (bodies.length === 1) return Response.json({ error: 'conflict' }, { status: 409 });
    return Response.json({ sessionId: body.sessionId, clientRequestId: body.clientRequestId, publicRunId, status: 'running', replayed: false });
  }));
  const { result, unmount } = hook();
  act(() => { result.current.send(sessionId, 'Not working still', 1000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(result.current.turn?.phase).toBe(BUSY_PHASE);
  await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
  expect(bodies).toHaveLength(2);
  expect(bodies[1]!.clientRequestId).toBe(bodies[0]!.clientRequestId);
  expect(result.current.turn?.publicRunId).toBe(publicRunId);
  unmount();
});

it('says plainly when it still cannot confirm a send, and offers Try again', async () => {
  vi.useFakeTimers();
  setAdmissionRetryDelays([500]);
  const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = hook();
  act(() => { result.current.send(sessionId, 'hello', 1000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.turn?.phase).toBe(UNCONFIRMED_PHASE);
  unmount();
});

it('does not retry a request Command rejected outright', async () => {
  setAdmissionRetryDelays([10]);
  const fetchMock = vi.fn(async () => new Response(null, { status: 400 }));
  vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = hook();
  act(() => { result.current.send(sessionId, 'hello', 1000); });
  await vi.waitFor(() => expect(result.current.turn?.phase).toBe(UNCONFIRMED_PHASE));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  unmount();
});
