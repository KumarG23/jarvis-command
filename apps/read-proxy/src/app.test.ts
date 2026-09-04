import { describe, expect, it, vi } from 'vitest';

import { buildReadProxy } from './app';

const config = {
  host: '127.0.0.1' as const,
  port: 8643,
  readProxyKey: 'read-proxy-test-key-with-safe-length',
  hermesBaseUrl: 'http://127.0.0.1:8642',
  hermesApiKey: 'full-hermes-api-test-key-with-safe-length',
};

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Hermes read-only allowlisting proxy', () => {
  it('requires the separate read-proxy credential before touching Hermes', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = buildReadProxy({ config, fetcher });

    const response = await app.inject({ method: 'GET', url: '/health/detailed' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    expect(fetcher).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['/health/detailed', 'http://127.0.0.1:8642/health/detailed'],
    ['/v1/capabilities', 'http://127.0.0.1:8642/v1/capabilities'],
  ])('forwards only the allowlisted read %s', async (path, expectedUpstream) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'ok' }));
    const app = buildReadProxy({ config, fetcher });

    const response = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${config.readProxyKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(expectedUpstream);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${config.hermesApiKey}`);
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    await app.close();
  });

  it('clamps session pagination and drops every other query parameter', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      object: 'list',
      data: [],
      limit: 50,
      offset: 0,
      has_more: false,
    }));
    const app = buildReadProxy({ config, fetcher });

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions?limit=999&offset=-7&source=work&include_hidden=true&title=secret',
      headers: { authorization: `Bearer ${config.readProxyKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      'http://127.0.0.1:8642/api/sessions?limit=50&offset=0&include_children=false',
    );
    await app.close();
  });

  it.each([
    ['POST', '/health/detailed'],
    ['HEAD', '/health/detailed'],
    ['GET', '/v1/runs'],
    ['GET', '/api/sessions/example/messages'],
    ['GET', '/health'],
  ] as const)('rejects %s %s without contacting Hermes', async (method, path) => {
    const fetcher = vi.fn<typeof fetch>();
    const app = buildReadProxy({ config, fetcher });

    const response = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${config.readProxyKey}` },
    });

    expect([404, 405]).toContain(response.statusCode);
    expect(fetcher).not.toHaveBeenCalled();
    await app.close();
  });

  it('replaces upstream failures and bodies with a bounded error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: `secret=${config.hermesApiKey}`,
    }, 500));
    const app = buildReadProxy({ config, fetcher });

    const response = await app.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: `Bearer ${config.readProxyKey}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'upstream_unavailable' });
    expect(response.body).not.toContain(config.hermesApiKey);
    await app.close();
  });

  it('keeps a minimal health route local and credential-free', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = buildReadProxy({ config, fetcher });

    const response = await app.inject({ method: 'GET', url: '/_health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'jarvis-command-read-proxy' });
    expect(fetcher).not.toHaveBeenCalled();
    await app.close();
  });
});
