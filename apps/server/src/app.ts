import { CommandBootstrapSchema, type CommandBootstrap } from '@jarvis-command/contracts';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

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
  now?: () => Date;
}>;

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: createLoggerOptions(dependencies.config.nodeEnv),
    trustProxy: false,
    bodyLimit: 16_384,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 100,
  });
  const now = dependencies.now ?? (() => new Date());

  app.setErrorHandler((error, request, reply) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const candidateStatusCode = typeof error === 'object'
      && error !== null
      && 'statusCode' in error
      && typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
    request.log.error({ errorType: errorName }, 'request failed');
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
    reply.header('content-security-policy', [
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

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'jarvis-command',
    version: dependencies.config.appVersion,
  }));

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

    const payload: CommandBootstrap = {
      identity: { provider: verifiedIdentity.provider },
      command: {
        version: dependencies.config.appVersion,
        environment: dependencies.config.nodeEnv,
        generatedAt: now().toISOString(),
      },
      hermes: {
        state: snapshot.state,
        version: snapshot.version,
        model: snapshot.model,
        provider: snapshot.provider,
        gatewayState: snapshot.gatewayState,
        activeAgents: snapshot.activeAgents,
        capabilities: snapshot.capabilities,
        readinessChecks: snapshot.readinessChecks,
      },
      sessions: snapshot.sessions,
    };

    return CommandBootstrapSchema.parse(payload);
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
} {
  if (nodeEnv === 'test') {
    return false;
  }

  return {
    level: 'info',
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
