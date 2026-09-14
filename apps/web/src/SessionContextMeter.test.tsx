import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionContextMeter } from './SessionContextMeter';

const receipt = {
  inputTokens: 120,
  outputTokens: 40,
  totalTokens: 160,
  context: { usedTokens: 96_000, limitTokens: 128_000, source: 'hermes_effective' as const },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SessionContextMeter', () => {
  it('renders the latest durable Hermes context with warning thresholds', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      sessionId: 'jc_context',
      state: 'available',
      updatedAt: '2026-09-14T20:00:00.000Z',
      receipt,
    }));
    vi.stubGlobal('fetch', fetcher);

    render(<SessionContextMeter enabled sessionId="jc_context" liveUsage={null} />);

    const progress = await screen.findByRole('progressbar', { name: 'Context usage' });
    expect(progress).toHaveAttribute('aria-valuenow', '75');
    expect(progress.closest('.session-context')).toHaveClass('warning');
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith('/api/live/sessions/jc_context/context', expect.objectContaining({ cache: 'no-store' }));
  });

  it('immediately prefers a newer live authoritative receipt and marks critical occupancy', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const live = {
      ...receipt,
      context: { usedTokens: 116_000, limitTokens: 128_000, source: 'hermes_effective' as const },
    };

    render(<SessionContextMeter
      enabled
      sessionId="jc_context"
      liveUsage={live}
      compaction={{
        state: 'running',
        startedAt: '2026-09-14T20:00:00.000Z',
        updatedAt: '2026-09-14T20:00:01.000Z',
      }}
    />);

    const progress = await screen.findByRole('progressbar', { name: 'Context usage' });
    expect(progress).toHaveAttribute('aria-valuenow', '91');
    expect(progress.closest('.session-context')).toHaveClass('critical', 'compacting');
    expect(screen.getByText('Compacting')).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports unavailable data without inventing a percentage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      sessionId: 'jc_context', state: 'unavailable', updatedAt: null, receipt: null,
    })));

    render(<SessionContextMeter enabled sessionId="jc_context" liveUsage={null} />);

    await waitFor(() => expect(screen.getByLabelText('Context usage unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
