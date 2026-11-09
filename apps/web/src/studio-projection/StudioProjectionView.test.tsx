import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import golden from './fixtures/golden.projection.json?raw';
import { StudioProjectionView } from './StudioProjectionView';
import { fixtureSource } from './studioProjectionSource';
import type { ProjectionReadResult } from './studioProjectionSource';

// Synthetic only: every source here is an in-memory fixture; nothing reaches a network, Studio or GitHub.
const OBSERVED = Date.parse('2026-11-09T15:00:00Z');
const at = (seconds: number) => () => OBSERVED + seconds * 1000;
const ok = (body: string = golden): ProjectionReadResult => ({ status: 200, body });
const source = (respond: (signal: AbortSignal) => Promise<ProjectionReadResult> | ProjectionReadResult) => {
  const read = vi.fn(respond);
  return Object.assign(fixtureSource('SYNTHETIC test fixture (not Studio data)', read), { read });
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('disabled and inactive', () => {
  it('stays disabled with no transport and issues no read', () => {
    render(<StudioProjectionView source={null} active now={at(5)} />);
    expect(screen.getByText(/Live team status is not connected in this build/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
    expect(screen.queryByText(/Source:/)).toBeNull();
  });

  it('does not read while hidden, reads once on activation, and cancels when hidden again', async () => {
    let signal: AbortSignal | undefined;
    const s = source((sig) => { signal = sig; return new Promise<ProjectionReadResult>(() => undefined); });
    const view = render(<StudioProjectionView source={s} active={false} now={at(5)} />);
    expect(s.read).not.toHaveBeenCalled();
    view.rerender(<StudioProjectionView source={s} active now={at(5)} />);
    expect(s.read).toHaveBeenCalledTimes(1);
    view.rerender(<StudioProjectionView source={s} active={false} now={at(5)} />);
    expect(signal?.aborted).toBe(true);
    expect(s.read).toHaveBeenCalledTimes(1);
  });

  it('polls only while active and the document is visible, never overlapping reads', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    let release: (r: ProjectionReadResult) => void = () => undefined;
    const s = source(() => new Promise<ProjectionReadResult>((resolve) => { release = resolve; }));
    const view = render(<StudioProjectionView source={s} active refreshMs={30_000} now={at(5)} />);
    expect(s.read).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(s.read).toHaveBeenCalledTimes(1); // first read still in flight: no overlap
    await act(async () => { release(ok()); });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(s.read).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(s.read).toHaveBeenCalledTimes(2);
    view.rerender(<StudioProjectionView source={s} active={false} refreshMs={30_000} now={at(5)} />);
    await act(async () => { vi.advanceTimersByTime(300_000); });
    expect(s.read).toHaveBeenCalledTimes(2);
  });
});

describe('snapshot rendering', () => {
  const open = async () => {
    const user = userEvent.setup();
    render(<StudioProjectionView source={source(() => ok())} active now={at(30)} />);
    await screen.findByText('Jarvis Command');
    return user;
  };

  it('labels the fixture source and calls the snapshot current-but-not-live', async () => {
    await open();
    expect(screen.getByText(/Source: SYNTHETIC test fixture/)).toBeVisible();
    const banner = document.querySelector('[data-state="current"]')!;
    expect(banner).toHaveTextContent('Snapshot observed 30s ago');
    expect(banner).toHaveTextContent('not a live feed');
  });

  it('shows the five stages, never a zero for unknown totals, and the partial coverage', async () => {
    await open();
    const tiles = within(screen.getByRole('list', { name: 'Work by stage across projects' }));
    for (const label of ['Needs attention', 'Building', 'Checking', 'Review', 'Ready to test']) expect(tiles.getByText(label)).toBeVisible();
    expect(tiles.getAllByText('Unknown')).toHaveLength(5);
    expect(screen.getByText(/Counts cover 2 of 3 projects/, { selector: 'p' })).toBeVisible();
    expect(document.querySelector('[data-state="partial"]')).toHaveTextContent('Partial snapshot');
    expect(screen.getByText('GitHub unavailable: work counts unknown')).toBeVisible();
    expect(screen.getByText('Emberbound')).toBeVisible();
  });

  it('never invents a percentage and keeps progress qualifiers', async () => {
    await open();
    expect(document.body.textContent).not.toMatch(/\d\s*%/);
    expect(screen.getByText(/Plan checklist: 1 of 3 items done \(MASTER_PLAN\.md\)/)).toBeVisible();
    expect(screen.getByText(/plan-reported milestone statuses; no completion is inferred/)).toBeVisible();
    expect(screen.getByText(/Progress unknown: plan source unavailable/)).toBeVisible();
  });

  it('drills overview → project → work detail with separate evidence and unknown executed route', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Jarvis Command/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Jarvis Command' })).toHaveFocus();
    for (const label of ['Needs attention', 'Building', 'Checking', 'Review', 'Ready to test']) expect(screen.getByRole('heading', { level: 3, name: new RegExp(label) })).toBeVisible();
    expect(screen.getByText(/process presence, not progress/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /#1 SYNTHETIC running worker/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'SYNTHETIC running worker' })).toHaveFocus();
    expect(screen.getByText(/configured model claude-sonnet-5-5/)).toBeVisible();
    expect(screen.getByText('Executed route: unknown.')).toBeVisible();
    expect(screen.getByText(/Process presence is not progress/)).toBeVisible();
    for (const label of ['Checks', 'Review', 'Merged', 'Scheduler release', 'Ready to test']) expect(screen.getByText(label, { selector: 'dt' })).toBeVisible();
  });

  it('shows blocker reason, owner, next action and qualified dependency links', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Jarvis Command/ }));
    await user.click(screen.getByRole('button', { name: /#6 SYNTHETIC blocked on dependency/ }));
    const blocker = within(screen.getByRole('region', { name: 'Blocker' }));
    expect(blocker.getByText('Provider usage limit reached')).toBeVisible();
    expect(blocker.getByText('Neal')).toBeVisible();
    expect(blocker.getByText('Wait for pool reset or lead reassigns')).toBeVisible();
    expect(blocker.getByRole('link', { name: 'Example/studio-synth#9' })).toHaveAttribute('href', 'https://github.com/Example/studio-synth/issues/9');
  });

  it('keeps merged, scheduler release and ready-to-test evidence apart', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Dev Studio/ }));
    expect(screen.getByText(/Scheduler release 1234567890ab/)).toBeVisible();
    expect(screen.getAllByText(/A merge alone does not show release or deployment/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Merged is not released|not yet released/);
    expect(screen.getByText(/In the live scheduler release 1234567890ab/)).toBeVisible();
    expect(screen.getByText(/Plan-reported status/)).toBeVisible();
    expect(screen.getByText('live unavailable; phone check pending')).toBeVisible();
    expect(screen.getByText(/Dispatch/, { selector: 'dt' }).nextElementSibling).toHaveTextContent('Paused (transient)');
  });

  it('only renders allowlisted https GitHub links with safe rel', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Jarvis Command/ }));
    await user.click(screen.getByRole('button', { name: /#2 SYNTHETIC failing checks/ }));
    const anchors = [...document.querySelectorAll('a')];
    expect(anchors.length).toBeGreaterThan(2);
    for (const a of anchors) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\/github\.com\//);
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
      expect(a).toHaveAttribute('target', '_blank');
    }
  });

  it('keyboard: Escape and Back climb one level and return focus to the opener', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Jarvis Command/ }));
    await user.click(screen.getByRole('button', { name: /#3 SYNTHETIC checks pending/ }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /#3 SYNTHETIC checks pending/ })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'All projects' }));
    expect(screen.getByRole('button', { name: /Jarvis Command/ })).toHaveFocus();
  });
});

