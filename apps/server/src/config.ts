import { z } from 'zod';

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_VERSION: z.string().min(1).max(80).default('0.1.0-dev'),
  AUTH_MODE: z.enum(['cloudflare', 'development']).default('development'),
  CF_ACCESS_TEAM_DOMAIN: z.string().min(1).optional(),
  CF_ACCESS_AUD: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  CF_ACCESS_EMAIL: z.email().optional(),
  HERMES_API_BASE_URL: z.url().default('http://127.0.0.1:18642'),
  HERMES_API_KEY: z.string().min(16),
  HERMES_MODEL_LABEL: z.string().min(1).max(160).default('gpt-5.6-sol'),
  HERMES_PROVIDER_LABEL: z.string().min(1).max(120).default('OpenAI Codex'),
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
    allowedEmail: string;
  }> | null;
  hermes: Readonly<{
    baseUrl: string;
    apiKey: string;
    modelLabel: string;
    providerLabel: string;
  }>;
  webDistDir: string | undefined;
}>;

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);

  if (parsed.NODE_ENV === 'production' && parsed.AUTH_MODE !== 'cloudflare') {
    throw new Error('AUTH_MODE must be cloudflare in production');
  }

  const cloudflare = parsed.AUTH_MODE === 'cloudflare'
    ? {
        teamDomain: requireValue('CF_ACCESS_TEAM_DOMAIN', parsed.CF_ACCESS_TEAM_DOMAIN),
        audience: requireValue('CF_ACCESS_AUD', parsed.CF_ACCESS_AUD),
        allowedEmail: requireValue('CF_ACCESS_EMAIL', parsed.CF_ACCESS_EMAIL).toLowerCase(),
      }
    : null;

  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    appVersion: parsed.APP_VERSION,
    authMode: parsed.AUTH_MODE,
    cloudflare,
    hermes: Object.freeze({
      baseUrl: parsed.HERMES_API_BASE_URL.replace(/\/$/, ''),
      apiKey: parsed.HERMES_API_KEY,
      modelLabel: parsed.HERMES_MODEL_LABEL,
      providerLabel: parsed.HERMES_PROVIDER_LABEL,
    }),
    webDistDir: parsed.WEB_DIST_DIR,
  });
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required when AUTH_MODE is cloudflare`);
  }

  return value;
}
