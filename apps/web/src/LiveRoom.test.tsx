import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveRoom } from './LiveRoom';
import { TurnView } from './TurnView';
import type { Turn } from './useLiveTurn';

const session = { id: 'jc_' + 'a'.repeat(32), title: 'Saved test room', source: 'api_server', ownership: 'command' as const, model: null, lastActive: '2026-09-05T12:00:00Z', messageCount: 1, toolCallCount: 0, pinned: false };
const content = 'Saved reply\n  exact whitespace';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('shows one recovered answer after its bound saved history arrives, retaining an older identical answer', async () => {
  const turn: Turn = { intent: { sessionId: session.id, clientRequestId: 'recovered', input: null }, publicRunId: 'jcr_' + 'a'.repeat(32), phase: 'Run completed', done: true, output: content, outputLimited: false, historyMatched: false, identityVerified: true, approval: null, events: [], historyBinding: { userMessageId: 'new:u', assistantMessageId: 'new:a' } };
  const messages = ['user', 'assistant', 'user', 'assistant'].map((role, index) => ({ id: ['old:u', 'old:a', 'new:u', 'new:a'][index], sessionId: session.id, role, content: role === 'user' ? 'question' : content, timestamp: null, toolName: null, displayKind: null }));
  let resolve!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  render(<LiveRoom session={session} onHistory={vi.fn()} turns={[turn]} renderTurn={value => <TurnView turn={value} allowed={false} approve={vi.fn()} stop={vi.fn()} />} />);
  expect(screen.getAllByRole('article', { name: 'Jarvis response' })).toHaveLength(1);
  resolve(Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 4, hasMore: false } }));
  await waitFor(() => expect(document.querySelector('[data-message-id="new:a"]')).not.toBeNull());
  expect(document.querySelector('.turn-output')).toBeNull();
  expect(screen.getAllByRole('article', { name: 'Jarvis response' })).toHaveLength(2);
  expect(document.querySelector('[data-message-id="old:a"]')).not.toBeNull();
});
it.each([false, true])('renders an owned partial-page echo once while retaining local output (done=%s)', async done => {
  const turn: Turn = { intent: { sessionId: session.id, clientRequestId: 'local', input: 'question' }, publicRunId: 'jcr_' + 'a'.repeat(32), phase: 'Run running', done, output: content, outputLimited: false, historyMatched: false, identityVerified: true, approval: null, events: [], historyBaseline: ['old:u', 'old:a'] };
  const messages = ['user', 'assistant', 'user', 'assistant'].map((role, index) => ({ id: ['old:u', 'old:a', 'new:u', 'new:a'][index], sessionId: session.id, role, content: role === 'user' ? 'question' : content, timestamp: null, toolName: null, displayKind: null }));
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 4, hasMore: true } }));
  vi.stubGlobal('fetch', fetchMock);
  const renderTurn = (value: Turn) => <TurnView turn={value} allowed={false} approve={vi.fn()} stop={vi.fn()} />;
  const { rerender } = render(<LiveRoom session={session} onHistory={vi.fn()} turns={[turn]} renderTurn={renderTurn} />);
  await screen.findByRole('button', { name: 'Load more messages' });
  expect(screen.getAllByRole('article', { name: 'Your message' })).toHaveLength(2);
  expect(screen.getAllByRole('article', { name: 'Jarvis response' })).toHaveLength(2);
  expect(document.querySelector('[data-message-id="old:a"]')).not.toBeNull();
  expect(document.querySelector('.live-message .turn-output')).toHaveTextContent('Saved reply');
  expect(document.querySelector('[data-message-id="new:a"]')).toBeNull();
  fetchMock.mockRejectedValueOnce(new Error('late page unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
  await screen.findByRole('alert');
  expect(screen.getAllByRole('article', { name: 'Jarvis response' })).toHaveLength(2);
  fetchMock.mockResolvedValueOnce(Response.json({ sessionId: session.id, messages: [], pagination: { limit: 50, offset: 4, returned: 0, hasMore: false } }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  await waitFor(() => expect(screen.queryByText('Loading messages…')).not.toBeInTheDocument());
  rerender(<LiveRoom session={session} onHistory={vi.fn()} turns={[{ ...turn, done: true }]} renderTurn={renderTurn} />);
  expect(document.querySelector('[data-message-id="new:a"]')).not.toBeNull();
  expect(screen.getAllByRole('article', { name: 'Jarvis response' })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(2);
});
it('labels saved conversation cards consistently and hides empty assistant tool-call records', async () => {
  const messages = ['user', 'assistant'].map((role, index) => ({ id: `record:${index}`, sessionId: session.id, role, content: role === 'user' ? 'question' : '', timestamp: null, toolName: null, displayKind: 'tool_call' }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 2, hasMore: false } })));
  render(<LiveRoom session={session} onHistory={vi.fn()} />);
  expect(await screen.findByRole('article', { name: 'Your message' })).toHaveTextContent('You');
  expect(screen.queryByRole('article', { name: 'Jarvis response' })).not.toBeInTheDocument();
  expect(screen.queryByText('Assistant activity record — no text was saved.')).not.toBeInTheDocument();
});
it('views the last rendered chat message at its absolute canonical position after metadata-only trailing pages', async () => {
  const ordinary = Array.from({ length: 50 }, (_, index) => ({ id: index === 49 ? 'answer:canonical' : `chat:${index}`, sessionId: session.id, role: 'assistant', content: index === 49 ? 'answer' : 'prior answer', timestamp: null, toolName: null, displayKind: null }));
  const metadata = Array.from({ length: 50 }, (_, index) => {
    const records = [
      { role: 'system', content: 'setup', toolName: null, displayKind: null },
      { role: 'user', content: 'notification', toolName: null, displayKind: 'internal_notification' },
      { role: 'tool', content: 'tool output', toolName: 'shell', displayKind: null },
      { role: 'assistant', content: '', toolName: null, displayKind: null },
      { role: 'assistant', content: 'display output', toolName: null, displayKind: 'display_only' },
    ];
    return { id: `metadata:${index}`, sessionId: session.id, timestamp: null, ...records[index % records.length] };
  });
  const pages = [ordinary, metadata];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const offset = Number(new URL(url, 'http://fixture').searchParams.get('offset'));
    const messages = pages[offset / 50]!;
    return Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset, returned: messages.length, hasMore: offset === 0 } });
  }));
  let observe!: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void;
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof observe) { observe = callback; } observe() {} disconnect() {} });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 20, top: 20, bottom: 22, left: 0, right: 100, width: 100, height: 2, toJSON() {} });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.querySelector('.latest-message-view') });
  const onLatestViewed = vi.fn();
  render(<div className="timeline"><LiveRoom session={session} onHistory={vi.fn()} onLatestViewed={onLatestViewed} /></div>);
  await screen.findByRole('button', { name: 'Load more messages' });
  fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
  await waitFor(() => expect(document.querySelector('[data-message-id="answer:canonical"] .latest-message-view')).not.toBeNull());
  expect(document.querySelector('[data-message-id="metadata:0"] .latest-message-view')).toBeNull();
  await waitFor(() => { expect(observe).toBeTypeOf('function'); });
  act(() => observe([{ isIntersecting: true, intersectionRatio: 1 }]));
  expect(onLatestViewed).toHaveBeenCalledExactlyOnceWith(session.id, 'answer:canonical', 49);
  expect(onLatestViewed).not.toHaveBeenCalledWith(session.id, 'metadata:49', 99);
});
it.each(['success', 'denied'])('offers honest %s copying after a reply moves to saved history', async mode => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ sessionId: session.id, messages: [{ id: 'saved:1', sessionId: session.id, role: 'assistant', content, timestamp: session.lastActive, toolName: null, displayKind: null }], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } })));
  const writeText = mode === 'success' ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('denied'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<LiveRoom session={session} onHistory={vi.fn()} />);
  await screen.findByText(/Saved reply/);
  fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
  await screen.findByText(mode === 'success' ? 'Response copied' : 'Could not copy. Select the response text and copy manually.');
  expect(writeText).toHaveBeenCalledExactlyOnceWith(content);
});


