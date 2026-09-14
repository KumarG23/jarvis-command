import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

export function ContextPane({ open, children }: Readonly<{ open: boolean; children: ReactNode }>) {
  const [width, setWidth] = useState(380);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = panel.current;
    if (!element || !open) return;
    // A mobile sheet traps focus; desktop remains a non-modal companion to chat.
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 1000px)').matches) return;
      const controls = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    element.addEventListener('keydown', trap);
    return () => element.removeEventListener('keydown', trap);
  }, [open]);
  return <aside ref={panel} className="context-pane" aria-label="Context workspace" hidden={!open} style={{ width }}>
    <div role="separator" aria-label="Resize context pane" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={560} aria-valuenow={width} tabIndex={0} className="pane-resize"
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(value => Math.max(320, Math.min(560, value + (event.key === 'ArrowLeft' ? 20 : -20)))); } }}
      onPointerDown={event => { drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) setWidth(Math.max(320, Math.min(560, drag.current.width + drag.current.x - event.clientX))); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><GripVertical size={16} /></div>
    {children}
  </aside>;
}
