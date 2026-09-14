import {
  SessionContextResponseSchema,
  type LiveRunUsage,
  type LiveCompaction,
  type SessionContextResponse,
} from '@jarvis-command/contracts';
import { useEffect, useState } from 'react';

import { boundedJson } from './useLiveTurn';

type Props = Readonly<{
  enabled: boolean;
  sessionId: string | null;
  liveUsage: LiveRunUsage | null;
  compaction?: LiveCompaction | null;
}>;

export function SessionContextMeter({ enabled, sessionId, liveUsage, compaction }: Props) {
  const [snapshot, setSnapshot] = useState<SessionContextResponse | null>(null);

  useEffect(() => {
    setSnapshot(null);
    if (!enabled || !sessionId) return;
    if (liveUsage) {
      setSnapshot({
        sessionId,
        state: 'available',
        updatedAt: new Date().toISOString(),
        receipt: liveUsage,
      });
      return;
    }

    const controller = new AbortController();
    void boundedJson(
      `/api/live/sessions/${encodeURIComponent(sessionId)}/context`,
      { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } },
      controller,
    ).then((value) => {
      const parsed = SessionContextResponseSchema.parse(value);
      if (!controller.signal.aborted && parsed.sessionId === sessionId) setSnapshot(parsed);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setSnapshot({ sessionId, state: 'unavailable', updatedAt: null, receipt: null });
      }
    });
    return () => controller.abort();
  }, [enabled, sessionId, liveUsage]);

  if (!enabled || !sessionId) return null;
  const context = snapshot?.receipt?.context;
  const lifecycleLabel = compaction?.state === 'running'
    ? 'Compacting'
    : compaction?.state === 'completed'
      ? 'Compacted'
      : compaction?.state === 'aborted'
        ? 'Compact stopped'
        : 'Context';
  if (!context) {
    return <div className={`session-context unavailable${compaction?.state === 'running' ? ' compacting' : ''}`} aria-label={compaction?.state === 'running' ? 'Context compaction running' : 'Context usage unavailable'} title="Hermes has not reported context usage for this chat yet">
      <span>{lifecycleLabel}</span><small>—</small>
    </div>;
  }

  const percentage = context.usedTokens / context.limitTokens * 100;
  const bounded = Math.min(100, percentage);
  const tone = percentage >= 85 ? 'critical' : percentage >= 70 ? 'warning' : 'normal';
  const formatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  const title = `Hermes effective context: ${formatter.format(context.usedTokens)} of ${formatter.format(context.limitTokens)} tokens`;
  return <div className={`session-context ${tone}${compaction?.state === 'running' ? ' compacting' : ''}`} title={`${title}${compaction ? ` · ${lifecycleLabel}` : ''}`}>
    <span>{lifecycleLabel}</span>
    <div className="session-context-track" role="progressbar" aria-label="Context usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bounded)}>
      <i className="session-context-fill" style={{ width: `${bounded}%` }} />
      <i className="session-context-marker warning-marker" aria-hidden="true" />
      <i className="session-context-marker critical-marker" aria-hidden="true" />
    </div>
    <strong>{percentage.toFixed(0)}%</strong>
  </div>;
}