describe('freshness and failure states', () => {
  it('marks old snapshots stale and aging, and flags a future timestamp', async () => {
    const stale = render(<StudioProjectionView source={source(() => ok())} active now={at(2 * 86_400)} />);
    await screen.findByText('Jarvis Command');
    expect(document.querySelector('[data-state="stale"]')).toHaveTextContent('Stale. Snapshot observed 2d ago');
    stale.unmount();
    const aging = render(<StudioProjectionView source={source(() => ok())} active now={at(600)} />);
    await screen.findByText('Jarvis Command');
    expect(document.querySelector('[data-state="aging"]')).toHaveTextContent('newer data may exist');
    aging.unmount();
    render(<StudioProjectionView source={source(() => ok())} active now={at(-3600)} />);
    await screen.findByText('Jarvis Command');
    expect(document.querySelector('[data-state="clock_mismatch"]')).toHaveTextContent('age is unknown');
  });

  it('shows no data when unreachable with nothing earlier', async () => {
    render(<StudioProjectionView source={source(() => Promise.reject(new Error('socket closed')))} active now={at(5)} />);
    expect(await screen.findByText('Studio is unreachable.')).toBeVisible();
    expect(screen.queryByText('Jarvis Command')).toBeNull();
    expect(document.body.textContent).not.toMatch(/socket closed/);
  });

  it.each([
    ['unsupported version', JSON.stringify({ ...JSON.parse(golden), version: 2 }), 'Studio projection version is not supported.'],
    ['malformed', JSON.stringify({ ...JSON.parse(golden), surprise: true }), 'Studio data was rejected as untrustworthy.'],
    ['not JSON', '<html>sign in</html>', 'Studio sent a response this client cannot read.'],
    ['oversized', 'x'.repeat(5 * 1024 * 1024), 'Studio response was too large and was rejected.'],
  ])('rejects %s and displays no Studio data', async (_name, body, title) => {
    render(<StudioProjectionView source={source(() => ok(body))} active now={at(5)} />);
    expect(await screen.findByText(title)).toBeVisible();
    expect(screen.queryByText('Jarvis Command')).toBeNull();
    expect(screen.getByText(/No data is shown/)).toBeVisible();
  });

  it('treats non-200/503 statuses as errors', async () => {
    render(<StudioProjectionView source={source(() => ({ status: 302, body: golden }))} active now={at(5)} />);
    expect(await screen.findByText('Studio returned an error.')).toBeVisible();
    expect(screen.queryByText('Jarvis Command')).toBeNull();
  });

  it('keeps a last known snapshot, loudly not current, when a refresh fails', async () => {
    let fail = false;
    const s = source(() => (fail ? Promise.reject(new Error('down')) : ok()));
    render(<StudioProjectionView source={s} active now={at(90)} />);
    await screen.findByText('Jarvis Command');
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const banner = await waitFor(() => { const el = document.querySelector('[data-state="last-known"]'); expect(el).not.toBeNull(); return el!; });
    expect(banner).toHaveTextContent('Studio is unreachable.');
    expect(banner).toHaveTextContent('not current');
    expect(screen.getByText('Last known data')).toBeVisible();
    expect(screen.getByText('Jarvis Command')).toBeVisible();
  });

  it('a later good read clears the failure', async () => {
    let fail = true;
    const s = source(() => (fail ? Promise.reject(new Error('down')) : ok()));
    render(<StudioProjectionView source={s} active now={at(5)} />);
    await screen.findByText('Studio is unreachable.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Jarvis Command');
    expect(document.querySelector('[data-state="failed"]')).toBeNull();
  });

  it('accepts a 503 that still carries a valid partial document', async () => {
    render(<StudioProjectionView source={source(() => ({ status: 503, body: golden }))} active now={at(5)} />);
    expect(await screen.findByText('Jarvis Command')).toBeVisible();
    expect(document.querySelector('[data-state="partial"]')).not.toBeNull();
  });
});

