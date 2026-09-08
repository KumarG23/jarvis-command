import { timingSafeEqual } from 'node:crypto';

import {
  ApprovalChoiceSchema,
  ApprovalRequestIdSchema,
  OpaqueIdentifierSchema,
  SessionIdSchema,
  LiveRoomSessionContinueRequestSchema,
  LiveRoomSessionCreateRequestSchema,
  LiveRunApprovalRequestSchema,
  LiveRunStateSchema,
  LiveRunSteerRequestSchema,
  SessionMessagesPageSchema,
  SessionMutationResponseSchema,
  type LiveApproval,
  type LiveRunState,
  type LiveRunUsage,
  type SessionMessage,
  type SessionSummary,
} from '@jarvis-command/contracts';
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import type { CommandProxyConfig } from './config';

const MAX_JSON_RESPONSE_BYTES = 2_097_152;
const MAX_SSE_FRAME_BYTES = 524_288;
const MAX_SSE_TOTAL_BYTES = 33_554_432;
const MAX_ACTIVE_STREAMS = 4;
const JSON_TIMEOUT_MS = 8_000;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/;
const COMMAND_SESSION_ID = /^jc_[a-f0-9]{32}$/;
const RUN_ID = /^run_[a-f0-9]{32}$/;
const IDEMPOTENCY_KEY = /^[!-~]{1,255}$/;
const COMMAND_SOURCES = new Set(['jarvis-command', 'api_server']);

const UpstreamSessionSchema = z.object({
  id: SessionIdSchema,
  source: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  last_active: z.union([z.number(), z.string()]).nullable().optional(),
  started_at: z.union([z.number(), z.string()]).nullable().optional(),
  message_count: z.number().int().nonnegative().optional(),
  tool_call_count: z.number().int().nonnegative().optional(),
  pinned: z.boolean().optional(),
}).passthrough();

const UpstreamSessionEnvelopeSchema = z.object({
  session: UpstreamSessionSchema,
}).passthrough();

const UpstreamMessageSchema = z.object({
  id: z.union([OpaqueIdentifierSchema, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]),
  session_id: SessionIdSchema,
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().max(131_072),
  timestamp: z.union([z.number(), z.string()]).nullable().optional(),
  tool_name: z.string().nullable().optional(),
  display_kind: z.string().nullable().optional(),
}).passthrough();

const UpstreamMessagePageSchema = z.object({
  session_id: SessionIdSchema,
  data: z.array(UpstreamMessageSchema).max(100),
  pagination: z.object({
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    order: z.literal('oldest'),
  }).passthrough(),
}).passthrough();

const UpstreamRunCreateSchema = z.object({
  run_id: z.string().regex(RUN_ID),
  status: z.string(),
  replayed: z.boolean().optional(),
}).passthrough();

const UpstreamRunStatusSchema = z.object({
  run_id: z.string().regex(RUN_ID),
  session_id: SessionIdSchema,
  status: z.string(),
  updated_at: z.union([z.number(), z.string()]),
  approval: z.record(z.string(), z.unknown()).nullable().optional(),
  output: z.string().max(262_144).nullable().optional(),
  error: z.string().max(4_096).nullable().optional(),
  pending_steer: z.string().max(4_000).nullable().optional(),
  usage: z.record(z.string(), z.unknown()).nullable().optional(),
  history_binding: z.object({
    run_id: z.string().regex(RUN_ID), session_id: SessionIdSchema,
    user_message_id: z.string().regex(/^[1-9][0-9]{0,18}$/),
    assistant_message_id: z.string().regex(/^[1-9][0-9]{0,18}$/),
  }).strict().optional(),
}).passthrough();

const UpstreamApprovalResponseSchema = z.object({
  run_id: z.string().regex(RUN_ID),
  request_id: ApprovalRequestIdSchema,
  choice: ApprovalChoiceSchema,
  resolved: z.number().int().min(1).max(100),
}).passthrough();

