// Strict consumer for the Studio `studio.projection` v1 document (accepted producer:
// KumarG23/dev-studio dashboard/projection.py at 6339856aae28f03cddcd2996b5c1c4ec770388d7).
//
// The decoder never repairs data. Unknown versions or fields, wrong types, oversized or
// over-long values, invalid dates, unregistered or non-GitHub links and any internal
// contradiction (ids, counts, coverage, ages) reject the whole snapshot with a typed reason.
// Valid-but-partial snapshots keep their explicit null/unknown/error semantics: nothing is
// summed, defaulted or truncated here.

export const STUDIO_PROJECTION_SCHEMA = 'studio.projection';
export const STUDIO_PROJECTION_VERSION = 1;
// The accepted producer sample is ~66 KB for 4 projects/26 issues. The producer's own ceilings (16 projects x 100
// items) reach ~2.2 MB (see the full-capacity test), so 4 MiB (~60x the sample) is a consumer safety bound, not a
// producer limit and not the older 64 KiB recommendation: a larger document is rejected as oversized and never
// truncated into misleading counts.
export const STUDIO_PROJECTION_MAX_BYTES = 4 * 1024 * 1024;
export const MAX_PROJECTS = 16;
export const MAX_ITEMS_PER_PROJECT = 100;

export const LANES = ['attention', 'building', 'checking', 'review', 'ready_to_test'] as const;
export const OTHER_LANES = ['integrated', 'unverified', 'queued', 'open'] as const;
export const ALL_LANES = [...LANES, ...OTHER_LANES] as const;
export type Lane = (typeof ALL_LANES)[number];
export type CiState = 'passed' | 'failed' | 'pending' | 'unknown';
export type ReviewState = 'approved' | 'changes_requested' | 'review_required' | 'none' | null;
export type RunObservation = 'running' | 'not_running' | 'session_without_recent_activity' | 'unknown';
export type ItemState = 'blocked' | 'running' | 'ready' | 'unverified' | 'open';

export type ReleaseState =
  | Readonly<{ state: 'unknown'; reason: string }>
  | Readonly<{ state: 'in_live_scheduler_release' | 'not_in_live_scheduler_release'; liveSha: string }>;
export type ProjectRelease =
  | Readonly<{ state: 'unknown'; reason: string }>
  | Readonly<{ state: 'known'; kind: 'studio_scheduler_release'; liveSha: string; activatedAt: string | null; note: string }>;

export type EvidenceLink = Readonly<{ label: string; url: string }>;
export type PullRequest = Readonly<{
  id: string; number: number; title: string; draft: boolean; ci: CiState; review: ReviewState;
  updatedAt: string | null; links: readonly EvidenceLink[];
}>;
export type Delivery = Readonly<{
  id: string; number: number; title: string; mergedAt: string | null; mergeSha: string | null; release: ReleaseState; url: string;
}>;
export type Dependency = Readonly<{ id: string; repo: string; number: number; url: string }>;
export type Blocker = Readonly<{
  reason: string; owner: string | null; dependencies: readonly Dependency[]; unsupportedDependencyRefs: number;
  nextAction: string; source: string;
}>;
export type Owner = Readonly<{
  profile: string; role: 'lead' | 'worker';
  configured: Readonly<{ model: string; pool: string; effort: string | null; source: string }>;
  executed: Readonly<{ state: 'unknown'; reason: string }>;
}>;
export type WorkItem = Readonly<{
  id: string; number: number; title: string; lane: Lane; state: ItemState;
  run: Readonly<{ observed: RunObservation; session: boolean | null; lastActivityAt: string | null; lastExitAt: string | null }>;
  owner: Owner | null; prs: readonly PullRequest[]; integration: readonly Delivery[]; milestone: string | null;
  updatedAt: string | null; ageSeconds: number | null; stale: boolean; blocker: Blocker | null; evidence: readonly EvidenceLink[];
}>;
export type Counts = Readonly<Record<Lane, number> & { openIssues: number; openPrs: number; sessions: number | null; running: number | null; blocked: number; ready: number }>;
export type PlanStatus = Readonly<{ id: string | null; title: string | null; status: string | null; statusSource: string | null }>;
export type Progress =
  | Readonly<{ kind: 'plan_checklist'; done: number; total: number; source: string; committedAt: string | null }>
  | Readonly<{ kind: 'plan_milestones'; count: number; note: string }>
  | Readonly<{ kind: 'unknown'; reason: string }>;
