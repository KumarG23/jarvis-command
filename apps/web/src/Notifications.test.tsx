import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NotificationsPane, useNotifications } from './Notifications';

const sessionId = 'jc_' + 'a'.repeat(32);
const publicRunId = 'jcr_' + 'b'.repeat(32);
const session = { id: sessionId, title: 'SYNTHETIC chat', source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-10-28T14:00:00.000Z', messageCount: 0, toolCallCount: 0, pinned: false };
const item = (n: number, category: string, readAt: string | null = null) => ({
  id: `ntf_${n.toString(16).padStart(32, '0')}`, category, observedAt: '2026-10-28T14:00:00.000Z', sessionId, publicRunId,
  title: category === 'approval' ? 'Approval needed' : category === 'run-failed' ? 'Run failed' : 'Run finished', body: 'Generic body.', readAt,
});
const prefs = { categories: { 'run-completed': true, 'run-failed': true, approval: true } };
function inbox(items: ReturnType<typeof item>[], preferences = prefs) {
  return { version: 1, items, unreadCount: items.filter(i => i.readAt === null).length, preferences, delivery: { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' } };
}
function Harness({ onOpen }: Readonly<{ onOpen: Parameters<typeof NotificationsPane>[0]['onOpen'] }>) {
  const state = useNotifications(true, '');
  return <NotificationsPane state={state} onOpen={onOpen} />;
}
afterEach(() => { vi.unstubAllGlobals(); });

function server(initial: ReturnType<typeof inbox>, handlers: Record<string, (body: unknown) => Response | Promise<Response>> = {}) {
  let current = initial;
  const calls: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (handlers[path]) return handlers[path]!(body);
    if (path === '/api/notifications') return Response.json(current);
    if (path === '/api/notifications/reconcile') return Response.json({ inbox: current, checked: 0, unavailable: 0 });
    if (path === '/api/notifications/read') {
      current = inbox(current.items.map(i => (body.all || body.ids.includes(i.id)) ? { ...i, readAt: '2026-10-28T14:05:00.000Z' } : i), current.preferences);
      return Response.json(current);
    }
    if (path === '/api/notifications/preferences') { current = inbox(current.items, body); return Response.json(current); }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, fetcher };
}

it('shows unread count, generic rows, filters, and persists read state via the server', async () => {
  const s = server(inbox([item(3, 'approval'), item(2, 'run-failed'), item(1, 'run-completed', '2026-10-28T13:00:00.000Z')]));
  const requestPermission = vi.fn();
  vi.stubGlobal('Notification', { requestPermission });
  render(<Harness onOpen={() => null} />);
  expect(await screen.findByRole('heading', { name: '2 unread' })).toBeInTheDocument();
  expect(screen.getByText(/Events from the CLI, Discord or other surfaces and closed-app push alerts are not available yet/)).toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'Notifications' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Mark Approval needed read' }));
  await screen.findByRole('heading', { name: '1 unread' });
  expect(screen.getByRole('button', { name: 'Approvals' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
  expect(await screen.findByRole('heading', { name: 'All caught up' })).toBeInTheDocument();
  expect(requestPermission).not.toHaveBeenCalled();
  expect(s.calls.filter(call => call.startsWith('POST')).every(call => /\/api\/notifications\//.test(call))).toBe(true);
});

it('opens only a server-confirmed available target and is honest otherwise', async () => {
  const onOpen = vi.fn<(target: unknown) => string | null>(() => null);
  const target = (state: string) => state === 'available'
    ? { state, sessionId, publicRunId, clientRequestId: '00000000-0000-4000-8000-000000000001', runStatus: 'waiting_for_approval', approvalPending: true, session, inbox: inbox([item(1, 'approval', '2026-10-28T14:05:00.000Z')]) }
    : { state };
  let state = 'missing';
  server(inbox([item(1, 'approval')]), { [`/api/notifications/${item(1, 'x').id}/open`]: () => Response.json(target(state)) });
  render(<Harness onOpen={onOpen} />);
  const open = await screen.findByRole('button', { name: 'Open chat for Approval needed' });
  fireEvent.click(open);
  expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
  state = 'unavailable'; fireEvent.click(open);
  expect(await screen.findByText(/stays unread/)).toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
  state = 'available'; fireEvent.click(open);
  await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  expect(onOpen.mock.calls[0]![0]).toMatchObject({ publicRunId, approvalPending: true });
  expect(await screen.findByRole('heading', { name: 'All caught up' })).toBeInTheDocument();
});

it('keeps edited preferences on save failure and requires matching readback', async () => {
  let mode: 'fail' | 'mismatch' | 'ok' = 'fail';
  server(inbox([]), { '/api/notifications/preferences': body => mode === 'fail' ? new Response('{}', { status: 503 }) : Response.json(inbox([], mode === 'mismatch' ? prefs : body as never)) });
  render(<Harness onOpen={() => null} />);
  const box = await screen.findByRole('checkbox', { name: 'Run failed' });
  fireEvent.click(box);
  const save = screen.getByRole('button', { name: 'Save preferences' });
  fireEvent.click(save);
  expect(await screen.findByRole('alert')).toHaveTextContent('edits are kept');
  expect(box).not.toBeChecked();
  mode = 'mismatch'; fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not saved as requested'));
  expect(box).not.toBeChecked();
  mode = 'ok'; fireEvent.click(save);
  expect(await screen.findByText('Preferences saved and confirmed.')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Run failed' })).not.toBeChecked();
});

it('shows a recoverable error when notification storage is unavailable', async () => {
  let fail = true;
  server(inbox([item(1, 'run-completed')]), { '/api/notifications': () => fail ? Response.json({ error: 'notification_storage_unavailable' }, { status: 503 }) : Response.json(inbox([item(1, 'run-completed')])) });
  render(<Harness onOpen={() => null} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByRole('list', { name: 'Notifications' })).toBeInTheDocument());
});

it('does not claim an incomplete empty inbox is caught up and explains unavailable approval delivery', async () => {
  const limited = { ...inbox([]), delivery: { inApp: 'incomplete', approvals: 'unavailable', push: 'unavailable', externalSurfaces: 'unavailable' } };
  server(limited);
  render(<Harness onOpen={() => null} />);
  expect(await screen.findByRole('heading', { name: 'No recorded unread notifications' })).toBeInTheDocument();
  expect(screen.queryByText('All caught up')).not.toBeInTheDocument();
  expect(screen.getByText(/Delivery is incomplete/)).toHaveTextContent('beyond bounded recovery may be missing');
  expect(screen.getByText(/New approval notifications are unavailable/)).toHaveTextContent('Review approvals in the chat');
});
