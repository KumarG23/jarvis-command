import { createHash } from 'node:crypto';
import type { NotificationCategory } from '@jarvis-command/contracts';
import type { NotificationStore } from './notification-store';

export type RunNotification = Readonly<{
  actor: string;
  sessionId: string;
  publicRunId: string;
  /** When the run was admitted; an event cannot predate it. Bounds replay suppression. */
  runRequestedAt: string;
  category: NotificationCategory;
  /** Distinguishes repeated events of one category within a run, e.g. an approval request ID. */
  key?: string;
}>;
/** Resolves true only when the event is durably accounted for (created, duplicate or suppressed). */
export type RunNotifier = (event: RunNotification) => Promise<boolean>;

// One deterministic ID per actual event: retries, restarts and concurrent status/SSE
// observations all derive the same ID and are deduped inside the store transaction.
export function notificationId(event: RunNotification): string {
  const digest = createHash('sha256')
    .update(`${event.actor}\0${event.category}\0${event.publicRunId}\0${event.key ?? ''}`).digest('hex');
  return `ntf_${digest.slice(0, 32)}`;
}

/**
 * A notification-storage fault never breaks run status or the SSE stream: it resolves false.
 * Callers then defer terminal auditing, so the run stays unsettled in the ledger and the next
 * status read or inbox reconcile retries the same deterministic event.
 */
export function createRunNotifier(store: NotificationStore): RunNotifier {
  return async event => {
    try {
      await store.record(event.actor, {
        id: notificationId(event), category: event.category, sessionId: event.sessionId, publicRunId: event.publicRunId,
        runRequestedAt: event.runRequestedAt,
      });
      return true;
    } catch { return false; /* surfaced by the inbox read path */ }
  };
}
