import { useState } from 'react';
import { NotificationInboxSchema, type PushState } from '@jarvis-command/contracts';
import { boundedJson } from './useLiveTurn';
import { knownItems } from './notificationInbox';
import type { NotificationsState } from './Notifications';

const write = (body: unknown): RequestInit => ({ method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-jarvis-command': '1', accept: 'application/json' }, body: JSON.stringify(body) });
const unavailable = { disabled: 'Web Push is disabled on this server.', configuration: 'Web Push configuration is unavailable.', storage: 'Private device storage is unavailable.', capacity: 'Push delivery tracking is full. New alerts are unavailable.' };

export function PushSettings({ push, refresh }: Readonly<{ push: PushState | undefined; refresh: NotificationsState['refresh'] }>) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const capability = push?.capability ?? { state: 'unavailable' as const, reason: 'disabled' as const };
  // Feature detection only: never permission/subscription access on mount or while disabled.
  const supported = typeof Notification !== 'undefined' && typeof PushManager !== 'undefined' && 'serviceWorker' in navigator;
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setNotice(null);
    try { await fn(); } catch { setNotice('Device change could not be confirmed. Check the device list before trying again.'); }
    finally { setBusy(false); }
  };
  async function enable() {
    if (capability.state !== 'available' || !supported) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setNotice('Notification permission was not granted. No device was registered.'); return; }
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration?.active) { setNotice('The app worker is not ready. Reopen Command before trying again.'); return; }
    const key = Uint8Array.from(atob(capability.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    NotificationInboxSchema.parse(knownItems(await boundedJson('/api/notifications/push/devices', write(subscription.toJSON()), new AbortController())));
    await refresh();
    setNotice('This device is registered. Delivery is best effort; keep using the inbox for current status.');
  }
  return <section aria-labelledby="push-settings">
    <h4 id="push-settings">Device push alerts</h4>
    <p className="muted small">Device push covers Jarvis replies, when the server enables it, and scheduled reminders. A reply alert shows the first line of Jarvis's answer only while “Show reply text in notifications” is on; run, failure and approval events stay in the inbox and are never pushed. Replies are pushed even after you close the app, unless Command is open and focused somewhere. Terminal (CLI) events are not pushed.</p>
    {capability.state === 'unavailable' ? <p role="status">{unavailable[capability.reason]} No browser permission is requested.</p> : !supported ? <p role="status">Web Push is unsupported in this browser.</p> : <button type="button" className="secondary-button" disabled={busy} onClick={() => void action(enable)}>Enable push on this device</button>}
    {push?.devices.length ? <ul aria-label="Registered push devices">{push.devices.map(device => <li key={device.id}>
      <span>Device {device.id.slice(-6)} · expires {new Date(device.expiresAt).toLocaleDateString()}</span>{' '}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void action(async () => {
        NotificationInboxSchema.parse(knownItems(await boundedJson(`/api/notifications/push/devices/${device.id}/revoke`, write({}), new AbortController())));
        await refresh(); setNotice('Device revoked. Future sends to it are disabled. An already dispatched alert cannot be recalled.');
      })}>Revoke device {device.id.slice(-6)}</button>
    </li>)}</ul> : null}
    {capability.state === 'available' && push?.devices.length ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void action(async () => {
      let result: { devices?: number; accepted?: number; expired?: number };
      try { result = await boundedJson('/api/notifications/push/test', write({}), new AbortController()) as typeof result; }
      catch { setNotice('The test could not be sent. Wait 20 seconds and try again.'); return; }
      const accepted = result.accepted ?? 0;
      setNotice(accepted > 0
        ? `Test sent to ${accepted} of ${result.devices ?? 0} device${result.devices === 1 ? '' : 's'}. If it doesn't appear on this phone within a minute, the push service accepted it but the phone didn't show it.`
        : result.expired ? 'The push service says this device registration expired. Revoke it and enable push again.' : 'The test could not be sent. Try again in a moment.');
    })}>Send test notification</button> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
