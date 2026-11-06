import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useReplyPresence } from './useReplyPresence';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const bodies = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.map(([, init]) => JSON.parse(String(init.body)));

it('reports visibility for the session, never sends a visible mark for a hidden page, and clears on unmount', () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const view = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const { unmount } = renderHook(() => useReplyPresence('jc_' + 'a'.repeat(32)));
  expect(bodies(fetcher)).toEqual([{ sessionId: 'jc_' + 'a'.repeat(32), visible: true }]);
  vi.advanceTimersByTime(10_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.mockReturnValue('hidden');
  vi.advanceTimersByTime(10_000);
  expect(fetcher).toHaveBeenCalledTimes(2); // no heartbeat while hidden
  unmount();
  expect(bodies(fetcher).at(-1)).toEqual({ sessionId: 'jc_' + 'a'.repeat(32), visible: false });
});

it('does nothing without a session or when disabled', () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  renderHook(() => useReplyPresence(null));
  renderHook(() => useReplyPresence('jc_' + 'a'.repeat(32), false));
  expect(fetcher).not.toHaveBeenCalled();
});
