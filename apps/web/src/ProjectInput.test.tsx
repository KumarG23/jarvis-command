import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnComposer } from './TurnView';
import { composeProjectInput, projectContext } from './projectInput';
import { useLiveTurn } from './useLiveTurn';

const sessionId = 'jc_' + 'a'.repeat(32);
const room = { id: 'room_' + 'b'.repeat(32), name: 'SYNTHETIC project', goal: 'Test context', instructions: 'Keep synthetic data separate.', repository: '/synthetic', notes: ['synthetic.md'], sessionIds: [sessionId], lastSessionId: sessionId };
const base = { allowed: true, imageAttachmentsEnabled: false, sessionId, projectId: room.id, project: room, max: 16000, maxSteer: 4000, turn: null, retry: vi.fn(), resume: vi.fn(), steer: vi.fn(), recoveries: [], consumeRecovery: vi.fn() };
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });
function setup(fresh = room) {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/rooms') return Response.json({ version: 1, rooms: [fresh] });
    if (url === '/api/live/model-options') return Response.json({ default: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, options: [] });
    throw Error('unexpected test request');
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function enter(message: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}
it('counts the complete input, accepts the exact limit and refuses one over without clearing the draft', async () => {
  setup(); const send = vi.fn(() => true);
  const expected = composeProjectInput('hello', room);
  const view = render(<TurnComposer {...base} send={send} max={expected.length - 1} />);
  enter('hello');
  await screen.findByText(/Complete message including project context/);
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('hello');
  view.rerender(<TurnComposer {...base} send={send} max={expected.length} />);
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith(sessionId, expected, expected.length, undefined, []));
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('');
});
it('keeps ordinary chat payload unchanged and does not fetch project metadata', async () => {
  const fetcher = setup(); const send = vi.fn(() => true);
  render(<TurnComposer {...base} projectId={null} project={null} send={send} />);
  enter('ordinary'); await waitFor(() => expect(send).toHaveBeenCalledWith(sessionId, 'ordinary', 16000, undefined, []));
  expect(fetcher.mock.calls.some(([url]) => url === '/api/rooms')).toBe(false);
});
it('refuses stale context and shows authoritative readback for explicit review', async () => {
  const changed = { ...room, instructions: 'New saved instructions' }; setup(changed);
  const send = vi.fn(), onProjectReadback = vi.fn();
  const view = render(<TurnComposer {...base} send={send} onProjectReadback={onProjectReadback} />);
  enter('keep draft'); await screen.findByText(/Saved project context changed/);
  expect(send).not.toHaveBeenCalled(); expect(onProjectReadback).toHaveBeenCalledWith(changed);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('keep draft');
  view.rerender(<TurnComposer {...base} project={changed} send={send} />);
  expect(view.container.querySelector('.project-input-preview pre')?.textContent).toBe(projectContext(changed));
});
it.each(['archived', 'membership', 'missing', 'failure'])('keeps drafts and refuses %s project readback', async mode => {
  setup();
  const fetcher = vi.fn(async (url: string) => {
    if (url !== '/api/rooms') return Response.json({ default: { provider: 'openai-codex', model: 'test' }, options: [] });
    if (mode === 'failure') throw Error('Readback unavailable');
    return Response.json({ version: 1, rooms: mode === 'missing' ? [] : [{ ...room, archived: mode === 'archived', sessionIds: mode === 'membership' ? [] : room.sessionIds, lastSessionId: mode === 'membership' ? null : sessionId }] });
  });
  vi.stubGlobal('fetch', fetcher); const send = vi.fn();
  render(<TurnComposer {...base} send={send} />); enter('retained');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
  expect(send).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('retained');
});
it('invalidates pending readback when the project changes even within the same chat', async () => {
  let resolve!: (value: Response) => void;
  setup(); vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/rooms' ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(Response.json({ default: { provider: 'openai-codex', model: 'test' }, options: [] }))));
  const send = vi.fn(); const view = render(<TurnComposer {...base} send={send} />); enter('original draft');
  view.rerender(<TurnComposer {...base} projectId={'room_' + 'c'.repeat(32)} project={{ ...room, id: 'room_' + 'c'.repeat(32) }} send={send} />);
  await act(async () => resolve(Response.json({ version: 1, rooms: [room] })));
  expect(send).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('original draft');
});
it('retries exactly the captured composed intent after a lost ACK without reading or appending newer context', async () => {
  const payloads: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { payloads.push(String(init?.body)); throw Error('lost ACK'); }));
  const hook = renderHook(useLiveTurn);
  act(() => hook.result.current.history(sessionId, [], true));
  const input = composeProjectInput('Original message', room);
  act(() => { expect(hook.result.current.send(sessionId, input, 16000, undefined, undefined, undefined, room.id)).toBe(true); });
  await waitFor(() => expect(hook.result.current.turn?.phase).toMatch(/Admission uncertain/));
  const changed = { ...room, instructions: 'Changed after admission', name: 'Different' };
  expect(composeProjectInput('Original message', changed)).not.toEqual(input);
  act(() => hook.result.current.retry());
  await waitFor(() => expect(payloads).toHaveLength(2));
  expect(payloads[1]).toBe(payloads[0]);
  expect(JSON.parse(payloads[1]!).input).toBe(input);
  expect(input.match(/\[Project context/g)).toHaveLength(1);
});
it('retains the original opaque project identity during read-only lost-ACK reload recovery', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111', runId = 'jcr_' + 'd'.repeat(32);
  sessionStorage.setItem('jarvis-command:live-turn', JSON.stringify({ sessionId, clientRequestId: requestId, publicRunId: null, projectId: room.id }));
  const fetcher = vi.fn(async (url: string) => url.includes('run-requests')
    ? Response.json({ sessionId, clientRequestId: requestId, publicRunId: runId })
    : Response.json({ sessionId, publicRunId: runId, status: 'running', updatedAt: '2026-10-28T12:00:00Z', approval: null, output: null, error: null, pendingSteer: null, usage: null }));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('EventSource', class { addEventListener() {} close() {} });
  const hook = renderHook(useLiveTurn);
  await waitFor(() => expect(hook.result.current.turn?.identityVerified).toBe(true));
  expect(hook.result.current.turn?.projectId).toBe(room.id);
  expect(hook.result.current.turn?.intent.input).toBeNull();
  expect(JSON.parse(sessionStorage.getItem('jarvis-command:live-turn')!)).toEqual({ sessionId, clientRequestId: requestId, publicRunId: runId, projectId: room.id });
  expect(fetcher.mock.calls.every(([, ...init]) => init.length === 0 || !JSON.stringify(init).includes('POST'))).toBe(true);
});
