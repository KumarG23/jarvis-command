import { z } from 'zod';

const EnvironmentSchema = z.object({
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8643),
  READ_PROXY_KEY: z.string().min(32),
  HERMES_API_BASE_URL: z.url().default('http://127.0.0.1:8642'),
  HERMES_API_KEY: z.string().min(32),
});

export type ReadProxyConfig = Readonly<{
  host: '127.0.0.1';
  port: number;
  readProxyKey: string;
  hermesBaseUrl: string;
  hermesApiKey: string;
}>;

export function loadReadProxyConfig(environment: NodeJS.ProcessEnv): ReadProxyConfig {
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
    readProxyKey: parsed.READ_PROXY_KEY,
    hermesBaseUrl: upstream.origin,
    hermesApiKey: parsed.HERMES_API_KEY,
  });
}
