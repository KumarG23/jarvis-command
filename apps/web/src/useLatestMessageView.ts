import { useEffect, useRef } from 'react';
// A bottom-of-message sentinel must intersect the clipped pane AND the viewport.
// Mounting, loading the last page, notification focus and a hidden tab are not reads.
export function useLatestMessageView(sessionId: string, messageId: string | null, position: number, observation: string | undefined,
  onViewed?: ((sessionId: string, messageId: string, position: number) => void) | undefined) {
  const marker = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const element = marker.current;
    if (!element || !messageId || !onViewed || typeof IntersectionObserver === 'undefined') return;
    let intersecting = false;
    const check = () => {
      if (!intersecting || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const box = element.getBoundingClientRect(), pane = element.closest('.timeline')?.getBoundingClientRect();
      if (!pane || box.width <= 0 || box.height <= 0 || box.top < Math.max(0, pane.top) || box.bottom > Math.min(innerHeight, pane.bottom)
        || box.left < Math.max(0, pane.left) || box.right > Math.min(innerWidth, pane.right)) return;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (hit && element.contains(hit)) onViewed(sessionId, messageId, position);
    };
    const observer = new IntersectionObserver(entries => { intersecting = entries.some(e => e.isIntersecting && e.intersectionRatio === 1); check(); }, { threshold: 1 });
    observer.observe(element);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { observer.disconnect(); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [sessionId, messageId, position, observation, onViewed]);
  return marker;
}
