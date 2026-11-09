import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnComposer } from './TurnView';
import { useLiveTurn } from './useLiveTurn';
import { inferencePreferenceKey } from './inferencePreference';
import { threadRecoveryKey } from './turnRecovery';
const sessionId = 'jc_' + 'a'.repeat(32), projectId = 'room_' + 'b'.repeat(32);
const inference = { provider: 'openai-codex' as const, model: 'gpt-6-luna' as const, reasoningEffort: 'low' as const };
const inventory = { default: { provider: inference.provider, model: inference.model }, options: [{ ...inference, label: 'SYNTHETIC Luna', reasoningEfforts: ['low'] }].map(({ provider, model, label, reasoningEfforts }) => ({ provider, model, label, reasoningEfforts })) };
const room = { id: projectId, name: 'SYNTHETIC project', goal: 'Owned routing', instructions: '', repository: '', notes: [], sessionIds: [sessionId], lastSessionId: sessionId };
const props = () => ({ allowed: true, draftsAuthorized: true, imageAttachmentsEnabled: false, sessionId, projectId: null as string | null, max: 16000, maxSteer: 100, turn: null, send: vi.fn<Parameters<typeof TurnComposer>[0]['send']>(() => false), retry: vi.fn(), resume: vi.fn(), steer: vi.fn(), recoveries: [], consumeRecovery: vi.fn() });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture() {
  let availability = true;
  const reads: object[] = [], writes: object[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/live/model-options') return Response.json(inventory);
    if (path === '/api/rooms') return Response.json({ version: 1, rooms: [room] });
    if (path === '/api/live/routing-defaults/read') { const target = JSON.parse(String(init?.body)); reads.push(target); return Response.json({ target, revision: 3, selection: inference, replayed: false, writesAvailable: availability }); }
    writes.push({ path, init }); throw Error('No synthetic mutation authorized');
  }));
  return { reads, writes, disable: () => { availability = false; } };
}
async function openPicker() {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model for this prompt' })).toBeEnabled());
  const details = document.querySelector('details.inference-control') as HTMLDetailsElement;
  details.open = true; fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Use saved defaults for the next message' })).toBeEnabled());
}
function sendDraft() { fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'SYNTHETIC draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Send message' })); }
it.each([false, true])('passes an explicit defaults envelope, with prompt override=%s kept separate', async override => {
  const f = fixture(), p = props(); render(<TurnComposer {...p} />); await openPicker();
  if (override) fireEvent.change(screen.getByRole('combobox', { name: 'Model for this prompt' }), { target: { value: `${inference.provider}:${inference.model}` } });
  fireEvent.click(screen.getByRole('checkbox')); sendDraft();
  await waitFor(() => expect(p.send).toHaveBeenCalledTimes(1));
  expect(p.send.mock.calls[0]).toEqual([sessionId, 'SYNTHETIC draft', 16000, override ? inference : undefined, [], { mode: 'defaults', projectId: null }]);
  expect(f.reads).toHaveLength(2); expect(f.writes).toHaveLength(0);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft');
});
it('keeps legacy sends unchanged and never migrates a browser prompt choice', async () => {
  const f = fixture(), p = props(); localStorage.setItem(inferencePreferenceKey(sessionId), JSON.stringify(inference));
  render(<TurnComposer {...p} />); await openPicker(); sendDraft();
  await waitFor(() => expect(p.send).toHaveBeenCalledTimes(1)); expect(p.send.mock.calls[0]).toHaveLength(5);
  expect(p.send.mock.calls[0]![3]).toEqual(inference); expect(f.writes).toHaveLength(0);
});
it('fresh false availability blocks opted-in send with the draft kept and no legacy fallback', async () => {
  const f = fixture(), p = props(); render(<TurnComposer {...p} />); await openPicker();
  fireEvent.click(screen.getByRole('checkbox')); f.disable(); sendDraft();
  await screen.findByText('Saved defaults are unavailable. Your draft is kept; no fallback was sent.');
  expect(p.send).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC draft');
  expect(screen.getByRole('checkbox')).toBeChecked(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(p.send).toHaveBeenCalledTimes(1)); expect(p.send.mock.calls[0]).toHaveLength(5);
});
it('uses the exact verified project envelope while preserving existing project input preflight', async () => {
  const f = fixture(), p = props(); render(<TurnComposer {...p} projectId={projectId} project={room} />); await openPicker();
  fireEvent.click(screen.getByRole('checkbox')); sendDraft();
  await waitFor(() => expect(p.send).toHaveBeenCalledTimes(1));
  expect(p.send.mock.calls[0]![5]).toEqual({ mode: 'defaults', projectId });
  expect(p.send.mock.calls[0]![1]).toContain('SYNTHETIC project');
  expect(f.reads).toContainEqual({ scope: 'project', projectId }); expect(f.writes).toHaveLength(0);
});
it.each([409, 503])('retains an immutable same-UUID envelope on %s and retry despite edited caller choices/images', async status => {
  const bodies: object[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/live/runs') { bodies.push(JSON.parse(String(init?.body))); return new Response('', { status }); }
    throw Error('No other operation authorized');
  }));
  const hook = renderHook(() => useLiveTurn(sessionId)); act(() => hook.result.current.history(sessionId, [], true));
  const choice = { ...inference }, routing = { mode: 'defaults' as const, projectId }, images = [{ artifactId: 'art_' + 'c'.repeat(32), version: 1 }];
  act(() => { expect(hook.result.current.send(sessionId, 'SYNTHETIC uncertain draft', 1000, choice, images, undefined, projectId, routing)).toBe(true); });
  await waitFor(() => expect(hook.result.current.turn?.phase).toBe('Admission uncertain — retry the same intent'));
  Object.assign(choice, { model: 'gpt-6-sol', reasoningEffort: 'high' }); routing.projectId = 'room_' + 'd'.repeat(32); images[0]!.version = 2;
  act(() => hook.result.current.retry()); await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual(bodies[0]); expect(bodies[1]).toMatchObject({ routing: { mode: 'defaults', projectId }, images: [{ version: 1 }] });
  expect(hook.result.current.turn?.intent.input).toBe('SYNTHETIC uncertain draft');
  expect(Object.isFrozen(hook.result.current.turn!.intent)).toBe(true);
  const stored = sessionStorage.getItem(threadRecoveryKey)!; expect(stored).not.toContain('SYNTHETIC uncertain draft');
  hook.unmount();
  const reload = renderHook(() => useLiveTurn(sessionId)); await act(async () => { await Promise.resolve(); });
  expect(bodies).toHaveLength(2); expect(reload.result.current.turn?.intent.input).toBeNull();
});
it('refuses mismatched routing/project scope before allocating an identity or posting', () => {
  const f = fixture(); const hook = renderHook(() => useLiveTurn(sessionId)); act(() => hook.result.current.history(sessionId, [], true));
  act(() => expect(hook.result.current.send(sessionId, 'SYNTHETIC', 100, undefined, undefined, undefined, null, { mode: 'defaults', projectId })).toBe(false));
  expect(f.writes).toHaveLength(0); expect(sessionStorage.getItem(threadRecoveryKey)).toBeNull();
});
it.each([null, projectId])('App submits the selected pane with exact routing/project context %s', async context => {
  const { App } = await import('./App');
  const session = { id: sessionId, title: 'SYNTHETIC selected chat', source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-11-09T15:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
  const bootstrap = { identity: { provider: 'development' }, command: { version: 'SYNTHETIC default selector', environment: 'test', generatedAt: '2026-11-09T15:00:00Z', liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session] };
  sessionStorage.setItem('jarvis-command:selected-session:v1', sessionId);
  if (context) sessionStorage.setItem('jarvis-command:project-room:v1', context);
  const bodies: Record<string, unknown>[] = [], unexpected: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/bootstrap') return Response.json(bootstrap);
    if (path === '/api/rooms') return Response.json({ version: 1, rooms: context ? [room] : [] });
    if (path === `/api/live/sessions/${sessionId}`) return Response.json({ session });
    if (path.includes('/messages?')) return Response.json({ sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
    if (path === '/api/live/model-options') return Response.json(inventory);
    if (path === '/api/live/routing-defaults/read') return Response.json({ target: JSON.parse(String(init?.body)), revision: 1, selection: inference, writesAvailable: true, replayed: false });
    if (path === '/api/live/runs') { bodies.push(JSON.parse(String(init?.body))); return new Response('', { status: 503 }); }
    if (init?.method && init.method !== 'GET') unexpected.push(`${init.method} ${path}`);
    return new Response('', { status: 503 });
  }));
  render(<App />); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled());
  await openPicker(); fireEvent.click(screen.getByRole('checkbox', { name: 'Use saved defaults for the next message' }));
  fireEvent.click(document.querySelector('details.inference-control > summary')!);
  sendDraft(); await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ sessionId, routing: { mode: 'defaults', projectId: context } });
  expect(bodies[0]).not.toHaveProperty('inference'); expect(unexpected).toEqual([]);
});
