import type { CiState, Lane, ReleaseState, ReviewState, RunObservation, StudioSnapshot } from './studioProjection';

export const LANE_LABEL: Record<Lane, string> = {
  attention: 'Needs attention', building: 'Building', checking: 'Checking', review: 'Review', ready_to_test: 'Ready to test',
  integrated: 'Merged (release shown separately)', unverified: 'Unverified', queued: 'Queued', open: 'Open',
};
export const CI_LABEL: Record<CiState, string> = { passed: 'Checks passed', failed: 'Checks failing', pending: 'Checks running', unknown: 'Checks not reported' };
export const REVIEW_LABEL = (review: ReviewState): string => review === null ? 'Review not reported'
  : { approved: 'Review approved', changes_requested: 'Changes requested', review_required: 'Review required', none: 'No review decision' }[review];
export const RUN_LABEL: Record<RunObservation, string> = {
  running: 'Worker session with recent log activity', not_running: 'No worker session',
  session_without_recent_activity: 'Worker session present, no recent activity', unknown: 'Worker observation unavailable',
};
export const RELEASE_LABEL = (release: ReleaseState): string => release.state === 'unknown' ? `Release unknown (${release.reason})`
  : release.state === 'in_live_scheduler_release' ? `In the live scheduler release ${release.liveSha}` : `Not in the live scheduler release ${release.liveSha}`;

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
/** Deterministic UTC minute-level time, independent of the viewer's locale and zone. */
export function formatTime(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export type Freshness = 'current' | 'aging' | 'stale' | 'clock_mismatch';
/** Age of the snapshot relative to the viewer's clock. A snapshot is never "live": at most "current" within the producer's window. */
export function classifyFreshness(snapshot: StudioSnapshot, nowMs: number): { state: Freshness; ageSeconds: number } {
  const ageSeconds = Math.floor((nowMs - snapshot.observedAtMs) / 1000);
  if (ageSeconds < -60) return { state: 'clock_mismatch', ageSeconds: 0 };
  const age = Math.max(0, ageSeconds);
  return { state: age <= snapshot.freshForSeconds ? 'current' : age <= snapshot.staleAfterSeconds ? 'aging' : 'stale', ageSeconds: age };
}

export function partialReasons(snapshot: StudioSnapshot): string[] {
  const reasons: string[] = [];
  const { coverage } = snapshot.totals;
  if (!coverage.complete) reasons.push(`Counts cover ${coverage.withCounts} of ${coverage.projects} projects; totals for the rest are unknown.`);
  for (const project of snapshot.projects) {
    if (project.truncated && project.counts) reasons.push(`${project.displayName}: showing the first ${project.work.length} of ${project.counts.openIssues} open issues.`);
  }
  for (const error of snapshot.errors.slice(0, 6)) reasons.push(`${snapshot.projects.find((p) => p.id === error.project)?.displayName ?? error.project}: ${error.message}`);
  if (snapshot.errors.length > 6) reasons.push(`${snapshot.errors.length - 6} more source notes not shown.`);
  return reasons;
}
