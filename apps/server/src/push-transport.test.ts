import { EventEmitter } from 'node:events';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { afterEach, expect, it, vi } from 'vitest';
import { restrictedPushTransport } from './push-service';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const details = { endpoint: 'https://fcm.googleapis.com/fcm/send/SYNTHETIC', headers: {}, body: Buffer.alloc(100) };
it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254'])('never connects when approved hostname resolves to %s', async address => {
  vi.mocked(lookup).mockResolvedValue([{ address, family: 4 }] as never);
  await expect(restrictedPushTransport(details)).rejects.toThrow('unknown');
  expect(request).not.toHaveBeenCalled();
});
it('pins the validated address, preserves TLS hostname and does not follow redirects or consume response bodies', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  const response = { statusCode: 302, destroy: vi.fn() };
  const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  vi.mocked(request).mockImplementation((...args: unknown[]) => {
    const options = args[1] as { agent: boolean; family: number; lookup: (host: string, opts: unknown, callback: (...args: unknown[]) => void) => void };
    expect(args[0]).toBe(details.endpoint); expect(options.agent).toBe(false); expect(options.family).toBe(4);
    const resolved = vi.fn(); options.lookup('fcm.googleapis.com', {}, resolved);
    expect(resolved).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    req.end.mockImplementation(() => queueMicrotask(() => (args[2] as (r: unknown) => void)(response)));
    return req as never;
  });
  expect(await restrictedPushTransport(details)).toBe(302);
  expect(request).toHaveBeenCalledTimes(1); expect(response.destroy).toHaveBeenCalledTimes(1);
});
it('bounds hanging DNS absolutely and never connects if DNS resolves after timeout', async () => {
  vi.useFakeTimers();
  let complete: (value: unknown) => void = () => {};
  vi.mocked(lookup).mockImplementation(() => new Promise(resolve => { complete = resolve; }) as never);
  const done = expect(restrictedPushTransport(details)).rejects.toThrow('unknown');
  await vi.advanceTimersByTimeAsync(5000); await done;
  complete([{ address: '8.8.8.8', family: 4 }]); await Promise.resolve();
  expect(request).not.toHaveBeenCalled();
});
it('destroys hanging connections at the finite deadline, with no retry', async () => {
  vi.useFakeTimers();
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  vi.mocked(request).mockReturnValue(req as never);
  const done = expect(restrictedPushTransport(details)).rejects.toThrow('unknown');
  await vi.advanceTimersByTimeAsync(5000); await done;
  expect(req.destroy).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1);
});
it('rejects oversized payload before DNS or any network work', async () => {
  await expect(restrictedPushTransport({ ...details, body: Buffer.alloc(4097) })).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});
