import { expect, type Route } from '@playwright/test';
import { ThreadStateSchema } from '@jarvis-command/contracts';

// Only explicitly listed synthetic sessions are served.
// Legacy fixtures have no authoritative run/history observation. Return Unknown,
// never Idle or unread: this cannot cause a read write or admit a run. Other
// paths (including POST /read) still reach each spec's strict mutation guards.
export function handleThreadState(route: Route, sessionIds: readonly string[]): boolean {
  const request = route.request(), url = new URL(request.url());
  const match = /^\/api\/live\/sessions\/(jc_[a-f0-9]{32})\/thread-state$/.exec(url.pathname);
  if (!match || !sessionIds.includes(match[1]!)) return false;
  const valid = request.method() === 'GET' && url.search === '';
  expect.soft(valid, 'thread-state fixture is a query-free GET only').toBe(true);
  void (valid ? route.fulfill({ json: ThreadStateSchema.parse({
    sessionId: match[1], observedAt: new Date().toISOString(), runStatus: 'unknown',
    recentAt: null, runObservedAt: null, latest: null, lastRead: null,
    unread: null, historyComplete: false,
  }) }) : route.abort());
  return true;
}
