import type { CommandBootstrap } from '@jarvis-command/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

afterEach(() => vi.unstubAllGlobals());

describe('Command session creation', () => {
  it('creates once with the exact mutation boundary, selects the validated session and adds navigation', async () => {
    const pending = deferred<Response>();
    const created = { ...bootstrap.sessions[0]!, id: 'jc_new:session+exact', title: 'New Command session', ownership: 'command', source: 'web', messageCount: 0 };
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(Response.json(history(created.id, 0, [])));
    vi.stubGlobal('fetch', fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    const create = await screen.findByRole('button', { name: 'New Command session' });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(create).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/live/sessions', {
      method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: '{}',
    });
    await act(async () => pending.resolve(Response.json({ session: created })));
    expect(await screen.findByText('No messages in this session yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: created.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Command session.*0 messages/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Command-owned session')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBeInTheDocument();
  });

  it.each(['http', 'access', 'malformed', 'external'])('reports honest creation failure for %s without adding a session', async (fault) => {
    const session = { ...bootstrap.sessions[0]!, id: 'jc_new', title: 'Must not appear', ownership: 'command' };
    if (fault === 'external') session.ownership = 'external';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(fault === 'malformed' ? { secret: 'private detail' } : { session }, { status: fault === 'http' ? 502 : fault === 'access' ? 401 : 200 })));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New Command session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(fault === 'access' ? 'Access expired or denied.' : 'Session creation could not be confirmed.');
    expect(screen.queryByText('Must not appear')).not.toBeInTheDocument();
    expect(screen.queryByText('private detail')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Command session' })).not.toBeDisabled();
  });

  it('does not activate session selection or creation when the capability is disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<App loadBootstrap={async () => bootstrap} />);
    const session = await screen.findByRole('button', { name: /18 messages/ });
    expect(session).toBeDisabled();
    fireEvent.click(session);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'New Command session' })).not.toBeInTheDocument();
  });
});

