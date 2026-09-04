import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_VERSION: z.string().min(1).max(40).default('0.1.0-dev'),
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

  if (
    parsed.NODE_ENV === 'production'
    && (
      hermesBridgeUrl.protocol !== 'http:'
      || hermesBridgeUrl.hostname !== '127.0.0.1'
      || hermesBridgeUrl.username
      || hermesBridgeUrl.password
      || hermesBridgeUrl.pathname !== '/'
      || hermesBridgeUrl.search
      || hermesBridgeUrl.hash
    )
  ) {
    throw new Error('HERMES_API_BASE_URL must be an uncredentialed loopback HTTP origin in production');
  }

  const cloudflare = parsed.AUTH_MODE === 'cloudflare'
    ? (() => {
        const jwksFile = requireValue('CF_ACCESS_JWKS_FILE', parsed.CF_ACCESS_JWKS_FILE);
        if (!isAbsolute(jwksFile)) {
          throw new Error('CF_ACCESS_JWKS_FILE must be an absolute local path');
        }

        return {
        teamDomain: requireValue('CF_ACCESS_TEAM_DOMAIN', parsed.CF_ACCESS_TEAM_DOMAIN).toLowerCase(),
        audience: requireValue('CF_ACCESS_AUD', parsed.CF_ACCESS_AUD),
        allowedEmailHash: requireValue(
          'CF_ACCESS_EMAIL_SHA256',
          parsed.CF_ACCESS_EMAIL_SHA256,
        ).toLowerCase(),
          jwksFile,
        };
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
    webDistDir: parsed.WEB_DIST_DIR ? resolve(parsed.WEB_DIST_DIR) : undefined,
  });
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required when AUTH_MODE is cloudflare`);
  }

  return value;
}