it('keeps saved tool output collapsed while retaining its exact payload', async () => {
  const tool = { id: 'tool:1', sessionId: session.id, role: 'tool', content: 'Exact tool output\n  unchanged', timestamp: null, toolName: 'terminal', displayKind: null };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ sessionId: session.id, messages: [tool], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } })));
  render(<LiveRoom session={session} onHistory={vi.fn()} />);
  const summary = await screen.findByText('terminal');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(summary.closest('details')!.querySelector('p')!.textContent).toBe(tool.content);
  fireEvent.click(summary);
  expect(summary.closest('details')).toHaveAttribute('open');
});

it('renders stored and live assistant thread links consistently; user and tool messages stay inert', async () => {
  const target = 'jc_' + 'c'.repeat(32), projectId = 'room_' + 'd'.repeat(32);
  const token = `[open thread](thread:${target})`;
  const messages = [
    { id: 'user:token', sessionId: session.id, role: 'user', content: token, timestamp: null, toolName: null, displayKind: null },
    { id: 'assistant:token', sessionId: session.id, role: 'assistant', content: token, timestamp: null, toolName: null, displayKind: null },
    { id: 'tool:token', sessionId: session.id, role: 'tool', content: token, timestamp: null, toolName: 'tool', displayKind: null },
  ];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 3, hasMore: false } })));
  const onThreadLink = vi.fn();
  const turn: Turn = { intent: { sessionId: session.id, clientRequestId: 'live-link', input: 'question' }, publicRunId: 'jcr_' + 'e'.repeat(32), phase: 'Run completed', done: true, output: token, outputLimited: false, historyMatched: false, identityVerified: true, approval: null, events: [] };
  const view = render(<LiveRoom session={session} onHistory={vi.fn()} threadProjectId={projectId} threadProjectSessionIds={[target]} onThreadLink={onThreadLink} />);
  const storedControl = await screen.findByRole('button', { name: 'open thread' });
  fireEvent.click(storedControl);
  expect(onThreadLink).toHaveBeenCalledExactlyOnceWith(projectId, target);
  expect(document.querySelector('[data-message-id="user:token"] button')).toBeNull();
  expect(document.querySelector('[data-message-id="tool:token"] button')).toBeNull();
  view.unmount();
  render(<TurnView turn={turn} threadProjectId={projectId} threadProjectSessionIds={[target]} onThreadLink={onThreadLink} allowed={false} approve={vi.fn()} stop={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'open thread' }));
  expect(onThreadLink).toHaveBeenCalledTimes(2);
  expect(onThreadLink).toHaveBeenNthCalledWith(1, projectId, target);
  expect(onThreadLink).toHaveBeenNthCalledWith(2, projectId, target);
});

