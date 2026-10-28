import { useEffect, useState } from 'react';
import { NotificationIdSchema } from '@jarvis-command/contracts';
import type { NotificationsState, NotificationsPane } from './Notifications';

export function PushLink({ enabled, state, onOpen }: Readonly<{ enabled: boolean; state: NotificationsState; onOpen: Parameters<typeof NotificationsPane>[0]['onOpen'] }>) {
  const [id, setId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const result = NotificationIdSchema.safeParse(params.get('notification'));
    return result.success ? result.data : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const receive = (event: MessageEvent) => {
      const source = event.source as ServiceWorker | null;
      if (!source || source !== navigator.serviceWorker.controller || event.data?.type !== 'command-notification') return;
      const result = NotificationIdSchema.safeParse(event.data.id);
      if (result.success) { setId(result.data); setNotice(null); }
    };
    navigator.serviceWorker.addEventListener('message', receive);
    return () => navigator.serviceWorker.removeEventListener('message', receive);
  }, []);
  if (!id) return null;
  return <div className="push-link notice" role="region" aria-label="Push notification">
    <p>Notification received. Open to confirm access and current status.</p>
    {!enabled ? <p>Sign in to a live Command connection to review it.</p> : <button className="secondary-button" type="button" disabled={state.busy} onClick={async () => {
      const target = await state.open(id);
      if (target?.state === 'available') { const note = onOpen(target); if (!note) setId(null); else setNotice(note); }
      else setNotice('This notification is missing, expired or unavailable for this account. No action was taken.');
    }}>Open notification</button>}
    <button className="text-button" type="button" onClick={() => {
      setId(null);
      const url = new URL(window.location.href); url.searchParams.delete('notification');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }}>Dismiss notification</button>
    {notice ? <p role="status">{notice}</p> : null}
  </div>;
}
