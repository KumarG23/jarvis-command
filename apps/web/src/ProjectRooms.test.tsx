import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectRooms } from './ProjectRooms';

const room = { id: 'room_' + 'a'.repeat(32), name: 'Synthetic project', goal: 'Exact metadata', repository: '/not/read', notes: [], sessionIds: [], lastSessionId: null };
const session = { id: 'jc_' + 'b'.repeat(32), title: 'Created conversation', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('explains a missing edit endpoint and retains the draft without retrying or fabricating a save', async () => {
  sessionStorage.setItem('jarvis-command:project-room:v1', room.id);
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({}, { status: 404 }) : Response.json({ version: 1, rooms: [room] }));
  vi.stubGlobal('fetch', fetcher);
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Project details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit project' }));
  const editor = screen.getByRole('form', { name: 'Edit project' });
  fireEvent.change(within(editor).getByLabelText('Project name'), { target: { value: 'Keep this draft' } });
  fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Project editing is unavailable on this server, or this project no longer exists.');
  expect(within(editor).getByLabelText('Project name')).toHaveValue('Keep this draft');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

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
  fireEvent.click(screen.getByRole('button', { name: 'Edit project' }));
  const editor = screen.getByRole('form', { name: 'Edit project' });
  fireEvent.change(within(editor).getByLabelText('Project name'), { target: { value: 'Revised project' } });
  fireEvent.change(within(editor).getByLabelText('Project goal'), { target: { value: 'Revised goal' } });
  fireEvent.change(within(editor).getByLabelText('Repository reference'), { target: { value: '/metadata/only' } });
  fireEvent.change(within(editor).getByLabelText('Note references (one per line)'), { target: { value: 'vault/One.md\nvault/Two.md' } });
  fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('alert');
  expect(within(editor).getByLabelText('Project name')).toHaveValue('Revised project');
  expect(onSession).not.toHaveBeenCalled();
  fail = false;
  fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit project' })).not.toBeInTheDocument());
  expect(stored).toEqual({ ...linked, name: 'Revised project', goal: 'Revised goal', repository: '/metadata/only', notes: ['vault/One.md', 'vault/Two.md'] });
  expect(onScope).toHaveBeenLastCalledWith('Revised project'); expect(onSession).not.toHaveBeenCalled();
  expect(within(screen.getByRole('navigation', { name: 'Projects' })).getByRole('button', { name: session.title })).toBeInTheDocument();
  expect(sessionStorage.getItem('jarvis-command:project-room:v1')).toBe(room.id);
  fireEvent.click(screen.getByRole('button', { name: 'Edit project' }));
  const next = screen.getByRole('form', { name: 'Edit project' });
  fireEvent.change(within(next).getByLabelText('Project name'), { target: { value: 'Discard me' } });
  fireEvent.click(within(next).getByRole('button', { name: 'Cancel' }));
  expect(stored.name).toBe('Revised project');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
});

it('filters only fetched room metadata while retaining selection and shows clear no-match and empty states', async () => {
  const other = { ...room, id: 'room_' + 'c'.repeat(32), name: 'Garden', goal: 'Grow plants', repository: '/soil', notes: ['vault/Worms.md'] };
  const fetcher = vi.fn(async () => Response.json({ version: 1, rooms: [room, other] })); vi.stubGlobal('fetch', fetcher);
  const onScope = vi.fn(), onSession = vi.fn();
  const view = render(<ProjectRooms sessions={[]} onScope={onScope} onSession={onSession} />);
  fireEvent.click(await screen.findByRole('button', { name: room.name }));
  await waitFor(() => expect(onScope).toHaveBeenLastCalledWith(room.name)); onScope.mockClear(); onSession.mockClear();
  const search = screen.getByRole('searchbox', { name: 'Search projects and chats' });
  for (const query of [' GARDEN ', 'plants', '/SOIL', 'worms']) {
    fireEvent.change(search, { target: { value: query } });
    expect(screen.getByRole('button', { name: 'Garden' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: room.name })).not.toBeInTheDocument();
  }
  fireEvent.change(search, { target: { value: 'no such room' } });
  expect(screen.getByText('No matching projects.')).toBeInTheDocument();
  expect(sessionStorage.getItem('jarvis-command:project-room:v1')).toBe(room.id);
  expect(onScope).not.toHaveBeenCalled(); expect(onSession).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('button', { name: room.name })).toHaveAttribute('aria-current', 'page');
  view.unmount(); sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 1, rooms: [] })));
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={vi.fn()} />);
  expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
});

it('closes the drawer by keyboard or its labeled button, restores focus and retains the edit draft', async () => {
  sessionStorage.setItem('jarvis-command:project-room:v1', room.id);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 1, rooms: [room] })));
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={vi.fn()} />);
  const details = await screen.findByRole('button', { name: 'Project details' });
  fireEvent.click(details);
  const close = screen.getByRole('button', { name: 'Close project details' });
  expect(close).toHaveFocus(); expect(details).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Edit project' }));
  const name = within(screen.getByRole('form', { name: 'Edit project' })).getByLabelText('Project name');
  fireEvent.change(name, { target: { value: 'Retained draft' } });
  fireEvent.keyDown(name, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Close project details' })).not.toBeInTheDocument();
  expect(details).toHaveFocus(); expect(details).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(details);
  expect(within(screen.getByRole('form', { name: 'Edit project' })).getByLabelText('Project name')).toHaveValue('Retained draft');
  fireEvent.click(screen.getByRole('button', { name: 'Close project details' })); expect(details).toHaveFocus();
});

it('renders project details in the context slot while keeping navigation in the sidebar', async () => {
  const target = document.createElement('div'); document.body.append(target);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 1, rooms: [room] })));
  const onScope = vi.fn();
  const view = render(<ProjectRooms sessions={[]} onScope={onScope} onSession={vi.fn()} contextTarget={target} />);
  fireEvent.click(await screen.findByRole('button', { name: room.name }));
  await waitFor(() => expect(onScope).toHaveBeenCalledWith(room.name));
  fireEvent.click(screen.getByRole('button', { name: 'Project details' }));
  expect(within(target).getByText(room.goal)).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Projects' })).queryByText(room.goal)).not.toBeInTheDocument();
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
  await screen.findByRole('button', { name: 'Project details' });
  const create = screen.getByRole('button', { name: 'New chat' });
  await waitFor(() => expect(create).toBeEnabled()); fireEvent.click(create);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Finish adding created chat' })).toBeInTheDocument();
  expect(screen.queryByText(session.id)).not.toBeInTheDocument();
  expect(create).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Finish adding created chat' }));
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
  const newProject = await screen.findByRole('button', { name: 'New project' });
  await waitFor(() => expect(newProject).toBeEnabled());
  fireEvent.click(newProject);
  fireEvent.change(await screen.findByLabelText('Project name'), { target: { value: room.name } });
  fireEvent.change(screen.getByLabelText('Project goal'), { target: { value: room.goal } });
  const form = screen.getByRole('button', { name: 'Create project' }).closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  await act(async () => finish(Response.json({}, { status: 503 })));
  fireEvent.click(screen.getByRole('button', { name: 'Reload projects' }));
  await screen.findByRole('button', { name: room.name });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
