import { RoutingUnavailableError } from './routing-defaults';
import { ThreadReadStorageError } from './thread-read-store';
import { ThreadObservationUnavailableError } from './thread-state';
import { ReactionStorageError, ReactionUnavailableError, ReactionConflictError, ReactionBoundsError } from './reaction-store';
import { CommandBootstrapSchema, type CommandBootstrap } from '@jarvis-command/contracts';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import { registerLiveRoomRoutes, type LiveStreamLimits } from './live-room-routes';
import { registerArtifactRoutes } from './artifact-routes';
import type { createLiveRoomService } from './live-room-service';
import { AuditIntegrityError } from './audit-ledger';
import { ArtifactConflictError, ArtifactDeletedError, ArtifactNotFoundError, ArtifactStorageError, ArtifactStore } from './artifact-store';
import { RoomStorageError } from './project-room-store';
import { NotificationNotFoundError, NotificationStorageError, type NotificationStore } from './notification-store';
import type { Presence } from './reply-notifier';
import { CommandProxyUnavailableError } from './command-client';
import type { AppConfig } from './config';
import type { HermesSnapshot } from './hermes-client';

type AppDependencies = Readonly<{
  config: AppConfig;
  verifyAccess: (
    assertion: string | undefined,
  ) => Promise<Readonly<{
    subject: string;
    provider: CommandBootstrap['identity']['provider'];
  }>>;
  hermes: Readonly<{
    readSnapshot: () => Promise<HermesSnapshot>;
  }>;
  liveRoom?: ReturnType<typeof createLiveRoomService> | undefined;
  artifactStore?: ArtifactStore | undefined;
  notifications?: NotificationStore | undefined;
  presence?: Presence | undefined;
  checkLiveRoom?: () => Promise<void>;
  liveStreamLimits?: LiveStreamLimits;
  now?: () => Date;
}>;

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: createLoggerOptions(dependencies.config.nodeEnv),
    trustProxy: false,
    bodyLimit: 131_072,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 100,
  });
  const now = dependencies.now ?? (() => new Date());
  const artifactStore = dependencies.artifactStore ?? (dependencies.config.artifacts.enabled && dependencies.config.artifacts.root
    ? new ArtifactStore({
        root: dependencies.config.artifacts.root,
        maxFileBytes: dependencies.config.artifacts.maxFileBytes,
        maxTotalBytes: dependencies.config.artifacts.maxTotalBytes,
        maxArtifacts: dependencies.config.artifacts.maxArtifacts,
      })
    : undefined);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RoutingUnavailableError) return reply.code(503).send({ error: 'routing_unavailable', message: error.message });
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const candidateStatusCode = typeof error === 'object'
      && error !== null
      && 'statusCode' in error
      && typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
    request.log.error({ errorType: errorName }, 'request failed');
    if (error instanceof ThreadReadStorageError || error instanceof ThreadObservationUnavailableError) return reply.code(503).send({ error: 'thread_state_unavailable' });
    if (error instanceof ReactionUnavailableError) return reply.code(409).send({ error: 'reactions_unavailable' });
    if (error instanceof ReactionConflictError) return reply.code(409).send({ error: 'reaction_conflict' });
    if (error instanceof ReactionBoundsError) return reply.code(409).send({ error: 'reaction_limit_reached' });
    if (error instanceof ReactionStorageError) return reply.code(503).send({ error: 'reaction_storage_unavailable' });
    if (error instanceof RoomStorageError) return reply.code(503).send({ error: 'room_storage_unavailable' });
    if (error instanceof NotificationStorageError) return reply.code(503).send({ error: 'notification_storage_unavailable' });
    if (error instanceof NotificationNotFoundError) return reply.code(404).send({ error: 'notification_not_found' });
    if (error instanceof ArtifactStorageError) return reply.code(503).send({ error: 'artifact_storage_unavailable' });
    if (error instanceof ArtifactConflictError) return reply.code(409).send({ error: 'artifact_conflict' });
    if (error instanceof ArtifactDeletedError) return reply.code(410).send({ error: 'artifact_deleted' });
    if (error instanceof ArtifactNotFoundError) return reply.code(404).send({ error: 'artifact_not_found' });
    if (error instanceof AuditIntegrityError || (error instanceof CommandProxyUnavailableError && error.statusCode === 503)) {
      return reply.code(503).send({ error: 'live_room_unavailable' });
    }
    const statusCode = candidateStatusCode !== undefined
      && candidateStatusCode >= 400
      && candidateStatusCode < 500
      ? candidateStatusCode
      : 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'internal_error' : 'bad_request',
    });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const cachePolicy = isApiRequestUrl(request.url)
      ? 'no-store'
      : request.url.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
    reply.header('cache-control', cachePolicy);
    if (!reply.hasHeader('content-security-policy')) reply.header('content-security-policy', [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "manifest-src 'self'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "worker-src 'self'",
    ].join('; '));
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  app.get('/api/health', async (_request, reply) => {
    const artifactReadiness = artifactStore ? await artifactStore.readiness() : { artifacts: 'pass' as const, initialized: true };
    const ok = artifactReadiness.artifacts === 'pass';
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'unavailable',
      service: 'jarvis-command',
      version: dependencies.config.appVersion,
      readiness: { artifacts: artifactReadiness.artifacts },
    });
  });

  // Network-only top-level reauth entry. Never accept a caller-selected target.
  app.get('/api/auth/recover', async (request, reply) => {
    const rawAssertion = request.headers['cf-access-jwt-assertion'];
    try {
      await dependencies.verifyAccess(typeof rawAssertion === 'string' ? rawAssertion : undefined);
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.redirect('/', 303);
  });

  app.get('/api/bootstrap', async (request, reply) => {
    const rawAssertion = request.headers['cf-access-jwt-assertion'];
    const assertion = typeof rawAssertion === 'string' ? rawAssertion : undefined;
    let verifiedIdentity: Awaited<ReturnType<AppDependencies['verifyAccess']>>;

    try {
      verifiedIdentity = await dependencies.verifyAccess(assertion);
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    let snapshot: HermesSnapshot;
    try {
      snapshot = await dependencies.hermes.readSnapshot();
    } catch {
      snapshot = offlineSnapshot();
    }

    let liveRoomEnabled = !!dependencies.config.command && !!dependencies.liveRoom;
    if (liveRoomEnabled) {
      try { await dependencies.checkLiveRoom?.(); } catch { liveRoomEnabled = false; }
    }
    const capabilities = [...new Set([
      ...snapshot.capabilities.filter(capability => capability !== 'message_reactions'),
      ...(dependencies.config.artifacts.enabled ? ['artifact_studio'] : []),
    ])];
    // An optional UI capability must not overflow the existing bootstrap contract.
    if (liveRoomEnabled && dependencies.config.reactionsEnabled && capabilities.length < 100) capabilities.push('message_reactions');
    const payload: CommandBootstrap = {
      identity: { provider: verifiedIdentity.provider },
      command: {
        version: dependencies.config.appVersion,
        environment: dependencies.config.nodeEnv,
        generatedAt: now().toISOString(),
        liveRoom: {
          enabled: liveRoomEnabled,
          externalContinue: false,
          maxInputCharacters: 16_000,
          maxSteerCharacters: 4_000,
        },

      },
      hermes: {
        state: snapshot.state,
        version: snapshot.version,
        model: snapshot.model,
        provider: snapshot.provider,
        gatewayState: snapshot.gatewayState,
        activeAgents: snapshot.activeAgents,
        capabilities,
        readinessChecks: snapshot.readinessChecks,
      },
      sessions: snapshot.sessions,
    };

    return CommandBootstrapSchema.parse(payload);
  });

  // Keep the original dependency object: production supplies liveRoom lazily
  // after onReady. Spreading here would freeze that getter before startup.
  registerLiveRoomRoutes(app, dependencies, artifactStore);
  registerArtifactRoutes(app, { ...dependencies, artifactStore });
  app.addHook('onReady', async () => {
    await artifactStore?.init();
  });

  if (dependencies.config.webDistDir) {
    app.register(fastifyStatic, {
      root: dependencies.config.webDistDir,
      index: ['index.html'],
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !isApiRequestUrl(request.url)) {
        return reply.type('text/html; charset=utf-8').sendFile('index.html');
      }

      return reply.code(404).send({ error: 'not_found' });
    });
  }

  return app;
}

