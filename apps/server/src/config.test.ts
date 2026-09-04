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
  CF_ACCESS_EMAIL_SHA256: 'b'.repeat(64),
  CF_ACCESS_JWKS_FILE: '/run/jarvis-command/cloudflare-jwks/certs.json',
  HERMES_API_BASE_URL: 'http://127.0.0.1:18642',
  HERMES_READ_PROXY_KEY: 'test-read-proxy-key-with-safe-length',
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
        allowedEmailHash: 'b'.repeat(64),
        jwksFile: '/run/jarvis-command/cloudflare-jwks/certs.json',
      },
      hermes: {
        baseUrl: 'http://127.0.0.1:18642',
        readProxyKey: 'test-read-proxy-key-with-safe-length',
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

  it('rejects a read-proxy key below the proxy entropy floor', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      HERMES_READ_PROXY_KEY: 'x'.repeat(31),
    })).toThrow(/HERMES_READ_PROXY_KEY/);
  });

  it('rejects a malformed Cloudflare Access team domain', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com/path',
    })).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
  });

  it('requires the Access audience in production', () => {
    const candidate = { ...productionEnvironment };
    delete (candidate as Partial<typeof productionEnvironment>).CF_ACCESS_AUD;

    expect(() => loadConfig(candidate)).toThrow(/CF_ACCESS_AUD/);
  });

  it('requires a valid approved-identity hash in production', () => {
    const candidate = {
      ...productionEnvironment,
      CF_ACCESS_EMAIL_SHA256: 'not-a-sha256',
    };

    expect(() => loadConfig(candidate)).toThrow(/CF_ACCESS_EMAIL_SHA256/);
  });

  it('requires an absolute local JWKS file in Cloudflare authentication mode', () => {
    const missing = { ...productionEnvironment };
    delete (missing as Partial<typeof productionEnvironment>).CF_ACCESS_JWKS_FILE;

    expect(() => loadConfig(missing)).toThrow(/CF_ACCESS_JWKS_FILE/);
    expect(() => loadConfig({
      ...productionEnvironment,
      CF_ACCESS_JWKS_FILE: './certs.json',
    })).toThrow(/CF_ACCESS_JWKS_FILE/);
  });

  it('rejects a production server that points at a non-loopback Hermes bridge', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      HERMES_API_BASE_URL: 'http://192.168.6.67:8643',
    })).toThrow(/loopback/i);
  });

  it('rejects a production listener outside loopback', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      HOST: '0.0.0.0',
    })).toThrow(/HOST.*loopback/i);
  });

  it('resolves a relative web distribution directory before Fastify sees it', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      AUTH_MODE: 'development',
      HERMES_READ_PROXY_KEY: 'local-read-proxy-key-with-safe-length',
      WEB_DIST_DIR: './apps/web/dist',
    });

    expect(config.webDistDir).toBe(`${process.cwd()}/apps/web/dist`);
  });

  it('provides safe local-development defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      AUTH_MODE: 'development',
      HERMES_READ_PROXY_KEY: 'local-read-proxy-key-with-safe-length',
    });

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.cloudflare).toBeNull();
    expect(config.hermes.baseUrl).toBe('http://127.0.0.1:18642');
  });
});
