import { CommandBootstrapSchema, type CommandBootstrap } from '@jarvis-command/contracts';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import type { AppConfig } from './config';
import type { HermesSnapshot } from './hermes-client';

type AppDependencies = Readonly<{
  config: AppConfig;
  verifyAccess: (
    assertion: string | undefined,
  ) => Promise<CommandBootstrap['identity']>;
  hermes: Readonly<{
    readSnapshot: () => Promise<HermesSnapshot>;
  }>;
  now?: () => Date;
}>;

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: dependencies.config.nodeEnv !== 'test',
    trustProxy: false,
  });
  const now = dependencies.now ?? (() => new Date());

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
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
    let identity: CommandBootstrap['identity'];

    try {
      identity = await dependencies.verifyAccess(assertion);
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    let snapshot: HermesSnapshot;
    try {
      snapshot = await dependencies.hermes.readSnapshot();
    } catch {
      snapshot = offlineSnapshot(dependencies.config);
    }

    const payload: CommandBootstrap = {
      identity,
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
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.type('text/html; charset=utf-8').sendFile('index.html');
      }

      return reply.code(404).send({ error: 'not_found' });
    });
  }

  return app;
}

function offlineSnapshot(config: AppConfig): HermesSnapshot {
  return {
    state: 'offline',
    version: null,
    model: config.hermes.modelLabel,
    provider: config.hermes.providerLabel,
    gatewayState: 'unknown',
    activeAgents: 0,
    capabilities: [],
    readinessChecks: { upstream: 'fail' },
    sessions: [],
  };
}
