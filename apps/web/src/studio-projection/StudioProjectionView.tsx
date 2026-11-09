import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import './StudioProjectionView.css';
import {
  classifyFreshness, CI_LABEL, formatAge, formatTime, LANE_LABEL, partialReasons, RELEASE_LABEL, REVIEW_LABEL, RUN_LABEL,
} from './presentation';
import type { ProjectionSource } from './studioProjectionSource';
import { decodeStudioProjection, LANES, OTHER_LANES, safeGithubUrl } from './studioProjection';
import type { Delivery, DecodeFailureKind, Lane, Project, ProjectRelease, StudioSnapshot, WorkItem } from './studioProjection';

type Failure = Readonly<{ kind: DecodeFailureKind | 'unreachable' | 'http'; message: string; at: number }>;
type Nav = Readonly<{ project: string | null; item: string | null }>;

export type StudioProjectionViewProps = Readonly<{
  /** Null means no approved transport exists: the view stays disabled and issues no request. */
  source: ProjectionSource | null;
  /** True only while the view is visible and focused by the shell. Hidden views never read or poll. */
  active: boolean;
  /** Optional bounded polling while active and the document is visible. Omitted = manual refresh only. */
  refreshMs?: number;
  now?: () => number;
}>;

const FAILURE_TITLE: Record<Failure['kind'], string> = {
  unreachable: 'Studio is unreachable', http: 'Studio returned an error', not_json: 'Studio sent a response this client cannot read',
  oversized: 'Studio response was too large and was rejected', unsupported_version: 'Studio projection version is not supported',
  producer_unavailable: 'Studio reports its projection is unavailable', malformed: 'Studio data was rejected as untrustworthy',
};
const MIN_REFRESH_MS = 30_000;

function Link({ url, children }: Readonly<{ url: string; children: ReactNode }>) {
  const href = safeGithubUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
}

