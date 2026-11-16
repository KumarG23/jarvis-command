import type { CommandBootstrap, SessionSummary } from '@jarvis-command/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App, SHOW_STUDIO_ENTRY } from './App';

// Synthetic only: these fixtures never reach an endpoint, Studio data or live work.
const timestamp = new Date().toISOString();
const commandSession: SessionSummary = {
  id: `jc_${'a'.repeat(32)}`,
  title: 'SYNTHETIC Studio draft chat',
  source: 'web',
  ownership: 'command',
  model: null,
  lastActive: timestamp,
  messageCount: 1,
  toolCallCount: 0,
  pinned: false,
};
const bootstrap: CommandBootstrap = {
  identity: { provider: 'cloudflare-access' },
  command: {
    version: '0.2.0',
    environment: 'production',
    generatedAt: timestamp,
    liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16_000, maxSteerCharacters: 4_000 },
  },
  hermes: {
    state: 'online',
    version: '0.21.0',
    model: null,
    provider: null,
    gatewayState: 'idle',
    activeAgents: 0,
    capabilities: ['run_events_sse', 'artifact_studio'],
    readinessChecks: { config: 'pass' },
  },
  sessions: [commandSession],
};
const emptyInbox = { version: 1, items: [], unreadCount: 0, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } }, delivery: { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' } };

type Call = Readonly<{ url: string; method: string; body: string | null }>;

function history(sessionId: string) {
  return {
    sessionId,
    messages: [{ id: 'stored:one', sessionId, role: 'user', content: 'SYNTHETIC owned question', timestamp, toolName: null, displayKind: null }],
    pagination: { limit: 50, offset: 0, returned: 1, hasMore: false },
  };
}

function fixture(rooms: unknown[] = []) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
    const path = new URL(url, 'http://command.test').pathname;
    if (path === '/api/rooms') return Response.json({ version: 1, rooms });
    if (path === '/api/notifications') return Response.json(emptyInbox);
    if (path === '/api/notifications/presence') return Response.json({ ok: true });
    if (path.startsWith('/api/sessions/') && path.endsWith('/messages')) return Response.json(history(commandSession.id));
    if (path === `/api/live/sessions/${commandSession.id}`) return Response.json({ session: commandSession });
    if (path === '/api/live/sessions/' + commandSession.id + '/context' || path.endsWith('/context')) return Response.json({ sessionId: commandSession.id, state: 'unavailable', receipt: null, updatedAt: null });
    if (path.startsWith('/api/artifacts') && init?.method === undefined) return Response.json({ artifacts: [] });
    if (path === '/api/artifacts/upload') {
      return Response.json({ artifact: {
        id: `art_${'b'.repeat(32)}`, title: 'synthetic.png', type: 'image', mime: 'image/png',
        createdAt: timestamp, updatedAt: timestamp, creator: { subject: 'synthetic', source: 'upload' },
        sessionId: commandSession.id, projectId: null, runId: null, sourceRequestId: null,
        size: 3, sha256: 'c'.repeat(64), currentVersion: 1, canonical: false, privateMode: 'private', originalFilename: 'synthetic.png',
        versions: [{ version: 1, parentVersion: null, baseVersion: null, createdAt: timestamp, creator: { subject: 'synthetic', source: 'upload' }, mime: 'image/png', size: 3, sha256: 'c'.repeat(64), revisionNote: null, feedback: null, originalFilename: 'synthetic.png' }],
        comments: [],
      } });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function openShell() {
  sessionStorage.setItem('jarvis-command:selected-session:v1', commandSession.id);
  render(<App loadBootstrap={async () => bootstrap} />);
  const composer = await screen.findByRole('textbox', { name: 'Message Jarvis' });
  await waitFor(() => expect(composer).toBeEnabled());
  return composer;
}

function studioButton() {
  return within(screen.getByLabelText('Capabilities')).getByRole('button', { name: /Studio crew/ });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

describe.skipIf(!SHOW_STUDIO_ENTRY)('Studio unavailable destination', () => {
  it('is a global top-level destination that opens an honest unavailable view and returns with draft and selection intact', async () => {
    const calls = fixture();
    const composer = await openShell();
    fireEvent.change(composer, { target: { value: 'SYNTHETIC unsent draft' } });
    expect(screen.getByLabelText('Selected session')).toHaveTextContent(commandSession.title);

    const before = calls.length;
    fireEvent.click(studioButton());

    const studio = screen.getByRole('region', { name: 'Studio crew' });
    expect(studio).toHaveFocus();
    expect(within(studio).getByRole('heading', { level: 1, name: 'Studio crew' })).toBeVisible();
    expect(within(studio).getByText('Live team status is not connected in this build. No crew members, tasks or activity are available to show here.')).toBeVisible();
    expect(within(studio).queryByRole('list')).not.toBeInTheDocument();
    expect(within(studio).queryByRole('article')).not.toBeInTheDocument();
    expect(studioButton()).toHaveAttribute('aria-current', 'page');
    // The hidden chat keeps its lifecycle but is out of the accessibility tree.
    expect(screen.queryByRole('region', { name: 'Conversation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).not.toBeInTheDocument();

    // No Studio read/write/polling and no run admission while the unavailable view is open.
    const during = calls.slice(before).filter(call => !call.url.endsWith('/api/notifications/presence'));
    expect(during.filter(call => /studio|crew/i.test(call.url))).toEqual([]);
    expect(during.filter(call => call.method !== 'GET')).toEqual([]);

    fireEvent.click(within(studio).getByRole('button', { name: 'Return to chat' }));
    expect(await screen.findByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC unsent draft');
    expect(screen.getByLabelText('Selected session')).toHaveTextContent(commandSession.title);
    expect(studioButton()).toHaveFocus();
    expect(studioButton()).not.toHaveAttribute('aria-current');
    const after = calls.slice(before).filter(call => !call.url.endsWith('/api/notifications/presence'));
    expect(after.filter(call => call.method !== 'GET')).toEqual([]);
  });

  it('closes with Escape and with phone Back, leaving focus on the Studio entry', async () => {
    fixture();
    await openShell();
    fireEvent.click(studioButton());
    expect(screen.getByRole('region', { name: 'Studio crew' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('region', { name: 'Studio crew' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Studio crew' })).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Conversation' })).toBeInTheDocument();
    expect(studioButton()).toHaveFocus();

    fireEvent.click(studioButton());
    expect(screen.getByRole('region', { name: 'Studio crew' })).toBeInTheDocument();
    // Simulate the browser's Back traversal landing on the chat entry.
    window.history.replaceState(null, '');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.queryByRole('region', { name: 'Studio crew' })).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Conversation' })).toBeInTheDocument();
    expect(studioButton()).toHaveFocus();
  });

  it('returns drawer focus to the visible Studio opener for Close, Escape, scrim and Back without dismissing Studio', async () => {
    fixture();
    // Keep jsdom history deterministic; the Back popstate is dispatched explicitly below.
    vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    await openShell();
    fireEvent.click(studioButton());
    const studioState = window.history.state;
    // The chat's opener is hidden from the accessibility tree; only Studio's is exposed.
    const visibleOpener = () => screen.getAllByRole('button', { name: 'Open chat navigation' })
      .find(element => !element.closest('[hidden]')) as HTMLElement;
    const studio = () => screen.getByRole('region', { name: 'Studio crew' });

    fireEvent.click(visibleOpener());
    fireEvent.click(screen.getByRole('button', { name: 'Close chat navigation' }));
    expect(visibleOpener()).toHaveFocus();
    expect(studio()).toBeInTheDocument();

    fireEvent.click(visibleOpener());
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close chat navigation' }), { key: 'Escape' });
    expect(visibleOpener()).toHaveFocus();
    expect(studio()).toBeInTheDocument();

    fireEvent.click(visibleOpener());
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(visibleOpener()).toHaveFocus();
    expect(studio()).toBeInTheDocument();

    fireEvent.click(visibleOpener());
    window.history.replaceState(studioState, '');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(studio()).toBeInTheDocument();
    expect(visibleOpener()).toHaveFocus();
  });

  it('never reports the hidden chat as visibly focused to reply-presence', async () => {
    const calls = fixture();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await openShell();
    await waitFor(() => expect(calls.some(call => call.url.endsWith('/api/notifications/presence') && call.body?.includes('"visible":true'))).toBe(true));

    fireEvent.click(studioButton());
    await waitFor(() => expect(calls.some(call => call.url.endsWith('/api/notifications/presence') && call.body?.includes('"visible":false'))).toBe(true));
    const markedVisible = calls.filter(call => call.url.endsWith('/api/notifications/presence') && call.body?.includes('"visible":true')).length;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls.filter(call => call.url.endsWith('/api/notifications/presence') && call.body?.includes('"visible":true'))).toHaveLength(markedVisible);
  });

  it('keeps an in-memory image attachment, per-chat draft and project selection across Studio without opening a project pane', async () => {
    const room = { id: `room_${'d'.repeat(32)}`, name: 'SYNTHETIC project', goal: 'Keep work together', instructions: '', archived: false, repository: '', notes: [], sessionIds: [commandSession.id], lastSessionId: commandSession.id };
    fixture([room]);
    await openShell();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Projects' })).getByRole('button', { name: 'SYNTHETIC project' }));
    await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(commandSession.title));
    const composer = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: 'SYNTHETIC draft with image' } });
    const file = new File([new Uint8Array([1, 2, 3])], 'synthetic.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Attach images'), { target: { files: [file] } });
    const attached = await screen.findByLabelText('Attached images');
    expect(within(attached).getByText('synthetic.png')).toBeInTheDocument();

    fireEvent.click(studioButton());
    expect(screen.getByRole('region', { name: 'Studio crew' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Context workspace' })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('region', { name: 'Studio crew' })).getByRole('button', { name: 'Return to chat' }));
    expect(await screen.findByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft with image');
    expect(within(screen.getByLabelText('Attached images')).getByText('synthetic.png')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Projects' })).getByRole('button', { name: 'SYNTHETIC project' })).toHaveAttribute('aria-current', 'page');
  });

  it('mounts the inert projection view: disabled source issues no request of any kind, shows no snapshot controls, and keeps one level-1 heading', async () => {
    const calls = fixture();
    const composer = await openShell();
    fireEvent.change(composer, { target: { value: 'SYNTHETIC draft kept through Studio' } });
    const before = calls.length;
    fireEvent.click(studioButton());
    const studio = screen.getByRole('region', { name: 'Studio crew' });
    expect(within(studio).getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(studio).getByRole('status')).toHaveAttribute('data-state', 'disabled');
    expect(within(studio).queryByRole('button', { name: /Refresh/ })).not.toBeInTheDocument();
    expect(within(studio).queryByText(/Snapshot|Last known|Studio projects/)).not.toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 50));
    // Opening Studio makes no request at all (reply-presence suspension is the only allowed traffic) and clears no read marker.
    expect(calls.slice(before).filter(call => !call.url.endsWith('/api/notifications/presence'))).toEqual([]);
    fireEvent.keyDown(studio, { key: 'Escape' });
    expect(await screen.findByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft kept through Studio');
    expect(calls.slice(before).filter(call => call.method !== 'GET' && !call.url.endsWith('/api/notifications/presence'))).toEqual([]);
  });
});
