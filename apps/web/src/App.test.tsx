import type { CommandBootstrap } from '@jarvis-command/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const bootstrap: CommandBootstrap = {
  identity: {
    provider: 'cloudflare-access',
  },
  command: {
    version: '0.1.0',
    environment: 'production',
    generatedAt: '2026-09-03T14:30:00.000Z',
    liveRoom: { enabled: false, externalContinue: false, maxInputCharacters: 16_000, maxSteerCharacters: 4_000 },
  },
  hermes: {
    state: 'online',
    version: '0.21.0',
    model: 'gpt-5.6-sol',
    provider: 'OpenAI Codex',
    gatewayState: 'idle',
    activeAgents: 1,
    capabilities: ['run_events_sse', 'session_resources'],
    readinessChecks: {
      config: 'pass',
      disk: 'pass',
      sessionDb: 'pass',
    },
  },
  sessions: [
    {
      id: 'session_123',
      title: 'Jarvis Command',
      source: 'discord',
      ownership: 'external',
      model: 'gpt-5.6-sol',
      lastActive: '2026-09-03T14:29:00.000Z',
      messageCount: 18,
      toolCallCount: 7,
      pinned: true,
    },
  ],
};

const liveBootstrap: CommandBootstrap = {
  ...bootstrap,
  command: { ...bootstrap.command, liveRoom: { ...bootstrap.command.liveRoom, enabled: true } },
};

function history(sessionId = 'session_123', offset = 0, contents = ['First question', 'Assistant answer', 'Tool output'], hasMore = false) {
  return {
    sessionId,
    messages: contents.map((content, index) => ({
      id: `message:${offset + index}+exact`, sessionId,
      role: ['user', 'assistant', 'tool'][index % 3], content,
      timestamp: '2026-09-03T14:29:00.000Z', toolName: index % 3 === 2 ? 'terminal' : null, displayKind: null,
    })),
    pagination: { limit: 50, offset, returned: contents.length, hasMore },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function stubFetch(fetcher: typeof fetch) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url === '/api/rooms' ? Promise.resolve(Response.json({ version: 1, rooms: [] })) : fetcher(url, init));
}

async function clickEnabled(name: string | RegExp) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

afterEach(() => vi.unstubAllGlobals());

describe('Selected room recovery', () => {
  it('creates a named project, attaches and reloads an exact conversation outside recents with honest context', async () => {
    const session = { ...bootstrap.sessions[0]!, id: 'jc_' + 'a'.repeat(32), source: 'api_server', ownership: 'command' as const, title: 'Project conversation' };
    let rooms: unknown[] = [];
    const room = { id: 'room_' + 'b'.repeat(32), name: 'Jarvis Command project', goal: 'Build persistent rooms', repository: '/repo/command', notes: ['vault/Command.md'], sessionIds: [session.id], lastSessionId: session.id };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/rooms') {
        if (init?.method === 'POST') { rooms = [{ ...room, sessionIds: [], lastSessionId: null }]; return Response.json({ room: rooms[0] }); }
        return Response.json({ version: 1, rooms });
      }
      if (url === `/api/rooms/${room.id}/sessions`) { rooms = [room]; return Response.json({ room, session }); }
      if (url === `/api/live/sessions/${session.id}` || url === '/api/live/sessions') return Response.json({ session });
      return Response.json(history(session.id));
    });
    vi.stubGlobal('fetch', fetchMock);
    const load = async () => ({ ...liveBootstrap, hermes: { ...liveBootstrap.hermes, model: 'hermes-agent', provider: null }, sessions: [] });
    const view = render(<App loadBootstrap={load} />);
    const newProject = await screen.findByRole('button', { name: 'New project' });
    await waitFor(() => expect(newProject).toBeEnabled());
    fireEvent.click(newProject);
    fireEvent.change(await screen.findByLabelText('Project name'), { target: { value: room.name } });
    fireEvent.change(screen.getByLabelText('Project goal'), { target: { value: room.goal } });
    fireEvent.change(screen.getByLabelText('Repository reference'), { target: { value: room.repository } });
    fireEvent.change(screen.getByLabelText('Note references (one per line)'), { target: { value: room.notes[0] } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await screen.findByText(room.goal);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(session.title));
    expect(screen.getByText(/Context is not applied automatically/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hermes available' }));
    expect(screen.getByText('Adapter label: hermes-agent')).toBeInTheDocument();
    view.unmount(); render(<App loadBootstrap={load} />);
    await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(session.title));
    expect(fetchMock).toHaveBeenCalledWith(`/api/live/sessions/${session.id}`, expect.anything());
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Recent chats' })).getByRole('button', { name: session.title }));
    expect(screen.queryByText(room.goal)).not.toBeInTheDocument();
    sessionStorage.removeItem('jarvis-command:project-room:v1');
  });
  it.each(['unknown', 'disabled', 'storage-denied'])('ignores unusable remembered selection: %s', async (mode) => {
    sessionStorage.setItem('jarvis-command:selected-session:v1', mode === 'unknown' ? 'not-in-bootstrap' : 'session_123');
    const read = mode === 'storage-denied' ? vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); }) : null;
    const fetchMock = vi.fn(); stubFetch(fetchMock);
    try {
      render(<App loadBootstrap={async () => mode === 'disabled' ? bootstrap : liveBootstrap} />);
      await screen.findByRole('heading', { name: 'What are we working on?' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByText('Assistant answer')).not.toBeInTheDocument();
    } finally { read?.mockRestore(); }
  });
  it('returns to the selected room after reload without storing message contents', async () => {
    stubFetch(vi.fn(async () => Response.json(history())));
    const first = render(<App loadBootstrap={async () => liveBootstrap} />);
    const recent = await screen.findByRole('button', { name: /^Jarvis Command/ });
    await waitFor(() => expect(recent).toBeEnabled());
    fireEvent.click(recent);
    await screen.findByText('Assistant answer');
    expect(sessionStorage.getItem('jarvis-command:selected-session:v1')).toBe('session_123');
    first.unmount();
    render(<App loadBootstrap={async () => liveBootstrap} />);
    expect(await screen.findByText('Assistant answer')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected session')).toHaveTextContent('Jarvis Command');
    expect(sessionStorage.getItem('jarvis-command:selected-session:v1')).toBe('session_123');
    expect(sessionStorage.getItem('jarvis-command:selected-session:v1')).not.toContain('Assistant answer');
  });
});

