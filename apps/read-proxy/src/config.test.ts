import { describe, expect, it } from 'vitest';

import { loadReadProxyConfig } from './config';

const validEnvironment = {
  HOST: '127.0.0.1',
  PORT: '8643',
  READ_PROXY_KEY: 'r'.repeat(48),
  HERMES_API_BASE_URL: 'http://127.0.0.1:8642',
  HERMES_API_KEY: 'h'.repeat(48),
};

describe('read proxy configuration', () => {
  it('accepts only a loopback listener and loopback Hermes upstream', () => {
    expect(loadReadProxyConfig(validEnvironment)).toEqual({
      host: '127.0.0.1',
      port: 8643,
      readProxyKey: 'r'.repeat(48),
      hermesBaseUrl: 'http://127.0.0.1:8642',
      hermesApiKey: 'h'.repeat(48),
    });
  });

  it.each([
    ['0.0.0.0', 'http://127.0.0.1:8642'],
    ['192.168.6.67', 'http://127.0.0.1:8642'],
    ['127.0.0.1', 'http://192.168.6.67:8642'],
    ['127.0.0.1', 'https://example.com'],
  ])('rejects unsafe bind/upstream combination %s -> %s', (host, upstream) => {
    expect(() => loadReadProxyConfig({
      ...validEnvironment,
      HOST: host,
      HERMES_API_BASE_URL: upstream,
    })).toThrow();
  });
});
