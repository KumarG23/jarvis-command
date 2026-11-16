import { useEffect, useRef, useState } from 'react';
import { NotificationIdSchema } from '@jarvis-command/contracts';
import type { NotificationsState, NotificationsPane } from './Notifications';

function clearParameter() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('notification')) return;
  url.searchParams.delete('notification');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

/**
 * Tapping a push opens Command at `/?notification=<id>` (cold launch) or messages an open window.
 * Once the live connection and project navigation are ready (so a restored project selection
 * cannot overwrite it), the target is resolved by the server and its chat opened automatically,
 * once per notification. The banner stays only when that fails or is not yet possible.
 */
export function PushLink({ enabled, ready = true, state, onOpen }: Readonly<{
  enabled: boolean;
  /** Project navigation has finished its initial load and restore. */
  ready?: boolean;
  state: NotificationsState;
  onOpen: Parameters<typeof NotificationsPane>[0]['onOpen'];
}>) {
  const [id, setId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const result = NotificationIdSchema.safeParse(params.get('notification'));
    return result.success ? result.data : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const receive = (event: MessageEvent) => {
      const source = event.source as ServiceWorker | null;
      if (!source || source !== navigator.serviceWorker.controller || event.data?.type !== 'command-notification') return;
      const result = NotificationIdSchema.safeParse(event.data.id);
      if (result.success) { attempted.current.delete(result.data); setId(result.data); setNotice(null); }
    };
    navigator.serviceWorker.addEventListener('message', receive);
    return () => navigator.serviceWorker.removeEventListener('message', receive);
  }, []);

  const open = async (target: string) => {
    const result = await state.open(target);
    if (result?.state === 'available') {
      const note = onOpen(result);
      if (!note) { setId(current => current === target ? null : current); clearParameter(); } else setNotice(note);
    } else setNotice('This notification is missing, expired or unavailable for this account. No action was taken.');
  };

  useEffect(() => {
    if (!id || !enabled || !ready || attempted.current.has(id)) return;
    attempted.current.add(id);
    void open(id);
  }, [id, enabled, ready]); // one automatic attempt per notification id

  if (!id) return null;
  return <div className="push-link notice" role="region" aria-label="Push notification">
    <p>{enabled && ready && !notice ? 'Opening the chat for this notification…' : 'Notification received. Open to confirm access and current status.'}</p>
    {!enabled ? <p>Sign in to a live Command connection to review it.</p> : <button className="secondary-button" type="button" disabled={state.busy} onClick={() => { void open(id); }}>Open notification</button>}
    <button className="text-button" type="button" onClick={() => { setId(null); clearParameter(); }}>Dismiss notification</button>
    {notice ? <p role="status">{notice}</p> : null}
  </div>;
}
