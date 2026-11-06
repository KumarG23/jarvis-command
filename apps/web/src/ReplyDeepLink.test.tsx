import type { CommandBootstrap } from '@jarvis-command/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';

// SYNTHETIC end-to-end candidate fixtures: the server target DTO is the only source of the exact message.
const timestamp = '2026-11-06T12:00:00Z';
const sess = (letter: string) => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC chat ${letter.toUpperCase()}`, source: 'api_server', ownership: 'command' as const, model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false });
const [chatA, chatB] = [sess('a'), sess('b')] as const;
const bootstrap = { identity: { provider: 'development' }, command: { version: 'SYNTHETIC', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [chatA, chatB] } as unknown as CommandBootstrap;
const id = (n: number) => `ntf_${n.toString(16).padStart(32, '0')}`;
const runId = 'jcr_' + 'c'.repeat(32);
const msg = (session: typeof chatA, mid: string) => ({ id: mid, sessionId: session.id, role: 'assistant', content: 'SYNTHETIC identical answer', timestamp: null, toolName: null, displayKind: null });
const inbox = { version: 1, items: [], unreadCount: 0, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } }, delivery: { inApp: 'incomplete', push: 'unavailable', externalSurfaces: 'unavailable' } };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); sessionStorage.clear(); });

function setup(target: Record<string, unknown>) {
  const calls: Array<[string, string]> = [];
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push([method, url]);
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [] });
    if (url === '/api/notifications') return Response.json(inbox);
    if (url === '/api/notifications/presence') return new Response(null, { status: 204 });
    if (url === `/api/notifications/${id(1)}/open`) return Response.json({ state: 'available', sessionId: chatA.id, publicRunId: runId, clientRequestId: '00000000-0000-4000-8000-000000000001', runStatus: 'completed', approvalPending: false, session: chatA, inbox, ...target });
    for (const chat of [chatA, chatB]) {
      if (url === `/api/live/sessions/${chat.id}`) return Response.json({ session: chat });
      if (url.startsWith(`/api/sessions/${chat.id}/messages`)) return Response.json({ sessionId: chat.id, messages: [msg(chat, `${chat.id.slice(3, 5)}:first`), msg(chat, `${chat.id.slice(3, 5)}:exact`), msg(chat, `${chat.id.slice(3, 5)}:latest`)], pagination: { limit: 50, offset: 0, returned: 3, hasMore: false } });
    }
    if (url === '/api/live/model-options') return Response.json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [] });
    return new Response('{}', { status: 503 });
  }));
  return calls;
}

it('a push deep link opens the exact reply in the right session, never the latest or a same-text answer elsewhere, with no admission', { timeout: 30000 }, async () => {
  window.history.replaceState(null, '', `/?notification=${id(1)}`);
  const calls = setup({ messageId: 'aa:exact' });
  render(<App loadBootstrap={async () => bootstrap} />);
  await screen.findByRole('button', { name: 'Open chat navigation' });
  await waitFor(() => expect(screen.getAllByRole('button', { name: new RegExp(chatA.title) }).length).toBeGreaterThan(0));
  fireEvent.click(await screen.findByRole('button', { name: 'Open notification' }));
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(chatA.title), { timeout: 8000 });
  await waitFor(() => expect(document.querySelector('[data-message-id="aa:exact"]')).toHaveFocus(), { timeout: 8000 });
  expect(screen.getByLabelText('Selected session')).toHaveTextContent(chatA.title);
  expect(document.querySelectorAll('[data-reply-focus="true"]')).toHaveLength(1);
  expect(document.querySelector('[data-message-id="aa:latest"]')).not.toHaveAttribute('data-reply-focus');
  // The visible, loaded session reports presence; the unselected one does not.
  await waitFor(() => expect(calls.some(([m, u]) => m === 'POST' && u === '/api/notifications/presence')).toBe(true));
  expect(calls.filter(([m, u]) => m === 'POST' && !['/api/notifications/presence', `/api/notifications/${id(1)}/open`].includes(u))).toEqual([]);
  expect(calls.some(([, u]) => /\/api\/live\/(runs|sessions\/[^/]+\/(messages|runs))/.test(u) && u.includes('/runs'))).toBe(false);
});

it('shows exact-reply-unavailable for a missing or foreign id while still opening only the authorized session', async () => {
  window.history.replaceState(null, '', `/?notification=${id(1)}`);
  setup({ messageId: 'bb:exact' }); // an id that belongs to chat B, not the target chat A
  render(<App loadBootstrap={async () => bootstrap} />);
  await screen.findByRole('button', { name: 'Open chat navigation' });
  await waitFor(() => expect(screen.getAllByRole('button', { name: new RegExp(chatA.title) }).length).toBeGreaterThan(0));
  fireEvent.click(await screen.findByRole('button', { name: 'Open notification' }));
  expect(await screen.findByText(/Exact reply unavailable/)).toBeInTheDocument();
  expect(screen.getByLabelText('Selected session')).toHaveTextContent(chatA.title);
  expect(document.querySelector('[data-reply-focus]')).toBeNull();
});

it('keeps legacy run-state opens unchanged: session opens with no focus or notice', async () => {
  window.history.replaceState(null, '', `/?notification=${id(1)}`);
  setup({});
  render(<App loadBootstrap={async () => bootstrap} />);
  await screen.findByRole('button', { name: 'Open chat navigation' });
  await waitFor(() => expect(screen.getAllByRole('button', { name: new RegExp(chatA.title) }).length).toBeGreaterThan(0));
  fireEvent.click(await screen.findByRole('button', { name: 'Open notification' }));
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(chatA.title), { timeout: 8000 });
  await screen.findAllByRole('article', { name: 'Jarvis response' });
  expect(document.querySelector('[data-reply-focus]')).toBeNull();
  expect(screen.queryByText(/Exact reply unavailable/)).toBeNull();
});
