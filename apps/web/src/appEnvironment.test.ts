import { afterEach, expect, it, vi } from 'vitest';
import { appStorageKey, recoverSignIn } from './appEnvironment';

afterEach(() => { window.history.replaceState(null, '', '/'); vi.unstubAllEnvs(); vi.resetModules(); });
const preview = '/api/preview/chat-first/';
it.each(['path', 'build'])('isolates preview recovery from production by %s', async mode => {
  const replace = vi.fn(), getRegistration = vi.fn();
  await recoverSignIn({ origin: window.location.origin, pathname: mode === 'path' ? preview : '/', replace }, { getRegistration }, mode === 'build' ? preview : '/');
  expect(replace).toHaveBeenCalledExactlyOnceWith(preview);
  expect(getRegistration).not.toHaveBeenCalled();
});
it('preserves exact production worker validation and recovery destination', async () => {
  const unregister = vi.fn(async () => true), replace = vi.fn();
  const registration = { scope: `${window.location.origin}/`, active: { scriptURL: `${window.location.origin}/sw.js` }, unregister };
  const getRegistration = vi.fn(async () => registration as unknown as ServiceWorkerRegistration);
  await recoverSignIn({ origin: window.location.origin, pathname: '/', replace }, { getRegistration }, '/');
  expect(getRegistration).toHaveBeenCalledWith('/');
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledExactlyOnceWith('/api/auth/recover');
  registration.active.scriptURL = `${window.location.origin}/unrelated.js`;
  await expect(recoverSignIn({ origin: window.location.origin, pathname: '/', replace }, { getRegistration }, '/')).rejects.toThrow();
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledTimes(1);
});
it('keeps production pending-run identity intact while preview writes and clears its own record', async () => {
  const key = 'jarvis-command:live-turn';
  const identity = { sessionId: 'jc_test', clientRequestId: '12345678-1234-4234-8234-123456789abc', publicRunId: 'jcr_' + 'a'.repeat(32) };
  sessionStorage.setItem(key, JSON.stringify(identity));
  window.history.replaceState(null, '', preview);
  vi.resetModules();
  const recovery = await import('./turnRecovery');
  expect(recovery.readRecovery()).toBeNull();
  recovery.writeRecovery(identity, null);
  expect(recovery.readRecovery()).toEqual(identity);
  recovery.clearRecovery(identity);
  expect(sessionStorage.getItem(key)).toBe(JSON.stringify(identity));
  for (const viewKey of ['jarvis-command:project-room:v1', 'jarvis-command:selected-session:v1']) {
    expect(appStorageKey(viewKey)).not.toBe(viewKey);
  }
  window.history.replaceState(null, '', '/');
  expect(appStorageKey(key)).toBe(key);
});
it('keeps unknown paths and failed worker removal from navigating through root recovery', async () => {
  const replace = vi.fn(), unregister = vi.fn(async () => false);
  const getRegistration = vi.fn(async () => ({ scope: `${window.location.origin}/`, active: { scriptURL: `${window.location.origin}/sw.js` }, unregister }) as unknown as ServiceWorkerRegistration);
  await expect(recoverSignIn({ origin: window.location.origin, pathname: '/unrelated/', replace }, { getRegistration }, '/')).rejects.toThrow();
  expect(getRegistration).not.toHaveBeenCalled();
  await expect(recoverSignIn({ origin: window.location.origin, pathname: '/', replace }, { getRegistration }, '/')).rejects.toThrow();
  expect(replace).not.toHaveBeenCalled();
});
