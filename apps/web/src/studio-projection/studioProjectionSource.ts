// Transport seam for the P14 consumer. NO network implementation exists: the current Command proxy is
// Hermes-only and no approved Command-to-Studio read path is proven (see docs/p14-projection-consumer.md).
// Until one is, the only sources are isolated, labelled fixtures. A future source must be a fixed GET of the
// documented projection route; this module deliberately has no URL parameter, forwarding or fetch call.
import { STUDIO_PROJECTION_MAX_BYTES } from './studioProjection';

export type ProjectionReadResult = Readonly<{ status: number; body: string }>;

export interface ProjectionSource {
  /** Only fixtures exist today. A real source must be added together with an approved transport. */
  readonly kind: 'fixture';
  /** Shown verbatim next to the data so fixtures can never be mistaken for Studio. */
  readonly label: string;
  /** Resolve with the HTTP-like status and already size-bounded body text, or reject when unreachable. */
  read(signal: AbortSignal): Promise<ProjectionReadResult>;
}

export class ProjectionTooLarge extends Error {
  constructor() { super('projection response exceeds the byte bound'); }
}

/** Read at most `maxBytes` of a response body; stops reading (and cancels) once the bound is crossed. */
export async function readBoundedText(response: Response, maxBytes = STUDIO_PROJECTION_MAX_BYTES): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body?.cancel(); throw new ProjectionTooLarge(); }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new ProjectionTooLarge(); }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

export function fixtureSource(label: string, respond: (signal: AbortSignal) => Promise<ProjectionReadResult> | ProjectionReadResult): ProjectionSource {
  return { kind: 'fixture', label, async read(signal) { return respond(signal); } };
}
