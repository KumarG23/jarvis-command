import { describe, expect, it, vi } from 'vitest';

import { createCommandServer } from './bootstrap';
import type { AppConfig } from './config';

const developmentConfig: AppConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3000,
  appVersion: '0.1.0-dev',
  authMode: 'development',
  cloudflare: null,
  hermes: {
    baseUrl: 'http://127.0.0.1:18642',
    readProxyKey: 'local-read-proxy-key-with-safe-length',
  },
  webDistDir: undefined,
};

describe('server composition', () => {
  it('uses an explicit development identity without weakening production auth', async () => {
    const app = createCommandServer(developmentConfig, {
      hermes: {
        readSnapshot: vi.fn().mockResolvedValue({
          state: 'online',
          version: '0.21.0',
          model: 'gpt-5.6-sol',
          provider: 'OpenAI Codex',
          gatewayState: 'idle',
          activeAgents: 0,
          capabilities: [],
          readinessChecks: {},
          sessions: [],
        }),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/bootstrap' });

    expect(response.statusCode).toBe(200);
    expect(response.json().identity).toEqual({
      provider: 'development',
    });
    await app.close();
  });
});