describe('Command session creation', () => {
  it('creates once with the exact mutation boundary, selects the validated session and adds navigation', async () => {
    const pending = deferred<Response>();
    const created = { ...bootstrap.sessions[0]!, id: 'jc_new:session+exact', title: 'New Command session', ownership: 'command', source: 'web', messageCount: 0 };
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(Response.json(history(created.id, 0, [])));
    stubFetch(fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    const create = await screen.findByRole('button', { name: 'New chat' });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    fireEvent.click(create);
    expect(create).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/live/sessions', {
      method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: '{}',
    });
    await act(async () => pending.resolve(Response.json({ session: created })));
    expect(await screen.findByText('No saved messages in session history yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: created.title })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBeInTheDocument();
  });

  it.each(['http', 'access', 'malformed', 'external'])('reports honest creation failure for %s without adding a session', async (fault) => {
    const session = { ...bootstrap.sessions[0]!, id: 'jc_new', title: 'Must not appear', ownership: 'command' };
    if (fault === 'external') session.ownership = 'external';
    stubFetch(vi.fn().mockResolvedValue(Response.json(fault === 'malformed' ? { secret: 'private detail' } : { session }, { status: fault === 'http' ? 502 : fault === 'access' ? 401 : 200 })));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled('New chat');
    expect(await screen.findByRole('alert')).toHaveTextContent(fault === 'access' ? 'Access expired or denied.' : 'Session creation could not be confirmed.');
    expect(screen.queryByText('Must not appear')).not.toBeInTheDocument();
    expect(screen.queryByText('private detail')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).not.toBeDisabled();
  });

  it('does not activate session selection or creation when the capability is disabled', async () => {
    const fetchMock = vi.fn();
    stubFetch(fetchMock);
    render(<App loadBootstrap={async () => bootstrap} />);
    await screen.findByText('Live chat is unavailable.');
    expect(screen.queryByRole('button', { name: /^Jarvis Command/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();
  });
});

describe('Live Room history', () => {
  it('allows an empty successor page, avoids concurrent loads and retains history across a failed page retry', async () => {
    const pending = deferred<Response>();
    const first = history('session_123', 0, Array.from({ length: 50 }, (_, i) => `Initial ${i}`), true);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(first)).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(Response.json(history('session_123', 50, [])));
    stubFetch(fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled(/^Jarvis Command/);
    const more = await screen.findByRole('button', { name: 'Load more messages' });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(more).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(Response.json({}, { status: 502 })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load messages.');
    expect(screen.getByText('Initial 49')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more messages' })).not.toBeInTheDocument());
    expect(screen.queryByText('End of history.')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/sessions/session_123/messages?limit=50&offset=50');
    expect(fetchMock.mock.calls[2]![0]).toBe(fetchMock.mock.calls[1]![0]);
    expect(screen.getAllByRole('article')).toHaveLength(50);
  });

  it.each(['network', 'non-json', 'redirect'])('bounds a %s history failure without exposing response content', async (fault) => {
    const response = new Response('<html>private upstream</html>');
    if (fault === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    stubFetch(fault === 'network' ? vi.fn().mockRejectedValue(new Error('private upstream')) : vi.fn().mockResolvedValue(response));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled(/^Jarvis Command/);
    expect(await screen.findByRole('alert')).toHaveTextContent(fault === 'redirect' ? 'Access expired or denied.' : 'Could not load messages.');
    expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
  });

  it('bounds history to ten pages and labels the view limit instead of claiming the end', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
      return Promise.resolve(Response.json(history('session_123', offset, Array.from({ length: 50 }, (_, i) => `Row ${offset + i}`), true)));
    });
    stubFetch(fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled(/^Jarvis Command/);
    for (let page = 1; page < 10; page += 1) {
      await screen.findByText(`Row ${page * 50 - 1}`);
      fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
    }
    await screen.findByText('Row 499');
    expect(screen.getByText('History view limit reached. More messages may exist.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more messages' })).not.toBeInTheDocument();
    expect(screen.queryByText('End of history.')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(10);
  }, 20_000);

  it('opens mobile navigation and selects a chat without a second session picker', async () => {
    stubFetch(vi.fn().mockResolvedValue(Response.json(history())));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    const menu = await screen.findByRole('button', { name: 'Open chat navigation' });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    const recent = screen.getByRole('button', { name: /^Jarvis Command/ });
    await waitFor(() => expect(recent).toBeEnabled());
    fireEvent.click(recent);
    expect(await screen.findByText('First question')).toBeInTheDocument();
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Selected session')).toHaveTextContent('Jarvis Command');
  });

  it.each([401, 403, 502])('handles HTTP %s without exposing upstream details and can retry', async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ secret: 'private upstream error' }, { status }))
      .mockResolvedValueOnce(Response.json(history()));
    stubFetch(fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled(/^Jarvis Command/);
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 502 ? 'Could not load messages.' : 'Access expired or denied.');
    expect(screen.queryByText(/private upstream error/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
    expect(await screen.findByText('First question')).toBeInTheDocument();
  });

  it.each(['session', 'message', 'offset', 'limit', 'count', 'no-progress'])('rejects an unbound or inconsistent history %s', async (fault) => {
    const page = history();
    if (fault === 'session') page.sessionId = 'other';
    if (fault === 'message') page.messages[0]!.sessionId = 'other';
    if (fault === 'offset') page.pagination.offset = 1;
    if (fault === 'limit') page.pagination.limit = 100;
    if (fault === 'count') page.pagination.returned = 2;
    if (fault === 'no-progress') { page.messages = []; page.pagination.returned = 0; page.pagination.hasMore = true; }
    stubFetch(vi.fn().mockResolvedValue(Response.json(page)));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled(/^Jarvis Command/);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load messages.');
    expect(screen.queryByText('First question')).not.toBeInTheDocument();
  });

  it('aborts and ignores stale history when switching sessions, including switching back', async () => {
    const old = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(Response.json(history('second:session+exact', 0, ['Second room'])))
      .mockResolvedValueOnce(Response.json(history('session_123', 0, ['Fresh first room'])));
    stubFetch(fetchMock);
    render(<App loadBootstrap={async () => ({ ...liveBootstrap, sessions: [...liveBootstrap.sessions, { ...liveBootstrap.sessions[0]!, id: 'second:session+exact', title: 'Second session' }] })} />);
    await clickEnabled(/^Jarvis Command/);
    await clickEnabled(/Second session/);
    expect(await screen.findByText('Second room')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1]![0]).toContain('second%3Asession%2Bexact');
    await clickEnabled(/^Jarvis Command/);
    expect(await screen.findByText('Fresh first room')).toBeInTheDocument();
    await act(async () => old.resolve(Response.json(history('session_123', 0, ['Stale first room']))));
    expect(screen.queryByText('Stale first room')).not.toBeInTheDocument();
    expect(screen.queryByText('Second room')).not.toBeInTheDocument();
  });

  it('loads pages using returned offsets, deduplicates exact IDs and honors the last page', async () => {
    const first = history('session_123', 0, ['First question'], true);
    const next = history('session_123', 1, ['Duplicate', 'Last answer'], false);
    next.messages[0]!.id = first.messages[0]!.id;
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(next));
    stubFetch(fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled(/^Jarvis Command/);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more messages' }));
    expect(await screen.findByText('Last answer')).toBeInTheDocument();
    expect(screen.getAllByText('First question')).toHaveLength(1);
    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more messages' })).not.toBeInTheDocument();
    expect(screen.queryByText('End of history.')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/sessions/session_123/messages?limit=50&offset=1');
  });

  it('shows an explicit empty history', async () => {
    stubFetch(vi.fn().mockResolvedValue(Response.json(history('session_123', 0, []))));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled(/^Jarvis Command/);
    expect(await screen.findByText('No saved messages in session history yet.')).toBeInTheDocument();
  });

  it('selects a recent session and renders oldest-first typed history through the BFF', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    stubFetch(fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    await clickEnabled(/^Jarvis Command/);
    expect(await screen.findByText('Loading messages…')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session_123/messages?limit=50&offset=0', expect.objectContaining({
      credentials: 'same-origin', headers: { accept: 'application/json' }, signal: expect.any(AbortSignal),
    }));
    await act(async () => pending.resolve(Response.json(history())));
    const timeline = screen.getByRole('region', { name: 'Conversation' });
    expect(within(timeline).getAllByRole('article').map((row) => row.textContent)).toEqual([
      expect.stringContaining('First question'), expect.stringContaining('Assistant answer'), expect.stringContaining('Tool output'),
    ]);
    expect(within(timeline).getByText('terminal')).toBeInTheDocument();
    expect(within(timeline).getByText(/External chat · Read-only/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).not.toBeInTheDocument();
  });
});

describe('Jarvis Command shell', () => {
  it('keeps connection details optional while preserving honest read-only capability', async () => {
    render(<App loadBootstrap={async () => bootstrap} />);
    expect(screen.getByLabelText('Jarvis Command is loading')).toBeInTheDocument();
    const health = await screen.findByRole('button', { name: 'Hermes available' });
    expect(screen.getByRole('region', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Context workspace' })).not.toBeInTheDocument();
    expect(screen.queryByText('gpt-5.6-sol')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).not.toBeInTheDocument();
    fireEvent.click(health);
    expect(screen.getByRole('heading', { name: 'Hermes connection' })).toBeInTheDocument();
    expect(screen.getByText('gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Codex')).toBeInTheDocument();
    expect(screen.getByText('Reported connection snapshot')).toBeInTheDocument();
    expect(screen.getByText('Access verified')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close context' }), { key: 'Escape' });
    expect(screen.queryByText('Reported connection snapshot')).not.toBeInTheDocument();
    expect(health).toHaveFocus();
  });

  it('keeps the command shell honest when Hermes is offline', async () => {
    render(<App loadBootstrap={async () => ({ ...bootstrap, hermes: { ...bootstrap.hermes,
      state: 'offline', model: null, provider: null, gatewayState: 'unknown', activeAgents: 0,
      readinessChecks: { hermesBridge: 'fail' },
    }, sessions: [] })} />);
    const health = await screen.findByRole('button', { name: 'Hermes unavailable' });
    expect(screen.getByRole('status')).toHaveTextContent('Check the connection before sending.');
    expect(health).toHaveClass('offline');
    fireEvent.click(health);
    expect(screen.getAllByText('Not reported')).toHaveLength(2);
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).not.toBeInTheDocument();
  });

  it('labels development authentication without claiming Cloudflare Access', async () => {
    render(<App loadBootstrap={async () => ({ ...bootstrap, identity: { provider: 'development' },
      command: { ...bootstrap.command, environment: 'development' },
    })} />);
    expect(await screen.findByText('Development preview · 0.1.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Development identity')).toBeInTheDocument();
    expect(screen.queryByText('Access verified')).not.toBeInTheDocument();
  });

  it('keeps degraded health visible with the context pane closed', async () => {
    render(<App loadBootstrap={async () => ({ ...bootstrap, hermes: { ...bootstrap.hermes,
      state: 'degraded', gatewayState: 'unknown', readinessChecks: { config: 'pass', disk: 'warn' },
    } })} />);
    expect(await screen.findByRole('button', { name: 'Hermes degraded' })).toHaveClass('degraded');
    expect(screen.getByRole('status')).toHaveTextContent('Some capabilities may be unavailable.');
  });

  it('shows a bounded failure state for an unclassified bootstrap failure', async () => {
    render(
      <App
        loadBootstrap={async () => {
          throw new Error('sensitive upstream details');
        }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Command unavailable',
    );
    expect(screen.queryByText('sensitive upstream details')).not.toBeInTheDocument();
  });
});

