import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLatestMessageView } from './useLatestMessageView';
let observe: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('requires the actual latest sentinel, full clipped visibility, foreground and focus; disconnects on switch', () => {
  const disconnect = vi.fn(), viewed = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof observe) { observe = callback; } observe() {} disconnect = disconnect; });
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 20, top: 20, bottom: 22, left: 0, right: 100, width: 100, height: 2, toJSON() {} });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => document.querySelector('.latest')) });
  function Pane({ id }: { id: string }) { const ref = useLatestMessageView(id, 'latest:exact', 51, 'fresh', viewed); return <div className="timeline"><span className="latest" ref={ref} /></div>; }
  const { rerender, unmount } = render(<Pane id="a" />);
  expect(viewed).not.toHaveBeenCalled();
  act(() => observe([{ isIntersecting: true, intersectionRatio: .5 }])); expect(viewed).not.toHaveBeenCalled();
  focus.mockReturnValue(false);
  act(() => observe([{ isIntersecting: true, intersectionRatio: 1 }])); expect(viewed).not.toHaveBeenCalled();
  focus.mockReturnValue(true); act(() => window.dispatchEvent(new Event('focus')));
  expect(viewed).toHaveBeenCalledExactlyOnceWith('a', 'latest:exact', 51);
  viewed.mockClear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange'))); expect(viewed).not.toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: -1, bottom: 1, left: 0, right: 100, width: 100, height: 2 } as DOMRect);
  act(() => observe([{ isIntersecting: true, intersectionRatio: 1 }])); expect(viewed).not.toHaveBeenCalled();
  rerender(<Pane id="b" />); expect(disconnect).toHaveBeenCalledTimes(1);
  unmount(); expect(disconnect).toHaveBeenCalledTimes(2);
});