export type CurrentMilestone = Readonly<{
  source: string; basis: 'active_delivery' | 'queued_or_unverified' | 'blocked_only'; title: string | null; ambiguous: boolean;
  issues: number | null; candidates: readonly Readonly<{ title: string; issues: number }>[];
}>;
export type ProjectError = Readonly<{ source: string; message: string }>;
export type Project = Readonly<{
  id: string; displayName: string; repo: string;
  dispatch: Readonly<{ state: 'paused' | 'unpaused'; kind: string | null; resumeAt: string | null }>;
  goal: string | null; goalSource: string | null; milestone: CurrentMilestone | null; progress: Progress;
  plan: Readonly<{
    state: 'read' | 'partial' | 'none' | 'unavailable'; reason: string | null; unreadable: readonly string[];
    baseCommit: string | null; baseCommittedAt: string | null;
    files: readonly Readonly<{ file: string; commit: string | null; committedAt: string | null }>[];
    roadmapSource: string | null; milestoneStatus: readonly PlanStatus[];
  }>;
  counts: Counts | null;
  latestEvent: Readonly<{ kind: string; at: string; ageSeconds: number; source: string; ref: string }> | null;
  delivery: Readonly<{ merged: readonly Delivery[]; coverage: string; release: ProjectRelease }> | null;
  sessions: number | null; running: number | null; work: readonly WorkItem[]; unlinkedPrs: readonly Omit<PullRequest, 'updatedAt'>[];
  truncated: boolean; unmatchedSessions: number | null; errors: readonly ProjectError[];
  sources: Readonly<{ github: 'online' | 'unavailable'; workers: 'observed' | 'unknown'; plan: string }>;
}>;
export type Totals = Readonly<{
  coverage: Readonly<{ projects: number; withCounts: number; complete: boolean }>;
  counts: Readonly<Record<string, number | null>>;
}>;
export type StudioSnapshot = Readonly<{
  observedAt: string; observedAtMs: number; freshForSeconds: number; staleAfterSeconds: number;
  provenance: readonly string[]; redaction: string; scope: Readonly<{ project: string; note: string }> | null;
  totals: Totals; projects: readonly Project[];
  errors: readonly Readonly<{ project: string; source: string; message: string }>[];
}>;

export type DecodeFailureKind = 'not_json' | 'oversized' | 'unsupported_version' | 'producer_unavailable' | 'malformed';
export type DecodeResult =
  | Readonly<{ ok: true; snapshot: StudioSnapshot; bytes: number }>
  | Readonly<{ ok: false; kind: DecodeFailureKind; message: string }>;

class Reject extends Error {}
type Obj = Record<string, unknown>;
const fail = (path: string, why: string): never => { throw new Reject(`${path}: ${why}`); };

const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/u;
function str(v: unknown, path: string, max: number, min = 1): string {
  if (typeof v !== 'string') return fail(path, 'expected string');
  if (v.length > max * 2) return fail(path, `longer than ${max}`);
  if ([...v].length > max) return fail(path, `longer than ${max}`);
  if ([...v].length < min) return fail(path, 'empty');
  if (FORBIDDEN_TEXT.test(v)) return fail(path, 'control or invisible characters');
  return v;
}
const strOrNull = (v: unknown, path: string, max: number) => (v === null ? null : str(v, path, max));
function int(v: unknown, path: string, min = 0, max = 10_000_000): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return fail(path, `expected integer ${min}..${max}`);
  return v;
}
const intOrNull = (v: unknown, path: string, min?: number, max?: number) => (v === null ? null : int(v, path, min, max));
function bool(v: unknown, path: string): boolean { return typeof v === 'boolean' ? v : fail(path, 'expected boolean'); }
function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fail(path, `expected one of ${allowed.join('|')}`);
}
function obj(v: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, 'expected object');
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return fail(path, 'expected plain object');
  const keys = Object.keys(v);
  for (const key of keys) if (!required.includes(key) && !optional.includes(key)) fail(path, `unknown field "${key.slice(0, 40)}"`);
  for (const key of required) if (!keys.includes(key)) fail(path, `missing field "${key}"`);
  return v as Obj;
}
function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) return fail(path, 'expected array');
  if (v.length > max) return fail(path, `more than ${max} entries`);
  return v;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/;
function isoMs(v: unknown, path: string): number {
  const m = typeof v === 'string' && v.length <= 40 ? ISO.exec(v) : null;
  if (!m) return fail(path, 'expected ISO-8601 timestamp with zone');
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const days = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const offsetBad = m[8] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59);
  if (year! < 2000 || year! > 2100 || month! < 1 || month! > 12 || day! < 1 || day! > days || hour! > 23 || minute! > 59 || second! > 59 || offsetBad) {
    return fail(path, 'not a valid calendar time');
  }
  const ms = Date.parse(v as string);
  return Number.isNaN(ms) ? fail(path, 'not a valid calendar time') : ms;
}
function iso(v: unknown, path: string): string { isoMs(v, path); return v as string; }
const isoOrNull = (v: unknown, path: string) => (v === null ? null : iso(v, path));

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const HEX12 = /^[0-9a-f]{12}$/;
const ID = /^[a-z][a-z0-9-]{0,40}$/;
const hex12OrNull = (v: unknown, path: string) => { if (v === null) return null; return HEX12.test(typeof v === 'string' ? v : '') ? (v as string) : fail(path, 'expected 12 hex characters'); };

/** Registered-repo scope used to allowlist every link and dependency in one document. */
type Ctx = { observedMs: number; registered: ReadonlySet<string>; scoped: boolean };

const GITHUB_PATH = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9._-]{0,38}\/[A-Za-z0-9._-]{1,100})((?:\/[A-Za-z0-9._~%+=@:-]{1,100}){0,8})$/;
function link(url: unknown, path: string, ctx: Ctx, exact?: string): string {
  const text = str(url, path, 300);
  if (exact !== undefined) return text === exact ? text : fail(path, 'link does not match its repo-qualified id');
  const m = GITHUB_PATH.exec(text);
  if (!m) return fail(path, 'not an allowed https://github.com link');
  if (!(ctx.scoped ? SLUG.test(m[1]!) : ctx.registered.has(m[1]!))) return fail(path, 'link repo is not a registered project');
  return text;
}
function links(v: unknown, path: string, ctx: Ctx, max: number, firstExact?: string): EvidenceLink[] {
  const list = arr(v, path, max);
  // The producer always rebuilds the canonical issue/PR link first; an empty list is malformed, not "no links".
  if (firstExact !== undefined && list.length === 0) fail(path, 'missing the canonical first link');
  return list.map((raw, i) => {
    const o = obj(raw, `${path}[${i}]`, ['label', 'url']);
    const url = i === 0 && firstExact !== undefined ? link(o.url, `${path}[${i}].url`, ctx, firstExact) : link(o.url, `${path}[${i}].url`, ctx);
    return { label: str(o.label, `${path}[${i}].label`, 60), url };
  });
}