const UpstreamSteerResponseSchema = z.object({
  run_id: z.string().regex(RUN_ID),
  accepted: z.literal(true),
}).passthrough();

const UpstreamStopResponseSchema = z.object({
  run_id: z.string().regex(RUN_ID),
  status: z.string(),
}).passthrough();

const RunCreateBodySchema = z.object({
  sessionId: z.string().regex(SESSION_ID),
  input: z.string().trim().min(1).max(16_000),
}).strict();

export type CommandProxyDependencies = Readonly<{
  config: CommandProxyConfig;
  fetcher?: typeof fetch;
  randomUUID?: () => string;
  now?: () => Date;
}>;

export function buildCommandProxy({
  config,
  fetcher = fetch,
  randomUUID = () => crypto.randomUUID(),
  now = () => new Date(),
}: CommandProxyDependencies) {
  if (config.commandProxyKey === config.hermesApiKey) throw new Error('Command proxy credentials must be distinct');
  const app = Fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: 131_072,
    exposeHeadRoutes: false,
    connectionTimeout: 10_000,
    requestTimeout: 12_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 100,
  });
  const activeStreams = new Set<AbortController>();
  app.addHook('preClose', async () => {
    for (const controller of activeStreams) controller.abort();
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    return reply.code(status && status >= 400 && status < 500 ? status : 500).send({ error: status && status >= 400 && status < 500 ? 'invalid_request' : 'internal_error' });
  });
  app.addHook('preValidation', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const history = request.routeOptions.url === '/api/sessions/:sessionId/messages';
    for (const [key, value] of Object.entries(query)) {
      if (!history || !['limit', 'offset'].includes(key) || typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < (key === 'limit' ? 1 : 0) || Number(value) > (key === 'limit' ? 100 : 1_000_000)) return invalidRequest(reply);
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    setSecurityHeaders(reply);
    return payload;
  });

  app.get('/_health', async () => ({
    status: 'ok',
    service: 'jarvis-command-command-proxy',
  }));

  app.get('/_ready', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    try {
      const capabilities = z.object({ features: z.object({ runs_idempotency: z.object({
        supported: z.literal(true), durable: z.literal(true),
        retention_seconds: z.number().int().min(86_400),
      }) }) }).parse(await requestJson({ path: '/v1/capabilities', method: 'GET', config, fetcher }));
      return { ready: true, durableIdempotency: true, retentionSeconds: capabilities.features.runs_idempotency.retention_seconds, externalContinue: false };
    } catch (error) { return sendProxyError(error, reply); }
  });

  app.get('/api/sessions/:sessionId/messages', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const sessionId = validSessionId(pathParameter(request, 'sessionId'));
    if (!sessionId) return invalidRequest(reply);
    const query = request.query as Record<string, unknown>;
    const limit = boundedInteger(query.limit, 50, 1, 100);
    const offset = boundedInteger(query.offset, 0, 0, 1_000_000);

    try {
      const upstream = UpstreamMessagePageSchema.parse(await requestJson({
        path: `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}&offset=${offset}&order=oldest`,
        method: 'GET',
        config,
        fetcher,
      }));
      if (upstream.session_id !== sessionId
        || upstream.data.some(message => message.session_id !== sessionId)
        || upstream.pagination.limit !== limit
        || upstream.pagination.offset !== offset
        || upstream.pagination.returned !== upstream.data.length
        || upstream.data.length > limit) throw new UpstreamProtocolError();
      const messages = upstream.data.map((message) => projectMessage(message));
      return SessionMessagesPageSchema.parse({
        sessionId: upstream.session_id,
        messages,
        pagination: {
          limit,
          offset,
          returned: messages.length,
          hasMore: messages.length === limit,
        },
      });
    } catch (error) {
      return sendProxyError(error, reply);
    }
  });

  app.get('/api/sessions/:sessionId', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const sessionId = pathParameter(request, 'sessionId');
    if (typeof sessionId !== 'string' || !COMMAND_SESSION_ID.test(sessionId)) return invalidRequest(reply);
    try {
      const upstream = UpstreamSessionEnvelopeSchema.parse(await requestJson({ path: `/api/sessions/${sessionId}`, method: 'GET', config, fetcher }));
      if (upstream.session.id !== sessionId) throw new UpstreamProtocolError();
      if (!COMMAND_SOURCES.has(upstream.session.source ?? '')) return reply.code(403).send({ error: 'session_read_only' });
      return SessionMutationResponseSchema.parse({ session: projectSession(upstream.session, now(), true) });
    } catch (error) { return sendProxyError(error, reply); }
  });
  app.post('/api/sessions', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const parsed = LiveRoomSessionCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply);
    const sessionId = commandSessionId(randomUUID());
    if (!sessionId) return reply.code(500).send({ error: 'internal_error' });

    try {
      const upstream = UpstreamSessionEnvelopeSchema.parse(await requestJson({
        path: '/api/sessions',
        method: 'POST',
        body: {
          id: sessionId,
          // Hermes normalizes unknown source tags; use its supported API source.
          source: 'api_server',
          ...(parsed.data.title ? { title: parsed.data.title } : {}),
        },
        config,
        fetcher,
      }));
      if (upstream.session.id !== sessionId || upstream.session.source !== 'api_server') throw new UpstreamProtocolError();
      return reply.code(201).send(SessionMutationResponseSchema.parse({
        session: projectSession(upstream.session, now(), true),
      }));
    } catch (error) {
      return sendProxyError(error, reply);
    }
  });

  app.post('/api/sessions/:sessionId/fork', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const sourceId = validSessionId(pathParameter(request, 'sessionId'));
    const parsed = LiveRoomSessionContinueRequestSchema.safeParse(request.body);
    if (!sourceId || !parsed.success) return invalidRequest(reply);
    const forkId = commandSessionId(randomUUID());
    if (!forkId) return reply.code(500).send({ error: 'internal_error' });

    try {
      if (!COMMAND_SESSION_ID.test(sourceId) || !await isWritableSession(sourceId, config, fetcher)) {
        return reply.code(403).send({ error: 'session_read_only' });
      }
      const upstream = UpstreamSessionEnvelopeSchema.parse(await requestJson({
        path: `/api/sessions/${encodeURIComponent(sourceId)}/fork`,
        method: 'POST',
        body: {
          id: forkId,
          ...(parsed.data.title ? { title: parsed.data.title } : {}),
        },
        config,
        fetcher,
      }));
      if (upstream.session.id !== forkId || !COMMAND_SOURCES.has(upstream.session.source ?? '')) throw new UpstreamProtocolError();
      return reply.code(201).send(SessionMutationResponseSchema.parse({
        session: projectSession(upstream.session, now(), true),
      }));
    } catch (error) {
      return sendProxyError(error, reply);
    }
  });

  app.post('/v1/runs', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const parsed = RunCreateBodySchema.safeParse(request.body);
    const idempotencyKey = headerValue(request, 'idempotency-key');
    if (!parsed.success || !idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return invalidRequest(reply);
    }

    try {
      const writable = await isWritableSession(parsed.data.sessionId, config, fetcher);
      if (!writable) return reply.code(403).send({ error: 'session_read_only' });
      const upstream = UpstreamRunCreateSchema.parse(await requestJson({
        path: '/v1/runs',
        method: 'POST',
        body: {
          session_id: parsed.data.sessionId,
          input: parsed.data.input,
        },
        headers: { 'idempotency-key': idempotencyKey },
        config,
        fetcher,
      }));
      return reply.code(202).send({
        runId: upstream.run_id,
        sessionId: parsed.data.sessionId,
        status: normalizeRunState(upstream.status),
        replayed: upstream.replayed ?? false,
      });
    } catch (error) {
      return sendProxyError(error, reply);
    }
  });

  app.get('/v1/runs/:runId', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const runId = validRunId(pathParameter(request, 'runId'));
    if (!runId) return invalidRequest(reply);

    try {
      const upstream = UpstreamRunStatusSchema.parse(await requestJson({
        path: `/v1/runs/${runId}`,
        method: 'GET',
        headers: request.headers['x-jarvis-history-binding'] === '1' ? { 'x-hermes-history-binding': '1' } : {},
        config,
        fetcher,
      }));
      if (upstream.run_id !== runId) throw new UpstreamProtocolError();
      return projectRunStatus(upstream, request.headers['x-jarvis-history-binding'] === '1');
    } catch (error) {
      return sendProxyError(error, reply);
    }
  });

  app.get('/v1/runs/:runId/events', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const runId = validRunId(pathParameter(request, 'runId'));
    if (!runId) return invalidRequest(reply);
    if (activeStreams.size >= MAX_ACTIVE_STREAMS) {
      return reply.code(429).send({ error: 'stream_limit' });
    }

    const controller = new AbortController();
    activeStreams.add(controller);
    const timeout = setTimeout(() => controller.abort(), config.maxStreamSeconds * 1_000);
    timeout.unref?.();
    const onClose = () => controller.abort();
    reply.raw.once('close', onClose);

    try {
      const upstream = await fetchEventStream(fetcher, `${config.hermesBaseUrl}/v1/runs/${runId}/events`, {
        method: 'GET',
        headers: upstreamHeaders(config),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => undefined);
        throw new UpstreamHttpError(upstream.status);
      }
      if (!upstream.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        void upstream.body?.cancel().catch(() => undefined);
        throw new UpstreamProtocolError();
      }
      if (!upstream.body) throw new UpstreamProtocolError();

      // Only SSE bypasses socket inactivity timeout; the hard stream lifetime remains.
      reply.raw.socket?.setTimeout?.(0);
      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('cache-control', 'no-cache, no-store');
      reply.raw.setHeader('x-accel-buffering', 'no');
      setRawSecurityHeaders(reply.raw.setHeader.bind(reply.raw));
      reply.raw.flushHeaders();

      await relayEventStream(upstream.body, runId, reply.raw, controller);
      if (!reply.raw.writableEnded) reply.raw.end();
      return reply;
    } catch (error) {
      if (reply.raw.headersSent) {
        if (!reply.raw.writableEnded) {
          reply.raw.write('event: error\ndata: {"error":"stream_unavailable"}\n\n');
          reply.raw.end();
        }
        return reply;
      }
      return sendProxyError(error, reply);
    } finally {
      clearTimeout(timeout);
      controller.abort();
      reply.raw.off('close', onClose);
      activeStreams.delete(controller);
    }
  });

  app.post('/v1/runs/:runId/approval', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const runId = validRunId(pathParameter(request, 'runId'));
    const parsed = LiveRunApprovalRequestSchema.safeParse(request.body);
    if (!runId || !parsed.success) return invalidRequest(reply);

    try {
      const upstream = UpstreamApprovalResponseSchema.parse(await requestJson({
        path: `/v1/runs/${runId}/approval`,
        method: 'POST',
        body: {
          request_id: parsed.data.requestId,
          choice: parsed.data.choice,
        },
        config,
        fetcher,
      }));
      if (upstream.run_id !== runId || upstream.request_id !== parsed.data.requestId || upstream.choice !== parsed.data.choice) throw new UpstreamProtocolError();
      return {
        runId: upstream.run_id,
        requestId: upstream.request_id,
        choice: upstream.choice,
        resolved: upstream.resolved,
      };
    } catch (error) {
      return sendProxyError(error, reply);
    }
  });

  app.post('/v1/runs/:runId/steer', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const runId = validRunId(pathParameter(request, 'runId'));
    const parsed = LiveRunSteerRequestSchema.safeParse(request.body);
    if (!runId || !parsed.success) return invalidRequest(reply);

    try {
      const upstream = UpstreamSteerResponseSchema.parse(await requestJson({
        path: `/v1/runs/${runId}/steer`,
        method: 'POST',
        body: { input: parsed.data.input },
        config,
        fetcher,
      }));
      if (upstream.run_id !== runId) throw new UpstreamProtocolError();
      return { runId: upstream.run_id, accepted: true };
    } catch (error) {
      return sendProxyError(error, reply);
    }
  });

  app.post('/v1/runs/:runId/stop', async (request, reply) => {
    if (!authorize(request, reply, config.commandProxyKey)) return reply;
    const runId = validRunId(pathParameter(request, 'runId'));
    if (!runId || !isEmptyRecord(request.body)) return invalidRequest(reply);

    try {
      const upstream = UpstreamStopResponseSchema.parse(await requestJson({
        path: `/v1/runs/${runId}/stop`,
        method: 'POST',
        body: {},
        config,
        fetcher,
      }));
      if (upstream.run_id !== runId) throw new UpstreamProtocolError();
      return { runId: upstream.run_id, status: normalizeRunState(upstream.status) };
    } catch (error) {
      return sendProxyError(error, reply);
    }
  });

  app.setNotFoundHandler(async (_request, reply) => (
    reply.code(404).send({ error: 'not_found' })
  ));

  return app;
}

