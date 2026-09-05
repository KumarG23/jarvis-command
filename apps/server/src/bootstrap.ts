import { AuditLedger } from './audit-ledger';
import { createCommandProxyClient } from './command-client';
import { createLiveRoomService } from './live-room-service';
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

  const client = config.command ? createCommandProxyClient({
    baseUrl: config.command.baseUrl,
    commandProxyKey: config.command.commandProxyKey,
  }) : undefined;
  let ledger: AuditLedger | undefined;
  let liveRoom: ReturnType<typeof createLiveRoomService> | undefined;
  const app = buildApp({
    config,
    verifyAccess,
    hermes,
    get liveRoom() { return liveRoom; },
    checkLiveRoom: async () => {
      if (!ledger || !client) throw new Error('Live Room unavailable');
      await ledger.verifyStorage();
      await client.readReadiness();
    },
  });
  app.addHook('onReady', async () => {
    if (!config.command || !client) return;
    ledger = await AuditLedger.open(config.command.auditLogPath);
    liveRoom = createLiveRoomService({ client, ledger });
  });
  app.addHook('onClose', async () => { await ledger?.close(); });
  return app;
}
