import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Cockpit } from './Cockpit';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('opens host shells only: no agent picker, no adapters call, and a shell-only create request', async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (url === '/api/host-shell/sessions' && init?.method === 'POST') return Response.json({ error: 'host_shell_unavailable', message: 'Hermes host is not reachable.' }, { status: 503 });
    return Response.json({ sessions: [] });
  }));
  render(<Cockpit hostShell projectId="host-shell" projectName="Hermes host" onClose={vi.fn()} fullScreen onToggleFullScreen={vi.fn()} />);
  expect(await screen.findByText('No shells open.')).toBeTruthy();
  expect(screen.getByText(/works while Hermes is down/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /New shell/ }));
  expect(screen.queryByLabelText('Agent')).toBeNull();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Restart gateway' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not reachable'));
  expect(calls.some(call => call.url.startsWith('/api/cockpit'))).toBe(false);
  const create = calls.find(call => call.body);
  expect(create?.url).toBe('/api/host-shell/sessions');
  expect(create?.body).toEqual({ requestId: expect.stringMatching(/^web-/), title: 'Restart gateway' });
});
