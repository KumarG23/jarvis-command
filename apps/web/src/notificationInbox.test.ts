import { expect, it } from 'vitest';
import { NotificationInboxSchema, NotificationTargetSchema } from '@jarvis-command/contracts';
import { inboxIn, knownItems } from './notificationInbox';

const known = { id: 'ntf_' + 'a'.repeat(32), category: 'run-completed', observedAt: '2026-11-12T18:00:00Z', sessionId: 'jc_' + 'b'.repeat(32), publicRunId: 'jcr_' + 'c'.repeat(32), title: 'Run finished', body: 'Done.', readAt: null };
const future = { ...known, id: 'ntf_' + 'd'.repeat(32), category: 'something-new', future: true };
const inbox = {
  version: 1, items: [known, future], unreadCount: 2, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } },
  delivery: { inApp: 'incomplete', push: 'unavailable', externalSurfaces: 'unavailable' },
};

it('skips inbox items this build does not understand instead of failing the inbox', () => {
  expect(NotificationInboxSchema.safeParse(inbox).success).toBe(false);
  const parsed = NotificationInboxSchema.parse(knownItems(inbox));
  expect(parsed.items.map(item => item.id)).toEqual([known.id]);
  expect(parsed.unreadCount).toBe(1);
  expect(knownItems({ ...inbox, items: [known], unreadCount: 1 })).toEqual({ ...inbox, items: [known], unreadCount: 1 });
  // Malformed envelopes still fail validation.
  expect(NotificationInboxSchema.safeParse(knownItems({ ...inbox, version: 2 })).success).toBe(false);
});

it('applies the same rule to an open target’s inbox', () => {
  const target = { state: 'available', sessionId: known.sessionId, approvalPending: false, session: { id: known.sessionId, title: 'Chat', source: 'api_server', ownership: 'command', model: null, lastActive: '2026-11-12T18:00:00Z', messageCount: 1, toolCallCount: 0, pinned: false }, inbox };
  expect(NotificationTargetSchema.parse(inboxIn(target))).toMatchObject({ state: 'available', inbox: { unreadCount: 1 } });
  expect(inboxIn({ state: 'missing' })).toEqual({ state: 'missing' });
});
