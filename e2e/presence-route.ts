import { expect, type Route } from '@playwright/test';

// Shared synthetic seam for the legitimate foreground-presence report (#99). The app only ever sends
// POST /api/notifications/presence with exactly { sessionId, visible }. It is fulfilled with 204 here;
// any other method, extra field or malformed payload on that path is a failure, not a pass-through,
// and every other unexpected request still reaches the calling spec's own guards.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/;

export function handlePresence(route: Route): boolean {
  const request = route.request();
  if (new URL(request.url()).pathname !== '/api/notifications/presence') return false;
  let problem: string | null = null;
  try {
    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (request.method() !== 'POST') problem = `method ${request.method()}`;
    else if (!body || Object.keys(body).sort().join(',') !== 'sessionId,visible') problem = 'unexpected fields';
    else if (typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)) problem = 'invalid sessionId';
    else if (typeof body.visible !== 'boolean') problem = 'invalid visible';
  } catch { problem = 'unreadable body'; }
  expect.soft(problem, 'presence request must be a strict POST { sessionId, visible }').toBeNull();
  void (problem ? route.abort() : route.fulfill({ status: 204, body: '' }));
  return true;
}
