import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyReply } from 'fastify';

import type { ReadProxyConfig } from './config';

const MAX_UPSTREAM_BYTES = 1_048_576;

type ReadProxyDependencies = Readonly<{
  config: ReadProxyConfig;
  fetcher?: typeof fetch;
}>;

export function buildReadProxy({ config, fetcher = fetch }: ReadProxyDependencies) {
  const app = Fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: 1_024,
    exposeHeadRoutes: false,
    connectionTimeout: 10_000,
    requestTimeout: 10_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 100,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    return payload;
  });

  app.get('/_health', async () => ({
    status: 'ok',
    service: 'jarvis-command-read-proxy',
  }));

  app.get('/health/detailed', async (request, reply) => {
    if (!authorized(request.headers.authorization, config.readProxyKey)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return forwardJson('/health/detailed', config, fetcher, reply);
  });

  app.get('/v1/capabilities', async (request, reply) => {
    if (!authorized(request.headers.authorization, config.readProxyKey)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return forwardJson('/v1/capabilities', config, fetcher, reply);
  });

  app.get('/api/sessions', async (request, reply) => {
    if (!authorized(request.headers.authorization, config.readProxyKey)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const query = request.query as Record<string, unknown>;
    const limit = boundedInteger(query.limit, 12, 1, 50);
    const offset = boundedInteger(query.offset, 0, 0, 1_000_000);
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      include_children: 'false',
    });
    return forwardJson(`/api/sessions?${params.toString()}`, config, fetcher, reply);
  });

  app.setNotFoundHandler(async (_request, reply) => (
    reply.code(404).send({ error: 'not_found' })
  ));

  return app;
}

async function forwardJson(
  path: string,
  config: ReadProxyConfig,
  fetcher: typeof fetch,
  reply: FastifyReply,
) {
  try {
    const response = await fetcher(`${config.hermesBaseUrl}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${config.hermesApiKey}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      return reply.code(503).send({ error: 'upstream_unavailable' });
    }

    const body = await readBoundedBody(response, MAX_UPSTREAM_BYTES);
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) {
      return reply.code(503).send({ error: 'upstream_unavailable' });
    }

    return reply.code(200).send(parsed);
  } catch {
    return reply.code(503).send({ error: 'upstream_unavailable' });
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error('upstream response too large');
  }
  if (!response.body) {
    throw new Error('upstream response missing body');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('upstream response too large');
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function authorized(header: string | undefined, expectedKey: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(expectedKey);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}
