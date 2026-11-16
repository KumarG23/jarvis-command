import { NotificationItemSchema } from '@jarvis-command/contracts';

/**
 * Forward compatibility: drops inbox items this build doesn't understand (for example a category
 * added by a newer server) instead of failing the whole inbox. Everything else is still validated.
 */
export function knownItems(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown }).items)) return raw;
  const inbox = raw as { items: unknown[]; unreadCount?: unknown };
  const items = inbox.items.filter(item => NotificationItemSchema.safeParse(item).success);
  if (items.length === inbox.items.length) return raw;
  return { ...inbox, items, unreadCount: items.filter(item => (item as { readAt: unknown }).readAt === null).length };
}
export const inboxIn = (raw: unknown) => {
  if (!raw || typeof raw !== 'object' || !('inbox' in raw)) return raw;
  return { ...raw, inbox: knownItems((raw as { inbox: unknown }).inbox) };
};


type ShownNotification = Pick<Notification, 'tag' | 'close'>;
type RegistrationLookup = { getRegistration: (scope?: string) => Promise<{ getNotifications: () => Promise<ShownNotification[]> } | undefined> };

/**
 * Removes phone/desktop alerts for inbox items that are now read, so "Mark read" (here or on
 * another device) also clears the system tray. Each alert's tag is its inbox item id.
 * Best effort: unsupported browsers or a missing worker change nothing.
 */
export async function closeReadAlerts(
  inbox: { items: ReadonlyArray<{ id: string; readAt: string | null }> },
  serviceWorker: RegistrationLookup | undefined = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker as unknown as RegistrationLookup | undefined,
) {
  const read = new Set(inbox.items.filter(item => item.readAt !== null).map(item => item.id));
  if (read.size === 0 || !serviceWorker) return 0;
  try {
    const registration = await serviceWorker.getRegistration('/');
    if (!registration?.getNotifications) return 0;
    const shown = await registration.getNotifications();
    let closed = 0;
    for (const alert of shown) if (read.has(alert.tag)) { alert.close(); closed++; }
    return closed;
  } catch { return 0; }
}
