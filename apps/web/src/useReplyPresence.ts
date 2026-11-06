import { useEffect } from 'react';

const write = (body: unknown): RequestInit => ({
  method: 'POST', credentials: 'same-origin', keepalive: true,
  headers: { 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: JSON.stringify(body),
});

/**
 * Best-effort: tells the server this session is on screen so it can skip a push. Marks expire
 * server-side within seconds, so a closed tab, crash or lost request never leaves a false
 * "visible"; when visibility is uncertain nothing is sent and nothing is suppressed.
 */
export function useReplyPresence(sessionId: string | null, enabled = true) {
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const visible = () => document.visibilityState === 'visible' && document.hasFocus();
    const report = () => { void fetch('/api/notifications/presence', write({ sessionId, visible: visible() })).catch(() => undefined); };
    report();
    const timer = window.setInterval(() => { if (visible()) report(); }, 10_000);
    for (const name of ['focus', 'blur']) window.addEventListener(name, report);
    document.addEventListener('visibilitychange', report);
    return () => {
      window.clearInterval(timer);
      for (const name of ['focus', 'blur']) window.removeEventListener(name, report);
      document.removeEventListener('visibilitychange', report);
      void fetch('/api/notifications/presence', write({ sessionId, visible: false })).catch(() => undefined);
    };
  }, [sessionId, enabled]);
}
