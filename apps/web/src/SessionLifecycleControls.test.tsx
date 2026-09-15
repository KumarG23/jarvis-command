import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionLifecycleControls } from './SessionLifecycleControls';

const session = {
  id: 'jc_1234567890abcdef1234567890abcdef',
  title: 'Lifecycle room',
  source: 'api_server',
  ownership: 'command' as const,
  model: 'gpt-5.6-sol',
  lastActive: '2026-09-14T23:00:00.000Z',
  messageCount: 12,
  toolCallCount: 1,
  pinned: false,
};
const operationId = 'jcr_1234567890abcdef1234567890abcdef';
const clientRequestId = 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('SessionLifecycleControls', () => {
  it('renders no mutation controls when Hermes does not advertise them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      sessionForkPreservesSource: false,
      sessionCompactionRuns: false,
    })));
    render(<SessionLifecycleControls enabled session={session} blocked={false} onSession={vi.fn()} onCompacted={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Compact context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fork chat' })).not.toBeInTheDocument();
  });

  it('forks without replacing the source and returns the verified child', async () => {
    const child = { ...session, id: 'jc_abcdef1234567890abcdef1234567890', title: 'Lifecycle room · Fork' };
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/live/session-controls') return Promise.resolve(Response.json({ sessionForkPreservesSource: true, sessionCompactionRuns: false }));
      if (path.endsWith('/continue')) return Promise.resolve(Response.json({ session: child }, { status: 201 }));
      throw Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const onSession = vi.fn().mockResolvedValue(undefined);
    render(<SessionLifecycleControls enabled session={session} blocked={false} onSession={onSession} onCompacted={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Fork chat' }));
    await waitFor(() => expect(onSession).toHaveBeenCalledWith(child));
    expect(fetcher).toHaveBeenCalledWith(
      `/api/live/sessions/${session.id}/continue`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'Lifecycle room · Fork' }) }),
    );
  });

  it('admits a durable compact operation, polls its result, and reports measured reduction', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => clientRequestId });
    const completed = {
      publicOperationId: operationId,
      sessionId: session.id,
      status: 'completed',
      updatedAt: '2026-09-14T23:00:03.000Z',
      compaction: { state: 'completed', startedAt: '2026-09-14T23:00:01.000Z', updatedAt: '2026-09-14T23:00:03.000Z' },
      result: {
        outcome: 'compacted', sourceSessionId: session.id, resultSessionId: session.id,
        beforeTokens: 96_000, afterTokens: 18_000, beforeMessages: 120, afterMessages: 24, inPlace: true,
      },
      error: null,
    };
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/live/session-controls') return Promise.resolve(Response.json({ sessionForkPreservesSource: true, sessionCompactionRuns: true }));
      if (path === '/api/live/context-compactions') return Promise.resolve(Response.json({ publicOperationId: operationId, sessionId: session.id, status: 'queued', replayed: false, clientRequestId }, { status: 202 }));
      if (path === `/api/live/context-compactions/${operationId}`) return Promise.resolve(Response.json(completed));
      throw Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const onCompacted = vi.fn();
    const view = render(<SessionLifecycleControls enabled session={session} blocked={false} onSession={vi.fn()} onCompacted={onCompacted} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Compact context' }));
    expect(await screen.findByText('Compacted 96,000 → 18,000 tokens.')).toBeInTheDocument();
    expect(onCompacted).toHaveBeenCalledWith(completed);
    expect(localStorage.length).toBe(1);
    view.unmount();
    const reverified = vi.fn();
    render(<SessionLifecycleControls enabled session={session} blocked={false} onSession={vi.fn()} onCompacted={reverified} />);
    await waitFor(() => expect(reverified).toHaveBeenCalledWith(completed));
  });
});
