import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveRoom } from './LiveRoom';

// SYNTHETIC fixtures only. Exact durable message ids; text/recency/adjacency never select a target.
const session = { id: 'jc_' + 'a'.repeat(32), title: 'SYNTHETIC room', source: 'api_server', ownership: 'command' as const, model: null, lastActive: '2026-11-06T12:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
const message = (id: string, role = 'assistant', content = 'SYNTHETIC repeated answer') => ({ id, sessionId: session.id, role, content, timestamp: null, toolName: null, displayKind: null });
const page = (messages: unknown[], offset: number, hasMore: boolean) => Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset, returned: messages.length, hasMore } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const rows = [message('assistant:A'), message('user:1', 'user', 'q'), message('assistant:B'), message('assistant:latest')];

it('focuses only the exact durable message among identical texts, not the latest or an adjacent answer', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => page(rows, 0, false)));
  const settled = vi.fn();
  render(<LiveRoom session={session} onHistory={vi.fn()} focusMessageId="assistant:A" onFocusSettled={settled} />);
  await waitFor(() => expect(document.querySelector('[data-message-id="assistant:A"]')).toHaveFocus());
  expect(document.querySelectorAll('[data-reply-focus="true"]')).toHaveLength(1);
  expect(document.querySelector('[data-message-id="assistant:A"]')).toHaveAttribute('data-reply-focus', 'true');
  expect(document.querySelector('[data-message-id="assistant:B"]')).not.toHaveAttribute('data-reply-focus');
  expect(document.querySelector('[data-message-id="assistant:latest"]')).not.toHaveAttribute('data-reply-focus');
  expect(settled).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Exact reply unavailable/)).toBeNull();
});

it('keeps legacy opens unchanged: no focus target means no focus or notice', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => page(rows, 0, false)));
  render(<LiveRoom session={session} onHistory={vi.fn()} />);
  await screen.findAllByRole('article', { name: 'Jarvis response' });
  expect(document.querySelector('[data-reply-focus]')).toBeNull();
  expect(screen.queryByText(/Exact reply unavailable/)).toBeNull();
});

it.each([
  ['a foreign/missing id with an identical-text answer present', 'assistant:other-session', /not in this chat’s saved history/],
  ['a stale id absent from history', 'assistant:gone', /not in this chat’s saved history/],
])('shows an honest unavailable state and highlights nothing for %s', async (_name, id, text) => {
  vi.stubGlobal('fetch', vi.fn(async () => page(rows, 0, false)));
  render(<LiveRoom session={session} onHistory={vi.fn()} focusMessageId={id} />);
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(document.querySelector('[data-reply-focus]')).toBeNull();
  expect(document.activeElement).toBe(document.body);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText(/Exact reply unavailable/)).toBeNull();
});

it('pages through existing bounded history to find the exact message, with no mutation', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') throw Error('SYNTHETIC must never mutate');
    const offset = Number(new URL(url, 'http://t.test').searchParams.get('offset'));
    return offset === 0 ? page([message('assistant:first')], 0, true) : page([message('assistant:target')], 1, false);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<LiveRoom session={session} onHistory={vi.fn()} focusMessageId="assistant:target" />);
  await waitFor(() => expect(document.querySelector('[data-message-id="assistant:target"]')).toHaveFocus());
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/messages'))).toHaveLength(2);
  expect(document.querySelector('[data-message-id="assistant:first"]')).not.toHaveAttribute('data-reply-focus');
});

it('stops at the history page bound with an incomplete-history notice instead of scraping or guessing', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (!url.includes('/messages')) return new Response('{}', { status: 404 }); calls++; const offset = Number(new URL(url, 'http://t.test').searchParams.get('offset')); return page([message(`assistant:${offset}`)], offset, true); }));
  render(<LiveRoom session={session} onHistory={vi.fn()} focusMessageId="assistant:never" />);
  expect(await screen.findByText(/not found within the history loaded so far/, undefined, { timeout: 15_000 })).toBeInTheDocument();
  expect(calls).toBe(20);
  expect(document.querySelector('[data-reply-focus]')).toBeNull();
});

it.each([401, 500])('reports unavailable and never focuses anything when history fails (%s)', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
  render(<LiveRoom session={session} onHistory={vi.fn()} focusMessageId="assistant:A" />);
  expect(await screen.findByText(/could not be located or displayed/)).toBeInTheDocument();
  expect(document.querySelector('[data-reply-focus]')).toBeNull();
});

it('reports presence only for a session whose history loaded, never on failure', async () => {
  const calls: string[] = [];
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/notifications/presence') { calls.push(String(init?.body)); return new Response(null, { status: 204 }); }
    return page(rows, 0, false);
  }));
  const { unmount } = render(<LiveRoom session={session} onHistory={vi.fn()} reportPresence />);
  await waitFor(() => expect(calls).toEqual([JSON.stringify({ sessionId: session.id, visible: true })]));
  unmount();
  expect(calls.at(-1)).toBe(JSON.stringify({ sessionId: session.id, visible: false }));

  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { if (url === '/api/notifications/presence') calls.push(String(init?.body)); return new Response('{}', { status: 403 }); }));
  render(<LiveRoom session={session} onHistory={vi.fn()} reportPresence />);
  await screen.findByText(/Access expired or denied/);
  expect(calls).toEqual([]);
});

it('does not report presence unless the app enables it', async () => {
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => page(rows, 0, false));
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  render(<LiveRoom session={session} onHistory={vi.fn()} />);
  await screen.findAllByRole('article', { name: 'Jarvis response' });
  expect(fetcher.mock.calls.some(([url]) => url === '/api/notifications/presence')).toBe(false);
});
