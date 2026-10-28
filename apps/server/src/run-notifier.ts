import { createHash } from 'node:crypto';
import type { NotificationCategory } from '@jarvis-command/contracts';
import type { NotificationStore } from './notification-store';

export type RunNotification = Readonly<{
  actor: string;
  sessionId: string;
  publicRunId: string;
  category: NotificationCategory;
  /** Distinguishes repeated events of one category within a run, e.g. an approval request ID. */
  key?: string;
}>;
export type RunNotifier = (event: RunNotification) => Promise<void>;

// One deterministic ID per actual event: retries, restarts and concurrent status/SSE
// observations all derive the same ID and are deduped inside the store transaction.
export function notificationId(event: RunNotification): string {
  const digest = createHash('sha256')
    .update(`${event.actor}\0${event.category}\0${event.publicRunId}\0${event.key ?? ''}`).digest('hex');
  return `ntf_${digest.slice(0, 32)}`;
}

/**
 * Recording is best-effort by design: a notification-storage fault must never break run
 * status, the SSE stream, or terminal auditing. The inbox read path reports storage faults.
 */
export function createRunNotifier(store: NotificationStore): RunNotifier {
  return async event => {
    try {
      await store.record(event.actor, {
        id: notificationId(event), category: event.category, sessionId: event.sessionId, publicRunId: event.publicRunId,
      });
    } catch { /* surfaced by the inbox read path */ }
  };
}
