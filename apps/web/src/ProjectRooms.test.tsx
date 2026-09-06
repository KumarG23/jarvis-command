import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectRooms } from './ProjectRooms';

const room = { id: 'room_' + 'a'.repeat(32), name: 'Synthetic project', goal: 'Exact metadata', repository: '/not/read', notes: [], sessionIds: [], lastSessionId: null };
const session = { id: 'jc_' + 'b'.repeat(32), title: 'Created conversation', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('renders real named-room navigation in the desktop slot rather than a placeholder', async () => {
  const target = document.createElement('div'); document.body.append(target);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 1, rooms: [room] })));
  const onScope = vi.fn();
  const view = render(<ProjectRooms sessions={[]} onScope={onScope} onSession={vi.fn()} navigationTarget={target} />);
  fireEvent.click(screen.getByRole('button', { name: 'Project rooms' }));
  fireEvent.click(await within(target).findByRole('button', { name: room.name }));
  await waitFor(() => expect(onScope).toHaveBeenCalledWith(room.name));
  view.unmount(); target.remove();
});

it('preserves a created identity on link failure and requires attachment recovery, not recreation', async () => {
  sessionStorage.setItem('jarvis-command:project-room:v1', room.id);
  let links = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [room] });
    if (url === '/api/live/sessions') return Response.json({ session });
    links++;
    if (links === 1) return Response.json({}, { status: 503 });
    return Response.json({ room: { ...room, sessionIds: [session.id], lastSessionId: session.id }, session });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={vi.fn()} />);
  const create = await screen.findByRole('button', { name: 'New Command session' });
  await waitFor(() => expect(create).toBeEnabled()); fireEvent.click(create);
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Attach existing Command session')).toHaveValue(session.id);
  expect(create).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Attach conversation' }));
  await waitFor(() => expect(links).toBe(2));
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/live/sessions')).toHaveLength(1);
  await waitFor(() => expect(create).toBeEnabled());
});

it('coalesces rapid room form submissions and reloads an uncertain metadata write without automatic retry', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let created = false;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { created = true; return pending; }
    return Response.json({ version: 1, rooms: created ? [room] : [] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Project rooms' }));
  fireEvent.change(await screen.findByLabelText('Room name'), { target: { value: room.name } });
  fireEvent.change(screen.getByLabelText('Room goal'), { target: { value: room.goal } });
  const form = screen.getByRole('button', { name: 'Create project room' }).closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  await act(async () => finish(Response.json({}, { status: 503 })));
  fireEvent.click(screen.getByRole('button', { name: 'Reload rooms' }));
  await screen.findByRole('button', { name: room.name });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
