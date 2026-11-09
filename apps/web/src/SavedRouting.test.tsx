import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoutingDefaultSetSchema } from '@jarvis-command/contracts';
import { useSavedRouting } from './savedRouting';
import { SavedRoutingControls } from './SavedRoutingControls';
const sessionId = 'jc_' + 'a'.repeat(32), other = 'jc_' + 'b'.repeat(32), projectId = 'room_' + 'c'.repeat(32);
const selection = { provider: 'openai-codex' as const, model: 'gpt-6-luna' as const, reasoningEffort: 'low' as const };
const target = { scope: 'thread', sessionId, projectId: null };
const calls: { path: string; body: Record<string, unknown>; init: RequestInit }[] = [];
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); calls.length = 0; });
function Harness({ id = sessionId, project = null as string | null, open = true }) {
  const saved = useSavedRouting(id, project, true, open);
  return <><input aria-label="Unsent draft" defaultValue="SYNTHETIC kept" /><SavedRoutingControls saved={saved} selection={selection} disabled={false} /><output>{saved.opted ? 'Opted in' : 'Legacy'}</output></>;
}
function fixture(availability: boolean | undefined = true) {
  const state = new Map<string, { revision: number; selection: typeof selection | null }>();
  let corrupt: ((body: Record<string, unknown>) => unknown) | null = null;
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); calls.push({ path, body, init });
    const t = path.endsWith('/set') ? body.target : body;
    const key = JSON.stringify(t); let current = state.get(key) ?? { revision: 0, selection: null };
    if (path.endsWith('/set')) {
      const req = RoutingDefaultSetSchema.parse(body); current = { revision: req.expectedRevision + 1, selection: req.selection as typeof selection | null }; state.set(key, current);
    }
    const response = { target: t, ...current, replayed: false, ...(availability === undefined ? {} : { writesAvailable: availability }) };
    return Response.json(corrupt ? corrupt(response) : response);
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, state, corrupt: (change: ((body: Record<string, unknown>) => unknown) | null) => { corrupt = change; } };
}
it.each([undefined, false, true])('uses actual writesAvailable=%s without a capability mutation or admission', async available => {
  const f = fixture(available); if (available === undefined) f.corrupt(body => { const next = { ...body }; delete next.writesAvailable; return next; }); render(<Harness />);
  const save = screen.getByRole('button', { name: 'Save prompt choice for thread' });
  await waitFor(() => expect(calls).toHaveLength(1)); await waitFor(() => expect(screen.queryByText('Reading saved defaults…')).not.toBeInTheDocument());
  expect(save).toHaveProperty('disabled', available !== true);
  expect(screen.getByRole('checkbox')).toHaveProperty('disabled', available !== true);
  expect(calls[0]!.path).toBe('/api/live/routing-defaults/read');
  expect(calls[0]!.init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  expect(calls[0]!.body).toEqual(target);
});
it('reads, saves, clears and remounts server readback with exact revision/UUID validation and no prompt migration', async () => {
  const f = fixture(); let view = render(<Harness />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save prompt choice for thread' })).toBeEnabled());
  expect(calls.every(c => c.path.endsWith('/read'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save prompt choice for thread' }));
  await screen.findByText(/gpt-6-luna · low \(revision 1\)/);
  const first = calls.find(c => c.path.endsWith('/set'))!;
  expect(RoutingDefaultSetSchema.parse(first.body)).toMatchObject({ target, expectedRevision: 0, selection });
  expect(first.body.clientRequestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(screen.getByLabelText('Unsent draft')).toHaveValue('SYNTHETIC kept');
  view.unmount(); view = render(<Harness />);
  await screen.findByText(/gpt-6-luna · low \(revision 1\)/);
  fireEvent.click(screen.getByRole('button', { name: 'Clear thread default' }));
  await screen.findByText(/Not set \(revision 2\)/);
  expect(calls.filter(c => c.path.endsWith('/set'))[1]!.body).toMatchObject({ target, selection: null, expectedRevision: 1 });
  expect(f.state.get(JSON.stringify(target))!.selection).toBeNull(); view.unmount();
});
it.each(['target', 'actor', 'revision', 'selection', 'uuid'])('rejects malformed %s mutation response, keeps requested readback/draft and requires refresh', async kind => {
  const f = fixture(); render(<Harness />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save prompt choice for thread' })).toBeEnabled());
  f.corrupt(body => kind === 'target' ? { ...body, target: { ...target, sessionId: other } } : kind === 'actor' ? { ...body, actor: 'forged' } : kind === 'uuid' ? { ...body, clientRequestId: 'invented-echo' } : kind === 'selection' ? { ...body, selection: null } : { ...body, revision: 99 });
  fireEvent.click(screen.getByRole('button', { name: 'Save prompt choice for thread' }));
  await screen.findByText(/change could not be confirmed/);
  expect(screen.getByRole('button', { name: 'Save prompt choice for thread' })).toBeDisabled();
  expect(screen.getByLabelText('Unsent draft')).toHaveValue('SYNTHETIC kept');
  expect(calls.filter(c => c.path.endsWith('/set'))).toHaveLength(1);
  f.corrupt(null); fireEvent.click(screen.getByRole('button', { name: 'Refresh saved defaults' }));
  await screen.findByText(/gpt-6-luna · low \(revision 1\)/);
  expect(calls.filter(c => c.path.endsWith('/set'))).toHaveLength(1);
});
it('keeps requested readback but disables new actions after read denial, without silently leaving an opted-in mode', async () => {
  const f = fixture(); render(<Harness />);
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled()); fireEvent.click(screen.getByRole('checkbox'));
  f.fetcher.mockRejectedValueOnce(Error('denied'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved defaults' }));
  await screen.findByText(/could not be refreshed/);
  expect(screen.getByRole('checkbox')).toBeChecked(); expect(screen.getByRole('checkbox')).toBeEnabled();
  expect(screen.getByText(/Thread: Not set/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox')); expect(screen.getByText('Legacy')).toBeInTheDocument();
});
it.each(['success', 'denial'])('ignores late %s set after session/project navigation and unmount', async result => {
  const f = fixture(); const view = render(<Harness />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save prompt choice for thread' })).toBeEnabled());
  let release!: (value: Response) => void;
  f.fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Save prompt choice for thread' }));
  view.rerender(<Harness id={other} project={projectId} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save prompt choice for project' })).toBeEnabled());
  await act(async () => release(result === 'success' ? Response.json({ target, revision: 1, selection, replayed: false, writesAvailable: true }) : new Response('', { status: 403 })));
  expect(screen.queryByText(/gpt-6-luna/)).not.toBeInTheDocument(); expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByLabelText('Unsent draft')).toHaveValue('SYNTHETIC kept'); view.unmount();
});
it('prevents double-click mutation and checks exact project targets', async () => {
  const f = fixture(); render(<Harness project={projectId} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save prompt choice for project' })).toBeEnabled());
  let release!: (value: Response) => void;
  f.fetcher.mockImplementationOnce((_path, init) => { calls.push({ path: '/api/live/routing-defaults/set', body: JSON.parse(String(init.body)), init }); return new Promise(resolve => { release = resolve; }); });
  const save = screen.getByRole('button', { name: 'Save prompt choice for project' }); fireEvent.click(save); fireEvent.click(save);
  expect(calls.filter(c => c.path.endsWith('/set'))).toHaveLength(1);
  const request = calls.at(-1)!.body; expect(request.target).toEqual({ scope: 'project', projectId });
  await act(async () => release(Response.json({ target: request.target, revision: 1, selection, replayed: false, writesAvailable: true })));
});
it('never probes an invalid target and reads only after the picker is opened', async () => {
  fixture(); const view = render(<Harness id="external" />); expect(calls).toHaveLength(0);
  view.rerender(<Harness open={false} />); expect(calls).toHaveLength(0);
  view.rerender(<Harness />); await waitFor(() => expect(calls).toHaveLength(1));
});
it('does not restore an opt-in that the user turned off during refresh', async () => {
  const f = fixture(); render(<Harness />);
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled()); fireEvent.click(screen.getByRole('checkbox'));
  let release!: (value: Response) => void;
  f.fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved defaults' })); fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => release(Response.json({ target, revision: 0, selection: null, replayed: false, writesAvailable: true })));
  expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByText('Legacy')).toBeInTheDocument();
});
it('uses refresh after a revision conflict and a fresh UUID for a subsequent explicit change', async () => {
  const f = fixture(); render(<Harness />);
  const save = screen.getByRole('button', { name: 'Save prompt choice for thread' }); await waitFor(() => expect(save).toBeEnabled());
  f.fetcher.mockResolvedValueOnce(new Response('', { status: 409 })); fireEvent.click(save);
  await screen.findByText(/change could not be confirmed/);
  const oldId = JSON.parse(String(f.fetcher.mock.calls.at(-1)![1].body)).clientRequestId;
  f.state.set(JSON.stringify(target), { revision: 1, selection });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved defaults' })); await screen.findByText(/revision 1/);
  expect(f.fetcher.mock.calls.filter(([path]) => path.endsWith('/set'))).toHaveLength(1);
  fireEvent.click(save); await screen.findByText(/revision 2/);
  const next = JSON.parse(String(f.fetcher.mock.calls.at(-1)![1].body)); expect(next.expectedRevision).toBe(1); expect(next.clientRequestId).not.toBe(oldId);
});
it.each(['success', 'denial'])('ignores a late %s read after navigation without changing the new target or focus', async result => {
  const f = fixture(); let release!: (response: Response) => void;
  f.fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const view = render(<Harness />); await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
  view.rerender(<Harness id={other} project={projectId} />);
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled()); screen.getByLabelText('Unsent draft').focus();
  await act(async () => release(result === 'success' ? Response.json({ target, revision: 1, selection, replayed: false, writesAvailable: true }) : new Response('', { status: 403 })));
  expect(screen.queryByText(/gpt-6-luna/)).not.toBeInTheDocument(); expect(screen.getByLabelText('Unsent draft')).toHaveFocus(); view.unmount();
});

it.each(['read', 'set'])('unlocks explicit refresh after a timed-out %s without replaying it', async operation => {
  const f = fixture(); render(<Harness />);
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
  f.fetcher.mockImplementationOnce(() => new Promise(() => {}));
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('button', { name: operation === 'read' ? 'Refresh saved defaults' : 'Save prompt choice for thread' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole('button', { name: 'Refresh saved defaults' })).toBeEnabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByLabelText('Unsent draft')).toHaveValue('SYNTHETIC kept');
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Reading saved defaults…')).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