export function StudioProjectionView({ source, active, refreshMs, now = Date.now }: StudioProjectionViewProps) {
  // Data is recorded together with the source that produced it and only shown for that same source.
  const [snapshotRec, setSnapshotRec] = useState<Readonly<{ source: ProjectionSource; value: StudioSnapshot }> | null>(null);
  const [failureRec, setFailureRec] = useState<Readonly<{ source: ProjectionSource; value: Failure }> | null>(null);
  const snapshot = source && snapshotRec?.source === source ? snapshotRec.value : null;
  const failure = source && failureRec?.source === source ? failureRec.value : null;
  const [loading, setLoading] = useState(false);
  const [clock, setClock] = useState(() => now());
  const [nav, setNav] = useState<Nav>({ project: null, item: null });
  const root = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  const snapshotRef = useRef<StudioSnapshot | null>(null), failureRef = useRef<Failure | null>(null);

  const load = useCallback(async () => {
    if (!source || inFlight.current || document.visibilityState === 'hidden') return; // never overlap, duplicate or read while hidden
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const result = await source.read(controller.signal);
      if (controller.signal.aborted) return;
      const at = nowRef.current();
      if (result.status !== 200 && result.status !== 503) { setFailureRec({ source, value: { kind: 'http', message: `HTTP ${result.status}.`, at } }); return; }
      const decoded = decodeStudioProjection(result.body);
      if (decoded.ok) { setSnapshotRec({ source, value: decoded.snapshot }); setFailureRec(null); } else setFailureRec({ source, value: { kind: decoded.kind, message: decoded.message, at } });
    } catch {
      if (!controller.signal.aborted) setFailureRec({ source, value: { kind: 'unreachable', message: 'The read did not complete.', at: nowRef.current() } });
    } finally {
      if (inFlight.current === controller) { inFlight.current = null; if (!controller.signal.aborted) setLoading(false); }
    }
  }, [source]);

  // A removed or replaced source never leaves its data, failure or drill-down behind.
  useEffect(() => { setSnapshotRec(null); setFailureRec(null); setNav({ project: null, item: null }); setLoading(false); }, [source]);

  // Read once on activation; stop (and cancel) the moment the view is hidden or the source goes away.
  useEffect(() => {
    if (!active || !source) return undefined;
    void load();
    return () => { inFlight.current?.abort(); inFlight.current = null; setLoading(false); };
  }, [active, source, load]);

  useEffect(() => {
    if (!active || !source) return undefined;
    const tick = window.setInterval(() => setClock(nowRef.current()), 15_000);
    const poll = refreshMs ? window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, Math.max(MIN_REFRESH_MS, refreshMs)) : null;
    setClock(nowRef.current());
    // A document that was hidden at activation reads as soon as it becomes visible.
    const onVisible = () => { if (document.visibilityState === 'visible' && !snapshotRef.current && !failureRef.current) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(tick); if (poll !== null) window.clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, source, refreshMs, load]);

  snapshotRef.current = snapshot; failureRef.current = failure;
  const project = useMemo(() => snapshot?.projects.find((p) => p.id === nav.project) ?? null, [snapshot, nav.project]);
  const item = useMemo(() => project?.work.find((w) => w.id === nav.item) ?? null, [project, nav.item]);
  // A refresh can remove what was open; fall back to the nearest level that still exists.
  const level: 'overview' | 'project' | 'item' = item ? 'item' : project ? 'project' : 'overview';

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const el = target === 'heading' ? heading.current : root.current?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(target)}"]`) ?? heading.current;
    el?.focus();
  }, [level, nav, snapshot === null]);

  const go = (next: Nav, focus: string) => { pendingFocus.current = focus; setNav(next); };
  const back = () => {
    if (level === 'item' && project) go({ project: project.id, item: null }, `item:${item!.id}`);
    else if (level === 'project') go({ project: null, item: null }, `project:${project!.id}`);
  };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && level !== 'overview') { event.stopPropagation(); back(); } };

  const freshness = snapshot ? classifyFreshness(snapshot, clock) : null;
  const lastKnown = snapshot !== null && failure !== null;
  const partial = snapshot ? partialReasons(snapshot) : [];

  if (!source) {
    // Disabled: no transport is approved, so nothing is requested and no Studio data (retained or otherwise) is shown.
    return (
      <div className="spv-disabled-root" role="status" data-state="disabled">
        <p><strong className="spv-sr">Studio view is disabled. </strong>Live team status is not connected in this build. No crew members, tasks or activity are available to show here.</p>
      </div>
    );
  }

  return (
    <section ref={root} className="spv-root" aria-labelledby="spv-title" onKeyDown={onKeyDown} aria-busy={loading}>
      <header className="spv-header">
        <div>
          <h2 id="spv-title" ref={heading} tabIndex={-1}>
            {level === 'overview' ? 'Studio projects' : level === 'project' ? project!.displayName : item!.title}
          </h2>
          <p className="spv-source small">Source: {source.label}</p>
        </div>
        <div className="spv-actions">
          {level !== 'overview' && <button type="button" className="spv-button" onClick={back}>{level === 'item' ? `Back to ${project!.displayName}` : 'All projects'}</button>}
          <button type="button" className="spv-button" disabled={loading || !active} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      <div role="status" aria-live="polite" className="spv-status-region">
        {loading && !snapshot && <div className="spv-banner" data-state="loading">Loading Studio projection…</div>}
        {failure && (
          <div className="spv-banner spv-failure" data-state={snapshot ? 'last-known' : 'failed'}>
            <strong>{FAILURE_TITLE[failure.kind]}.</strong> {failure.message}{' '}
            {snapshot ? <>The last known snapshot (observed {formatTime(snapshot.observedAt)}, {formatAge(freshness!.ageSeconds)} ago) is shown below. It is <strong>not current</strong>.</> : 'No data is shown.'}
          </div>
        )}
        {snapshot && freshness && (
          <div className={`spv-banner spv-fresh-${freshness.state}`} data-state={freshness.state}>
            {freshness.state === 'current' && <>Snapshot observed {formatAge(freshness.ageSeconds)} ago.</>}
            {freshness.state === 'aging' && <>Snapshot observed {formatAge(freshness.ageSeconds)} ago; newer data may exist.</>}
            {freshness.state === 'stale' && <><strong>Stale.</strong> Snapshot observed {formatAge(freshness.ageSeconds)} ago; do not rely on it.</>}
            {freshness.state === 'clock_mismatch' && <><strong>Clock mismatch.</strong> The snapshot claims to be from the future, so its age is unknown.</>}
            {' '}Observed {formatTime(snapshot.observedAt)}. This is a point-in-time snapshot, not a live feed.
          </div>
        )}
        {partial.length > 0 && (
          <div className="spv-banner spv-partial" data-state="partial">
            <strong>Partial snapshot.</strong>
            <ul>{partial.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        )}
      </div>

      {snapshot && (
        <div className={lastKnown ? 'spv-body spv-lastknown' : 'spv-body'}>
          {lastKnown && <p className="spv-lastknown-label">Last known data</p>}
          {level === 'overview' && <Overview snapshot={snapshot} open={(id) => go({ project: id, item: null }, 'heading')} />}
          {level === 'project' && project && <ProjectPage project={project} open={(id) => go({ project: project.id, item: id }, 'heading')} />}
          {level === 'item' && project && item && <ItemPage project={project} item={item} />}
        </div>
      )}
    </section>
  );
}

