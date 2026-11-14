import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Cockpit } from './Cockpit';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const at = '2026-11-14T12:00:00.000Z';
const session = (id: string, title: string, state: string) => ({
  id, projectId: 'room_x', threadId: null, requestId: `req-${id}`, title, kind: 'shell', state, owner: 'human', createdBy: 'human',
  host: 'vm', cwd: '/tmp', worktree: false, branch: null, nativeSessionId: null, pid: null, exitCode: null, failure: null,
  createdAt: at, updatedAt: at, stateAt: at,
});

it('closes an ended tab straight away and removes it from the list', async () => {
  const closed: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.endsWith('/close')) { closed.push(url); return Response.json({ closed: { id: 'x' } }); }
    return Response.json({ sessions: closed.length ? [] : [session('cs_done', 'Old build', 'stopped')] });
  }));
  render(<Cockpit projectId="room_x" projectName="MoonWater" onClose={vi.fn()} fullScreen onToggleFullScreen={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close Old build' }));
  await waitFor(() => expect(screen.queryByText('Old build')).toBeNull());
  expect(closed).toEqual(['/api/cockpit/projects/room_x/sessions/cs_done/close']);
});
