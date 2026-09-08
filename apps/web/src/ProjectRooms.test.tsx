import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectRooms } from './ProjectRooms';

const room = { id: 'room_' + 'a'.repeat(32), name: 'Synthetic project', goal: 'Exact metadata', repository: '/not/read', notes: [], sessionIds: [], lastSessionId: null };
const session = { id: 'jc_' + 'b'.repeat(32), title: 'Created conversation', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('saves existing metadata without resetting the selected conversation and retains a failed draft until cancel', async () => {
  const linked = { ...room, sessionIds: [session.id], lastSessionId: session.id };
  sessionStorage.setItem('jarvis-command:project-room:v1', room.id);
  let stored = linked; let fail = true;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [stored] });
    if (url === `/api/rooms/${room.id}`) {
      if (fail) return Response.json({}, { status: 503 });
      stored = { ...stored, ...JSON.parse(String(init?.body)) }; return Response.json({ room: stored });
    }
    return Response.json({ session });
  });
  vi.stubGlobal('fetch', fetcher);
  const onSession = vi.fn(), onScope = vi.fn();
  render(<ProjectRooms sessions={[session as never]} onScope={onScope} onSession={onSession} />);
  await waitFor(() => expect(onSession).toHaveBeenCalledWith(session)); onSession.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Project details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit project room' }));
  const editor = screen.getByRole('form', { name: 'Edit project room' });
  fireEvent.change(within(editor).getByLabelText('Room name'), { target: { value: 'Revised project' } });
  fireEvent.change(within(editor).getByLabelText('Room goal'), { target: { value: 'Revised goal' } });
  fireEvent.change(within(editor).getByLabelText('Repository / workdir reference'), { target: { value: '/metadata/only' } });
  fireEvent.change(within(editor).getByLabelText('Pinned note references (one per line)'), { target: { value: 'vault/One.md\nvault/Two.md' } });
  fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('alert');
  expect(within(editor).getByLabelText('Room name')).toHaveValue('Revised project');
  expect(onSession).not.toHaveBeenCalled();
  fail = false;
  fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit project room' })).not.toBeInTheDocument());
  expect(stored).toEqual({ ...linked, name: 'Revised project', goal: 'Revised goal', repository: '/metadata/only', notes: ['vault/One.md', 'vault/Two.md'] });
  expect(onScope).toHaveBeenLastCalledWith('Revised project'); expect(onSession).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Room conversation')).toHaveValue(session.id);
  expect(sessionStorage.getItem('jarvis-command:project-room:v1')).toBe(room.id);
  fireEvent.click(screen.getByRole('button', { name: 'Edit project room' }));
  const next = screen.getByRole('form', { name: 'Edit project room' });
  fireEvent.change(within(next).getByLabelText('Room name'), { target: { value: 'Discard me' } });
  fireEvent.click(within(next).getByRole('button', { name: 'Cancel' }));
  expect(stored.name).toBe('Revised project');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
});

it('filters only fetched room metadata while retaining selection and shows clear no-match and empty states', async () => {
  const other = { ...room, id: 'room_' + 'c'.repeat(32), name: 'Garden', goal: 'Grow plants', repository: '/soil', notes: ['vault/Worms.md'] };
  const fetcher = vi.fn(async () => Response.json({ version: 1, rooms: [room, other] })); vi.stubGlobal('fetch', fetcher);
  const onScope = vi.fn(), onSession = vi.fn();
  const view = render(<ProjectRooms sessions={[]} onScope={onScope} onSession={onSession} />);
  fireEvent.click(screen.getByRole('button', { name: 'Project rooms' }));
  fireEvent.click(await screen.findByRole('button', { name: room.name }));
  await waitFor(() => expect(onScope).toHaveBeenLastCalledWith(room.name)); onScope.mockClear(); onSession.mockClear();
  const search = screen.getByRole('searchbox', { name: 'Filter project rooms' });
  for (const query of [' GARDEN ', 'plants', '/SOIL', 'worms']) {
    fireEvent.change(search, { target: { value: query } });
    expect(screen.getByRole('button', { name: 'Garden' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: room.name })).not.toBeInTheDocument();
  }
  fireEvent.change(search, { target: { value: 'no such room' } });
  expect(screen.getByText('No matching project rooms.')).toBeInTheDocument();
  expect(sessionStorage.getItem('jarvis-command:project-room:v1')).toBe(room.id);
  expect(onScope).not.toHaveBeenCalled(); expect(onSession).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
  expect(screen.getByRole('button', { name: room.name })).toHaveAttribute('aria-current', 'page');
  view.unmount(); sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 1, rooms: [] })));
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Project rooms' }));
  expect(await screen.findByText('No project rooms yet. Create one below.')).toBeInTheDocument();
});

it('closes the drawer by keyboard or its labeled button, restores focus and retains the edit draft', async () => {
  sessionStorage.setItem('jarvis-command:project-room:v1', room.id);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 1, rooms: [room] })));
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={vi.fn()} />);
  const details = await screen.findByRole('button', { name: 'Project details' });
  fireEvent.click(details);
  const close = screen.getByRole('button', { name: 'Close project rooms' });
  expect(close).toHaveFocus(); expect(details).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Edit project room' }));
  const name = within(screen.getByRole('form', { name: 'Edit project room' })).getByLabelText('Room name');
  fireEvent.change(name, { target: { value: 'Retained draft' } });
  fireEvent.keyDown(name, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Close project rooms' })).not.toBeInTheDocument();
  expect(details).toHaveFocus(); expect(details).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(details);
  expect(within(screen.getByRole('form', { name: 'Edit project room' })).getByLabelText('Room name')).toHaveValue('Retained draft');
  fireEvent.click(screen.getByRole('button', { name: 'Close project rooms' })); expect(details).toHaveFocus();
});

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
