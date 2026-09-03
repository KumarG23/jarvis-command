import type { CommandBootstrap } from '@jarvis-command/contracts';

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
  const hermes = overrides.hermes ?? createHermesClient(config.hermes);
  const verifyAccess = config.cloudflare
    ? createAccessVerifier(config.cloudflare)
    : async (): Promise<CommandBootstrap['identity']> => ({
        email: 'operator@jarvis.invalid',
        provider: 'development',
      });

  return buildApp({
    config,
    verifyAccess,
    hermes,
  });
}
