import { z } from 'zod';

const EnvironmentSchema = z.object({
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8644),
  COMMAND_PROXY_KEY: z.string().min(32),
  HERMES_API_BASE_URL: z.url().default('http://127.0.0.1:8642'),
  HERMES_API_KEY: z.string().min(32),
  MAX_STREAM_SECONDS: z.coerce.number().int().min(30).max(3_600).default(1_800),
  // Disabled unless explicitly enabled; the three bounded Claude routes stay
  // advertised-only while this is absent or false.
  COMMAND_ANTHROPIC_ROUTES_ENABLED: z.enum(['true', 'false', '1', '0']).default('false')
    .transform(value => value === 'true' || value === '1'),
  // Separate disabled default for OpenRouter zero-spend routes. The bounded set of
  // advertised/authenticated ids ending exactly in `:free` stays unavailable until
  // an approved release enables this flag.
  // true: every model the authenticated subscription providers (openai-codex, xai-oauth,
  // and anthropic when its flag is on) advertise is selectable, not only the curated list.
  COMMAND_ADVERTISED_SUBSCRIPTION_ROUTES: z.enum(['true', 'false', '1', '0']).default('false')
    .transform(value => value === 'true' || value === '1'),
  COMMAND_OPENROUTER_FREE_ROUTES_ENABLED: z.enum(['true', 'false', '1', '0']).default('false')
    .transform(value => value === 'true' || value === '1'),
  // Disabled unless explicitly enabled. Gates only the optional validated `historyBinding`
  // projection on run status; installed Hermes support is unknown. Server-only: never
  // request- or browser-controlled.
  COMMAND_HISTORY_BINDING_ENABLED: z.enum(['true', 'false', '1', '0']).default('false')
    .transform(value => value === 'true' || value === '1'),
});

export type CommandProxyConfig = Readonly<{
  host: '127.0.0.1';
  port: number;
  commandProxyKey: string;
  hermesBaseUrl: string;
  hermesApiKey: string;
  maxStreamSeconds: number;
  anthropicRoutesEnabled: boolean;
  advertisedSubscriptionRoutes: boolean;
  openRouterFreeRoutesEnabled: boolean;
  historyBindingEnabled: boolean;
}>;

export function loadCommandProxyConfig(environment: NodeJS.ProcessEnv): CommandProxyConfig {
  const parsed = EnvironmentSchema.parse(environment);
  const upstream = new URL(parsed.HERMES_API_BASE_URL);

  if (
    upstream.protocol !== 'http:'
    || upstream.hostname !== '127.0.0.1'
    || upstream.username
    || upstream.password
    || upstream.pathname !== '/'
    || upstream.search
    || upstream.hash
  ) {
    throw new Error('HERMES_API_BASE_URL must be an uncredentialed loopback HTTP origin');
  }

  return Object.freeze({
    host: parsed.HOST,
    port: parsed.PORT,
    commandProxyKey: parsed.COMMAND_PROXY_KEY,
    hermesBaseUrl: upstream.origin,
    hermesApiKey: parsed.HERMES_API_KEY,
    maxStreamSeconds: parsed.MAX_STREAM_SECONDS,
    anthropicRoutesEnabled: parsed.COMMAND_ANTHROPIC_ROUTES_ENABLED,
    advertisedSubscriptionRoutes: parsed.COMMAND_ADVERTISED_SUBSCRIPTION_ROUTES,
    openRouterFreeRoutesEnabled: parsed.COMMAND_OPENROUTER_FREE_ROUTES_ENABLED,
    historyBindingEnabled: parsed.COMMAND_HISTORY_BINDING_ENABLED,
  });
}