describe('Live Room history', () => {
  it('allows an empty successor page, avoids concurrent loads and retains history across a failed page retry', async () => {
    const pending = deferred<Response>();
    const first = history('session_123', 0, Array.from({ length: 50 }, (_, i) => `Initial ${i}`), true);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(first)).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(Response.json(history('session_123', 50, [])));
    vi.stubGlobal('fetch', fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: /18 messages/ }));
    const more = await screen.findByRole('button', { name: 'Load more messages' });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(more).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(Response.json({}, { status: 502 })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load messages.');
    expect(screen.getByText('Initial 49')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
    expect(await screen.findByText('End of history.')).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/sessions/session_123/messages?limit=50&offset=50');
    expect(fetchMock.mock.calls[2]![0]).toBe(fetchMock.mock.calls[1]![0]);
    expect(screen.getAllByRole('article')).toHaveLength(50);
  });

  it.each(['network', 'non-json', 'redirect'])('bounds a %s history failure without exposing response content', async (fault) => {
    const response = new Response('<html>private upstream</html>');
    if (fault === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    vi.stubGlobal('fetch', fault === 'network' ? vi.fn().mockRejectedValue(new Error('private upstream')) : vi.fn().mockResolvedValue(response));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: /18 messages/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(fault === 'redirect' ? 'Access expired or denied.' : 'Could not load messages.');
    expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
  });

  it('bounds history to ten pages and labels the view limit instead of claiming the end', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
      return Promise.resolve(Response.json(history('session_123', offset, Array.from({ length: 50 }, (_, i) => `Row ${offset + i}`), true)));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: /18 messages/ }));
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

  it('selects sessions with a compact picker without needing the desktop sidebar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(history())));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    const picker = await screen.findByRole('combobox', { name: 'Session' });
    fireEvent.change(picker, { target: { value: 'session_123' } });
    expect(await screen.findByText('First question')).toBeInTheDocument();
    expect(picker).toHaveValue('session_123');
    fireEvent.change(picker, { target: { value: '' } });
    expect(screen.queryByText('First question')).not.toBeInTheDocument();
    expect(screen.getByText('Operational snapshot')).toBeInTheDocument();
  });

  it.each([401, 403, 502])('handles HTTP %s without exposing upstream details and can retry', async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ secret: 'private upstream error' }, { status }))
      .mockResolvedValueOnce(Response.json(history()));
    vi.stubGlobal('fetch', fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: /18 messages/ }));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: /18 messages/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load messages.');
    expect(screen.queryByText('First question')).not.toBeInTheDocument();
  });

  it('aborts and ignores stale history when switching sessions, including switching back', async () => {
    const old = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(Response.json(history('second:session+exact', 0, ['Second room'])))
      .mockResolvedValueOnce(Response.json(history('session_123', 0, ['Fresh first room'])));
    vi.stubGlobal('fetch', fetchMock);
    render(<App loadBootstrap={async () => ({ ...liveBootstrap, sessions: [...liveBootstrap.sessions, { ...liveBootstrap.sessions[0]!, id: 'second:session+exact', title: 'Second session' }] })} />);
    fireEvent.click(await screen.findByRole('button', { name: /Jarvis Command.*18 messages/ }));
    fireEvent.click(screen.getByRole('button', { name: /Second session/ }));
    expect(await screen.findByText('Second room')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1]![0]).toContain('second%3Asession%2Bexact');
    fireEvent.click(screen.getByRole('button', { name: /Jarvis Command.*18 messages/ }));
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
    vi.stubGlobal('fetch', fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: /18 messages/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more messages' }));
    expect(await screen.findByText('Last answer')).toBeInTheDocument();
    expect(screen.getAllByText('First question')).toHaveLength(1);
    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more messages' })).not.toBeInTheDocument();
    expect(screen.getByText('End of history.')).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/sessions/session_123/messages?limit=50&offset=1');
  });

  it('shows an explicit empty history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(history('session_123', 0, []))));
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: /18 messages/ }));
    expect(await screen.findByText('No messages in this session yet.')).toBeInTheDocument();
  });

  it('selects a recent session and renders oldest-first typed history through the BFF', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(<App loadBootstrap={async () => liveBootstrap} />);
    fireEvent.click(await screen.findByRole('button', { name: /18 messages/ }));
    expect(screen.getByText('Loading messages…')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session_123/messages?limit=50&offset=0', expect.objectContaining({
      credentials: 'same-origin', headers: { accept: 'application/json' }, signal: expect.any(AbortSignal),
    }));
    await act(async () => pending.resolve(Response.json(history())));
    const timeline = screen.getByRole('region', { name: 'Mission timeline' });
    expect(within(timeline).getAllByRole('article').map((row) => row.textContent)).toEqual([
      expect.stringContaining('First question'), expect.stringContaining('Assistant answer'), expect.stringContaining('Tool output'),
    ]);
    expect(within(timeline).getByText('terminal')).toBeInTheDocument();
    expect(within(timeline).getByText('External session · Read-only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue in Command' })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('Jarvis Command shell', () => {
  it('renders a useful command room from the live bootstrap contract', async () => {
    render(<App loadBootstrap={async () => bootstrap} />);

    expect(screen.getByLabelText('Jarvis Command is loading')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Jarvis Command' })).toBeInTheDocument();
    expect(screen.getAllByText('Hermes available')).toHaveLength(2);
    expect(screen.getByText('gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Codex')).toBeInTheDocument();
    expect(screen.queryByText('Max reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText('272K default')).not.toBeInTheDocument();
    expect(screen.getByText('1 active agent')).toBeInTheDocument();

    const sessions = screen.getByRole('navigation', { name: 'Project rooms' });
    expect(within(sessions).getByText('18 messages · 7 tools')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mission timeline' })).toBeInTheDocument();
    expect(screen.getByText('Operational snapshot')).toBeInTheDocument();
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
    expect(screen.getByText('Static snapshot')).toBeInTheDocument();
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Operations deck' })).toBeInTheDocument();
    const mobileNavigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(mobileNavigation).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search command room' })).not.toBeInTheDocument();
    expect(screen.getByText('Messaging is unavailable in this read-only slice.')).toBeInTheDocument();
    expect(within(sessions).getByRole('button', { name: 'Artifacts' })).toBeDisabled();
    expect(within(mobileNavigation).getByRole('button', { name: 'Agents' })).toBeDisabled();
    expect(within(mobileNavigation).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(mobileNavigation).getByRole('button', { name: 'Artifacts' })).toBeDisabled();
    expect(screen.getByText('Read-only bridge')).toBeInTheDocument();
    expect(screen.getAllByText('Access verified')).toHaveLength(2);
    expect(screen.getByText('Hermes available', { selector: '.state-badge' })).toHaveClass('online');
  });

  it('keeps the command shell honest when Hermes is offline', async () => {
    render(
      <App
        loadBootstrap={async () => ({
          ...bootstrap,
          hermes: {
            ...bootstrap.hermes,
            state: 'offline',
            model: null,
            provider: null,
            gatewayState: 'unknown',
            activeAgents: 0,
            readinessChecks: { hermesBridge: 'fail' },
          },
          sessions: [],
        })}
      />,
    );

    expect((await screen.findAllByText('Hermes unavailable')).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('heading', { name: 'Hermes unavailable' })).toBeInTheDocument();
    expect(screen.getByText('No sessions returned by Hermes.')).toBeInTheDocument();
    expect(screen.getAllByText('Hermes unavailable').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Hermes unavailable', { selector: '.state-badge' })).toHaveClass('offline');
    expect(screen.getByText('Model not reported')).toBeInTheDocument();
    expect(screen.getByText('Provider not reported')).toBeInTheDocument();
  });

  it('labels development authentication without claiming Cloudflare Access', async () => {
    render(<App loadBootstrap={async () => ({
      ...bootstrap,
      identity: { provider: 'development' },
      command: { ...bootstrap.command, environment: 'development' },
    })} />);

    expect(await screen.findAllByText('Development identity')).toHaveLength(2);
    expect(screen.queryByText('Access verified')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Authenticated operator')).toHaveAttribute(
      'title',
      'Development identity verified',
    );
    expect(screen.getByText('Development identity', { selector: '.identity-badge' })).toHaveClass('development');
  });

  it('renders degraded Hermes as reachable but unhealthy', async () => {
    render(<App loadBootstrap={async () => ({
      ...bootstrap,
      hermes: {
        ...bootstrap.hermes,
        state: 'degraded',
        gatewayState: 'unknown',
        readinessChecks: { config: 'pass', disk: 'warn' },
      },
    })} />);

    expect(await screen.findByRole('heading', { name: 'Hermes degraded' })).toBeInTheDocument();
    expect(screen.getByText(/private snapshot arrived, but readiness checks/i)).toBeInTheDocument();
    expect(screen.queryByText(/did not answer the private upstream probe/i)).not.toBeInTheDocument();
  });

  it('shows a bounded failure state when bootstrap authorization fails', async () => {
    render(
      <App
        loadBootstrap={async () => {
          throw new Error('sensitive upstream details');
        }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Jarvis Command could not establish the secure session.',
    );
    expect(screen.queryByText('sensitive upstream details')).not.toBeInTheDocument();
  });
});