function age(at: string, ageSeconds: number, ctx: Ctx, path: string) {
  const expected = Math.max(0, Math.floor((ctx.observedMs - Date.parse(at)) / 1000));
  if (Math.abs(expected - ageSeconds) > 2) fail(path, 'age does not agree with its timestamp and observed_at');
}

function release(v: unknown, path: string): ReleaseState {
  const state = typeof v === 'object' && v !== null ? (v as Obj).state : undefined;
  if (state === 'unknown') {
    const o = obj(v, path, ['state', 'reason']);
    return { state: 'unknown', reason: str(o.reason, `${path}.reason`, 120) };
  }
  const o = obj(v, path, ['state', 'live_sha']);
  return { state: oneOf(o.state, `${path}.state`, ['in_live_scheduler_release', 'not_in_live_scheduler_release'] as const), liveSha: hex12OrNull(o.live_sha, `${path}.live_sha`) ?? fail(path, 'live_sha required') };
}
function projectRelease(v: unknown, path: string): ProjectRelease {
  const state = typeof v === 'object' && v !== null ? (v as Obj).state : undefined;
  if (state === 'unknown') return release(v, path) as ProjectRelease;
  const o = obj(v, path, ['state', 'kind', 'live_sha', 'activated_at', 'note']);
  oneOf(o.state, `${path}.state`, ['known'] as const);
  oneOf(o.kind, `${path}.kind`, ['studio_scheduler_release'] as const);
  return { state: 'known', kind: 'studio_scheduler_release', liveSha: hex12OrNull(o.live_sha, `${path}.live_sha`) ?? fail(path, 'live_sha required'),
    activatedAt: isoOrNull(o.activated_at, `${path}.activated_at`), note: str(o.note, `${path}.note`, 160) };
}
function delivery(v: unknown, path: string, repo: string, ctx: Ctx): Delivery {
  const o = obj(v, path, ['id', 'number', 'title', 'merged_at', 'merge_sha', 'release', 'url']);
  const number = int(o.number, `${path}.number`, 1);
  if (o.id !== `${repo}#${number}`) fail(`${path}.id`, 'does not match repo-qualified number');
  return { id: o.id as string, number, title: str(o.title, `${path}.title`, 140), mergedAt: isoOrNull(o.merged_at, `${path}.merged_at`),
    mergeSha: hex12OrNull(o.merge_sha, `${path}.merge_sha`), release: release(o.release, `${path}.release`),
    url: link(o.url, `${path}.url`, ctx, `https://github.com/${repo}/pull/${number}`) };
}
function pullRequest(v: unknown, path: string, repo: string, ctx: Ctx, withUpdated: boolean): PullRequest {
  const keys = ['id', 'number', 'title', 'draft', 'ci', 'review', 'links'];
  const o = obj(v, path, withUpdated ? [...keys, 'updated_at'] : keys);
  const number = int(o.number, `${path}.number`, 1);
  if (o.id !== `${repo}#${number}`) fail(`${path}.id`, 'does not match repo-qualified number');
  const review = o.review === null ? null : oneOf(o.review, `${path}.review`, ['approved', 'changes_requested', 'review_required', 'none'] as const);
  return { id: o.id as string, number, title: str(o.title, `${path}.title`, 140), draft: bool(o.draft, `${path}.draft`),
    ci: oneOf(o.ci, `${path}.ci`, ['passed', 'failed', 'pending', 'unknown'] as const), review,
    updatedAt: withUpdated ? isoOrNull(o.updated_at, `${path}.updated_at`) : null,
    links: links(o.links, `${path}.links`, ctx, 2, `https://github.com/${repo}/pull/${number}`) };
}

function blocker(v: unknown, path: string, ctx: Ctx): Blocker {
  const o = obj(v, path, ['reason', 'owner', 'dependencies', 'unsupported_dependency_refs', 'next_action', 'source']);
  const dependencies = arr(o.dependencies, `${path}.dependencies`, 5).map((raw, i) => {
    const p = `${path}.dependencies[${i}]`;
    const d = obj(raw, p, ['id', 'repo', 'number', 'url']);
    const depRepo = str(d.repo, `${p}.repo`, 140);
    if (!SLUG.test(depRepo) || !(ctx.scoped || ctx.registered.has(depRepo))) fail(`${p}.repo`, 'dependency repo is not a registered project');
    const number = int(d.number, `${p}.number`, 1);
    if (d.id !== `${depRepo}#${number}`) fail(`${p}.id`, 'does not match repo-qualified number');
    return { id: d.id as string, repo: depRepo, number, url: link(d.url, `${p}.url`, ctx, `https://github.com/${depRepo}/issues/${number}`) };
  });
  return { reason: str(o.reason, `${path}.reason`, 160), owner: strOrNull(o.owner, `${path}.owner`, 60), dependencies,
    unsupportedDependencyRefs: int(o.unsupported_dependency_refs, `${path}.unsupported_dependency_refs`, 0, 1000),
    nextAction: str(o.next_action, `${path}.next_action`, 160), source: str(o.source, `${path}.source`, 100) };
}

