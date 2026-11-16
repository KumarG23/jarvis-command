import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Welcome } from './Welcome';
import { textDraftKey } from './textDraft';

const session = { id: 'jc_' + 'e'.repeat(32), title: 'New chat', source: 'web', ownership: 'command', model: null, lastActive: '2026-11-14T12:00:00.000Z', messageCount: 0, toolCallCount: 0, pinned: false };
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

it('starts a chat from a suggestion with its prompt already in the message box', async () => {
  const fetchMock = vi.fn(async () => Response.json({ session }));
  vi.stubGlobal('fetch', fetchMock);
  const onCreated = vi.fn();
  render(<Welcome projectName={null} canCreate onCreated={onCreated} onBrowse={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set a reminder' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith('/api/live/sessions', expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(sessionStorage.getItem(textDraftKey())!)).toEqual({ [session.id]: 'Remind me at 5 PM to ' });
});

it('shows a failure and keeps suggestions off while Hermes is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
  const { rerender } = render(<Welcome projectName={null} canCreate onCreated={vi.fn()} onBrowse={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start a blank chat' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
  rerender(<Welcome projectName={null} canCreate={false} onCreated={vi.fn()} onBrowse={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Homelab check' })).toBeDisabled();
});

it('points to the project list inside a project', () => {
  const onBrowse = vi.fn();
  render(<Welcome projectName="Homelab" canCreate onCreated={vi.fn()} onBrowse={onBrowse} />);
  expect(screen.getByRole('heading', { name: 'Let’s work on Homelab.' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Start a chat' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show project chats' }));
  expect(onBrowse).toHaveBeenCalled();
});
