import { expect, it } from 'vitest';
import { formatMessageTime } from './formatTime';

it('formats chat timestamps relative to today', () => {
  const now = new Date(2026, 10, 14, 15, 0);
  const at = (d: number, m = 10, y = 2026) => new Date(y, m, d, 12, 5);
  expect(formatMessageTime(at(14), now)).not.toMatch(/Nov|Yesterday|2026/);
  expect(formatMessageTime(at(13), now)).toMatch(/^Yesterday /);
  expect(formatMessageTime(at(2), now)).toMatch(/Nov 2/);
  expect(formatMessageTime(at(2, 10, 2025), now)).toMatch(/2025/);
  expect(formatMessageTime('not a date', now)).toBe('');
});
