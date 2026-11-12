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

