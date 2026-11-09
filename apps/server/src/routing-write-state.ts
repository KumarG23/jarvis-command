// Source writer stage (#156). Release requires the verified compatible-reader
// rollback image and current ledger; see docs/p13-writer-activation.md.
export const ROUTING_WRITES_AVAILABLE: boolean = true;

export class RoutingWritesUnavailableError extends Error {
  readonly statusCode = 503;
  constructor() { super('New routing defaults and defaults-based runs are unavailable during the compatible-reader release stage. Existing saved defaults remain readable and committed requests can be recovered.'); }
}
export function requireRoutingWrites() {
  if (!ROUTING_WRITES_AVAILABLE) throw new RoutingWritesUnavailableError();
}
