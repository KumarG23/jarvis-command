import { createHash } from 'node:crypto';
import type { NotificationCategory } from '@jarvis-command/contracts';
import type { NotificationStore } from './notification-store';
import type { PushService } from './push-service';
import type { Presence } from './reply-notifier';

export type RunNotification = Readonly<{
  actor: string;
  sessionId: string;
  publicRunId: string;
  /** Terminal audit time, or this approval observation's time (not historical event identity). */
  eventAt: string;
  category: NotificationCategory;
  /** Distinguishes repeated events of one category within a run, e.g. an approval request ID. */
  key?: string;
  /** Also push this run-completed item (generic text) because no reply item was verified for it. */
  pushFallback?: boolean;
  /** Bounded first line of the run's output. Goes only into the encrypted push, never the inbox item. */
  preview?: string;
}>;
/** Resolves true only when the event is durably accounted for (created, duplicate or suppressed). */
export type RunNotifier = (event: RunNotification) => Promise<boolean>;

// One deterministic ID per actual event: retries, restarts and concurrent status/SSE
// observations all derive the same ID and are deduped inside the store transaction.
export function notificationId(event: Pick<RunNotification, 'actor' | 'category' | 'publicRunId' | 'key'>): string {
  const digest = createHash('sha256')
    .update(`${event.actor}\0${event.category}\0${event.publicRunId}\0${event.key ?? ''}`).digest('hex');
  return `ntf_${digest.slice(0, 32)}`;
}

/**
 * A notification-storage fault never breaks run status, the SSE stream or terminal auditing: it
 * resolves false. The ledger already holds the terminal fact, so the inbox reconcile re-delivers
 * the same deterministic event once storage recovers.
 */
export function createRunNotifier(store: NotificationStore, push?: PushService, presence?: Presence): RunNotifier {
  return async event => {
    try {
      const id = notificationId(event);
      const result = await store.record(event.actor, {
        id, category: event.category, sessionId: event.sessionId, publicRunId: event.publicRunId,
        eventAt: event.eventAt,
      });
      // Only the call that created the item may push, and never while the chat is on screen.
      if (result === 'created' && event.pushFallback && event.category === 'run-completed'
        && !presence?.visible(event.actor, event.sessionId)) await push?.deliverRun(event.actor, id, event.preview);
      return true;
    } catch { return false; /* surfaced by the inbox read path */ }
  };
}