describe('source lifecycle', () => {
  it('shows no data after the source is removed, and none under a replacement source until it reads', async () => {
    const first = source(() => ok());
    const view = render(<StudioProjectionView source={first} active now={at(5)} />);
    await screen.findByText('Jarvis Command');
    view.rerender(<StudioProjectionView source={null} active now={at(5)} />);
    expect(screen.queryByText('Jarvis Command')).toBeNull();
    expect(screen.getByText(/Live team status is not connected in this build/)).toBeVisible();
    view.rerender(<StudioProjectionView source={first} active now={at(5)} />);
    await screen.findByText('Jarvis Command');
    const slow = Object.assign(fixtureSource('SYNTHETIC second fixture', () => new Promise<ProjectionReadResult>(() => undefined)), {});
    view.rerender(<StudioProjectionView source={slow} active now={at(5)} />);
    expect(screen.queryByText('Jarvis Command')).toBeNull();
    expect(screen.getByText(/Source: SYNTHETIC second fixture/)).toBeVisible();
  });

  it('makes no read while the document is hidden and recovers when it becomes visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const s = source(() => ok());
    render(<StudioProjectionView source={s} active now={at(5)} />);
    expect(s.read).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await screen.findByText('Jarvis Command');
    expect(s.read).toHaveBeenCalledTimes(1);
  });
});

