import { expect, it } from 'vitest';
import { KeyedSerialQueue } from './keyed-serial-queue';

it('runs operations for the same key in FIFO order', async () => {
  const queue = new KeyedSerialQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>(resolve => { releaseFirst = resolve; });
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });

  const first = queue.run('session', async () => {
    events.push('first:start');
    markFirstStarted();
    await firstBlocked;
    events.push('first:end');
  });
  await firstStarted;
  const second = queue.run('session', async () => { events.push('second'); });

  expect(events).toEqual(['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  expect(events).toEqual(['first:start', 'first:end', 'second']);
});

it('releases the next operation when its predecessor rejects', async () => {
  const queue = new KeyedSerialQueue();
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
  let rejectFirst!: (error: Error) => void;
  const firstBlocked = new Promise<never>((_resolve, reject) => { rejectFirst = reject; });
  const first = queue.run('session', async () => {
    markFirstStarted();
    return firstBlocked;
  });
  await firstStarted;
  const second = queue.run('session', async () => 'released');

  rejectFirst(Error('injected failure'));
  await expect(first).rejects.toThrow('injected failure');
  await expect(second).resolves.toBe('released');
});

it('does not serialize independent keys', async () => {
  const queue = new KeyedSerialQueue();
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>(resolve => { releaseFirst = resolve; });
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
  const first = queue.run('first', async () => { markFirstStarted(); await firstBlocked; });
  await firstStarted;

  await expect(queue.run('second', async () => 'concurrent')).resolves.toBe('concurrent');
  releaseFirst();
  await first;
});
