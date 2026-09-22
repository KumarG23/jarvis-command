import { AuditLedger } from './audit-ledger';
import { createCommandProxyClient } from './command-client';
import { createLiveRoomService } from './live-room-service';
import { createAccessVerifier } from './access-auth';
import { buildApp } from './app';
import type { AppConfig } from './config';
import { createHermesClient, type HermesSnapshot } from './hermes-client';
import { ArtifactStore, versionType } from './artifact-store';

export type CompositionOverrides = Readonly<{
  hermes?: Readonly<{
    readSnapshot: () => Promise<HermesSnapshot>;
  }>;
}>;

const CHAT_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_CHAT_IMAGE_BYTES = 6 * 1024 * 1024;

export function createArtifactImageResolver(artifactStore: ArtifactStore) {
  return async (references: ReadonlyArray<Readonly<{ artifactId: string; version: number }>>) => {
    const images: Array<{ mime: string; bytes: Buffer }> = [];
    let totalBytes = 0;
    for (const { artifactId, version } of references) {
      const { artifact, bytes } = await artifactStore.readVersionBytes(artifactId, version);
      const selected = artifact.versions.find(item => item.version === version);
      if (!selected || versionType(artifact, selected) !== 'image' || !CHAT_IMAGE_MIMES.has(selected.mime)) {
        throw Object.assign(new Error('Artifact is not a supported chat image'), { statusCode: 415 });
      }
      totalBytes += bytes.length;
      if (totalBytes > MAX_CHAT_IMAGE_BYTES) {
        throw Object.assign(new Error('Chat image payload too large'), { statusCode: 413 });
      }
      images.push({ mime: selected.mime, bytes });
    }
    return images;
  };
}

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
  const artifactStore = config.artifacts.enabled && config.artifacts.root
    ? new ArtifactStore({
        root: config.artifacts.root,
        maxFileBytes: config.artifacts.maxFileBytes,
        maxTotalBytes: config.artifacts.maxTotalBytes,
        maxArtifacts: config.artifacts.maxArtifacts,
      })
    : undefined;
  let ledger: AuditLedger | undefined;
  let liveRoom: ReturnType<typeof createLiveRoomService> | undefined;
  const app = buildApp({
    config,
    verifyAccess,
    hermes,
    artifactStore,
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
    liveRoom = createLiveRoomService({
      client,
      ledger,
      resolveImages: artifactStore
        ? createArtifactImageResolver(artifactStore)
        : async () => { throw Object.assign(new Error('Artifact storage unavailable'), { statusCode: 503 }); },
    });
  });
  app.addHook('onClose', async () => { await ledger?.close(); });
  return app;
}