describe('integrated lane and release labels', () => {
  it('keeps the lane neutral and shows unknown and proven scheduler receipts without inferring deployment', async () => {
    const user = userEvent.setup();
    render(<StudioProjectionView source={source(() => ok())} active now={at(5)} />);
    await user.click(await screen.findByRole('button', { name: /Jarvis Command/ }));
    await user.click(screen.getByText('Other states'));
    expect(screen.getByRole('heading', { level: 3, name: /Merged \(release shown separately\)/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /#7 SYNTHETIC merged awaiting release/ }));
    expect(screen.getByText(/Release unknown \(no read-only release receipt/)).toBeVisible();
    cleanup();
    await user.click(await (async () => { render(<StudioProjectionView source={source(() => ok())} active now={at(5)} />); return screen.findByRole('button', { name: /Dev Studio/ }); })());
    await user.click(screen.getByText('Other states'));
    await user.click(screen.getByRole('button', { name: /#10 SYNTHETIC queued/ }));
    expect(screen.getByText(/In the live scheduler release 1234567890ab/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/not yet released|Merged is not released|deployed/i);
  });
});

describe('malformed evidence links', () => {
  it('rejects empty canonical link lists instead of crashing navigation', async () => {
    const doc = JSON.parse(golden);
    doc.projects[0].work[0].evidence = [];
    render(<StudioProjectionView source={source(() => ok(JSON.stringify(doc)))} active now={at(5)} />);
    expect(await screen.findByText('Studio data was rejected as untrustworthy.')).toBeVisible();
    cleanup();
    const unlinked = JSON.parse(golden);
    unlinked.projects[0].unlinked_prs = [{ ...unlinked.projects[0].work[1].prs[0], id: 'Example/command-synth#99', number: 99, links: [] }];
    delete unlinked.projects[0].unlinked_prs[0].updated_at;
    render(<StudioProjectionView source={source(() => ok(JSON.stringify(unlinked)))} active now={at(5)} />);
    expect(await screen.findByText('Studio data was rejected as untrustworthy.')).toBeVisible();
  });
});

describe('hostile display data', () => {
  it('renders markup-like text inertly and rejects script links outright', async () => {
    const doc = JSON.parse(golden);
    doc.projects[0].work[0].title = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script>';
    render(<StudioProjectionView source={source(() => ok(JSON.stringify(doc)))} active now={at(5)} />);
    await userEvent.click(await screen.findByRole('button', { name: /Jarvis Command/ }));
    expect(screen.getByText(/<img src=x onerror=/)).toBeVisible();
    expect(document.querySelector('img, script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    cleanup();
    doc.projects[0].work[0].evidence[0].url = 'javascript:alert(1)';
    render(<StudioProjectionView source={source(() => ok(JSON.stringify(doc)))} active now={at(5)} />);
    expect(await screen.findByText('Studio data was rejected as untrustworthy.')).toBeVisible();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
