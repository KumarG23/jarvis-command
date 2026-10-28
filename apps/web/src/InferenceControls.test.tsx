import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnComposer, TurnView } from './TurnView';
import { inferencePreferenceKey } from './inferencePreference';
import type { Turn } from './useLiveTurn';

const inventory = {
  default: { provider: 'openai-codex', model: 'gpt-6-sol' },
  options: [
    { provider: 'openai-codex', model: 'gpt-6-sol', label: 'Sol', reasoningEfforts: ['medium', 'xhigh'] },
    { provider: 'openai-codex', model: 'gpt-6-luna', label: 'Luna', reasoningEfforts: ['minimal', 'low', 'medium'] },
  ],
};
const model = () => screen.getByRole('combobox', { name: 'Model for this prompt' });
const effort = () => screen.getByRole('combobox', { name: 'Reasoning for this prompt' });
const props = () => ({ allowed: true, imageAttachmentsEnabled: false, sessionId: 'jc_one', projectId: null, max: 100, maxSteer: 100, turn: null, send: vi.fn<Parameters<typeof TurnComposer>[0]['send']>(() => false), retry: vi.fn(), resume: vi.fn(), steer: vi.fn(), recoveries: [], consumeRecovery: vi.fn() });
afterEach(() => { localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() { const fetch = vi.fn(async () => Response.json(inventory)); vi.stubGlobal('fetch', fetch); return fetch; }
async function ready() { await waitFor(() => expect(model()).toBeEnabled()); }
async function chooseSol() { await ready(); fireEvent.change(model(), { target: { value: 'openai-codex:gpt-6-sol' } }); fireEvent.change(effort(), { target: { value: 'xhigh' } }); }
function send() { fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Keep draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Send message' })); }

it('reconciles Sol xhigh to an offered Luna effort and freshly validates before one send', async () => {
  const fetch = setup(); const p = props(); render(<TurnComposer {...p} />); await chooseSol();
  fireEvent.change(model(), { target: { value: 'openai-codex:gpt-6-luna' } });
  expect(effort()).toHaveValue('medium');
  send(); fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(p.send).toHaveBeenCalledTimes(1));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(p.send.mock.calls[0]).toEqual(['jc_one', 'Keep draft', 100, { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'medium' }, []]);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Keep draft');
});

it('keeps per-chat choices across switch and remount with new chats inheriting', async () => {
  setup(); const p = props(); const view = render(<TurnComposer {...p} />); await chooseSol();
  view.rerender(<TurnComposer {...p} sessionId="jc_two" />); expect(model()).toHaveValue('inherit');
  fireEvent.change(model(), { target: { value: 'openai-codex:gpt-6-luna' } });
  view.rerender(<TurnComposer {...p} />); expect(model()).toHaveValue('openai-codex:gpt-6-sol'); expect(effort()).toHaveValue('xhigh');
  view.unmount(); render(<TurnComposer {...p} />); await ready(); expect(model()).toHaveValue('openai-codex:gpt-6-sol'); expect(effort()).toHaveValue('xhigh');
});

it.each(['removed', 'effort removed', 'invalid', 'rejected'])('blocks fresh %s inventory without losing draft or admitting; explicit Inherit remains possible', async kind => {
  const fetch = setup(); const p = props(); render(<TurnComposer {...p} />); await chooseSol();
  fetch.mockImplementationOnce(async () => {
    if (kind === 'rejected') throw Error('offline');
    return Response.json(kind === 'invalid' ? {} : { ...inventory, options: kind === 'removed' ? [inventory.options[1]] : [{ ...inventory.options[0], reasoningEfforts: ['medium'] }] });
  });
  send(); await screen.findByText(/unavailable|unsupported/i, { selector: '[role="status"]' });
  expect(p.send).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Keep draft');
  fireEvent.change(model(), { target: { value: 'inherit' } }); fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(p.send).toHaveBeenCalledTimes(1)); expect(p.send.mock.calls[0]?.[3]).toBeUndefined();
});

it('does not turn missing executed fields or exact=false into a mismatch', () => {
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, execution: { requested: { provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'medium' }, executed: { provider: null, model: null, reasoningEffort: null, reasoningEffortSource: 'unknown' }, exact: false, fallbackUsed: false, routeSource: 'unknown' } };
  const turn = { intent: { sessionId: 'jc_one', input: null, clientRequestId: 'test' }, publicRunId: 'test', phase: 'Run completed', done: true, events: [], usage } as unknown as Turn;
  render(<TurnView turn={turn} allowed={false} approve={vi.fn()} stop={vi.fn()} />);
  expect(screen.queryByText(/Route changed|Requested route changed/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/Route verification unavailable/).length).toBeGreaterThan(0);
});

it('shows supplied counters without optional execution metadata', () => {
  const turn = { intent: { sessionId: 'jc_one', input: null, clientRequestId: 'test' }, publicRunId: 'test', phase: 'Run completed', done: true, events: [], usage: { inputTokens: 0, outputTokens: 2, totalTokens: 2 } } as unknown as Turn;
  render(<TurnView turn={turn} allowed={false} approve={vi.fn()} stop={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Execution receipt' })).toHaveTextContent('2 tokens · 0 in / 2 out');
  expect(screen.getByText('Executed route unavailable')).toBeInTheDocument();
});


it.each(['corrupt', 'stale', 'blocked read'])('requires an explicit choice for %s storage and never silently inherits', async kind => {
  setup();
  if (kind === 'blocked read') {
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (this === localStorage) throw Error('blocked');
      return getItem.call(this, key);
    });
  }
  else localStorage.setItem(inferencePreferenceKey('jc_one'), kind === 'corrupt' ? '{broken' : JSON.stringify({ provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'low' }));
  const p = props(); render(<TurnComposer {...p} />); await ready(); send();
  expect(p.send).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Keep draft');
  fireEvent.change(model(), { target: { value: 'inherit' } }); fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(p.send).toHaveBeenCalledTimes(1)); expect(p.send.mock.calls[0]?.[3]).toBeUndefined();
});

