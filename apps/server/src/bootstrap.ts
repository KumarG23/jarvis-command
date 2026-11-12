import { createTerminalLister } from './project-context';
import { ProjectRoomStore } from './project-room-store';
import { ReactionStore } from './reaction-store';
import { createPushService, type PushTransport } from './push-service';
import { AuditLedger } from './audit-ledger';
import { createCommandProxyClient } from './command-client';
import { createLiveRoomService } from './live-room-service';
import { createAccessVerifier } from './access-auth';
import { buildApp } from './app';
import type { AppConfig } from './config';
import { createHermesClient, type HermesSnapshot } from './hermes-client';
import { ArtifactStore, versionType } from './artifact-store';
import { dirname } from 'node:path';
import { NotificationStore } from './notification-store';
import { createRunNotifier } from './run-notifier';
import { createPresence, createReplyNotifier, type ReplyEvidenceSource } from './reply-notifier';
import { createReplyEvidenceSource } from './reply-evidence-source';

export type CompositionOverrides = Readonly<{
  hermes?: Readonly<{
    readSnapshot: () => Promise<HermesSnapshot>;
  }>;
  /** Composition-time seam for disposable fixtures only; never reachable from a request or the environment. */
  pushTransport?: PushTransport;
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
  const notifications = config.command ? new NotificationStore(dirname(config.command.auditLogPath)) : undefined;
  const push = notifications && config.push ? createPushService(config.push, notifications, overrides.pushTransport) : undefined;
  const presence = createPresence();
  let ledger: AuditLedger | undefined;
  let replyEvidence: ReplyEvidenceSource | undefined;
  let liveRoom: ReturnType<typeof createLiveRoomService> | undefined;
  const app = buildApp({
    config,
    verifyAccess,
    hermes,
    artifactStore,
    notifications,
    presence,
    get liveRoom() { return liveRoom; },
    get replyEvidence() { return replyEvidence; },
    checkLiveRoom: async () => {
      if (!ledger || !client) throw new Error('Live Room unavailable');
      await ledger.verifyStorage();
      await client.readReadiness();
    },
  });
  app.addHook('onReady', async () => {
    if (!config.command || !client) return;
    ledger = await AuditLedger.open(config.command.auditLogPath);
    // Server-only opt-in; the same client and opened ledger feed both the notifier and capability reporting.
    replyEvidence = config.replyEvidenceEnabled === true ? createReplyEvidenceSource({ client, ledger }) : undefined;
    liveRoom = createLiveRoomService({
      client,
      ledger,
      rooms: new ProjectRoomStore(dirname(config.command.auditLogPath)),
      notify: notifications ? createRunNotifier(notifications) : undefined,
      notifyReply: notifications ? createReplyNotifier({ store: notifications, push, enabled: config.push?.replies === true, source: replyEvidence, presence }) : undefined,
      reactions: new ReactionStore(dirname(config.command.auditLogPath)),
      reactionsEnabled: config.reactionsEnabled,
      projectContext: config.projectContextEnabled === true,
      ...(config.cockpit ? { listTerminals: createTerminalLister(config.cockpit) } : {}),
      ...(config.command.defaultInference ? { defaultInference: config.command.defaultInference } : {}),
      resolveImages: artifactStore
        ? createArtifactImageResolver(artifactStore)
        : async () => { throw Object.assign(new Error('Artifact storage unavailable'), { statusCode: 503 }); },
    });
  });
  app.addHook('onClose', async () => { await ledger?.close(); });
  return app;
}