function isApiRequestUrl(requestUrl: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(requestUrl, 'http://jarvis-command.invalid').pathname;
  } catch {
    return requestUrl === '/api'
      || requestUrl.startsWith('/api/')
      || requestUrl.startsWith('/api?');
  }

  return pathname === '/api' || pathname.startsWith('/api/');
}

export function createLoggerOptions(nodeEnv: AppConfig['nodeEnv']): false | {
  level: string;
  redact: { paths: string[]; censor: string };
  serializers: { req: (request: { method?: string }) => { method: string } };
} {
  if (nodeEnv === 'test') {
    return false;
  }

  return {
    level: 'info',
    serializers: { req: (request) => ({ method: request.method ?? 'UNKNOWN' }) },
    redact: {
      paths: [
        'req.body',
        'req.headers.authorization',
        'req.headers.cookie',
        "req.headers['cf-access-jwt-assertion']",
        'res.headers.set-cookie',
      ],
      censor: '[REDACTED]',
    },
  };
}

function offlineSnapshot(): HermesSnapshot {
  return {
    state: 'offline',
    version: null,
    model: null,
    provider: null,
    gatewayState: 'unknown',
    activeAgents: 0,
    capabilities: [],
    readinessChecks: { hermesBridge: 'fail' },
    sessions: [],
  };
}
