import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_VERSION: z.string().min(1).max(40).default('0.2.0-dev'),
  AUTH_MODE: z.enum(['cloudflare', 'development']).default('development'),
  CF_ACCESS_TEAM_DOMAIN: z.string()
    .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.cloudflareaccess\.com$/i, 'Invalid CF_ACCESS_TEAM_DOMAIN')
    .optional(),
  CF_ACCESS_AUD: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  CF_ACCESS_EMAIL_SHA256: z.string()
    .regex(/^[a-f0-9]{64}$/i, 'Invalid CF_ACCESS_EMAIL_SHA256')
    .optional(),
  CF_ACCESS_JWKS_FILE: z.string().min(1).optional(),
  HERMES_API_BASE_URL: z.url().default('http://127.0.0.1:18642'),
  HERMES_READ_PROXY_KEY: z.string().min(32),
  COMMAND_MODE: z.enum(['disabled', 'enabled']).default('disabled'),
  PUBLIC_ORIGIN: z.url().optional(),
  HERMES_COMMAND_API_BASE_URL: z.url().optional(),
  HERMES_COMMAND_PROXY_KEY: z.string().min(32).optional(),
  COMMAND_AUDIT_LOG_PATH: z.string().min(1).optional(),
  WEB_DIST_DIR: z.string().min(1).optional(),
});

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  appVersion: string;
  authMode: 'cloudflare' | 'development';
  cloudflare: Readonly<{
    teamDomain: string;
    audience: string;
    allowedEmailHash: string;
    jwksFile: string;
  }> | null;
  hermes: Readonly<{
    baseUrl: string;
    readProxyKey: string;
  }>;
  command: Readonly<{
    baseUrl: string;
    commandProxyKey: string;
    auditLogPath: string;
    publicOrigin: string;
  }> | null;
  webDistDir: string | undefined;
}>;

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
  const hermesBridgeUrl = new URL(parsed.HERMES_API_BASE_URL);

  if (parsed.NODE_ENV === 'production' && parsed.AUTH_MODE !== 'cloudflare') {
    throw new Error('AUTH_MODE must be cloudflare in production');
  }

  if (parsed.NODE_ENV === 'production' && parsed.HOST !== '127.0.0.1') {
    throw new Error('HOST must remain on the 127.0.0.1 loopback interface in production');
  }

  if (parsed.NODE_ENV === 'production' && !isLoopbackHttpOrigin(hermesBridgeUrl)) {
    throw new Error('HERMES_API_BASE_URL must be an uncredentialed loopback HTTP origin in production');
  }

  const cloudflare = parsed.AUTH_MODE === 'cloudflare'
    ? (() => {
        const jwksFile = requireValue('CF_ACCESS_JWKS_FILE', parsed.CF_ACCESS_JWKS_FILE);
        if (!isAbsolute(jwksFile)) {
          throw new Error('CF_ACCESS_JWKS_FILE must be an absolute local path');
        }

        return Object.freeze({
          teamDomain: requireValue('CF_ACCESS_TEAM_DOMAIN', parsed.CF_ACCESS_TEAM_DOMAIN).toLowerCase(),
          audience: requireValue('CF_ACCESS_AUD', parsed.CF_ACCESS_AUD),
          allowedEmailHash: requireValue(
            'CF_ACCESS_EMAIL_SHA256',
            parsed.CF_ACCESS_EMAIL_SHA256,
          ).toLowerCase(),
          jwksFile,
        });
      })()
    : null;

  const command = parsed.COMMAND_MODE === 'enabled'
    ? (() => {
        const baseUrl = new URL(requireValue(
          'HERMES_COMMAND_API_BASE_URL',
          parsed.HERMES_COMMAND_API_BASE_URL,
        ));
        if (!isLoopbackHttpOrigin(baseUrl)) {
          throw new Error('The command bridge must use an uncredentialed loopback HTTP origin');
        }
        const publicUrl = new URL(requireValue('PUBLIC_ORIGIN', parsed.PUBLIC_ORIGIN));
        if (
          publicUrl.username
          || publicUrl.password
          || publicUrl.pathname !== '/'
          || publicUrl.search
          || publicUrl.hash
          || (parsed.NODE_ENV === 'production' && publicUrl.protocol !== 'https:')
        ) {
          throw new Error('PUBLIC_ORIGIN must be an uncredentialed HTTPS origin in production');
        }
        const auditLogPath = requireValue(
          'COMMAND_AUDIT_LOG_PATH',
          parsed.COMMAND_AUDIT_LOG_PATH,
        );
        if (!isAbsolute(auditLogPath)) {
          throw new Error('COMMAND_AUDIT_LOG_PATH must be absolute');
        }
        const commandProxyKey = requireValue('HERMES_COMMAND_PROXY_KEY', parsed.HERMES_COMMAND_PROXY_KEY);
        if (commandProxyKey === parsed.HERMES_READ_PROXY_KEY || baseUrl.origin === hermesBridgeUrl.origin) {
          throw new Error('Command and read bridges require distinct credentials and origins');
        }
        return Object.freeze({
          baseUrl: baseUrl.origin,
          commandProxyKey,
          auditLogPath,
          publicOrigin: publicUrl.origin,
        });
      })()
    : null;

  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    appVersion: parsed.APP_VERSION,
    authMode: parsed.AUTH_MODE,
    cloudflare,
    hermes: Object.freeze({
      baseUrl: hermesBridgeUrl.origin,
      readProxyKey: parsed.HERMES_READ_PROXY_KEY,
    }),
    command,
    webDistDir: parsed.WEB_DIST_DIR ? resolve(parsed.WEB_DIST_DIR) : undefined,
  });
}

function isLoopbackHttpOrigin(value: URL): boolean {
  return value.protocol === 'http:'
    && value.hostname === '127.0.0.1'
    && !value.username
    && !value.password
    && value.pathname === '/'
    && !value.search
    && !value.hash;
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required for this configuration`);
  }
  return value;
}
