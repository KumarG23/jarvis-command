import { createAccessVerifier } from './access-auth';
import { buildApp } from './app';
import type { AppConfig } from './config';
import { createHermesClient, type HermesSnapshot } from './hermes-client';

export type CompositionOverrides = Readonly<{
  hermes?: Readonly<{
    readSnapshot: () => Promise<HermesSnapshot>;
  }>;
}>;

export function createCommandServer(
  config: AppConfig,
  overrides: CompositionOverrides = {},
) {
  const hermes = overrides.hermes ?? createHermesClient({
    baseUrl: config.hermes.baseUrl,
    readProxyKey: config.hermes.readProxyKey,
  });
  const verifyAccess = config.cloudflare
    ? createAccessVerifier(config.cloudflare)
    : async () => ({
        subject: 'development-operator',
        provider: 'development' as const,
      });

  return buildApp({
    config,
    verifyAccess,
    hermes,
  });
}
