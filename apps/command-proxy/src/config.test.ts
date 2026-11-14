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
      anthropicRoutesEnabled: false,
      advertisedSubscriptionRoutes: false,
      openRouterFreeRoutesEnabled: false,
  historyBindingEnabled: false,
    });
  });

  it('enables Anthropic routes only from an explicit server-side flag', () => {
    expect(loadCommandProxyConfig(valid).anthropicRoutesEnabled).toBe(false);
    for (const value of ['1', 'true']) {
      expect(loadCommandProxyConfig({ ...valid, COMMAND_ANTHROPIC_ROUTES_ENABLED: value }).anthropicRoutesEnabled).toBe(true);
    }
    for (const value of ['0', 'false']) {
      expect(loadCommandProxyConfig({ ...valid, COMMAND_ANTHROPIC_ROUTES_ENABLED: value }).anthropicRoutesEnabled).toBe(false);
    }
    expect(() => loadCommandProxyConfig({ ...valid, COMMAND_ANTHROPIC_ROUTES_ENABLED: 'yes' })).toThrow();
  });

  it('keeps OpenRouter free routes separately disabled unless explicitly enabled', () => {
    expect(loadCommandProxyConfig(valid).openRouterFreeRoutesEnabled).toBe(false);
    expect(loadCommandProxyConfig({ ...valid, COMMAND_ANTHROPIC_ROUTES_ENABLED: 'true' }).openRouterFreeRoutesEnabled).toBe(false);
    for (const value of ['1', 'true']) {
      expect(loadCommandProxyConfig({ ...valid, COMMAND_OPENROUTER_FREE_ROUTES_ENABLED: value }).openRouterFreeRoutesEnabled).toBe(true);
    }
    for (const value of ['0', 'false']) {
      expect(loadCommandProxyConfig({ ...valid, COMMAND_OPENROUTER_FREE_ROUTES_ENABLED: value }).openRouterFreeRoutesEnabled).toBe(false);
    }
    expect(() => loadCommandProxyConfig({ ...valid, COMMAND_OPENROUTER_FREE_ROUTES_ENABLED: 'yes' })).toThrow();
    expect(loadCommandProxyConfig(valid).historyBindingEnabled).toBe(false);
    expect(loadCommandProxyConfig({ ...valid, COMMAND_HISTORY_BINDING_ENABLED: 'true' }).historyBindingEnabled).toBe(true);
    expect(() => loadCommandProxyConfig({ ...valid, COMMAND_HISTORY_BINDING_ENABLED: 'yes' })).toThrow();
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

  it('keeps the Command origin key unset by default, separate from other keys, and visible ASCII only', () => {
    expect(loadCommandProxyConfig(valid).commandOriginKey).toBeUndefined();
    const key = 'command-origin-key-that-is-long-enough-1234567';
    expect(loadCommandProxyConfig({ ...valid, COMMAND_ORIGIN_KEY: key }).commandOriginKey).toBe(key);
    expect(() => loadCommandProxyConfig({ ...valid, COMMAND_ORIGIN_KEY: valid.COMMAND_PROXY_KEY })).toThrow(/must differ/);
    expect(() => loadCommandProxyConfig({ ...valid, COMMAND_ORIGIN_KEY: valid.HERMES_API_KEY })).toThrow(/must differ/);
    expect(() => loadCommandProxyConfig({ ...valid, COMMAND_ORIGIN_KEY: 'short' })).toThrow();
    expect(() => loadCommandProxyConfig({ ...valid, COMMAND_ORIGIN_KEY: `${key} with spaces` })).toThrow();
  });
});
