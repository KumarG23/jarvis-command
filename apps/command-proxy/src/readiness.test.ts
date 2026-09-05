import { expect, it, vi } from 'vitest';
import { buildCommandProxy } from './app';
it('projects authenticated durable-run readiness without forwarding capability internals', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const app = buildCommandProxy({ config: { host: '127.0.0.1', port: 8644, commandProxyKey: 'c'.repeat(32), hermesApiKey: 'h'.repeat(32), hermesBaseUrl: 'http://127.0.0.1:8642', maxStreamSeconds: 1800 }, fetcher });
  try {
    expect((await app.inject('/_ready')).statusCode).toBe(401);
    for (const durable of [true, false]) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ idempotency: { supported: true, durable, retention_seconds: 86400 }, secret: 'private detail' }), { headers: { 'content-type': 'application/json' } }));
      const response = await app.inject({ url: '/_ready', headers: { authorization: 'Bearer ' + 'c'.repeat(32) } });
      expect(response.statusCode).toBe(durable ? 200 : 503);
      expect(response.json()).toEqual(durable ? { ready: true, durableIdempotency: true, retentionSeconds: 86400, externalContinue: false } : { error: 'upstream_unavailable' });
    }
    expect(fetcher.mock.calls.every(([url]) => url === 'http://127.0.0.1:8642/v1/capabilities')).toBe(true);
  } finally { await app.close(); }
});
