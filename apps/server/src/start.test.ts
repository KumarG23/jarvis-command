import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from './config';
import { startCommandServer } from './start';

const config: AppConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  appVersion: '0.1.0-test',
  authMode: 'development',
  cloudflare: null,
  hermes: {
    baseUrl: 'http://127.0.0.1:18642',
    apiKey: 'local-hermes-key-with-safe-length',
    modelLabel: 'gpt-5.6-sol',
    providerLabel: 'OpenAI Codex',
  },
  webDistDir: undefined,
};

describe('server startup', () => {
  it('listens on the configured loopback host', async () => {
    const app = await startCommandServer(config, {
      hermes: { readSnapshot: vi.fn() },
    });

    try {
      const address = app.server.address();
      expect(address).toBeTypeOf('object');
      if (!address || typeof address === 'string') {
        throw new Error('Expected an internet socket address');
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'ok',
        service: 'jarvis-command',
      });
    } finally {
      await app.close();
    }
  });
});