it('loads 250 canonical IDs across five pages, retaining identical messages and existing DOM/copy controls', async () => {
  const messages = Array.from({ length: 250 }, (_, index) => ({ id: `canonical:${index}`, sessionId: session.id, role: 'assistant', content: '**identical reply**', timestamp: null, toolName: null, displayKind: null }));
  const fetchMock = vi.fn(async (url: string) => {
    const offset = Number(new URL(url, 'http://fixture').searchParams.get('offset'));
    return Response.json({ sessionId: session.id, messages: messages.slice(offset, offset + 50), pagination: { limit: 50, offset, returned: 50, hasMore: offset < 200 } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const onHistory = vi.fn();
  render(<LiveRoom session={session} onHistory={onHistory} />);
  await screen.findByRole('button', { name: 'Load more messages' });
  const first = document.querySelector('[data-message-id="canonical:0"]');
  for (let page = 1; page < 5; page++) {
    fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }));
    await waitFor(() => expect(screen.getAllByRole('article', { name: 'Jarvis response' })).toHaveLength((page + 1) * 50));
  }
  expect(document.querySelector('[data-message-id="canonical:0"]')).toBe(first);
  expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(250);
  expect(screen.queryByRole('button', { name: 'Save response as artifact' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Copy response' })[249]!);
  await screen.findByText('Response copied');
  expect(writeText).toHaveBeenCalledWith('**identical reply**');
  expect(onHistory).toHaveBeenLastCalledWith(session.id, messages, true);
  expect(fetchMock.mock.calls.filter(([url]) => url.includes('/messages?')).map(([url]) => new URL(url, 'http://fixture').searchParams.get('offset'))).toEqual(['0', '50', '100', '150', '200']);
}, 15000);
it('shows delivered reminders in time order between saved messages, only when enabled', async () => {
  const messages = [
    { id: 'm1', sessionId: session.id, role: 'user', content: 'remind me at 5', timestamp: '2026-11-12T16:00:00Z', toolName: null, displayKind: null },
    { id: 'm2', sessionId: session.id, role: 'assistant', content: 'Will do.', timestamp: '2026-11-12T16:00:05Z', toolName: null, displayKind: null },
    { id: 'm3', sessionId: session.id, role: 'user', content: 'thanks', timestamp: '2026-11-12T18:00:00Z', toolName: null, displayKind: null },
  ];
  const delivery = { deliveryId: 'dlv_' + 'b'.repeat(32), sessionId: session.id, kind: 'reminder', title: 'Stretch', content: 'Time to **stretch**.', deliveredAt: '2026-11-12T17:00:00Z' };
  const fetcher = vi.fn(async (url: string) => url.endsWith('/deliveries')
    ? Response.json({ sessionId: session.id, deliveries: [delivery] })
    : Response.json({ sessionId: session.id, messages, pagination: { limit: 50, offset: 0, returned: 3, hasMore: false } }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<LiveRoom session={session} onHistory={vi.fn()} showDeliveries />);
  const card = await screen.findByRole('article', { name: 'Scheduled message from Jarvis' });
  expect(card.textContent).toContain('Reminder: Stretch');
  expect(card.querySelector('strong')?.textContent).toBe('stretch');
  const order = [...document.querySelectorAll('[data-message-id], [data-delivery-id]')].map(node => node.getAttribute('data-message-id') ?? 'delivery');
  expect(order).toEqual(['m1', 'm2', 'delivery', 'm3']);
  view.unmount();
  fetcher.mockClear();
  render(<LiveRoom session={session} onHistory={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('[data-message-id="m3"]')).not.toBeNull());
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/deliveries'))).toBe(false);
});
