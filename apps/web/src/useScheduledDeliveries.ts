import { useEffect, useState } from 'react';
import { ScheduledDeliveriesResponseSchema, type ScheduledDelivery, type SessionMessage } from '@jarvis-command/contracts';

const POLL_MS = 30_000;

/**
 * Scheduled messages Hermes delivered into this chat (reminders, cron results). Command stores them
 * itself, so they are not in Hermes history. Only Command chats can receive one. Polls while the
 * page is visible so a reminder that arrives with the chat open appears without a reload.
 * A failed read shows nothing extra: deliveries never block or replace the chat history.
 */
export function useScheduledDeliveries(sessionId: string, enabled: boolean): ScheduledDelivery[] {
  const [deliveries, setDeliveries] = useState<ScheduledDelivery[]>([]);
  useEffect(() => {
    setDeliveries([]);
    if (!enabled || !/^jc_[a-f0-9]{32}$/.test(sessionId)) return;
    let controller: AbortController | undefined;
    let stopped = false;
    const load = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      controller?.abort();
      const current = controller = new AbortController();
      try {
        const response = await fetch(`/api/live/sessions/${encodeURIComponent(sessionId)}/deliveries`, {
          credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: current.signal,
        });
        if (!response.ok || response.redirected) return;
        const page = ScheduledDeliveriesResponseSchema.parse(await response.json());
        if (stopped || current.signal.aborted || page.sessionId !== sessionId || page.deliveries.some(item => item.sessionId !== sessionId)) return;
        setDeliveries(previous => previous.length === page.deliveries.length && previous.every((item, index) => item.deliveryId === page.deliveries[index]!.deliveryId) ? previous : page.deliveries);
      } catch { /* deliveries are additive; history still renders */ }
    };
    void load();
    const timer = setInterval(() => { void load(); }, POLL_MS);
    const visible = () => { void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [sessionId, enabled]);
  return deliveries;
}

/**
 * Index of the history message each delivery follows, by time: after the last message at or before
 * its delivery time, or -1 (before everything) when none is. Messages without a time never anchor.
 */
export function placeDeliveries(deliveries: readonly ScheduledDelivery[], messages: readonly SessionMessage[]): Map<number, ScheduledDelivery[]> {
  const placed = new Map<number, ScheduledDelivery[]>();
  for (const delivery of deliveries) {
    const at = Date.parse(delivery.deliveredAt);
    let after = -1;
    messages.forEach((message, index) => { if (message.timestamp && Date.parse(message.timestamp) <= at) after = index; });
    placed.set(after, [...placed.get(after) ?? [], delivery]);
  }
  return placed;
}
