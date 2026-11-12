import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';

import { loadConfig } from './config';

const productionEnvironment = {
  NODE_ENV: 'production',
  PORT: '3000',
  HOST: '127.0.0.1',
  APP_VERSION: '0.2.0-test',
  AUTH_MODE: 'cloudflare',
  CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  CF_ACCESS_AUD: 'a'.repeat(64),
  CF_ACCESS_EMAIL_SHA256: 'b'.repeat(64),
  CF_ACCESS_JWKS_FILE: '/run/jarvis-command/cloudflare-jwks/certs.json',
  HERMES_API_BASE_URL: 'http://127.0.0.1:18642',
  HERMES_READ_PROXY_KEY: 'test-read-proxy-key-with-safe-length',
  COMMAND_MODE: 'enabled',
  PUBLIC_ORIGIN: 'https://command.sharma-house.com',
  HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643',
  HERMES_COMMAND_PROXY_KEY: 'test-command-proxy-key-with-safe-length',
  COMMAND_AUDIT_LOG_PATH: '/var/lib/jarvis-command/audit/events.jsonl',
};

describe('loadConfig', () => {
  it('loads a production configuration without exposing unrelated environment variables', () => {
    const config = loadConfig({
      ...productionEnvironment,
      SOME_UNRELATED_SECRET: 'never-copy-me',
    });

    expect(config).toEqual({
      cockpit: null,
      scheduledRuns: null,
      reactionsEnabled: false,
      replyEvidenceEnabled: false,
      projectDeletionEnabled: false,
      push: { capability: { state: 'unavailable', reason: 'disabled' }, replies: false },
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 3000,
      appVersion: '0.2.0-test',
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
      command: {
        baseUrl: 'http://127.0.0.1:18643',
        commandProxyKey: 'test-command-proxy-key-with-safe-length',
        auditLogPath: '/var/lib/jarvis-command/audit/events.jsonl',
        publicOrigin: 'https://command.sharma-house.com',
      },
      webDistDir: undefined,
      artifacts: {
        enabled: false,
        root: null,
        maxFileBytes: 10_485_760,
        maxTotalBytes: 268_435_456,
        maxArtifacts: 10_000,
      },
    });
    expect(config).not.toHaveProperty('SOME_UNRELATED_SECRET');
  });

  it('enables the cockpit only with a session host origin and key', () => {
    const key = 'k'.repeat(40);
    expect(loadConfig({ ...productionEnvironment, COCKPIT_MODE: 'enabled', SESSION_HOST_BASE_URL: 'http://10.0.0.5:8650', SESSION_HOST_KEY: key }).cockpit)
      .toEqual({ sessionHostUrl: 'http://10.0.0.5:8650', sessionHostKey: key });
    expect(() => loadConfig({ ...productionEnvironment, COCKPIT_MODE: 'enabled', SESSION_HOST_KEY: key })).toThrow(/SESSION_HOST_BASE_URL/);
    expect(() => loadConfig({ ...productionEnvironment, COCKPIT_MODE: 'enabled', SESSION_HOST_BASE_URL: 'http://u:p@10.0.0.5:8650', SESSION_HOST_KEY: key })).toThrow(/uncredentialed/);
    expect(() => loadConfig({ ...productionEnvironment, COCKPIT_MODE: 'enabled', SESSION_HOST_BASE_URL: 'http://10.0.0.5:8650', SESSION_HOST_KEY: 'short' })).toThrow();
    expect(() => loadConfig({ ...productionEnvironment, COMMAND_MODE: 'disabled', COCKPIT_MODE: 'enabled', SESSION_HOST_BASE_URL: 'http://10.0.0.5:8650', SESSION_HOST_KEY: key })).toThrow();
  });

  it('enables scheduled runs only with a key and owner actor on a separate port', () => {
    const key = 'k'.repeat(40);
    const owner = 'a'.repeat(64);
    expect(loadConfig(productionEnvironment).scheduledRuns).toBeNull();
    expect(loadConfig({ ...productionEnvironment, SCHEDULED_RUNS_MODE: 'enabled', SCHEDULED_RUNS_HOST: '0.0.0.0', SCHEDULED_RUNS_KEY: key, SCHEDULED_RUNS_OWNER_ACTOR: owner }).scheduledRuns)
      .toEqual({ host: '0.0.0.0', port: 8652, key, ownerActor: owner, home: null });
    expect(() => loadConfig({ ...productionEnvironment, SCHEDULED_RUNS_MODE: 'enabled', SCHEDULED_RUNS_OWNER_ACTOR: owner })).toThrow(/SCHEDULED_RUNS_KEY/);
    expect(() => loadConfig({ ...productionEnvironment, SCHEDULED_RUNS_MODE: 'enabled', SCHEDULED_RUNS_KEY: key })).toThrow(/SCHEDULED_RUNS_OWNER_ACTOR/);
    expect(() => loadConfig({ ...productionEnvironment, SCHEDULED_RUNS_MODE: 'enabled', SCHEDULED_RUNS_KEY: key, SCHEDULED_RUNS_OWNER_ACTOR: 'not-a-hash' })).toThrow();
    expect(() => loadConfig({ ...productionEnvironment, SCHEDULED_RUNS_MODE: 'enabled', SCHEDULED_RUNS_KEY: key, SCHEDULED_RUNS_OWNER_ACTOR: owner, SCHEDULED_RUNS_PORT: productionEnvironment.PORT ?? '8650' })).toThrow(/differ/);
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

  it('rejects an enabled command bridge outside loopback or a non-HTTPS production origin', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      HERMES_COMMAND_API_BASE_URL: 'http://192.168.6.67:8644',
    })).toThrow(/command.*loopback/i);
    expect(() => loadConfig({
      ...productionEnvironment,
      PUBLIC_ORIGIN: 'http://command.sharma-house.com',
    })).toThrow(/PUBLIC_ORIGIN|https/i);
  });

  it('requires command credentials and targets distinct from the read bridge', () => {
    expect(() => loadConfig({ ...productionEnvironment, HERMES_COMMAND_PROXY_KEY: productionEnvironment.HERMES_READ_PROXY_KEY })).toThrow();
    expect(() => loadConfig({ ...productionEnvironment, HERMES_COMMAND_API_BASE_URL: productionEnvironment.HERMES_API_BASE_URL })).toThrow();
  });

  it('requires every command boundary value when command mode is enabled', () => {
    for (const name of [
      'PUBLIC_ORIGIN',
      'HERMES_COMMAND_API_BASE_URL',
      'HERMES_COMMAND_PROXY_KEY',
      'COMMAND_AUDIT_LOG_PATH',
    ] as const) {
      const candidate: Record<string, string> = { ...productionEnvironment };
      delete candidate[name];
      expect(() => loadConfig(candidate)).toThrow();
    }
  });

  it('keeps the write boundary explicitly disabled when command mode is disabled', () => {
    expect(loadConfig({
      ...productionEnvironment,
      COMMAND_MODE: 'disabled',
    }).command).toBeNull();
  });

  it('rejects a production listener outside loopback', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      HOST: '0.0.0.0',
    })).toThrow(/HOST.*loopback/i);
  });

  it('requires an absolute prepared artifact path when production artifacts are enabled', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      ARTIFACTS_MODE: 'enabled',
    })).toThrow(/ARTIFACT_STORAGE_PATH/);
    expect(() => loadConfig({
      ...productionEnvironment,
      ARTIFACTS_MODE: 'enabled',
      ARTIFACT_STORAGE_PATH: './artifacts',
    })).toThrow(/ARTIFACT_STORAGE_PATH.*absolute/i);
    expect(loadConfig({
      ...productionEnvironment,
      ARTIFACTS_MODE: 'enabled',
      ARTIFACT_STORAGE_PATH: '/var/lib/jarvis-command/artifacts',
      ARTIFACT_MAX_FILE_BYTES: '1048576',
    }).artifacts).toEqual({
      enabled: true,
      root: '/var/lib/jarvis-command/artifacts',
      maxFileBytes: 1_048_576,
      maxTotalBytes: 268_435_456,
      maxArtifacts: 10_000,
    });
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
    expect(config.command).toBeNull();
    expect(config.artifacts).toMatchObject({
      enabled: true,
      root: `${tmpdir()}/jarvis-command-artifacts-dev`,
      maxFileBytes: 10_485_760,
      maxTotalBytes: 268_435_456,
      maxArtifacts: 10_000,
    });
  });
});

it('keeps project deletion disabled unless explicitly configured', () => {
  const environment = { NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32) };
  expect(loadConfig(environment).projectDeletionEnabled).toBe(false);
  expect(loadConfig({ ...environment, PROJECT_DELETION_MODE: 'enabled' }).projectDeletionEnabled).toBe(true);
  expect(() => loadConfig({ ...environment, PROJECT_DELETION_MODE: 'true' })).toThrow();
});

it('keeps reactions disabled by default and accepts only an explicit server control', () => {
  expect(loadConfig(productionEnvironment).reactionsEnabled).toBe(false);
  expect(loadConfig({ ...productionEnvironment, REACTIONS_MODE: 'enabled' }).reactionsEnabled).toBe(true);
  expect(() => loadConfig({ ...productionEnvironment, REACTIONS_MODE: 'true' })).toThrow();
});
