import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

const productionEnvironment = {
  NODE_ENV: 'production',
  PORT: '3000',
  HOST: '127.0.0.1',
  APP_VERSION: '0.1.0-test',
  AUTH_MODE: 'cloudflare',
  CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  CF_ACCESS_AUD: 'a'.repeat(64),
  CF_ACCESS_EMAIL: 'operator@example.com',
  HERMES_API_BASE_URL: 'http://127.0.0.1:18642',
  HERMES_API_KEY: 'test-hermes-key-with-safe-length',
  HERMES_MODEL_LABEL: 'gpt-5.6-sol',
  HERMES_PROVIDER_LABEL: 'OpenAI Codex',
};

describe('loadConfig', () => {
  it('loads a production configuration without exposing unrelated environment variables', () => {
    const config = loadConfig({
      ...productionEnvironment,
      SOME_UNRELATED_SECRET: 'never-copy-me',
    });

    expect(config).toEqual({
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 3000,
      appVersion: '0.1.0-test',
      authMode: 'cloudflare',
      cloudflare: {
        teamDomain: 'team.cloudflareaccess.com',
        audience: 'a'.repeat(64),
        allowedEmail: 'operator@example.com',
      },
      hermes: {
        baseUrl: 'http://127.0.0.1:18642',
        apiKey: 'test-hermes-key-with-safe-length',
        modelLabel: 'gpt-5.6-sol',
        providerLabel: 'OpenAI Codex',
      },
      webDistDir: undefined,
    });
    expect(config).not.toHaveProperty('SOME_UNRELATED_SECRET');
  });

  it('refuses development authentication in production', () => {
    expect(() =>
      loadConfig({
        ...productionEnvironment,
        AUTH_MODE: 'development',
      }),
    ).toThrow(/AUTH_MODE.*cloudflare/i);
  });

  it('requires the Access audience in production', () => {
    const candidate = { ...productionEnvironment };
    delete (candidate as Partial<typeof productionEnvironment>).CF_ACCESS_AUD;

    expect(() => loadConfig(candidate)).toThrow(/CF_ACCESS_AUD/);
  });

  it('provides safe local-development defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      AUTH_MODE: 'development',
      HERMES_API_KEY: 'local-hermes-key-with-safe-length',
    });

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.cloudflare).toBeNull();
    expect(config.hermes.baseUrl).toBe('http://127.0.0.1:18642');
  });
});