function owner(v: unknown, path: string): Owner | null {
  if (v === null) return null;
  const o = obj(v, path, ['profile', 'role', 'configured', 'executed']);
  const c = obj(o.configured, `${path}.configured`, ['model', 'pool', 'effort', 'source']);
  const e = obj(o.executed, `${path}.executed`, ['state', 'reason']);
  oneOf(e.state, `${path}.executed.state`, ['unknown'] as const); // v1 never reports an executed route
  const profile = str(o.profile, `${path}.profile`, 40);
  if (!ID.test(profile)) fail(`${path}.profile`, 'unexpected profile name');
  return { profile, role: oneOf(o.role, `${path}.role`, ['lead', 'worker'] as const),
    configured: { model: str(c.model, `${path}.configured.model`, 100), pool: str(c.pool, `${path}.configured.pool`, 40),
      effort: strOrNull(c.effort, `${path}.configured.effort`, 12), source: str(c.source, `${path}.configured.source`, 140) },
    executed: { state: 'unknown', reason: str(e.reason, `${path}.executed.reason`, 200) } };
}

function workItem(v: unknown, path: string, repo: string, ctx: Ctx): WorkItem {
  const o = obj(v, path, ['id', 'number', 'title', 'lane', 'state', 'run', 'owner', 'prs', 'integration', 'milestone', 'updated_at', 'age_seconds', 'stale', 'blocker', 'evidence']);
  const number = int(o.number, `${path}.number`, 1);
  if (o.id !== `${repo}#${number}`) fail(`${path}.id`, 'does not match repo-qualified number');
  const lane = oneOf(o.lane, `${path}.lane`, ALL_LANES);
  const state = oneOf(o.state, `${path}.state`, ['blocked', 'running', 'ready', 'unverified', 'open'] as const);
  const r = obj(o.run, `${path}.run`, ['observed', 'session', 'last_activity_at', 'last_exit_at']);
  const observed = oneOf(r.observed, `${path}.run.observed`, ['running', 'not_running', 'session_without_recent_activity', 'unknown'] as const);
  const session = r.session === null ? null : bool(r.session, `${path}.run.session`);
  if ((observed === 'unknown') !== (session === null)) fail(`${path}.run`, 'session presence disagrees with observation');
  if (observed === 'not_running' ? session !== false : (observed === 'running' || observed === 'session_without_recent_activity') && session !== true) {
    fail(`${path}.run`, 'session presence disagrees with observation');
  }
  const updatedAt = isoOrNull(o.updated_at, `${path}.updated_at`);
  const ageSeconds = intOrNull(o.age_seconds, `${path}.age_seconds`, 0, 3_000_000_000);
  if ((updatedAt === null) !== (ageSeconds === null)) fail(`${path}.age_seconds`, 'age and timestamp must both be present or both null');
  if (updatedAt !== null && ageSeconds !== null) age(updatedAt, ageSeconds, ctx, `${path}.age_seconds`);
  const stale = bool(o.stale, `${path}.stale`);
  if (stale && (ageSeconds === null || ageSeconds < 86_398)) fail(`${path}.stale`, 'stale without a 24h age');
  if (!stale && ageSeconds !== null && ageSeconds > 86_402 && ['attention', 'building', 'unverified'].includes(lane)) fail(`${path}.stale`, 'aged item not marked stale');
  const bl = o.blocker === null ? null : blocker(o.blocker, `${path}.blocker`, ctx);
  if ((bl !== null) !== (state === 'blocked' || lane === 'attention')) fail(`${path}.blocker`, 'blocker presence disagrees with lane/state');
  const prs = arr(o.prs, `${path}.prs`, 20).map((p, i) => pullRequest(p, `${path}.prs[${i}]`, repo, ctx, true));
  return { id: o.id as string, number, title: str(o.title, `${path}.title`, 140), lane, state,
    run: { observed, session, lastActivityAt: isoOrNull(r.last_activity_at, `${path}.run.last_activity_at`), lastExitAt: isoOrNull(r.last_exit_at, `${path}.run.last_exit_at`) },
    owner: owner(o.owner, `${path}.owner`), prs,
    integration: arr(o.integration, `${path}.integration`, 3).map((d, i) => delivery(d, `${path}.integration[${i}]`, repo, ctx)),
    milestone: strOrNull(o.milestone, `${path}.milestone`, 160), updatedAt, ageSeconds, stale, blocker: bl,
    evidence: links(o.evidence, `${path}.evidence`, ctx, 60, `https://github.com/${repo}/issues/${number}`) };
}