async function isWritableSession(
  sessionId: string,
  config: CommandProxyConfig,
  fetcher: typeof fetch,
): Promise<boolean> {
  const upstream = UpstreamSessionEnvelopeSchema.parse(await requestJson({
    path: `/api/sessions/${encodeURIComponent(sessionId)}`,
    method: 'GET',
    config,
    fetcher,
  }));
  const source = upstream.session.source ?? '';
  return COMMAND_SESSION_ID.test(upstream.session.id)
    && upstream.session.id === sessionId
    && COMMAND_SOURCES.has(source);
}

type RequestJsonOptions = Readonly<{
  path: string;
  method: 'GET' | 'POST';
  body?: Readonly<Record<string, unknown>>;
  headers?: Readonly<Record<string, string>>;
  config: CommandProxyConfig;
  fetcher: typeof fetch;
}>;

async function requestJson(options: RequestJsonOptions): Promise<unknown> {
  const response = await options.fetcher(`${options.config.hermesBaseUrl}${options.path}`, {
    method: options.method,
    headers: {
      ...upstreamHeaders(options.config),
      ...(options.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamHttpError(response.status);
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamProtocolError();
  }
  const text = await readBoundedBody(response, MAX_JSON_RESPONSE_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamProtocolError();
  }
}

async function fetchEventStream(fetcher: typeof fetch, url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  const { signal } = init;
  return await new Promise<Response>((resolve, reject) => {
    const onAbort = () => { reject(new UpstreamProtocolError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    void Promise.resolve().then(() => fetcher(url, init)).then(response => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }
      resolve(response);
    }, error => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}

function upstreamHeaders(config: CommandProxyConfig): Record<string, string> {
  return {
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${config.hermesApiKey}`,
  };
}

function projectSession(
  session: z.infer<typeof UpstreamSessionSchema>,
  fallbackDate: Date,
  forceCommand: boolean,
): SessionSummary {
  const projected = {
    id: session.id,
    title: nonBlank(session.title, 'Untitled session').slice(0, 160),
    source: nonBlank(session.source, 'unknown').slice(0, 40),
    ownership: forceCommand || (
      COMMAND_SESSION_ID.test(session.id) && COMMAND_SOURCES.has(session.source ?? '')
    ) ? 'command' as const : 'external' as const,
    model: nullableNonBlank(session.model)?.slice(0, 160) ?? null,
    lastActive: toIsoTimestamp(session.last_active ?? session.started_at, fallbackDate),
    messageCount: session.message_count ?? 0,
    toolCallCount: session.tool_call_count ?? 0,
    pinned: session.pinned ?? false,
  };
  return projected;
}

function projectMessage(message: z.infer<typeof UpstreamMessageSchema>): SessionMessage {
  return {
    id: String(message.id),
    sessionId: message.session_id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp === null || message.timestamp === undefined
      ? null
      : toIsoTimestamp(message.timestamp),
    toolName: nullableNonBlank(message.tool_name)?.slice(0, 160) ?? null,
    displayKind: nullableNonBlank(message.display_kind)?.slice(0, 80) ?? null,
  };
}

function projectRunStatus(upstream: z.infer<typeof UpstreamRunStatusSchema>, includeBinding = false) {
  const binding = upstream.history_binding;
  if (binding && (binding.run_id !== upstream.run_id || binding.session_id !== upstream.session_id
    || upstream.status !== 'completed' || BigInt(binding.user_message_id) >= BigInt(binding.assistant_message_id))) throw new UpstreamProtocolError();
  return {
    ...(includeBinding && binding ? { historyBinding: { userMessageId: binding.user_message_id, assistantMessageId: binding.assistant_message_id } } : {}),
    runId: upstream.run_id,
    sessionId: upstream.session_id,
    status: normalizeRunState(upstream.status),
    updatedAt: toIsoTimestamp(upstream.updated_at),
    approval: upstream.approval ? projectApproval(upstream.approval) : null,
    output: upstream.output ?? null,
    error: upstream.error == null ? null : 'Hermes run unavailable',
    pendingSteer: upstream.pending_steer ?? null,
    usage: projectUsage(upstream.usage),
  };
}

function projectApproval(value: Record<string, unknown>): LiveApproval {
  const requestId = ApprovalRequestIdSchema.parse(value.request_id);
  const command = value.command;
  if (typeof command !== 'string' || !command.trim() || command.length > 4_096) throw new UpstreamProtocolError();
  const redactedCommand = redactApprovalText(command);
  if (redactedCommand.length > 4_096) throw new UpstreamProtocolError();
  const description = nonBlank(value.description, 'Hermes requires operator approval.');
  const tool = nullableNonBlank(value.tool);
  if (!requestId || requestId.length > 256) throw new UpstreamProtocolError();
  return {
    requestId,
    command: redactedCommand,
    description: redactApprovalText(description).slice(0, 2_048),
    tool: tool === null ? null : redactApprovalText(tool).slice(0, 160),
  };
}

function projectUsage(value: Record<string, unknown> | null | undefined): LiveRunUsage | null {
  if (!value) return null;
  const inputTokens = nonnegativeInteger(value.input_tokens);
  const outputTokens = nonnegativeInteger(value.output_tokens);
  const totalTokens = nonnegativeInteger(value.total_tokens);
  return { inputTokens, outputTokens, totalTokens };
}

async function relayEventStream(
  body: ReadableStream<Uint8Array>,
  expectedRunId: string,
  output: NodeJS.WritableStream,
  controller: AbortController,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  controller.signal.addEventListener('abort', onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  let buffer = '';
  let total = 0;
  let dataLines: string[] = [];
  let dataBytes = 0;
  const appendData = (line: string) => {
    const data = line.slice(5).trimStart();
    dataBytes += Buffer.byteLength(data) + (dataLines.length > 0 ? 1 : 0);
    if (dataBytes > MAX_SSE_FRAME_BYTES) throw new UpstreamProtocolError();
    dataLines.push(data);
  };

  const write = async (text: string) => {
    controller.signal.throwIfAborted();
    if (output.write(text)) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        output.off('drain', onDrain);
        output.off('error', onError);
        controller.signal.removeEventListener('abort', onAbort);
      };
      const onDrain = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new UpstreamProtocolError()); };
      const onAbort = onError;
      output.once('drain', onDrain);
      output.once('error', onError);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
  };
  const flushFrame = async () => {
    if (dataLines.length === 0) return;
    const rawData = dataLines.join('\n');
    dataLines = [];
    dataBytes = 0;
    if (Buffer.byteLength(rawData) > MAX_SSE_FRAME_BYTES) throw new UpstreamProtocolError();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      throw new UpstreamProtocolError();
    }
    const projected = projectEvent(parsed, expectedRunId);
    if (projected) await write(`data: ${JSON.stringify(projected)}\n\n`);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SSE_TOTAL_BYTES) throw new UpstreamProtocolError();
      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer) > MAX_SSE_FRAME_BYTES * 2) throw new UpstreamProtocolError();

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          await flushFrame();
        } else if (line.startsWith('data:')) {
          appendData(line);
        } else if (line.startsWith(':')) {
          await write(': keepalive\n\n');
        }
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) appendData(buffer);
    await flushFrame();
  } finally {
    controller.abort();
    controller.signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function projectEvent(value: unknown, expectedRunId: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UpstreamProtocolError();
  const event = value as Record<string, unknown>;
  if (event.run_id !== expectedRunId) throw new UpstreamProtocolError();
  const timestamp = toIsoTimestamp(event.timestamp);

  switch (event.event) {
    case 'message.delta':
      return { runId: expectedRunId, type: 'message.delta', timestamp, delta: boundedString(event.delta, 32_768) };
    case 'tool.started':
      return {
        runId: expectedRunId,
        type: 'tool.started',
        timestamp,
        tool: OpaqueIdentifierSchema.parse(event.tool),
        preview: redactForDisplay(event.preview, 2_048),
      };
    case 'tool.completed':
      return {
        runId: expectedRunId,
        type: 'tool.completed',
        timestamp,
        tool: OpaqueIdentifierSchema.parse(event.tool),
        durationSeconds: boundedNumber(event.duration, 0, 86_400),
        error: event.error === true,
      };
    case 'subagent.start':
      return {
        runId: expectedRunId,
        type: 'subagent.start',
        timestamp,
        subagentId: OpaqueIdentifierSchema.parse(event.subagent_id ?? event.child_session_id),
        goal: redactForDisplay(event.goal ?? event.preview, 2_048),
        status: nullableBoundedString(event.status, 80),
      };
    case 'subagent.complete':
      return {
        runId: expectedRunId,
        type: 'subagent.complete',
        timestamp,
        subagentId: OpaqueIdentifierSchema.parse(event.subagent_id ?? event.child_session_id),
        summary: redactForDisplay(event.summary ?? event.preview, 4_096),
        status: nullableBoundedString(event.status, 80),
      };
    case 'approval.request':
      return { runId: expectedRunId, type: 'approval.request', timestamp, approval: projectApproval(event) };
    case 'approval.responded': {
      const choice = ApprovalChoiceSchema.parse(event.choice);
      return {
        runId: expectedRunId,
        type: 'approval.responded',
        timestamp,
        requestId: ApprovalRequestIdSchema.parse(event.request_id),
        choice,
      };
    }
    case 'run.steered':
      return { runId: expectedRunId, type: 'run.steered', timestamp, accepted: true };
    case 'run.completed':
      return {
        runId: expectedRunId,
        type: 'run.completed',
        timestamp,
        output: boundedString(event.output, 262_144),
        pendingSteer: nullableBoundedString(event.pending_steer, 4_000),
        usage: isRecord(event.usage) ? projectUsage(event.usage) : null,
      };
    case 'run.interrupted':
    case 'run.failed':
      return { runId: expectedRunId, type: event.event, timestamp, error: 'Hermes run unavailable' };
    case 'run.cancelled':
      return { runId: expectedRunId, type: 'run.cancelled', timestamp };
    case 'reasoning.available':
      return null;
    default:
      return null;
  }
}

function normalizeRunState(value: string): LiveRunState {
  if (value === 'started') return 'queued';
  const parsed = LiveRunStateSchema.safeParse(value);
  if (!parsed.success) throw new UpstreamProtocolError();
  return parsed.data;
}

function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedKey: string,
): boolean {
  const authorization = headerValue(request, 'authorization');
  if (!authorization?.startsWith('Bearer ')) {
    void reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  const received = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(expectedKey);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    void reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function sendProxyError(error: unknown, reply: FastifyReply) {
  if (error instanceof UpstreamHttpError) {
    if (error.status === 404) return reply.code(404).send({ error: 'not_found' });
    if (error.status === 409) return reply.code(409).send({ error: 'conflict' });
    if (error.status === 429) return reply.code(429).send({ error: 'busy' });
    if (error.status === 400 || error.status === 422) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
  }
  return reply.code(503).send({ error: 'upstream_unavailable' });
}

function invalidRequest(reply: FastifyReply) {
  return reply.code(400).send({ error: 'invalid_request' });
}

class UpstreamHttpError extends Error {
  public constructor(public readonly status: number) {
    super('Upstream request failed');
  }
}

class UpstreamProtocolError extends Error {
  public constructor() {
    super('Upstream response violated the command proxy contract');
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamProtocolError();
  }
  if (!response.body) throw new UpstreamProtocolError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new UpstreamProtocolError();
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function setSecurityHeaders(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store');
  reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
}

function setRawSecurityHeaders(setHeader: (name: string, value: string) => unknown): void {
  setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  setHeader('referrer-policy', 'no-referrer');
  setHeader('x-content-type-options', 'nosniff');
  setHeader('x-frame-options', 'DENY');
}

function pathParameter(request: FastifyRequest, name: string): unknown {
  return (request.params as Record<string, unknown>)[name];
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function validSessionId(value: unknown): string | null {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null;
}

function validRunId(value: unknown): string | null {
  return typeof value === 'string' && RUN_ID.test(value) ? value : null;
}

function commandSessionId(uuid: string): string | null {
  const compact = uuid.toLowerCase().replaceAll('-', '');
  const id = `jc_${compact}`;
  return COMMAND_SESSION_ID.test(id) ? id : null;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

function toIsoTimestamp(value: unknown, fallback = new Date(0)): string {
  const date = typeof value === 'number'
    ? new Date(value * 1_000)
    : typeof value === 'string'
      ? new Date(value)
      : fallback;
  if (Number.isNaN(date.getTime())) throw new UpstreamProtocolError();
  return date.toISOString();
}

function nonBlank(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nullableNonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function boundedString(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function nullableBoundedString(value: unknown, maximum: number): string | null {
  const result = boundedString(value, maximum).trim();
  return result || null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : minimum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function redactApprovalText(value: string): string {
  // This is a deliberately narrow display policy, not a shell/JSON parser.
  // Quotes, escapes and operators in a credential span require another surface.
  return value.replace(
    /\b(Bearer\s+|(?:api[_-]?key|token|password|secret)\b["']?\s*[:=]\s*)([^\s]*)/gi,
    (_match, prefix: string, credential: string) => {
      if (!/^[A-Za-z0-9._~+/=-]+$/.test(credential) || /[\r\n]/.test(prefix)) {
        throw new UpstreamProtocolError();
      }
      return `${prefix}[REDACTED]`;
    },
  );
}

function redactForDisplay(value: unknown, maximum: number): string {
  const omitted = '[Metadata omitted]';
  if (typeof value !== 'string') return '';
  // Inspect complete, bounded metadata, never a clipped credential span. Unlike
  // approval targets, ambiguous metadata can be omitted without losing the event.
  if (value.length > maximum) return omitted;
  if (/\b(?:Bearer|api[_-]?key|token|password|secret)\b/i.test(value)
    && /["'\\\r\n\u2028\u2029]/.test(value)) return omitted;
  try {
    const redacted = redactApprovalText(value);
    return redacted.length <= maximum ? redacted : omitted;
  } catch (error) {
    if (!(error instanceof UpstreamProtocolError)) throw error;
    return omitted;
  }
}
