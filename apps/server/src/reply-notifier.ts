import { createHash } from 'node:crypto';
import type { PushService } from './push-service';
import type { NotificationStore } from './notification-store';
import { executedLabel, replyPreview } from './reply-preview';

/**
 * Reply notifications (#99). One category: a verified final assistant message. Nothing here reads
 * run output, "latest" history rows or receipts; the only text is the history message that the
 * evidence source bound to this exact session, message and run.
 */
export type ReplyRun = Readonly<{ actor: string; sessionId: string; publicRunId: string; eventAt: string }>;
export type ReplyEvidence = Readonly<{
  userMessageId: string;
  assistantMessageId: string;
  /** The persisted history message the binding names, as read from the run's own session. */
  message: Readonly<{ id: string; sessionId: string; role: string; content: string }>;
  /** Executed (not requested) identity of this run, or null when unknown. */
  executed: Readonly<{ model: string | null }> | null;
}>;
/** Resolves the durable run -> message binding. Resolves null when it is not proven. */
export type ReplyEvidenceSource = (run: ReplyRun) => Promise<ReplyEvidence | null>;

/**
 * No production source exists: the installed Hermes contract does not provide an exact
 * message<->run binding (accepted #9 Unsupported, BFF never sets `historyBinding`). Wiring a
 * verified source here is the only change needed once that contract exists.
 */
export const REPLY_EVIDENCE_SOURCE: ReplyEvidenceSource | undefined = undefined;

export type ReplyState = 'disabled' | 'unsupported' | 'available';
export const replyState = (enabled: boolean, source: ReplyEvidenceSource | undefined): ReplyState => (
  !enabled ? 'disabled' : source ? 'available' : 'unsupported'
);

// One ID per exact final message for the actor; run ids, retries and timestamps never enter it.
export const replyNotificationId = (actor: string, sessionId: string, messageId: string): string => (
  `ntf_${createHash('sha256').update(`${actor}\0assistant-reply\0${sessionId}\0${messageId}`).digest('hex').slice(0, 32)}`
);

export type VerifiedReply = Readonly<{ messageId: string; preview: string; label: string | null }>;
export function verifyReply(run: ReplyRun, evidence: ReplyEvidence): VerifiedReply | null {
  const { message } = evidence;
  if (!evidence.assistantMessageId || !evidence.userMessageId || evidence.assistantMessageId === evidence.userMessageId) return null;
  if (message.id !== evidence.assistantMessageId || message.sessionId !== run.sessionId || message.role !== 'assistant') return null;
  const preview = replyPreview(message.content);
  if (!preview) return null;
  return { messageId: message.id, preview, label: executedLabel(evidence.executed?.model) };
}

/** Bounded, in-memory, best-effort "this session is on screen" marks. Stale or absent means not visible. */
export function createPresence(now: () => number = Date.now, ttlMs = 20_000, capacity = 256) {
  const marks = new Map<string, number>();
  const key = (actor: string, sessionId: string) => `${actor}\0${sessionId}`;
  return {
    mark(actor: string, sessionId: string, visible: boolean) {
      marks.delete(key(actor, sessionId));
      if (!visible) return;
      marks.set(key(actor, sessionId), now() + ttlMs);
      for (const [stale, until] of marks) if (until <= now()) marks.delete(stale);
      while (marks.size > capacity) marks.delete(marks.keys().next().value!);
    },
    visible: (actor: string, sessionId: string) => (marks.get(key(actor, sessionId)) ?? 0) > now(),
  };
}
export type Presence = ReturnType<typeof createPresence>;

export type ReplyNotifier = (run: ReplyRun) => Promise<boolean>;
/** Never throws: a fault leaves the audit, status and stream untouched and sends nothing further. */
export function createReplyNotifier(options: Readonly<{
  store: NotificationStore; push?: PushService | undefined; enabled: boolean;
  source: ReplyEvidenceSource | undefined; presence?: Presence | undefined;
}>): ReplyNotifier {
  const handled = new Set<string>(); // bounded memo so repeated status polls do not re-read evidence
  return async run => {
    if (!options.enabled || !options.source || handled.has(run.publicRunId)) return false;
    try {
      const evidence = await options.source(run);
      const reply = evidence && verifyReply(run, evidence);
      if (!reply) return false;
      const id = replyNotificationId(run.actor, run.sessionId, reply.messageId);
      const result = await options.store.recordReply(run.actor, { id, ...run, ...reply });
      handled.add(run.publicRunId);
      if (handled.size > 512) handled.delete(handled.values().next().value!);
      // Only the call that created the item may push; duplicates/suppressed never re-send.
      if (result === 'created' && !options.presence?.visible(run.actor, run.sessionId)) await options.push?.deliverReply(run.actor, id);
      return true;
    } catch { return false; }
  };
}
