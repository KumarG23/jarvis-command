import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PushSettings } from './PushSettings';
import { PushLink } from './PushLink';
import type { NotificationsState } from './Notifications';

const publicKey = 'B' + 'a'.repeat(86);
const enabled = { capability: { state: 'available' as const, publicKey }, devices: [] };
const id = 'ntf_' + 'a'.repeat(32);
const inbox = { version: 1, items: [], unreadCount: 0, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } }, delivery: { inApp: 'incomplete', push: 'unavailable', externalSurfaces: 'unavailable' } };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
function browser(permission = 'granted') {
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal('Notification', { requestPermission }); vi.stubGlobal('PushManager', class {});
  const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/SYNTHETIC', expirationTime: null, keys: { p256dh: publicKey, auth: 'a'.repeat(22) } }) }));
  const getSubscription = vi.fn(async () => null);
  const getRegistration = vi.fn(async () => ({ active: {}, pushManager: { subscribe, getSubscription } }));
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  const fetch = vi.fn(async () => Response.json(inbox)); vi.stubGlobal('fetch', fetch);
  return { requestPermission, subscribe, getSubscription, getRegistration, fetch };
}
it('disabled by default: zero prompts, subscriptions, browser registration lookups or network effects', () => {
  const b = browser(); const refresh = vi.fn();
  render(<PushSettings push={undefined} refresh={refresh} />);
  expect(screen.getByText(/Web Push is disabled/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enable push on this device' })).not.toBeInTheDocument();
  for (const fn of Object.values(b)) expect(fn).not.toHaveBeenCalled();
});
it.each(['denied', 'default'])('explicit permission %s never subscribes or registers', async permission => {
  const b = browser(permission);
  render(<PushSettings push={enabled} refresh={vi.fn()} />);
  expect(b.requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enable push on this device' }));
  await screen.findByText(/permission was not granted/);
  expect(b.requestPermission).toHaveBeenCalledTimes(1);
  expect(b.subscribe).not.toHaveBeenCalled(); expect(b.fetch).not.toHaveBeenCalled(); expect(b.getRegistration).not.toHaveBeenCalled();
});
it('registers only after explicit grant, uses user-visible-only public key and refreshes authoritative state', async () => {
  const b = browser(); const refresh = vi.fn();
  render(<PushSettings push={enabled} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Enable push on this device' }));
  await screen.findByText(/This device is registered/);
  expect(b.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
  expect(b.fetch).toHaveBeenCalledWith('/api/notifications/push/devices', expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: expect.objectContaining({ 'x-jarvis-command': '1' }) }));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('shows unsupported browser honestly without permission/subscription effects', () => {
  const b = browser(); vi.stubGlobal('PushManager', undefined);
  render(<PushSettings push={enabled} refresh={vi.fn()} />);
  expect(screen.getByText(/unsupported in this browser/)).toBeInTheDocument();
  expect(b.requestPermission).not.toHaveBeenCalled(); expect(b.subscribe).not.toHaveBeenCalled();
});
it('reports uncertain registration and preserves subscription for explicit readback/retry instead of automatic subscription/retry', async () => {
  const b = browser(); b.fetch.mockRejectedValue(new Error());
  render(<PushSettings push={enabled} refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Enable push on this device' }));
  await screen.findByText(/could not be confirmed/);
  expect(b.fetch).toHaveBeenCalledTimes(1); expect(b.subscribe).toHaveBeenCalledTimes(1);
});
it('allows explicit revocation even if push is disabled and displays no endpoint or key material', async () => {
  const b = browser(); const refresh = vi.fn();
  render(<PushSettings push={{ capability: { state: 'unavailable', reason: 'disabled' }, devices: [{ id: 'dev_' + 'a'.repeat(32), registeredAt: '2026-10-28T00:00:00.000Z', expiresAt: '2026-11-28T00:00:00.000Z' }] }} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Revoke device aaaaaa' }));
  await screen.findByText(/Device revoked/);
  expect(b.fetch).toHaveBeenCalledWith('/api/notifications/push/devices/dev_' + 'a'.repeat(32) + '/revoke', expect.anything());
  expect(b.requestPermission).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledTimes(1);
});
it.each(['missing', 'unavailable', null])('reauthorizes click, leaves %s target actionless, and never adopts an unverified target', async result => {
  window.history.replaceState(null, '', '/?notification=' + id);
  const open = vi.fn(async () => result ? { state: result } : null); const onOpen = vi.fn();
  render(<PushLink enabled state={{ open, busy: false } as unknown as NotificationsState} onOpen={onOpen} />);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open notification' }));
  await screen.findByText(/missing, expired or unavailable/);
  expect(open).toHaveBeenCalledWith(id); expect(onOpen).not.toHaveBeenCalled();
});
it('keeps an opaque deep link through sign-in and opens only the server-confirmed target on explicit click', async () => {
  window.history.replaceState(null, '', '/?notification=' + id);
  const target = { state: 'available', sessionId: 'jc_' + 'a'.repeat(32) };
  const open = vi.fn(async () => target); const onOpen = vi.fn(() => null);
  const { rerender } = render(<PushLink enabled={false} state={{ open, busy: false } as unknown as NotificationsState} onOpen={onOpen} />);
  expect(screen.getByText(/Sign in to a live/)).toBeInTheDocument(); expect(open).not.toHaveBeenCalled();
  rerender(<PushLink enabled state={{ open, busy: false } as unknown as NotificationsState} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open notification' }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(target));
  expect(screen.queryByRole('region', { name: 'Push notification' })).not.toBeInTheDocument();
});
it('ignores malformed push query targets', () => {
  window.history.replaceState(null, '', '/?notification=https://evil.invalid');
  const open = vi.fn(); render(<PushLink enabled state={{ open } as unknown as NotificationsState} onOpen={vi.fn()} />);
  expect(screen.queryByRole('region', { name: 'Push notification' })).not.toBeInTheDocument(); expect(open).not.toHaveBeenCalled();
});
