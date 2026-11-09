import { ThreadStateSchema, type ThreadState } from '@jarvis-command/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeThreadState } from './threadStatus';
import { boundedJson } from './useLiveTurn';

export function useThreadStates(sessionIds: readonly string[], enabled: boolean) {
  const [states, setStates] = useState<Record<string, ThreadState>>({});
  const current = useRef(states); current.current = states;
  const [clock, setClock] = useState(Date.now());
  const ids = [...new Set(sessionIds)].filter(id => /^jc_[a-f0-9]{32}$/.test(id)).slice(0, 50).sort().join('|');
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, running = false;
    const controllers = new Set<AbortController>();
    const refresh = async () => {
      setClock(Date.now());
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      const pending = ids.split('|').filter(Boolean);
      const worker = async () => {
        while (pending.length && !stopped && document.visibilityState === 'visible') {
          const id = pending.shift()!, controller = new AbortController(); controllers.add(controller);
          try {
            const state = ThreadStateSchema.parse(await boundedJson(`/api/live/sessions/${encodeURIComponent(id)}/thread-state`, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } }, controller));
            if (state.sessionId !== id) throw Error('Thread identity differs');
            if (!stopped) setStates(old => ({ ...old, [id]: mergeThreadState(old[id], state) }));
          } catch { /* Old observations expire to Unknown; transport never becomes Idle. */ }
          finally { controllers.delete(controller); }
        }
      };
      await Promise.all([worker(), worker()]); running = false;
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { stopped = true; clearInterval(timer); controllers.forEach(c => c.abort()); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [ids, enabled]);
  const viewing = useRef(new Set<string>());
  const viewed = useCallback(async (sessionId: string, messageId: string, position: number) => {
    const state = current.current[sessionId];
    if (!enabled || document.visibilityState !== 'visible' || !document.hasFocus() || !state?.unread
      || state.latest?.messageId !== messageId || state.latest.position !== position || viewing.current.has(sessionId)) return;
    viewing.current.add(sessionId);
    try {
      const result = ThreadStateSchema.parse(await boundedJson(`/api/live/sessions/${encodeURIComponent(sessionId)}/read`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: JSON.stringify({ messageId, position }),
      }, new AbortController()));
      if (result.sessionId !== sessionId) return;
      setStates(old => ({ ...old, [sessionId]: mergeThreadState(old[sessionId], result) }));
    } catch { /* No automatic write retry: next authoritative observation and actual view are required. */ }
    finally { viewing.current.delete(sessionId); }
  }, [enabled]);
  return { states, clock: Math.max(clock, Date.now()), viewed };
}
