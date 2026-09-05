import { createHash } from 'node:crypto';

import { generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { buildReadProxy } from '../../read-proxy/src/app';
import { createAccessVerifier } from './access-auth';
import { buildApp } from './app';
import type { AppConfig } from './config';
import { createHermesClient } from './hermes-client';

const issuer = 'https://team.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const approvedEmail = 'operator@example.test';
const readProxyKey = `read-${'r'.repeat(40)}`;
const hermesApiKey = `full-${'h'.repeat(40)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('production trust boundary', () => {
  it('verifies Access and returns only the minimized browser DTO through the read proxy', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({
      email: approvedEmail,
      type: 'app',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'integration-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('persistent-cloudflare-subject')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const upstream = vi.fn<typeof fetch>(async (input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${hermesApiKey}`);
      const url = new URL(String(input));

      if (url.pathname === '/health/detailed') {
        return jsonResponse({
          status: 'ready',
          version: '0.21.0',
          gateway_state: 'idle',
          gateway_busy: false,
          active_agents: 1,
          readiness: { status: 'ready', checks: { config: 'pass', disk: 'pass' } },
          upstream_internal_detail: 'not-for-the-browser',
        });
      }

      if (url.pathname === '/v1/capabilities') {
        return jsonResponse({
          object: 'hermes.api_server.capabilities',
          model: 'gpt-5.6-sol',
          features: {
            run_events_sse: true,
            session_resources: true,
            unrestricted_terminal: true,
          },
          provider_secret_detail: 'not-for-the-browser',
        });
      }

      if (url.pathname === '/api/sessions') {
        return jsonResponse({
          object: 'list',
          data: [{
            id: 'session-1',
            title: 'Jarvis Command',
            source: 'discord',
            model: 'gpt-5.6-sol',
            last_active: '2026-09-03T17:00:00.000Z',
            message_count: 12,
            tool_call_count: 5,
            pinned: true,
            preview: 'sensitive historical preview',
            email: approvedEmail,
          }],
          limit: 12,
          offset: 0,
          has_more: false,
          upstream_private_page_token: 'not-for-the-browser',
        });
      }

      return jsonResponse({ error: 'unexpected_path' }, 404);
    });

    const readProxy = buildReadProxy({
      config: {
        host: '127.0.0.1',
        port: 8643,
        readProxyKey,
        hermesBaseUrl: 'http://127.0.0.1:8642',
        hermesApiKey,
      },
      fetcher: upstream,
    });
    const proxyFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const response = await readProxy.inject({
        method: 'GET',
        url: `${url.pathname}${url.search}`,
        headers,
      });
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) {
          responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value));
        }
      }
      return new Response(response.body, {
        status: response.statusCode,
        headers: responseHeaders,
      });
    };

    const config: AppConfig = {
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 3000,
      appVersion: '0.1.0-integration',
      authMode: 'cloudflare',
      cloudflare: {
        teamDomain: 'team.cloudflareaccess.com',
        audience,
        allowedEmailHash: createHash('sha256').update(approvedEmail).digest('hex'),
        jwksFile: '/run/jarvis-command/cloudflare-jwks/certs.json',
      },
      hermes: {
        baseUrl: 'http://127.0.0.1:18642',
        readProxyKey,
      },
      command: null,
      webDistDir: undefined,
    };
    const app = buildApp({
      config,
      verifyAccess: createAccessVerifier({ ...config.cloudflare!, key: publicKey }),
      hermes: createHermesClient({
        baseUrl: config.hermes.baseUrl,
        readProxyKey,
        fetcher: proxyFetch,
      }),
      now: () => new Date('2026-09-03T17:01:00.000Z'),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: { 'cf-access-jwt-assertion': token },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      identity: { provider: 'cloudflare-access' },
      command: {
        version: '0.1.0-integration',
        environment: 'production',
        generatedAt: '2026-09-03T17:01:00.000Z',
        liveRoom: { enabled: false, externalContinue: false, maxInputCharacters: 16_000, maxSteerCharacters: 4_000 },
      },
      hermes: {
        state: 'online',
        version: '0.21.0',
        model: 'gpt-5.6-sol',
        provider: null,
        gatewayState: 'idle',
        activeAgents: 1,
        capabilities: ['run_events_sse', 'session_resources'],
        readinessChecks: { config: 'pass', disk: 'pass' },
      },
      sessions: [{
        id: 'session-1',
        title: 'Jarvis Command',
        source: 'discord',
        ownership: 'external',
        model: 'gpt-5.6-sol',
        lastActive: '2026-09-03T17:00:00.000Z',
        messageCount: 12,
        toolCallCount: 5,
        pinned: true,
      }],
    });
    expect(response.body).not.toContain(approvedEmail);
    expect(response.body).not.toContain('persistent-cloudflare-subject');
    expect(response.body).not.toContain('sensitive historical preview');
    expect(response.body).not.toContain('not-for-the-browser');
    expect(response.body).not.toContain(readProxyKey);
    expect(response.body).not.toContain(hermesApiKey);
    expect(upstream).toHaveBeenCalledTimes(3);

    await app.close();
    await readProxy.close();
  });

  it('denies a wrong read key and every non-allowlisted route before Hermes', async () => {
    const upstream = vi.fn<typeof fetch>();
    const readProxy = buildReadProxy({
      config: {
        host: '127.0.0.1',
        port: 8643,
        readProxyKey,
        hermesBaseUrl: 'http://127.0.0.1:8642',
        hermesApiKey,
      },
      fetcher: upstream,
    });

    const wrongKey = await readProxy.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: `Bearer wrong-${'x'.repeat(40)}` },
    });
    const forbiddenMethod = await readProxy.inject({
      method: 'POST',
      url: '/health/detailed',
      headers: { authorization: `Bearer ${readProxyKey}` },
    });
    const forbiddenRoute = await readProxy.inject({
      method: 'GET',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${readProxyKey}` },
    });

    expect(wrongKey.statusCode).toBe(401);
    expect([404, 405]).toContain(forbiddenMethod.statusCode);
    expect(forbiddenRoute.statusCode).toBe(404);
    expect(upstream).not.toHaveBeenCalled();

    await readProxy.close();
  });
});
