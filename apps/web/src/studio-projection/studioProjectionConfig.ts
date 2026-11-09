import type { ProjectionSource } from './studioProjectionSource';

/**
 * The production projection source. It stays null until the lead/Jarvis owner approves a fixed GET-only Command-to-Studio
 * read path (see docs/p14-projection-consumer.md). With null the Studio view is inert: no request, no polling, no data.
 */
export const STUDIO_PROJECTION_SOURCE: ProjectionSource | null = null;
