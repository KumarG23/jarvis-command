import { createHash } from 'node:crypto';
import type { DeliveryInput, DeliveryStore } from './delivery-store';
import type { NotificationStore } from './notification-store';
import type { PushService } from './push-service';
import type { Presence } from './reply-notifier';
import type { DeliveryResult } from './scheduled-runs';

/** One inbox ID per stored delivery, so a replayed POST never creates a second entry or push. */
export function deliveryNotificationId(actor: string, deliveryId: string): string {
  return `ntf_${createHash('sha256').update(`${actor}\0delivery\0${deliveryId}`).digest('hex').slice(0, 32)}`;
}

/**
 * Stores a delivered scheduled message, then records its inbox entry and pushes it. The message is
 * durable before the 200; an inbox or push fault never fails the delivery (Hermes would resend
 * the same key, which replays and retries the inbox entry).
 */
export function createDeliverer(dependencies: Readonly<{
  deliveries: DeliveryStore; notifications: NotificationStore; push?: PushService | undefined; presence?: Presence | undefined;
}>) {
  return async (actor: string, input: DeliveryInput): Promise<DeliveryResult> => {
    const { delivery, replayed } = await dependencies.deliveries.record(actor, input);
    try {
      const id = deliveryNotificationId(actor, delivery.deliveryId);
      const result = await dependencies.notifications.recordDelivery(actor, {
        id, sessionId: delivery.sessionId, deliveryId: delivery.deliveryId, kind: delivery.kind, title: delivery.title, content: delivery.content,
      });
      if (result === 'created' && !dependencies.presence?.visible(actor, delivery.sessionId)) await dependencies.push?.deliverDelivery(actor, id);
    } catch { /* the stored message still shows in the chat */ }
    return { deliveryId: delivery.deliveryId, sessionId: delivery.sessionId, replayed };
  };
}
