import { expect, it } from 'vitest';
import { unavailableDefaultRead } from '../../../e2e/routing-defaults-route';
const thread = { scope: 'thread' as const, sessionId: 'jc_' + 'a'.repeat(32), projectId: null };
const project = { scope: 'project' as const, projectId: 'room_' + 'b'.repeat(32) };
const url = new URL('http://synthetic.invalid/api/live/routing-defaults/read');
it.each([thread, project])('returns strictly bound unavailable requested readback for %j', target => {
  expect(unavailableDefaultRead('POST', url, target, [target])).toEqual({ target, revision: 0, selection: null, replayed: false, writesAvailable: false });
});
it.each([
  ['GET', url, thread],
  ['POST', new URL(url + '?scope=other'), thread],
  ['POST', url, { ...thread, sessionId: 'external' }],
  ['POST', url, { ...thread, sessionId: 'jc_' + 'c'.repeat(32) }],
  ['POST', url, { ...thread, projectId: project.projectId }],
  ['POST', url, project],
  ['POST', url, { ...thread, actor: 'forged' }],
  ['POST', url, null],
] as const)('rejects malformed, wrong-method or wrong-scope read %j', (method, targetUrl, body) => {
  expect(() => unavailableDefaultRead(method, targetUrl, body, [thread])).toThrow();
});
it.each(['/api/live/routing-defaults/set', '/api/live/runs', '/api/live/sessions', '/api/unexpected'])('leaves %s for existing strict mutation guards', path => {
  expect(unavailableDefaultRead('POST', new URL(path, url), thread, [thread])).toBeNull();
});