const COUNT_KEYS = [...ALL_LANES, 'open_issues', 'open_prs', 'sessions', 'running', 'blocked', 'ready'] as const;
function counts(v: unknown, path: string): Counts | null {
  if (v === null) return null;
  const o = obj(v, path, COUNT_KEYS);
  const n = (k: string) => int(o[k], `${path}.${k}`, 0, 100_000);
  const nn = (k: string) => intOrNull(o[k], `${path}.${k}`, 0, 100_000);
  const lanes = Object.fromEntries(ALL_LANES.map((k) => [k, n(k)])) as Record<Lane, number>;
  const total = ALL_LANES.reduce((sum, k) => sum + lanes[k], 0);
  if (total !== n('open_issues')) fail(path, 'lane counts do not sum to open_issues');
  if ((nn('sessions') === null) !== (nn('running') === null)) fail(path, 'sessions and running must both be known or both unknown');
  return { ...lanes, openIssues: n('open_issues'), openPrs: n('open_prs'), sessions: nn('sessions'), running: nn('running'), blocked: n('blocked'), ready: n('ready') };
}

function progress(v: unknown, path: string): Progress {
  const kind = typeof v === 'object' && v !== null ? (v as Obj).kind : undefined;
  if (kind === 'plan_checklist') {
    const o = obj(v, path, ['kind', 'done', 'total', 'source', 'committed_at']);
    const total = int(o.total, `${path}.total`, 1, 100_000), done = int(o.done, `${path}.done`, 0, total);
    return { kind, done, total, source: str(o.source, `${path}.source`, 60), committedAt: isoOrNull(o.committed_at, `${path}.committed_at`) };
  }
  if (kind === 'plan_milestones') {
    const o = obj(v, path, ['kind', 'count', 'note']);
    return { kind, count: int(o.count, `${path}.count`, 1, 30), note: str(o.note, `${path}.note`, 160) };
  }
  const o = obj(v, path, ['kind', 'reason']);
  oneOf(o.kind, `${path}.kind`, ['unknown'] as const);
  return { kind: 'unknown', reason: str(o.reason, `${path}.reason`, 120) };
}

function planStatuses(v: unknown, path: string): PlanStatus[] {
  return arr(v, path, 30).map((raw, i) => {
    const o = obj(raw, `${path}[${i}]`, ['id', 'title', 'status', 'status_source']);
    return { id: strOrNull(o.id, `${path}[${i}].id`, 60), title: strOrNull(o.title, `${path}[${i}].title`, 120),
      status: strOrNull(o.status, `${path}[${i}].status`, 300), statusSource: strOrNull(o.status_source, `${path}[${i}].status_source`, 160) };
  });
}

function milestone(v: unknown, path: string): CurrentMilestone | null {
  if (v === null) return null;
  const o = obj(v, path, ['source', 'basis', 'title', 'ambiguous', 'issues'], ['candidates']);
  const ambiguous = bool(o.ambiguous, `${path}.ambiguous`);
  const title = strOrNull(o.title, `${path}.title`, 160), issues = intOrNull(o.issues, `${path}.issues`, 1, 100_000);
  const candidates = o.candidates === undefined ? [] : arr(o.candidates, `${path}.candidates`, 5).map((raw, i) => {
    const c = obj(raw, `${path}.candidates[${i}]`, ['title', 'issues']);
    return { title: str(c.title, `${path}.candidates[${i}].title`, 160), issues: int(c.issues, `${path}.candidates[${i}].issues`, 1, 100_000) };
  });
  if (ambiguous ? title !== null || issues !== null || candidates.length < 2 : title === null || issues === null || candidates.length > 0) {
    fail(path, 'ambiguity disagrees with title/issues/candidates');
  }
  return { source: str(o.source, `${path}.source`, 80), basis: oneOf(o.basis, `${path}.basis`, ['active_delivery', 'queued_or_unverified', 'blocked_only'] as const), title, ambiguous, issues, candidates };
}

