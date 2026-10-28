import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveRoom } from './LiveRoom';
import type { LiveRunUsage } from '@jarvis-command/contracts';

// Sanitized values from #2's completed fixture; no admission/replay.
const session = { id: 'jc_300d0e2efc094ab38ebc2398d13e5114', title: 'Receipt regression fixture', source: 'api_server', ownership: 'command' as const, model: null, lastActive: '2026-10-25T14:34:10Z', messageCount: 9, toolCallCount: 0, pinned: false };
const usage: LiveRunUsage = {
  inputTokens: 25249, outputTokens: 13, totalTokens: 25262,
  reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  apiCalls: 1, providerLatencyMs: 2340, endToEndLatencyMs: 2392, outputTokensPerSecond: 5.56,
  context: { usedTokens: 25249, limitTokens: 500000, source: 'hermes_effective' },
  execution: {
    requested: { provider: null, model: null, reasoningEffort: null },
    executed: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium', reasoningEffortSource: 'wire' },
    routeSource: 'unknown', exact: false, fallbackUsed: false,
  },
};
afterEach(() => vi.unstubAllGlobals());
function mockReads(receipt: LiveRunUsage | null = usage, receiptSession = session.id) {
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes('/messages?') ? {
    sessionId: session.id,
    messages: [{ id: 'fixture:reply', sessionId: session.id, role: 'assistant', content: 'M0-RECEIPT-OK', timestamp: session.lastActive, toolName: null, displayKind: null }],
    pagination: { limit: 50, offset: 0, returned: 1, hasMore: false },
  } : { sessionId: receiptSession, state: receipt ? 'available' : 'unavailable', updatedAt: null, receipt }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
it('retains the authoritative session receipt after selecting history and remounting, with one saved reply and GETs only', async () => {
  const fetcher = mockReads();
  for (let reload = 0; reload < 2; reload++) {
    const view = render(<LiveRoom session={session} onHistory={vi.fn()} />);
    const receipt = await screen.findByRole('region', { name: 'Execution receipt' });
    expect(within(receipt).getByText(/25,262 tokens · 25,249 in \/ 13 out/)).toBeInTheDocument();
    expect(receipt).toHaveTextContent('gpt-6.1-sol · medium · OpenAI');
    expect(receipt).toHaveTextContent('0 reasoning · 0 cache read · 0 cache write');
    expect(receipt).toHaveTextContent('25,249 / 500,000');
    expect(receipt).not.toHaveTextContent('Exact route');
    expect(receipt).not.toHaveTextContent('Requested route changed');
    expect(screen.getByLabelText('Saved session receipt')).toHaveTextContent('Individual message association unavailable');
    expect(screen.getAllByRole('article', { name: 'Jarvis response' })).toHaveLength(1);
    view.unmount();
  }
  expect(fetcher).toHaveBeenCalledTimes(4);
  for (const [, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) expect(init.method ?? 'GET').toBe('GET');
});
it('keeps unknown counters unavailable while retaining supplied zero counters', async () => {
  mockReads({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0 });
  render(<LiveRoom session={session} onHistory={vi.fn()} />);
  const receipt = await screen.findByRole('region', { name: 'Execution receipt' });
  expect(receipt).toHaveTextContent('0 tokens · 0 in / 0 out');
  expect(receipt).toHaveTextContent('Reasoning — · 0 cache read · Cache write —');
  expect(receipt).toHaveTextContent('Executed route unavailable');
  expect(receipt).toHaveTextContent('Context usage unavailable');
});
it.each(['missing', 'wrong-session', 'denied'])('does not invent or leak a receipt when %s', async mode => {
  const fetcher = mockReads(mode === 'missing' ? null : usage, mode === 'wrong-session' ? 'jc_other' : session.id);
  if (mode === 'denied') {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes('/context') ? new Response('', { status: 403 }) : original(url));
  }
  render(<LiveRoom session={session} onHistory={vi.fn()} />);
  await waitFor(() => expect(screen.queryByText('Loading messages…')).not.toBeInTheDocument());
  await screen.findByText('Saved receipt unavailable');
  expect(screen.queryByRole('region', { name: 'Execution receipt' })).not.toBeInTheDocument();
});

it('keeps the live-turn receipt as the only receipt when it already owns usage', async () => {
  const { TurnView } = await import('./TurnView');
  const fetcher = mockReads();
  const turn = {
    intent: { sessionId: session.id, clientRequestId: 'receipt-regression', input: null },
    publicRunId: 'jcr_5c9c5f6e4d89969471684e5b28380bc0',
    phase: 'Run completed', done: true, output: 'M0-RECEIPT-OK', outputLimited: false,
    historyMatched: true, identityVerified: true, approval: null, events: [], usage,
  };
  render(<LiveRoom session={session} onHistory={vi.fn()} turns={[turn]} renderTurn={value => <TurnView turn={value} allowed={false} approve={vi.fn()} stop={vi.fn()} />} />);
  await screen.findByText('M0-RECEIPT-OK');
  expect(screen.getAllByRole('region', { name: 'Execution receipt' })).toHaveLength(1);
  expect(screen.queryByLabelText('Saved session receipt')).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
