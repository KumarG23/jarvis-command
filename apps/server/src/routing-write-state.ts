// Compatible-reader release stage. Activate only in a later reviewed source increment
// after this reader is deployed and retained as the recoverable rollback image.
export const ROUTING_WRITES_AVAILABLE: boolean = false;

export class RoutingWritesUnavailableError extends Error {
  readonly statusCode = 503;
  constructor() { super('New routing defaults and defaults-based runs are unavailable during the compatible-reader release stage. Existing saved defaults remain readable and committed requests can be recovered.'); }
}
export function requireRoutingWrites() {
  if (!ROUTING_WRITES_AVAILABLE) throw new RoutingWritesUnavailableError();
}
