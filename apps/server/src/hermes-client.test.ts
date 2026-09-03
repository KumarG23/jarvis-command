import { describe, expect, it } from 'vitest';

import { HermesUpstreamError, createHermesClient } from './hermes-client';

const baseUrl = 'http://127.0.0.1:18642';
const apiKey = 'server-side-hermes-key';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Hermes client', () => {
  it('projects readiness, capabilities, and sessions into a bounded snapshot', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        authorization: headers.get('authorization'),
      });

      if (url.endsWith('/health/detailed')) {
        return jsonResponse({
          status: 'ready',
          version: '0.21.0',
          gateway_state: 'idle',
          active_agents: 2,
          readiness: {
            checks: {
              config: { status: 'ok', detail: 'must not cross the BFF' },
              disk: { status: 'warning', detail: '/private/path' },
              session_db: { status: 'error', detail: 'raw database error' },
            },
          },
          platforms: { discord: { token: 'must-not-leak' } },
          pid: 1234,
        });
      }

      if (url.endsWith('/v1/capabilities')) {
        return jsonResponse({
          model: 'hermes-agent',
          features: {
            run_events_sse: true,
            session_resources: true,
            admin_config_rw: false,
            browser_extension_control: { enabled: false },
          },
          endpoints: { hidden: 'do not proxy wholesale' },
        });
      }

      if (url.includes('/api/sessions?')) {
        return jsonResponse({
          object: 'list',
          data: [
            {
              id: 'session_123',
              title: 'Jarvis Command',
              source: 'discord',
              model: 'gpt-5.6-sol',
              last_active: 1_788_444_740,
              preview: 'Build the real command deck.',
              message_count: 18,
              tool_call_count: 7,
              pinned: 1,
              system_prompt: 'must-not-leak',
              model_config: { api_key: 'must-not-leak' },
            },
          ],
        });
      }

      return jsonResponse({}, 404);
    };

    const client = createHermesClient({
      baseUrl,
      apiKey,
      modelLabel: 'gpt-5.6-sol',
      providerLabel: 'OpenAI Codex',
      fetcher,
    });

    await expect(client.readSnapshot()).resolves.toEqual({
      state: 'degraded',
      version: '0.21.0',
      model: 'gpt-5.6-sol',
      provider: 'OpenAI Codex',
      gatewayState: 'idle',
      activeAgents: 2,
      capabilities: ['run_events_sse', 'session_resources'],
      readinessChecks: {
        config: 'pass',
        disk: 'warn',
        sessionDb: 'fail',
      },
      sessions: [
        {
          id: 'session_123',
          title: 'Jarvis Command',
          source: 'discord',
          model: 'gpt-5.6-sol',
          lastActive: '2026-09-03T14:12:20.000Z',
          preview: 'Build the real command deck.',
          messageCount: 18,
          toolCallCount: 7,
          pinned: true,
        },
      ],
    });
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.authorization === `Bearer ${apiKey}`)).toBe(true);
  });

  it('fails with a sanitized error when Hermes is unavailable', async () => {
    const fetcher: typeof fetch = async () => jsonResponse({
      error: { message: 'raw upstream path and secret' },
    }, 503);
    const client = createHermesClient({
      baseUrl,
      apiKey,
      modelLabel: 'gpt-5.6-sol',
      providerLabel: 'OpenAI Codex',
      fetcher,
    });

    await expect(client.readSnapshot()).rejects.toEqual(
      new HermesUpstreamError('Hermes control plane is unavailable'),
    );
  });
});
