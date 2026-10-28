import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageContent } from './MessageContent';
import { TurnComposer } from './TurnView';
import { textDraftKey } from './textDraft';

const props = { allowed: true, draftsAuthorized: true, imageAttachmentsEnabled: false, sessionId: 'jc_draft_a', projectId: null, max: 16000, maxSteer: 100, turn: null, send: vi.fn(() => true), retry: vi.fn(), resume: vi.fn(), steer: vi.fn(), recoveries: [], consumeRecovery: vi.fn() };
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); props.send.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ default: { provider: 'openai-codex', model: 'fixture' }, options: [] })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const composer = () => screen.getByRole('textbox', { name: /^Message Jarvis$/ });
it('restores exact per-session text on reload and chat switching without submitting', () => {
  const first = render(<TurnComposer {...props} />);
  fireEvent.change(composer(), { target: { value: '  draft\nexact text  ' } });
  first.rerender(<TurnComposer {...props} sessionId="jc_draft_b" />);
  expect(composer()).toHaveValue('');
  fireEvent.change(composer(), { target: { value: 'second chat' } });
  first.rerender(<TurnComposer {...props} />);
  expect(composer()).toHaveValue('  draft\nexact text  ');
  first.unmount();
  render(<TurnComposer {...props} />);
  expect(composer()).toHaveValue('  draft\nexact text  ');
  expect(props.send).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(textDraftKey())!)).toEqual({ jc_draft_a: '  draft\nexact text  ', jc_draft_b: 'second chat' });
});
it('withholds stored and in-memory text on denied/unconfirmed history and restores after reauthorization', () => {
  sessionStorage.setItem(textDraftKey(), JSON.stringify({ jc_draft_a: 'private draft' }));
  const view = render(<TurnComposer {...props} draftsAuthorized={false} blocked />);
  expect(composer()).toHaveValue('');
  view.rerender(<TurnComposer {...props} />);
  expect(composer()).toHaveValue('private draft');
  fireEvent.change(composer(), { target: { value: 'new private draft' } });
  view.rerender(<TurnComposer {...props} allowed={false} />);
  expect(screen.queryByDisplayValue('new private draft')).toBeNull();
  view.rerender(<TurnComposer {...props} draftsAuthorized={false} blocked />);
  expect(composer()).toHaveValue('');
  view.rerender(<TurnComposer {...props} />);
  expect(composer()).toHaveValue('new private draft');
  expect(props.send).not.toHaveBeenCalled();
});
it('keeps text on failed storage and refuses admission if stale saved text cannot be cleared', async () => {
  sessionStorage.setItem(textDraftKey(), JSON.stringify({ jc_draft_a: 'old text' }));
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === textDraftKey()) throw Error('quota');
    return original.call(this, key, value);
  });
  render(<TurnComposer {...props} />);
  fireEvent.change(composer(), { target: { value: 'latest unsent text' } });
  expect(screen.getByText(/Draft storage unavailable or full/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByText(/Message not sent; keep this tab open/)).toBeInTheDocument();
  expect(composer()).toHaveValue('latest unsent text');
  expect(props.send).not.toHaveBeenCalled();
});
it('clears verified saved text before admission, never restoring admitted text after lost ACK', () => {
  const view = render(<TurnComposer {...props} />);
  fireEvent.change(composer(), { target: { value: 'send only once' } });
  props.send.mockImplementationOnce(() => {
    expect(sessionStorage.getItem(textDraftKey())).not.toContain('send only once');
    return true;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(props.send).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<TurnComposer {...props} blocked />);
  expect(composer()).toHaveValue('');
  expect(props.send).toHaveBeenCalledTimes(1);
});
it('preserves draft when send refuses admission and never evicts drafts at the storage bound', () => {
  sessionStorage.setItem(textDraftKey(), JSON.stringify(Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`jc_saved_${i}`, 'retained']))));
  render(<TurnComposer {...props} />);
  fireEvent.change(composer(), { target: { value: 'extra draft' } });
  expect(composer()).toHaveValue('extra draft');
  expect(Object.keys(JSON.parse(sessionStorage.getItem(textDraftKey())!))).toHaveLength(32);
  props.send.mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(composer()).toHaveValue('extra draft');
});
it('isolates preview drafts from production', () => {
  sessionStorage.setItem(textDraftKey(), JSON.stringify({ jc_draft_a: 'production draft' }));
  window.history.replaceState({}, '', '/api/preview/issue-26/');
  const view = render(<TurnComposer {...props} />);
  expect(composer()).toHaveValue('');
  fireEvent.change(composer(), { target: { value: 'preview draft' } });
  view.unmount();
  window.history.replaceState({}, '', '/');
  render(<TurnComposer {...props} />);
  expect(composer()).toHaveValue('production draft');
});
it('renders GFM, streaming fences and safe external links without raw HTML, unsafe links or remote resources', () => {
  const text = '# Heading\n\n**bold** and `inline`\n\n| A | B |\n| - | - |\n| one | two |\n\n[external](https://example.com) [unsafe](javascript:alert%281%29) [origin](/api/live/runs)\n\n![tracking](https://example.com/pixel)\n\n<script>alert(1)</script><iframe src="/api/bootstrap"></iframe>\n\n```js\n' + 'x'.repeat(500);
  const { container, rerender } = render(<MessageContent text={text} />);
  expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('one');
  expect(screen.getByRole('link', { name: 'external' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'origin' })).toBeNull();
  expect(container.querySelector('img,script,iframe')).toBeNull();
  expect(screen.getByLabelText('Code block').textContent).toBe('x'.repeat(500) + '\n');
  rerender(<MessageContent text={text + '\n```'} />);
  expect(screen.getByLabelText('Code block')).toHaveAttribute('tabindex', '0');
});
it('reports unreadable storage without exposing text, then retains a new edit when storage recovers', () => {
  const getItem = Storage.prototype.getItem;
  const failure = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === textDraftKey()) throw Error('blocked read');
    return getItem.call(this, key);
  });
  render(<TurnComposer {...props} />);
  expect(composer()).toHaveValue('');
  expect(screen.getByText(/Draft storage unavailable or full/)).toBeInTheDocument();
  failure.mockRestore();
  fireEvent.change(composer(), { target: { value: 'new edit' } });
  expect(screen.queryByText(/Draft storage unavailable or full/)).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(textDraftKey())!)).toEqual({ jc_draft_a: 'new edit' });
});
