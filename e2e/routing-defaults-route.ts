import { expect, type Route } from '@playwright/test';
import { RoutingDefaultResponseSchema, RoutingDefaultTargetSchema, type RoutingDefaultTarget } from '@jarvis-command/contracts';

// A POST read is not a preference mutation. Only explicitly listed synthetic
// targets are served, always unavailable; set/run/other operations fall through
// to the caller's unchanged mutation guards and request accounting.
export function unavailableDefaultRead(method: string, url: URL, body: unknown, targets: readonly RoutingDefaultTarget[]) {
  if (url.pathname !== '/api/live/routing-defaults/read') return null;
  if (method !== 'POST' || url.search !== '') throw Error('defaults fixture requires query-free POST read');
  const target = RoutingDefaultTargetSchema.parse(body);
  if (!targets.some(allowed => JSON.stringify(RoutingDefaultTargetSchema.parse(allowed)) === JSON.stringify(target))) throw Error('unlisted defaults target');
  return RoutingDefaultResponseSchema.parse({ target, revision: 0, selection: null, replayed: false, writesAvailable: false });
}
export function handleDefaultRead(route: Route, targets: readonly RoutingDefaultTarget[], reads: RoutingDefaultTarget[]): boolean {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname !== '/api/live/routing-defaults/read') return false;
  try {
    const response = unavailableDefaultRead(request.method(), url, request.postDataJSON(), targets)!;
    reads.push(response.target);
    void route.fulfill({ json: response });
  } catch {
    expect.soft(false, 'defaults read must be a strict POST for an explicitly listed synthetic target').toBe(true);
    void route.abort();
  }
  return true;
}
