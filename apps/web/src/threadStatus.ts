import type { ThreadState } from '@jarvis-command/contracts';
export type ThreadStatus = 'needs-you' | 'working' | 'unread' | 'idle' | 'unknown';
export const statusLabels: Record<ThreadStatus, string> = { 'needs-you': 'Needs you', working: 'Working', unread: 'Unread', idle: 'Idle', unknown: 'Unknown' };
const rank: Record<ThreadStatus, number> = { 'needs-you': 0, working: 1, unread: 2, idle: 3, unknown: 4 };
export const THREAD_STATE_TTL = 60_000;
const fresh = (time: string | null | undefined, now: number) => !!time && now - Date.parse(time) >= 0 && now - Date.parse(time) <= THREAD_STATE_TTL;
export function selectUnread(state: ThreadState | undefined, now = Date.now()): boolean | null {
  return state && fresh(state.observedAt, now) ? state.unread : null;
}
export function threadStatus(state: ThreadState | undefined, now = Date.now()): ThreadStatus {
  const runFresh = state && fresh(state.runObservedAt, now);
  if (runFresh && ['waiting-approval', 'failed', 'interrupted'].includes(state.runStatus)) return 'needs-you';
  if (runFresh && ['queued', 'running'].includes(state.runStatus)) return 'working';
  if (selectUnread(state, now) === true) return 'unread';
  if (runFresh && selectUnread(state, now) === false && ['completed', 'cancelled', 'idle'].includes(state.runStatus)) return 'idle';
  return 'unknown';
}
export function sortThreads(ids: readonly string[], states: Readonly<Record<string, ThreadState>>, now = Date.now()) {
  return [...ids].sort((a, b) => rank[threadStatus(states[a], now)] - rank[threadStatus(states[b], now)]
    || (Date.parse(states[b]?.recentAt ?? '') || 0) - (Date.parse(states[a]?.recentAt ?? '') || 0) || a.localeCompare(b));
}
export function summarizeThreads(ids: readonly string[], states: Readonly<Record<string, ThreadState>>, now = Date.now()): ThreadStatus {
  return threadStatus(states[sortThreads(ids, states, now)[0] ?? ''], now);
}
export const delegatedRouteUnavailable = 'Delegated thread model defaults unavailable: Hermes must expose an exact authorized thread-to-session route binding with approved model lock and attributable execution receipt. Use this chat’s existing next-run model selector; requested settings are not executed-route evidence.';

// Responses can arrive in reverse order, even with identical millisecond timestamps.
// Canonical positions and read identities preserve both a newer tail and a newer clear.
export function mergeThreadState(old: ThreadState | undefined, next: ThreadState): ThreadState {
  if (!old) return next;
  if (old.latest && next.latest && next.latest.position < old.latest.position) return old;
  if ((next.latest?.position ?? -1) <= (old.latest?.position ?? -1) && Date.parse(next.observedAt) < Date.parse(old.observedAt)) return old;
  const lastRead = (old.lastRead?.position ?? -1) > (next.lastRead?.position ?? -1) ? old.lastRead : next.lastRead;
  return { ...next, lastRead, unread: !next.historyComplete ? null : next.latest ? !(lastRead?.messageId === next.latest.messageId && lastRead.position === next.latest.position) : false };
}