function project(v: unknown, path: string, ctx: Ctx): Project {
  const o = obj(v, path, ['id', 'display_name', 'repo', 'dispatch', 'goal', 'goal_source', 'milestone', 'progress', 'plan', 'counts', 'latest_event', 'delivery',
    'sessions', 'running', 'work', 'unlinked_prs', 'truncated', 'unmatched_sessions', 'errors', 'sources']);
  const id = str(o.id, `${path}.id`, 41);
  if (!ID.test(id)) fail(`${path}.id`, 'unexpected project id');
  const repo = str(o.repo, `${path}.repo`, 140);
  if (!SLUG.test(repo)) fail(`${path}.repo`, 'expected owner/name');
  const d = obj(o.dispatch, `${path}.dispatch`, ['state', 'kind', 'resume_at']);
  const dispatch = { state: oneOf(d.state, `${path}.dispatch.state`, ['paused', 'unpaused'] as const),
    kind: d.kind === null ? null : oneOf(d.kind, `${path}.dispatch.kind`, ['operator', 'transient', 'auth', 'lead_quota', 'unknown'] as const),
    resumeAt: isoOrNull(d.resume_at, `${path}.dispatch.resume_at`) };
  if (dispatch.state === 'unpaused' && (dispatch.kind !== null || dispatch.resumeAt !== null)) fail(`${path}.dispatch`, 'unpaused project carries a pause');
  if (dispatch.state === 'paused' && dispatch.kind === null) fail(`${path}.dispatch`, 'paused project has no kind');

  const p = obj(o.plan, `${path}.plan`, ['state', 'reason', 'unreadable', 'base_commit', 'base_committed_at', 'files', 'roadmap', 'milestone_status']);
  let roadmapSource: string | null = null;
  if (p.roadmap !== null) {
    const r = obj(p.roadmap, `${path}.plan.roadmap`, ['source', 'milestones']);
    roadmapSource = str(r.source, `${path}.plan.roadmap.source`, 60);
    arr(r.milestones, `${path}.plan.roadmap.milestones`, 30).forEach((raw, i) => {
      const m = obj(raw, `${path}.plan.roadmap.milestones[${i}]`, ['id', 'title', 'status', 'status_source']);
      strOrNull(m.id, 'id', 60); strOrNull(m.title, 'title', 120); strOrNull(m.status, 'status', 300); strOrNull(m.status_source, 'status_source', 160);
    });
  }
  const planState = oneOf(p.state, `${path}.plan.state`, ['read', 'partial', 'none', 'unavailable'] as const);
  const plan = { state: planState, reason: strOrNull(p.reason, `${path}.plan.reason`, 200),
    unreadable: arr(p.unreadable, `${path}.plan.unreadable`, 8).map((x, i) => str(x, `${path}.plan.unreadable[${i}]`, 80)),
    baseCommit: hex12OrNull(p.base_commit, `${path}.plan.base_commit`), baseCommittedAt: isoOrNull(p.base_committed_at, `${path}.plan.base_committed_at`),
    files: arr(p.files, `${path}.plan.files`, 16).map((raw, i) => {
      const f = obj(raw, `${path}.plan.files[${i}]`, ['file', 'commit', 'committed_at']);
      return { file: str(f.file, `${path}.plan.files[${i}].file`, 60), commit: hex12OrNull(f.commit, `${path}.plan.files[${i}].commit`), committedAt: isoOrNull(f.committed_at, `${path}.plan.files[${i}].committed_at`) };
    }), roadmapSource, milestoneStatus: planStatuses(p.milestone_status, `${path}.plan.milestone_status`) };

  const c = counts(o.counts, `${path}.counts`);
  const sessions = intOrNull(o.sessions, `${path}.sessions`, 0, 100_000), running = intOrNull(o.running, `${path}.running`, 0, 100_000);
  const work = arr(o.work, `${path}.work`, MAX_ITEMS_PER_PROJECT).map((w, i) => workItem(w, `${path}.work[${i}]`, repo, ctx));
  const unlinked = arr(o.unlinked_prs, `${path}.unlinked_prs`, MAX_ITEMS_PER_PROJECT).map((x, i) => pullRequest(x, `${path}.unlinked_prs[${i}]`, repo, ctx, false));
  const truncated = bool(o.truncated, `${path}.truncated`);
  const unmatched = intOrNull(o.unmatched_sessions, `${path}.unmatched_sessions`, 0, 100_000);
  const errors = arr(o.errors, `${path}.errors`, 8).map((raw, i) => {
    const e = obj(raw, `${path}.errors[${i}]`, ['source', 'message']);
    return { source: oneOf(e.source, `${path}.errors[${i}].source`, ['workers', 'plan', 'github', 'github_merged'] as const), message: str(e.message, `${path}.errors[${i}].message`, 240) };
  });
  const s = obj(o.sources, `${path}.sources`, ['github', 'workers', 'plan']);
  const sources = { github: oneOf(s.github, `${path}.sources.github`, ['online', 'unavailable'] as const), workers: oneOf(s.workers, `${path}.sources.workers`, ['observed', 'unknown'] as const),
    plan: oneOf(s.plan, `${path}.sources.plan`, ['read', 'partial', 'none', 'unavailable'] as const) };

  // Cross-field consistency: the figures and the evidence that produced them must agree.
  const has = (source: string) => errors.some((e) => e.source === source);
  if ((sources.github === 'online') !== (c !== null)) fail(`${path}.sources.github`, 'disagrees with counts');
  if ((sources.workers === 'observed') !== (sessions !== null)) fail(`${path}.sources.workers`, 'disagrees with sessions');
  if (sources.plan !== planState) fail(`${path}.sources.plan`, 'disagrees with plan.state');
  if (has('github') !== (c === null) || has('workers') !== (sessions === null) || has('plan') !== (planState !== 'read')) fail(`${path}.errors`, 'error entries disagree with unknown sources');
  if (c === null) {
    if (work.length || unlinked.length || truncated || o.latest_event !== null || o.delivery !== null || running !== null || unmatched !== null) fail(path, 'GitHub-unavailable project carries work evidence');
  } else {
    if (c.sessions !== sessions || c.running !== running) fail(`${path}.counts`, 'sessions/running disagree with the project row');
    if ((unmatched === null) !== (sessions === null)) fail(`${path}.unmatched_sessions`, 'disagrees with sessions');
    if (truncated !== c.openIssues > MAX_ITEMS_PER_PROJECT || work.length !== Math.min(c.openIssues, MAX_ITEMS_PER_PROJECT)) fail(`${path}.work`, 'work coverage disagrees with open_issues/truncated');
    const eq = truncated ? (a: number, b: number) => a >= b : (a: number, b: number) => a === b;
    for (const lane of ALL_LANES) if (!eq(c[lane], work.filter((w) => w.lane === lane).length)) fail(`${path}.counts.${lane}`, 'disagrees with work items');
    if (!eq(c.blocked, work.filter((w) => w.state === 'blocked').length) || !eq(c.ready, work.filter((w) => w.state === 'ready').length)) fail(`${path}.counts`, 'blocked/ready disagree with work items');
    if (c.running !== null && !eq(c.running, work.filter((w) => w.run.observed === 'running').length)) fail(`${path}.counts.running`, 'disagrees with work items');
    if ((o.delivery === null) !== has('github_merged')) fail(`${path}.delivery`, 'disagrees with github_merged error');
  }
  if (work.some((w, i) => work.findIndex((x) => x.id === w.id) !== i)) fail(`${path}.work`, 'duplicate work id');
  const linked = new Set(work.flatMap((w) => w.prs.map((x) => x.id)));
  if (unlinked.some((x) => linked.has(x.id))) fail(`${path}.unlinked_prs`, 'a PR is both linked and unlinked');
  if (c !== null && !truncated && unlinked.length < MAX_ITEMS_PER_PROJECT && c.openPrs !== linked.size + unlinked.length) fail(`${path}.counts.open_prs`, 'disagrees with linked and unlinked PRs');

  let latestEvent: Project['latestEvent'] = null;
  if (o.latest_event !== null) {
    const e = obj(o.latest_event, `${path}.latest_event`, ['kind', 'at', 'age_seconds', 'source', 'ref']);
    const at = iso(e.at, `${path}.latest_event.at`), ageSeconds = int(e.age_seconds, `${path}.latest_event.age_seconds`, 0, 3_000_000_000);
    age(at, ageSeconds, ctx, `${path}.latest_event.age_seconds`);
    const ref = str(e.ref, `${path}.latest_event.ref`, 160);
    if (!ref.startsWith(`${repo}#`)) fail(`${path}.latest_event.ref`, 'ref is not in this project');
    latestEvent = { kind: oneOf(e.kind, `${path}.latest_event.kind`, ['worker_exit', 'issue_updated', 'pr_updated', 'pr_merged'] as const), at, ageSeconds, source: str(e.source, `${path}.latest_event.source`, 80), ref };
  }
  let del: Project['delivery'] = null;
  if (o.delivery !== null) {
    const dv = obj(o.delivery, `${path}.delivery`, ['merged', 'coverage', 'release']);
    del = { merged: arr(dv.merged, `${path}.delivery.merged`, 10).map((x, i) => delivery(x, `${path}.delivery.merged[${i}]`, repo, ctx)),
      coverage: str(dv.coverage, `${path}.delivery.coverage`, 80), release: projectRelease(dv.release, `${path}.delivery.release`) };
  }
  const goal = strOrNull(o.goal, `${path}.goal`, 240), goalSource = strOrNull(o.goal_source, `${path}.goal_source`, 60);
  if ((goal === null) !== (goalSource === null)) fail(`${path}.goal`, 'goal and goal_source must agree');
  return { id, displayName: str(o.display_name, `${path}.display_name`, 80), repo, dispatch, goal, goalSource, milestone: milestone(o.milestone, `${path}.milestone`),
    progress: progress(o.progress, `${path}.progress`), plan, counts: c, latestEvent, delivery: del, sessions, running, work, unlinkedPrs: unlinked,
    truncated, unmatchedSessions: unmatched, errors, sources };
}

