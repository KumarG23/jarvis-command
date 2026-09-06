import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLiveTurn } from './useLiveTurn';

const ids = Array.from({ length: 40 }, (_, i) => `jc_${i.toString(16).padStart(32, '0')}`);
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('bounds room snapshots to 32, refreshes recency, and safely reloads an evicted room', () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = renderHook(useLiveTurn);
  act(() => { for (const id of ids.slice(0, 32)) result.current.history(id, [], true); });
  act(() => { result.current.history(ids[0]!, [], true); result.current.history(ids[32]!, [], true); });
  expect(result.current.historyReady(ids[0])).toBe(true);
  expect(result.current.historyReady(ids[1])).toBe(false);
  expect(ids.filter(id => result.current.historyReady(id))).toHaveLength(32);
  act(() => result.current.history(ids[1]!, [], false));
  expect(result.current.historyReady(ids[1])).toBe(false);
  act(() => result.current.history(ids[1]!, [], true));
  expect(result.current.historyReady(ids[1])).toBe(true);
  expect(ids.filter(id => result.current.historyReady(id))).toHaveLength(32);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
  unmount();
});

it.each(['admitting', 'reload'] as const)('keeps %s identity protected while other room snapshots are evicted', async (kind) => {
  const active = 'jc_cache_active';
  const key = 'jarvis-command:live-turn';
  const fetchMock = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetchMock);
  if (kind === 'reload') sessionStorage.setItem(key, JSON.stringify({ sessionId: active, clientRequestId: '12345678-1234-4234-8234-123456789abc', publicRunId: null }));
  const { result, unmount } = renderHook(useLiveTurn);
  act(() => result.current.history(active, [], true));
  if (kind === 'admitting') act(() => expect(result.current.send(active, 'private current draft', 100)).toBe(true));
  const intent = result.current.turn!.intent;
  const recovery = sessionStorage.getItem(key);
  act(() => { for (const id of ids) result.current.history(id, [], true); });
  expect(result.current.historyReady(active)).toBe(true);
  expect([active, ...ids].filter(id => result.current.historyReady(id))).toHaveLength(32);
  expect(result.current.turn!.intent).toBe(intent);
  expect(sessionStorage.getItem(key)).toBe(recovery);
  act(() => expect(result.current.send(ids.at(-1)!, 'must not replace active work', 100)).toBe(false));
  expect(fetchMock).toHaveBeenCalledTimes(kind === 'admitting' ? 1 : 0);
  await act(async () => unmount());
});
