import { SessionContextResponseSchema, type LiveRunUsage } from '@jarvis-command/contracts';
import { useEffect, useState } from 'react';
import { ExecutionReceipt } from './TurnView';
import { boundedJson } from './useLiveTurn';

// The existing endpoint binds this receipt to the session, not a message/run ID.
// Keep it separate from message cards; never infer a binding from text or recency.
export function HistoryReceipt({ sessionId, refreshKey }: Readonly<{ sessionId: string; refreshKey: string }>) {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; refreshKey: string; usage: LiveRunUsage | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void boundedJson(`/api/live/sessions/${encodeURIComponent(sessionId)}/context`, {
      credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' },
    }, controller).then(value => {
      const parsed = SessionContextResponseSchema.parse(value);
      if (parsed.sessionId !== sessionId) throw new Error('Receipt session mismatch');
      if (!controller.signal.aborted) {
        setSnapshot({ sessionId, refreshKey, usage: parsed.state === 'available' ? parsed.receipt : null });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ sessionId, refreshKey, usage: null });
    });
    return () => controller.abort();
  }, [sessionId, refreshKey]);
  const current = snapshot?.sessionId === sessionId && snapshot.refreshKey === refreshKey ? snapshot : null;
  return <aside className="history-receipt" aria-label="Saved session receipt">
    <p>Latest saved session receipt · Individual message association unavailable</p>
    {current?.usage ? <ExecutionReceipt usage={current.usage} /> : <p>{current ? 'Saved receipt unavailable' : 'Loading saved receipt…'}</p>}
  </aside>;
}