function totals(v: unknown, path: string, projects: readonly Project[], scoped: boolean): Totals {
  const keys = [...ALL_LANES, 'open_issues', 'open_prs', 'blocked', 'ready', 'running', 'sessions'];
  const o = obj(v, path, ['coverage', ...keys]);
  const cv = obj(o.coverage, `${path}.coverage`, ['projects', 'with_counts', 'complete']);
  const coverage = { projects: int(cv.projects, `${path}.coverage.projects`, 0, 1000), withCounts: int(cv.with_counts, `${path}.coverage.with_counts`, 0, 1000), complete: bool(cv.complete, `${path}.coverage.complete`) };
  if (coverage.withCounts > coverage.projects || coverage.complete !== (coverage.withCounts === coverage.projects)) fail(`${path}.coverage`, 'inconsistent coverage');
  const out: Record<string, number | null> = {};
  for (const k of keys) out[k] = intOrNull(o[k], `${path}.${k}`, 0, 1_000_000);
  if (!scoped) {
    if (coverage.projects !== projects.length || coverage.withCounts !== projects.filter((p) => p.counts).length) fail(`${path}.coverage`, 'coverage disagrees with projects');
    const mapKey: Record<string, (p: Project) => number | null> = { open_issues: (p) => p.counts?.openIssues ?? null, open_prs: (p) => p.counts?.openPrs ?? null,
      blocked: (p) => p.counts?.blocked ?? null, ready: (p) => p.counts?.ready ?? null, running: (p) => p.running, sessions: (p) => p.sessions };
    for (const k of keys) {
      const pick = mapKey[k] ?? ((p: Project) => p.counts?.[k as Lane] ?? null);
      const values = projects.map(pick);
      const expected = values.every((x) => x !== null) ? values.reduce<number>((sum, x) => sum + (x as number), 0) : null;
      if (out[k] !== expected) fail(`${path}.${k}`, 'total disagrees with the project rows (or hides unknown coverage)');
    }
  } else if (projects.length !== 1) fail(path, 'scoped document must carry exactly one project');
  return { coverage, counts: out };
}

