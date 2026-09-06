import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveRoom } from './LiveRoom';

const session = { id: 'jc_' + 'a'.repeat(32), title: 'Saved test room', source: 'api_server', ownership: 'command' as const, model: null, lastActive: '2026-09-05T12:00:00Z', messageCount: 1, toolCallCount: 0, pinned: false };
const content = 'Saved reply\n  exact whitespace';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
