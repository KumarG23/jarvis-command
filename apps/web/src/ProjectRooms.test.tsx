import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { ProjectRooms, type ProjectRoomsHandle } from './ProjectRooms';

const room = { id: 'room_' + 'a'.repeat(32), name: 'Synthetic project', goal: 'Exact metadata', repository: '/not/read', notes: [], sessionIds: [], lastSessionId: null };
const session = { id: 'jc_' + 'b'.repeat(32), title: 'Created conversation', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-09-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
const external = { ...session, id: 'discord:channel+message', title: 'This Discord chat', source: 'discord', ownership: 'external' };
it('adds an external recent chat directly to a chosen project', async () => {
  const linked = { ...room, sessionIds: [external.id], lastSessionId: external.id };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/rooms') return Response.json({ version: 1, rooms: [room] });
    expect(String(input)).toBe(`/api/rooms/${room.id}/sessions`);
    expect(JSON.parse(String(init?.body))).toEqual({ sessionId: external.id });
    return Response.json({ room: linked, session: external });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProjectRooms sessions={[external] as never} onScope={vi.fn()} onSession={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: `Add ${external.title} to project` }));
  expect(screen.getByRole('dialog', { name: 'Add chat to project' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add to project' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('dialog', { name: 'Add chat to project' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: `Delete ${external.title}` })).not.toBeInTheDocument();
});

it('requires confirmation before permanently deleting a Command chat', async () => {
  const onDeleted = vi.fn();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/rooms') return Response.json({ version: 1, rooms: [room] });
    expect(init?.method).toBe('DELETE');
    return Response.json({ deleted: true, sessionId: session.id });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProjectRooms sessions={[session] as never} onScope={vi.fn()} onSession={vi.fn()} onDeleted={onDeleted} />);
  fireEvent.click(await screen.findByRole('button', { name: `Delete ${session.title}` }));
  expect(screen.getByRole('dialog', { name: 'Delete this chat permanently?' })).toHaveTextContent('cannot be undone');
  expect(onDeleted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(session.id));
  expect(screen.queryByRole('dialog', { name: 'Delete this chat permanently?' })).not.toBeInTheDocument();
});

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('offers both Command and external recent chats when adding one to a project', async () => {
  sessionStorage.setItem('jarvis-command:project-room:v1', room.id);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 1, rooms: [room] })));
  render(<ProjectRooms sessions={[session, external] as never} onScope={vi.fn()} onSession={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Project details' }));
  const picker = screen.getByLabelText('Chat');
  expect(within(picker).getByRole('option', { name: session.title })).toBeInTheDocument();
  expect(within(picker).getByRole('option', { name: external.title })).toBeInTheDocument();
});

it('reopens a saved external project chat after it leaves recent chats', async () => {
  const linked = { ...room, sessionIds: [external.id], lastSessionId: external.id };
  sessionStorage.setItem('jarvis-command:project-room:v1', room.id);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/rooms'
    ? Response.json({ version: 1, rooms: [linked] })
    : Response.json({ session: external })));
  const onSession = vi.fn();
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={onSession} />);
  await waitFor(() => expect(onSession).toHaveBeenCalledWith(external));
  expect(await screen.findByRole('button', { name: external.title })).toBeInTheDocument();
});

it('hydrates an external saved-chat title when it is not the project default', async () => {
  const linked = { ...room, sessionIds: [external.id], lastSessionId: null };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/rooms'
    ? Response.json({ version: 1, rooms: [linked] })
    : Response.json({ session: external })));
  render(<ProjectRooms sessions={[]} onScope={vi.fn()} onSession={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: room.name }));
  expect(await screen.findByRole('button', { name: external.title })).toBeInTheDocument();
});

it('attaches an adopted fork to the selected project before selecting it', async () => {
  const child = { ...session, id: 'jc_' + 'd'.repeat(32), title: 'Created conversation · Fork' };
  const attached = { ...room, sessionIds: [child.id], lastSessionId: child.id };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [room] });
    if (url === `/api/rooms/${room.id}/sessions` && init?.method === 'POST') {
      return Response.json({ room: attached, session: child });
    }
    throw Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const ref = createRef<ProjectRoomsHandle>();
  const onSession = vi.fn();
  render(<ProjectRooms ref={ref} sessions={[]} onScope={vi.fn()} onSession={onSession} />);
  fireEvent.click(await screen.findByRole('button', { name: room.name }));
  await waitFor(() => expect(ref.current).not.toBeNull());
  await act(async () => ref.current!.adoptSession(child as never));
  expect(fetcher).toHaveBeenCalledWith(
    `/api/rooms/${room.id}/sessions`,
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ sessionId: child.id }) }),
  );
  expect(onSession).toHaveBeenLastCalledWith(child);
});

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
