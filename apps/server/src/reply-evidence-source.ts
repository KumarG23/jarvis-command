import type { AuditLedger } from './audit-ledger';
import type { CommandProxyClient } from './command-client';
import type { ReplyEvidence, ReplyEvidenceSource } from './reply-notifier';

// Finite read bounds for one resolution: one status GET plus at most PAGES history GETs.
export const REPLY_HISTORY_PAGE_ROWS = 50;
export const REPLY_HISTORY_MAX_PAGES = 4;
// UTF-8 bytes of message content across the whole window (the client separately bounds each response's wire size).
export const REPLY_HISTORY_MAX_CONTENT_BYTES = 1_048_576;

type Dependencies = Readonly<{
  client: Pick<CommandProxyClient, 'getRun' | 'getMessages'>;
  ledger: Pick<AuditLedger, 'findRunByPublicId'>;
}>;

/**
 * Server-only resolver for #170. NOT wired into production: `REPLY_EVIDENCE_SOURCE` stays undefined.
 * `run.actor` is already the actor fingerprint. The same admitted ledger record must match actor,
 * public run and session before any upstream read. The one assistant message is then found by the
 * run's own exact binding id in that session's paginated history; never by text, order or time.
 * Every gap yields null (nothing is guessed).
 */
export function createReplyEvidenceSource({ client, ledger }: Dependencies): ReplyEvidenceSource {
  return async (run): Promise<ReplyEvidence | null> => {
    try {
      const record = ledger.findRunByPublicId(run.actor, run.publicRunId);
      if (!record || !record.upstreamRunId || record.actor !== run.actor
        || record.publicRunId !== run.publicRunId || record.sessionId !== run.sessionId) return null;

      const status = await client.getRun(record.upstreamRunId);
      const binding = status.historyBinding;
      if (!binding || status.runId !== record.upstreamRunId || status.sessionId !== record.sessionId
        || status.status !== 'completed' || status.kind === 'context_compaction') return null;

      // The whole finite window is always read before accepting: a conflicting duplicate on any
      // later page inside it yields null. A duplicate beyond the window cannot be excluded; that is
      // outside what this bounded resolver establishes (native ids are unique per session).
      let scanned = 0;
      let target: { id: string; sessionId: string; role: string; content: string } | null = null;
      for (let page = 0; page < REPLY_HISTORY_MAX_PAGES; page++) {
        const result = await client.getMessages(record.sessionId, REPLY_HISTORY_PAGE_ROWS, page * REPLY_HISTORY_PAGE_ROWS);
        for (const message of result.messages) {
          scanned += Buffer.byteLength(message.content);
          if (message.id !== binding.assistantMessageId) continue;
          if (target) return null; // duplicate id: conflicting evidence
          target = message;
        }
        if (scanned > REPLY_HISTORY_MAX_CONTENT_BYTES) return null;
        if (!result.pagination.hasMore) break;
      }
      if (!target || target.sessionId !== record.sessionId || target.role !== 'assistant' || !target.content.trim()) return null;

      // Executed identity only from this exact run's receipt; requested or session-latest never.
      const model = status.usage?.execution?.executed.model ?? record.receipt?.execution?.executed.model ?? null;
      return {
        userMessageId: binding.userMessageId,
        assistantMessageId: binding.assistantMessageId,
        message: target,
        executed: { model },
      };
    } catch { return null; }
  };
}
