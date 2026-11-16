import { expect, it } from 'vitest';
import { chatTitle, sourceLabel, splitRecent } from './chatTitle';

it('names untitled outside sessions by where they came from', () => {
  expect(chatTitle({ title: 'Untitled session', source: 'discord' })).toBe('Discord chat');
  expect(chatTitle({ title: 'Untitled session', source: 'cron' })).toBe('Scheduled job');
  expect(chatTitle({ title: 'Untitled session', source: 'unknown' })).toBe('Jarvis session');
  expect(chatTitle({ title: 'Disk check', source: 'cron' })).toBe('Disk check');
  expect(sourceLabel('home_assistant')).toBe('Home assistant session');
});

it('keeps Command chats in Recent chats and moves outside sessions to their own group, dropping empty ones', () => {
  const own = { id: 'jc_1', ownership: 'command' as const, messageCount: 0 };
  const discord = { id: 'd1', ownership: 'external' as const, messageCount: 4 };
  const empty = { id: 'c1', ownership: 'external' as const, messageCount: 0 };
  expect(splitRecent([own, discord, empty])).toEqual({ own: [own], other: [discord] });
  expect(splitRecent([own, discord, empty], 'c1').other).toEqual([discord, empty]);
});
