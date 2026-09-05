import { describe, expect, it } from 'vitest';

import { loadCommandProxyConfig } from './config';

const valid = {
  HOST: '127.0.0.1',
  PORT: '8644',
  COMMAND_PROXY_KEY: 'command-proxy-key-that-is-long-enough-123456',
  HERMES_API_BASE_URL: 'http://127.0.0.1:8642',
  HERMES_API_KEY: 'hermes-api-key-that-is-long-enough-12345678',
  MAX_STREAM_SECONDS: '1800',
};

describe('loadCommandProxyConfig', () => {
  it('accepts only a loopback listener and uncredentialed loopback Hermes origin', () => {
    expect(loadCommandProxyConfig(valid)).toEqual({
      host: '127.0.0.1',
      port: 8644,
      commandProxyKey: valid.COMMAND_PROXY_KEY,
      hermesBaseUrl: valid.HERMES_API_BASE_URL,
      hermesApiKey: valid.HERMES_API_KEY,
      maxStreamSeconds: 1_800,
    });
  });

  it.each([
    { HOST: '0.0.0.0' },
    { HERMES_API_BASE_URL: 'http://192.168.6.67:8642' },
    { HERMES_API_BASE_URL: 'https://127.0.0.1:8642' },
    { HERMES_API_BASE_URL: 'http://user:pass@127.0.0.1:8642' },
    { HERMES_API_BASE_URL: 'http://127.0.0.1:8642/v1' },
  ])('rejects unsafe listener/upstream override %#', (override) => {
    expect(() => loadCommandProxyConfig({ ...valid, ...override })).toThrow();
  });

  it('requires independent long credentials and a bounded stream lifetime', () => {
    expect(() => loadCommandProxyConfig({ ...valid, COMMAND_PROXY_KEY: 'short' })).toThrow();
    expect(() => loadCommandProxyConfig({ ...valid, HERMES_API_KEY: 'short' })).toThrow();
    expect(() => loadCommandProxyConfig({ ...valid, MAX_STREAM_SECONDS: '7200' })).toThrow();
  });
});
