import { expect, it } from 'vitest';
import { NotificationItemSchema, NotificationPreferencesSchema } from './notifications';

const base = { id: `ntf_${'1'.repeat(32)}`, observedAt: '2026-11-06T12:00:00.000Z', sessionId: `jc_${'2'.repeat(32)}`, publicRunId: `jcr_${'3'.repeat(32)}`, title: 'T', body: 'B', readAt: null };

it('keeps run-state items unchanged and requires reply metadata exactly for assistant-reply items', () => {
  expect(NotificationItemSchema.safeParse({ ...base, category: 'approval' }).success).toBe(true);
  expect(NotificationItemSchema.safeParse({ ...base, category: 'assistant-reply', reply: { messageId: 'm:1', label: null } }).success).toBe(true);
  expect(NotificationItemSchema.safeParse({ ...base, category: 'assistant-reply' }).success).toBe(false);
  expect(NotificationItemSchema.safeParse({ ...base, category: 'approval', reply: { messageId: 'm:1', label: null } }).success).toBe(false);
});

it('accepts the optional reply-text preference but no reply category toggle', () => {
  const categories = { 'run-completed': true, 'run-failed': true, approval: true };
  expect(NotificationPreferencesSchema.safeParse({ categories }).success).toBe(true);
  expect(NotificationPreferencesSchema.safeParse({ categories, showReplyText: false }).success).toBe(true);
  expect(NotificationPreferencesSchema.safeParse({ categories: { ...categories, 'assistant-reply': true } }).success).toBe(false);
  expect(NotificationPreferencesSchema.safeParse({ categories, showReplyText: 'no' }).success).toBe(false);
});