it('retains in-tab session isolation with blocked storage writes and explains reload limits', async () => {
  setup(); const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage) throw Error('quota');
    return setItem.call(this, key, value);
  });
  const p = props(); const view = render(<TurnComposer {...p} />); await chooseSol();
  expect(screen.getByText(/Local preference storage unavailable/)).toBeInTheDocument();
  view.rerender(<TurnComposer {...p} sessionId="jc_two" />); expect(model()).toHaveValue('inherit');
  view.rerender(<TurnComposer {...p} />); expect(effort()).toHaveValue('xhigh');
  send(); await waitFor(() => expect(p.send).toHaveBeenCalledTimes(1));
});

it('offers one explicit bounded retry after invalid inventory; never retries or sends automatically', async () => {
  const fetch = setup(); fetch.mockResolvedValueOnce(Response.json({})); const p = props(); render(<TurnComposer {...p} />);
  await screen.findByText(/Model choices unavailable/); expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry model choices' }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'Sol' })).toBeInTheDocument());
  expect(fetch).toHaveBeenCalledTimes(2); expect(p.send).not.toHaveBeenCalled();
});

it('does not send after changing chats during a pending preflight, even when switching back', async () => {
  const fetch = setup(); const p = props(); const view = render(<TurnComposer {...p} />); await chooseSol();
  let resolve!: (response: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  send(); view.rerender(<TurnComposer {...p} sessionId="jc_two" />); view.rerender(<TurnComposer {...p} />);
  await act(async () => resolve(Response.json(inventory)));
  expect(p.send).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Keep draft');
});

it.each([
  ['Exact route', true, false, 'gpt-6-sol'],
  ['Route verification unavailable', false, false, 'gpt-6-sol'],
  ['Route changed', false, false, 'gpt-6-luna'],
  ['Fallback used', false, true, 'gpt-6-luna'],
])('renders %s consistently in current run receipt and inspector', (decision, exact, fallbackUsed, model) => {
  const route = { provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'medium' };
  const turn = { intent: { sessionId: 'jc_one', input: null, clientRequestId: 'test' }, publicRunId: 'test', phase: 'Run completed', done: true, events: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, apiCalls: 0, execution: { requested: route, executed: { ...route, model, reasoningEffortSource: 'wire' }, exact, fallbackUsed, routeSource: 'unknown' } } } as unknown as Turn;
  render(<TurnView turn={turn} allowed={false} approve={vi.fn()} stop={vi.fn()} />);
  fireEvent.click(screen.getByText('Activity / Usage'));
  expect(screen.getByRole('region', { name: 'Run inspector' })).toHaveTextContent(decision);
  expect(screen.getByRole('region', { name: 'Execution receipt' })).toHaveTextContent(decision === 'Route changed' ? 'Requested route changed' : decision);
  expect(screen.getByRole('region', { name: 'Execution receipt' })).toHaveTextContent('0 reasoning · 0 cache read · Cache write —');
});

it('times out unavailable inventory and enables explicit retry rather than staying busy', async () => {
  vi.useFakeTimers(); const fetch = setup(); fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
  render(<TurnComposer {...props()} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(screen.getByRole('button', { name: 'Retry model choices' })).toBeEnabled();
  expect(screen.getByText(/Model choices unavailable/)).toBeInTheDocument();
  vi.useRealTimers(); fireEvent.click(screen.getByRole('button', { name: 'Retry model choices' })); await ready();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('times out a fresh send preflight without admitting, losing the draft, or auto retrying', async () => {
  const fetch = setup(); const p = props(); render(<TurnComposer {...p} />); await chooseSol();
  vi.useFakeTimers(); fetch.mockImplementationOnce(() => new Promise<Response>(() => {})); send();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(p.send).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Keep draft');
  expect(screen.getByRole('button', { name: 'Retry model choices' })).toBeEnabled(); vi.useRealTimers();
});

it('uses a separate application environment namespace for preferences', async () => {
  setup(); const productionKey = inferencePreferenceKey('jc_one');
  localStorage.setItem(productionKey, JSON.stringify({ provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'xhigh' }));
  window.history.replaceState(null, '', '/api/preview/issue22/');
  try {
    expect(inferencePreferenceKey('jc_one')).not.toBe(productionKey);
    render(<TurnComposer {...props()} />); await ready(); expect(model()).toHaveValue('inherit');
    fireEvent.change(model(), { target: { value: 'openai-codex:gpt-6-luna' } });
    expect(JSON.parse(localStorage.getItem(productionKey)!)).toMatchObject({ model: 'gpt-6-sol', reasoningEffort: 'xhigh' });
  } finally { window.history.replaceState(null, '', '/'); }
});

it('preserves a recovery edit made while a fresh preflight is pending', async () => {
  const fetch = setup(); const p = props(); const recovery = { intent: { sessionId: 'jc_one', clientRequestId: 'test', input: 'Recovered draft' }, input: 'Recovered draft', kind: 'uncertain' as const };
  render(<TurnComposer {...p} recoveries={[recovery]} />); await chooseSol();
  let resolve!: (response: Response) => void; fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  send(); fireEvent.click(screen.getByRole('button', { name: 'Append to draft' }));
  await act(async () => resolve(Response.json(inventory)));
  expect(p.send).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Keep draft\nRecovered draft');
});