function Overview({ snapshot, open }: Readonly<{ snapshot: StudioSnapshot; open: (projectId: string) => void }>) {
  const { counts, coverage } = snapshot.totals;
  return (
    <>
      <h3 className="spv-sr">Across all projects</h3>
      <ul className="spv-tiles" aria-label="Work by stage across projects">
        {LANES.map((lane) => (
          <li key={lane} className={`spv-tile spv-lane-${lane}`}>
            <span className="spv-tile-count">{counts[lane] === null ? 'Unknown' : counts[lane]}</span>
            <span className="spv-tile-label">{LANE_LABEL[lane]}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        {coverage.complete ? `All ${coverage.projects} projects reported counts.` : `Counts cover ${coverage.withCounts} of ${coverage.projects} projects, so unknown totals are not shown as numbers.`}
        {' '}Worker sessions are process presence only and are never counted as progress.
      </p>
      <h3>Projects</h3>
      <ul className="spv-cards">
        {snapshot.projects.map((project) => (
          <li key={project.id}>
            <button type="button" className="spv-card" data-focus-key={`project:${project.id}`} onClick={() => open(project.id)}>
              <span className="spv-card-title">{project.displayName}</span>
              <span className="spv-card-line">{project.goal ?? 'Goal not reported'}</span>
              <span className="spv-card-line muted">{milestoneText(project)}</span>
              <span className="spv-card-line muted">{progressText(project)}</span>
              <span className="spv-chips">
                {LANES.map((lane) => <span key={lane} className={`spv-chip spv-lane-${lane}`}>{LANE_LABEL[lane]}: {project.counts ? project.counts[lane] : 'unknown'}</span>)}
              </span>
              {project.dispatch.state === 'paused' && <span className="spv-card-line spv-warn">Dispatch paused ({project.dispatch.kind}){project.dispatch.resumeAt ? `, resumes ${formatTime(project.dispatch.resumeAt)}` : ''}</span>}
              {!project.counts && <span className="spv-card-line spv-warn">GitHub unavailable: work counts unknown</span>}
              <span className="spv-card-line muted small">{project.latestEvent ? `Latest: ${eventText(project.latestEvent.kind)} · ${project.latestEvent.source} · ${formatAge(project.latestEvent.ageSeconds)} before snapshot` : 'Latest event: not reported'}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function eventText(kind: string): string {
  return ({ worker_exit: 'worker exited', issue_updated: 'issue updated', pr_updated: 'PR updated', pr_merged: 'PR merged' } as Record<string, string>)[kind] ?? kind;
}
function milestoneText(project: Project): string {
  const m = project.milestone;
  if (!m) return 'Current milestone: not reported';
  if (m.ambiguous) return `Current milestone: ambiguous (${m.candidates.map((c) => c.title).join(' / ')})`;
  return `Current milestone: ${m.title}`;
}
function progressText(project: Project): string {
  const p = project.progress;
  if (p.kind === 'plan_checklist') return `Plan checklist: ${p.done} of ${p.total} items done (${p.source})`;
  if (p.kind === 'plan_milestones') return `${p.count} plan-reported milestone statuses; no completion is inferred`;
  return `Progress unknown: ${p.reason}`;
}
function releaseText(release: ProjectRelease): string {
  return release.state === 'unknown' ? `Unknown (${release.reason})` : `Scheduler release ${release.liveSha}${release.activatedAt ? `, activated ${formatTime(release.activatedAt)}` : ''}. ${release.note}.`;
}

function ProjectPage({ project, open }: Readonly<{ project: Project; open: (itemId: string) => void }>) {
  const lanes = (list: readonly Lane[]) => list.map((lane) => {
    const items = project.work.filter((w) => w.lane === lane);
    const total = project.counts ? project.counts[lane] : null;
    return (
      <section key={lane} className={`spv-lane spv-lane-${lane}`} aria-labelledby={`spv-lane-${lane}`}>
        <h3 id={`spv-lane-${lane}`}>{LANE_LABEL[lane]} <span className="spv-count">({total ?? 'unknown'})</span></h3>
        {items.length === 0 ? <p className="muted small">{total === null ? 'Unknown: work data is unavailable.' : total === 0 ? 'None.' : 'None within the displayed items.'}</p> : (
          <ul className="spv-items">
            {items.map((w) => (
              <li key={w.id}>
                <button type="button" className="spv-item" data-focus-key={`item:${w.id}`} onClick={() => open(w.id)}>
                  <span className="spv-item-title">#{w.number} {w.title}</span>
                  <span className="spv-item-meta muted small">{itemSummary(w)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  });
  const status = project.plan.milestoneStatus;
  return (
    <>
      <dl className="spv-facts">
        <dt>Repository</dt><dd><Link url={`https://github.com/${project.repo}`}>{project.repo}</Link></dd>
        <dt>Goal</dt><dd>{project.goal ? <>{project.goal} <span className="muted small">({project.goalSource})</span></> : 'Not reported'}</dd>
        <dt>Current milestone</dt><dd>{milestoneText(project).replace('Current milestone: ', '')}{project.milestone && ` · from ${project.milestone.source}`}</dd>
        <dt>Plan progress</dt><dd>{progressText(project)}</dd>
        <dt>Dispatch</dt><dd>{project.dispatch.state === 'paused' ? `Paused (${project.dispatch.kind})${project.dispatch.resumeAt ? `, resumes ${formatTime(project.dispatch.resumeAt)}` : ''}` : 'Not paused'}</dd>
        <dt>Worker sessions</dt><dd>{project.sessions === null ? 'Unknown' : `${project.sessions} present (process presence, not progress); ${project.running ?? 'unknown'} with recent log activity; ${project.unmatchedSessions ?? 'unknown'} not matching an open issue`}</dd>
        <dt>Latest event</dt><dd>{project.latestEvent ? `${eventText(project.latestEvent.kind)} · ${project.latestEvent.ref} · ${project.latestEvent.source} · ${formatTime(project.latestEvent.at)} (${formatAge(project.latestEvent.ageSeconds)} before snapshot)` : 'Not reported'}</dd>
        <dt>Scheduler release</dt><dd>{project.delivery ? releaseText(project.delivery.release) : 'Unknown (merged-PR data unavailable)'}</dd>
      </dl>
      {status.length > 0 && (
        <section aria-labelledby="spv-plan-status">
          <h3 id="spv-plan-status">Plan-reported status</h3>
          <p className="muted small">Verbatim from the plan; qualifiers such as “unavailable” or “pending” are kept and nothing is counted as complete.</p>
          <ul className="spv-plan">{status.map((s, i) => <li key={`${s.id}:${i}`}><strong>{s.id ?? s.title ?? 'Plan item'}</strong> {s.title && s.id ? `· ${s.title}` : ''}<br /><span>{s.status ?? 'No status'}</span><br /><span className="muted small">{s.statusSource ?? 'source not reported'}</span></li>)}</ul>
        </section>
      )}
      <p className="muted small">Plan evidence: {project.plan.state}{project.plan.baseCommit ? `, base ${project.plan.baseCommit}` : ''}{project.plan.baseCommittedAt ? ` (${formatTime(project.plan.baseCommittedAt)})` : ''}{project.plan.files.length ? `; files ${project.plan.files.map((f) => f.file).join(', ')}` : ''}{project.plan.unreadable.length ? `; unreadable ${project.plan.unreadable.join(', ')}` : ''}.</p>
      {project.truncated && project.counts && <p className="spv-banner spv-partial">Showing the first {project.work.length} of {project.counts.openIssues} open issues; lane counts above include items not shown.</p>}
      {!project.counts && <p className="spv-banner spv-partial">GitHub was unavailable for this project, so its work and counts are unknown (not zero).</p>}
      {lanes(LANES)}
      <details className="spv-more"><summary>Other states</summary>{lanes(OTHER_LANES)}</details>
      {project.delivery && (
        <section aria-labelledby="spv-merged">
          <h3 id="spv-merged">Recently merged <span className="muted small">({project.delivery.coverage})</span></h3>
          {project.delivery.merged.length === 0 ? <p className="muted small">None in range.</p> : <ul className="spv-plan">{project.delivery.merged.map((d) => <MergedRecord key={d.id} record={d} />)}</ul>}
        </section>
      )}
      {project.unlinkedPrs.length > 0 && (
        <details className="spv-more"><summary>Open PRs not linked to an open issue ({project.unlinkedPrs.length})</summary>
          <ul className="spv-plan">{project.unlinkedPrs.map((pr) => <li key={pr.id}><Link url={pr.links[0]?.url ?? ''}>{pr.id} {pr.title}</Link>{pr.draft ? ' (draft)' : ''}<br />{CI_LABEL[pr.ci]} · {REVIEW_LABEL(pr.review)}</li>)}</ul>
        </details>
      )}
    </>
  );
}

function itemSummary(w: WorkItem): string {
  const parts = [w.owner ? `${w.owner.role} ${w.owner.profile}` : 'owner not reported'];
  if (w.blocker) parts.push(`blocked: ${w.blocker.reason}`);
  const pr = w.prs[0];
  if (pr) parts.push(`${CI_LABEL[pr.ci]}, ${REVIEW_LABEL(pr.review)}`);
  parts.push(w.ageSeconds === null ? 'age unknown' : `updated ${formatAge(w.ageSeconds)} before snapshot${w.stale ? ' (stale)' : ''}`);
  return parts.join(' · ');
}

function MergedRecord({ record }: Readonly<{ record: Delivery }>) {
  return (
    <li><Link url={record.url}>{record.id} {record.title}</Link><br />
      Merged {record.mergedAt ? formatTime(record.mergedAt) : 'at unknown time'}{record.mergeSha ? ` · ${record.mergeSha}` : ''}<br />
      <span className="muted small">{RELEASE_LABEL(record.release)}. A merge alone does not show release or deployment.</span></li>
  );
}

function ItemPage({ project, item }: Readonly<{ project: Project; item: WorkItem }>) {
  const o = item.owner;
  return (
    <>
      <p className="spv-lede"><span className={`spv-chip spv-lane-${item.lane}`}>{LANE_LABEL[item.lane]}</span> <Link url={item.evidence[0]?.url ?? ''}>{item.id}</Link> · {project.displayName}</p>
      <dl className="spv-facts">
        <dt>Plan milestone</dt><dd>{item.milestone ?? 'Not reported'}</dd>
        <dt>Last update</dt><dd>{item.updatedAt && item.ageSeconds !== null ? `${formatTime(item.updatedAt)} (${formatAge(item.ageSeconds)} before snapshot)${item.stale ? ' · stale' : ''}` : 'Not reported'}</dd>
        <dt>Process observation</dt><dd>{RUN_LABEL[item.run.observed]}. Process presence is not progress.{item.run.lastActivityAt ? ` Last log activity ${formatTime(item.run.lastActivityAt)}.` : ''}{item.run.lastExitAt ? ` Last exit ${formatTime(item.run.lastExitAt)}.` : ''}</dd>
        <dt>Owner (configured)</dt>
        <dd>{o ? <>{o.role} {o.profile} · configured model {o.configured.model} ({o.configured.pool}) · requested effort {o.configured.effort ?? 'not reported'}<br />
          <strong>Executed route: unknown.</strong> <span className="muted small">{o.executed.reason}. Configuration is not evidence of what ran.</span></> : 'Not reported'}</dd>
      </dl>
      {item.blocker && (
        <section aria-labelledby="spv-blocker" className="spv-blocker">
          <h3 id="spv-blocker">Blocker</h3>
          <dl className="spv-facts">
            <dt>Reason</dt><dd>{item.blocker.reason}</dd>
            <dt>Owner</dt><dd>{item.blocker.owner ?? 'Not reported'}</dd>
            <dt>Next action</dt><dd>{item.blocker.nextAction}</dd>
            <dt>Depends on</dt><dd>{item.blocker.dependencies.length ? <ul>{item.blocker.dependencies.map((d) => <li key={d.id}><Link url={d.url}>{d.id}</Link></li>)}</ul> : 'None identified'}{item.blocker.unsupportedDependencyRefs > 0 && ` · ${item.blocker.unsupportedDependencyRefs} reference(s) to unregistered repositories not shown`}</dd>
            <dt>Source</dt><dd>{item.blocker.source}</dd>
          </dl>
        </section>
      )}
      <h3>Evidence</h3>
      <p className="muted small">Each state is reported separately; one does not imply another.</p>
      <dl className="spv-facts spv-evidence">
        <dt>Checks</dt><dd>{item.prs.length ? <ul>{item.prs.map((p) => <li key={p.id}>{p.id}{p.draft ? ' (draft)' : ''}: {CI_LABEL[p.ci]}</li>)}</ul> : 'No linked PR'}</dd>
        <dt>Review</dt><dd>{item.prs.length ? <ul>{item.prs.map((p) => <li key={p.id}>{p.id}: {REVIEW_LABEL(p.review)}</li>)}</ul> : 'No linked PR'}</dd>
        <dt>Merged</dt><dd>{item.integration.length ? <ul>{item.integration.map((d) => <li key={d.id}>{d.id} {d.mergedAt ? formatTime(d.mergedAt) : ''}{d.mergeSha ? ` · ${d.mergeSha}` : ''}</li>)}</ul> : 'No merged PR linked'}</dd>
        <dt>Scheduler release</dt><dd>{item.integration.length ? <ul>{item.integration.map((d) => <li key={d.id}>{d.id}: {RELEASE_LABEL(d.release)}</li>)}</ul> : 'Not applicable until merged'}</dd>
        <dt>Ready to test</dt><dd>{item.lane === 'ready_to_test' ? 'Marked ready to test by an explicit label' : 'Not marked ready to test'}</dd>
      </dl>
      <h3>Links</h3>
      <ul className="spv-links">{item.evidence.map((e, i) => <li key={`${e.url}:${i}`}><Link url={e.url}>{e.label}</Link></li>)}</ul>
    </>
  );
}