function decodeDocument(raw: unknown): StudioSnapshot {
  const head = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Obj) : fail('$', 'expected object');
  if (head.schema !== STUDIO_PROJECTION_SCHEMA) fail('$.schema', 'not a studio.projection document');
  const o = obj(raw, '$', ['schema', 'version', 'read_only', 'method', 'observed_at', 'fresh_for_seconds', 'stale_after_seconds', 'provenance', 'redaction', 'limits', 'totals', 'projects', 'errors'], ['scope']);
  if (o.read_only !== true || o.method !== 'GET') fail('$', 'projection must declare read_only GET');
  const observedMs = isoMs(o.observed_at, '$.observed_at');
  const fresh = int(o.fresh_for_seconds, '$.fresh_for_seconds', 1, 3600), staleAfter = int(o.stale_after_seconds, '$.stale_after_seconds', 60, 30 * 86_400);
  if (fresh >= staleAfter) fail('$.stale_after_seconds', 'must exceed fresh_for_seconds');
  const limits = obj(o.limits, '$.limits', ['max_projects', 'max_items_per_project']);
  if (int(limits.max_projects, '$.limits.max_projects', 1, MAX_PROJECTS) > MAX_PROJECTS || int(limits.max_items_per_project, '$.limits.max_items_per_project', 1, MAX_ITEMS_PER_PROJECT) > MAX_ITEMS_PER_PROJECT) fail('$.limits', 'beyond consumer bounds');
  const scopeRaw = o.scope === undefined ? null : obj(o.scope, '$.scope', ['project', 'note']);
  const rows = arr(o.projects, '$.projects', MAX_PROJECTS);
  if (rows.length === 0) fail('$.projects', 'no projects');
  if (rows.length > (limits.max_projects as number)) fail('$.projects', 'more projects than limits.max_projects');
  // Registered repos are those the document itself names; a scoped document cannot know the others.
  const registered = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const repo = typeof row === 'object' && row !== null ? (row as Obj).repo : undefined;
    registered.add(str(repo, `$.projects[${i}].repo`, 140));
  }
  const ctx: Ctx = { observedMs, registered, scoped: scopeRaw !== null };
  const projects = rows.map((row, i) => project(row, `$.projects[${i}]`, ctx));
  if (new Set(projects.map((p) => p.id)).size !== projects.length || registered.size !== projects.length) fail('$.projects', 'duplicate project id or repo');
  for (const p of projects) if (p.work.length > (limits.max_items_per_project as number)) fail('$.projects', 'more items than limits.max_items_per_project');
  const scope = scopeRaw && { project: str(scopeRaw.project, '$.scope.project', 41), note: str(scopeRaw.note, '$.scope.note', 160) };
  if (scope && projects[0]!.id !== scope.project) fail('$.scope.project', 'does not match the project returned');
  const flat = projects.flatMap((p) => p.errors.map((e) => `${p.id}|${e.source}|${e.message}`)).sort();
  const errors = arr(o.errors, '$.errors', 128).map((raw, i) => {
    const e = obj(raw, `$.errors[${i}]`, ['project', 'source', 'message']);
    return { project: str(e.project, `$.errors[${i}].project`, 41), source: str(e.source, `$.errors[${i}].source`, 40), message: str(e.message, `$.errors[${i}].message`, 240) };
  });
  if (JSON.stringify(errors.map((e) => `${e.project}|${e.source}|${e.message}`).sort()) !== JSON.stringify(flat)) fail('$.errors', 'top-level errors disagree with project errors');
  return { observedAt: o.observed_at as string, observedAtMs: observedMs, freshForSeconds: fresh, staleAfterSeconds: staleAfter,
    provenance: arr(o.provenance, '$.provenance', 12).map((x, i) => str(x, `$.provenance[${i}]`, 200)), redaction: str(o.redaction, '$.redaction', 300),
    scope, totals: totals(o.totals, '$.totals', projects, scopeRaw !== null), projects, errors };
}

const utf8 = new TextEncoder();
/** Decode a response body (text) or an already-parsed value. Never throws; the reason is typed and bounded. */
export function decodeStudioProjection(input: string | unknown): DecodeResult {
  let value: unknown = input, bytes = 0;
  if (typeof input === 'string') {
    if (input.length > STUDIO_PROJECTION_MAX_BYTES || (bytes = utf8.encode(input).byteLength) > STUDIO_PROJECTION_MAX_BYTES) {
      return { ok: false, kind: 'oversized', message: `Response exceeds the ${STUDIO_PROJECTION_MAX_BYTES}-byte bound and was not read.` };
    }
    try { value = JSON.parse(input); } catch { return { ok: false, kind: 'not_json', message: 'Response is not valid JSON.' }; }
  }
  const head = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : null;
  if (head && head.schema === STUDIO_PROJECTION_SCHEMA) {
    if (head.version !== STUDIO_PROJECTION_VERSION) return { ok: false, kind: 'unsupported_version', message: `Unsupported studio.projection version (this client reads ${STUDIO_PROJECTION_VERSION}).` };
    const keys = Object.keys(head);
    if (keys.length === 3 && typeof head.error === 'string') return { ok: false, kind: 'producer_unavailable', message: 'Studio reported that its projection is unavailable.' };
  }
  try {
    return { ok: true, snapshot: decodeDocument(value), bytes };
  } catch (error) {
    if (error instanceof Reject) return { ok: false, kind: 'malformed', message: error.message.slice(0, 200) };
    return { ok: false, kind: 'malformed', message: 'Response could not be validated.' };
  }
}

/** Render-time re-check for any href: only a rebuilt https://github.com path, never trusted from the decoder alone. */
export function safeGithubUrl(url: string): string | null {
  return url.length <= 300 && GITHUB_PATH.test(url) ? url : null;
}
