import {
  ApprovalChoiceSchema,
  ApprovalRequestIdSchema,
  OpaqueIdentifierSchema,
  LiveRoomSessionContinueRequestSchema,
  LiveRoomSessionCreateRequestSchema,
  LiveRunApprovalRequestSchema,
  LiveRunStateSchema,
  LiveRunSteerRequestSchema,
  LiveRunUsageSchema,
  SessionMessagesPageSchema,
  SessionMutationResponseSchema,
  type LiveApproval,
  type LiveRoomSessionContinueRequest,
  type LiveRoomSessionCreateRequest,
  type LiveRunApprovalRequest,
  type LiveRunState,
  type LiveRunSteerRequest,
  type LiveRunUsage,
  type SessionMessagesPage,
  type SessionMutationResponse,
} from '@jarvis-command/contracts';
import { z } from 'zod';

const MAX_JSON_BYTES = 2_097_152;
const MAX_SSE_FRAME_BYTES = 524_288;
const MAX_SSE_TOTAL_BYTES = 33_554_432;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/;
const RUN_ID = /^run_[a-f0-9]{32}$/;
const IDEMPOTENCY_KEY = /^[!-~]{1,255}$/;

const InternalRunCreateSchema = z.object({
  runId: z.string().regex(RUN_ID),
  sessionId: z.string().regex(SESSION_ID),
  status: LiveRunStateSchema,
  replayed: z.boolean(),
}).strict();

const InternalRunStatusSchema = z.object({
  runId: z.string().regex(RUN_ID),
  sessionId: z.string().regex(SESSION_ID),
  status: LiveRunStateSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  approval: z.object({
    requestId: ApprovalRequestIdSchema,
    command: z.string().min(1).max(4_096),
    description: z.string().min(1).max(2_048),
    tool: z.string().min(1).max(160).nullable(),
  }).strict().nullable(),
  output: z.string().max(262_144).nullable(),
  error: z.string().max(4_096).nullable(),
  pendingSteer: z.string().max(4_000).nullable(),
  usage: LiveRunUsageSchema.nullable(),
}).strict();

const InternalApprovalResponseSchema = z.object({
  runId: z.string().regex(RUN_ID),
  requestId: ApprovalRequestIdSchema,
  choice: ApprovalChoiceSchema,
  resolved: z.number().int().min(1).max(100),
}).strict();

const InternalSteerResponseSchema = z.object({
  runId: z.string().regex(RUN_ID),
  accepted: z.literal(true),
}).strict();

const InternalStopResponseSchema = z.object({
  runId: z.string().regex(RUN_ID),
  status: LiveRunStateSchema,
}).strict();

const EventBase = {
  runId: z.string().regex(RUN_ID),
  timestamp: z.iso.datetime({ offset: true }),
} as const;

const InternalRunEventSchema = z.discriminatedUnion('type', [
  z.object({ ...EventBase, type: z.literal('message.delta'), delta: z.string().max(32_768) }).strict(),
  z.object({
    ...EventBase,
    type: z.literal('tool.started'),
    tool: OpaqueIdentifierSchema,
    preview: z.string().max(2_048),
  }).strict(),
  z.object({
    ...EventBase,
    type: z.literal('tool.completed'),
    tool: OpaqueIdentifierSchema,
    durationSeconds: z.number().nonnegative().max(86_400),
    error: z.boolean(),
  }).strict(),
  z.object({
    ...EventBase,
    type: z.literal('subagent.start'),
    subagentId: OpaqueIdentifierSchema,
    goal: z.string().max(2_048),
    status: z.string().max(80).nullable(),
  }).strict(),
  z.object({
    ...EventBase,
    type: z.literal('subagent.complete'),
    subagentId: OpaqueIdentifierSchema,
    summary: z.string().max(4_096),
    status: z.string().max(80).nullable(),
  }).strict(),
  z.object({
    ...EventBase,
    type: z.literal('approval.request'),
    approval: z.object({
      requestId: ApprovalRequestIdSchema,
      command: z.string().min(1).max(4_096),
      description: z.string().min(1).max(2_048),
      tool: z.string().min(1).max(160).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    ...EventBase,
    type: z.literal('approval.responded'),
    requestId: ApprovalRequestIdSchema,
    choice: ApprovalChoiceSchema,
  }).strict(),
  z.object({ ...EventBase, type: z.literal('run.steered'), accepted: z.literal(true) }).strict(),
  z.object({
    ...EventBase,
    type: z.literal('run.completed'),
    output: z.string().max(262_144),
    pendingSteer: z.string().max(4_000).nullable(),
    usage: LiveRunUsageSchema.nullable(),
  }).strict(),
  z.object({ ...EventBase, type: z.literal('run.interrupted'), error: z.string().max(4_096) }).strict(),
  z.object({ ...EventBase, type: z.literal('run.failed'), error: z.string().max(4_096) }).strict(),
  z.object({ ...EventBase, type: z.literal('run.cancelled') }).strict(),
]);

export type CommandRunCreate = z.infer<typeof InternalRunCreateSchema>;
export type CommandRunStatus = z.infer<typeof InternalRunStatusSchema>;
export type CommandRunEvent = z.infer<typeof InternalRunEventSchema>;
export type CommandApprovalResponse = z.infer<typeof InternalApprovalResponseSchema>;
export type CommandSteerResponse = z.infer<typeof InternalSteerResponseSchema>;
export type CommandStopResponse = z.infer<typeof InternalStopResponseSchema>;

export type CommandProxyClient = Readonly<{
  getSession: (sessionId: string) => Promise<SessionMutationResponse>;
  readReadiness: () => Promise<{ ready: true; idempotencyRetentionSeconds: number }>;
  getMessages: (sessionId: string, limit: number, offset: number) => Promise<SessionMessagesPage>;
  createSession: (request: LiveRoomSessionCreateRequest) => Promise<SessionMutationResponse>;
  continueSession: (sessionId: string, request: LiveRoomSessionContinueRequest) => Promise<SessionMutationResponse>;
  startRun: (request: Readonly<{ sessionId: string; input: string; idempotencyKey: string }>) => Promise<CommandRunCreate>;
  getRun: (runId: string) => Promise<CommandRunStatus>;
  streamRunEvents: (runId: string, signal: AbortSignal) => AsyncGenerator<CommandRunEvent>;
  approveRun: (runId: string, request: LiveRunApprovalRequest) => Promise<CommandApprovalResponse>;
  steerRun: (runId: string, request: LiveRunSteerRequest) => Promise<CommandSteerResponse>;
  stopRun: (runId: string) => Promise<CommandStopResponse>;
}>;

export class CommandProxyUnavailableError extends Error {
  public constructor(public readonly statusCode = 503) {
    super('Hermes command bridge is unavailable');
    this.name = 'CommandProxyUnavailableError';
  }
}

export function createCommandProxyClient(options: Readonly<{
  baseUrl: string;
  commandProxyKey: string;
  fetcher?: typeof fetch;
}>): CommandProxyClient {
  const fetcher = options.fetcher ?? fetch;
  const authorization = `Bearer ${options.commandProxyKey}`;

  const requestJson = async <T>(
    path: string,
    schema: z.ZodType<T>,
    init: Readonly<{
      method?: 'GET' | 'POST';
      body?: unknown;
      headers?: Record<string, string>;
    }> = {},
  ): Promise<T> => {
    try {
      const method = init.method ?? 'GET';
      const response = await fetcher(`${options.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        ...(method === 'POST' ? { body: JSON.stringify(init.body ?? {}) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        await response.body?.cancel().catch(() => undefined);
        throw new CommandProxyUnavailableError(projectStatus(response.status));
      }
      return schema.parse(JSON.parse(await readBoundedBody(response, MAX_JSON_BYTES)));
    } catch (error) {
      if (error instanceof CommandProxyUnavailableError) throw error;
      throw new CommandProxyUnavailableError();
    }
  };

  return Object.freeze({
    getSession(sessionId) {
      if (!/^jc_[a-f0-9]{32}$/.test(sessionId)) return Promise.reject(new CommandProxyUnavailableError(400));
      return requestJson(`/api/sessions/${sessionId}`, SessionMutationResponseSchema.refine(value => value.session.id === sessionId && value.session.ownership === 'command' && ['api_server', 'jarvis-command'].includes(value.session.source)));
    },
    async readReadiness() {
      const result = await requestJson('/_ready', z.object({ ready: z.literal(true), durableIdempotency: z.literal(true), retentionSeconds: z.number().int().min(86_400), externalContinue: z.literal(false) }).strict());
      return { ready: true as const, idempotencyRetentionSeconds: result.retentionSeconds };
    },
    getMessages(sessionId, limit, offset) {
      if (!SESSION_ID.test(sessionId)) return Promise.reject(new CommandProxyUnavailableError(400));
      return requestJson(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}&offset=${offset}`,
        SessionMessagesPageSchema.refine(page => (
          page.sessionId === sessionId
          && page.messages.every(message => message.sessionId === sessionId)
          && page.pagination.limit === limit
          && page.pagination.offset === offset
          && page.pagination.returned === page.messages.length
          && page.messages.length <= limit
          && page.pagination.hasMore === (page.messages.length === limit)
        )),
      );
    },
    createSession(request) {
      const parsed = LiveRoomSessionCreateRequestSchema.parse(request);
      return requestJson('/api/sessions', SessionMutationResponseSchema, {
        method: 'POST',
        body: parsed,
      });
    },
    continueSession(sessionId, request) {
      if (!SESSION_ID.test(sessionId)) return Promise.reject(new CommandProxyUnavailableError(400));
      const parsed = LiveRoomSessionContinueRequestSchema.parse(request);
      return requestJson(
        `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
        SessionMutationResponseSchema,
        { method: 'POST', body: parsed },
      );
    },
    startRun(request) {
      if (
        !SESSION_ID.test(request.sessionId)
        || !request.input.trim()
        || request.input.length > 16_000
        || !IDEMPOTENCY_KEY.test(request.idempotencyKey)
      ) {
        return Promise.reject(new CommandProxyUnavailableError(400));
      }
      return requestJson('/v1/runs', InternalRunCreateSchema.refine(value => value.sessionId === request.sessionId), {
        method: 'POST',
        body: { sessionId: request.sessionId, input: request.input.trim() },
        headers: { 'idempotency-key': request.idempotencyKey },
      });
    },
    getRun(runId) {
      if (!RUN_ID.test(runId)) return Promise.reject(new CommandProxyUnavailableError(400));
      return requestJson(`/v1/runs/${runId}`, InternalRunStatusSchema.refine(value => value.runId === runId).transform(value => ({ ...value, error: value.error === null ? null : 'Hermes run unavailable' })));
    },
    async *streamRunEvents(runId, signal) {
      if (!RUN_ID.test(runId)) throw new CommandProxyUnavailableError(400);
      let response: Response;
      try {
        response = await fetcher(`${options.baseUrl}/v1/runs/${runId}/events`, {
          method: 'GET',
          headers: { accept: 'text/event-stream', authorization },
          redirect: 'error',
          signal,
        });
      } catch {
        throw new CommandProxyUnavailableError();
      }
      if (
        !response.ok
        || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
        || !response.body
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new CommandProxyUnavailableError(projectStatus(response.status));
      }
      try {
        for await (const raw of parseEventStream(response.body)) {
          const event = InternalRunEventSchema.parse(raw);
          if (event.runId !== runId) throw new CommandProxyUnavailableError();
          yield event.type === 'run.failed' || event.type === 'run.interrupted' ? { ...event, error: 'Hermes run unavailable' } : event;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof CommandProxyUnavailableError) throw error;
        throw new CommandProxyUnavailableError();
      }
    },
    approveRun(runId, request) {
      if (!RUN_ID.test(runId)) return Promise.reject(new CommandProxyUnavailableError(400));
      return requestJson(`/v1/runs/${runId}/approval`, InternalApprovalResponseSchema.refine(value => value.runId === runId && value.requestId === request.requestId && value.choice === request.choice), {
        method: 'POST',
        body: LiveRunApprovalRequestSchema.parse(request),
      });
    },
    steerRun(runId, request) {
      if (!RUN_ID.test(runId)) return Promise.reject(new CommandProxyUnavailableError(400));
      return requestJson(`/v1/runs/${runId}/steer`, InternalSteerResponseSchema.refine(value => value.runId === runId), {
        method: 'POST',
        body: LiveRunSteerRequestSchema.parse(request),
      });
    },
    stopRun(runId) {
      if (!RUN_ID.test(runId)) return Promise.reject(new CommandProxyUnavailableError(400));
      return requestJson(`/v1/runs/${runId}/stop`, InternalStopResponseSchema.refine(value => value.runId === runId), {
        method: 'POST',
        body: {},
      });
    },
  });
}

async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let frameBytes = 0;
  let total = 0;

  const parseFrame = (): unknown | undefined => {
    if (dataLines.length === 0) return undefined;
    const raw = dataLines.join('\n');
    dataLines = [];
    frameBytes = 0;
    if (Buffer.byteLength(raw) > MAX_SSE_FRAME_BYTES) throw new CommandProxyUnavailableError();
    return JSON.parse(raw);
  };

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SSE_TOTAL_BYTES) throw new CommandProxyUnavailableError();
    buffer += decoder.decode(value, { stream: true });
    if (Buffer.byteLength(buffer) > MAX_SSE_FRAME_BYTES * 2) throw new CommandProxyUnavailableError();
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      frameBytes += Buffer.byteLength(line) + 1;
      if (frameBytes > MAX_SSE_FRAME_BYTES) throw new CommandProxyUnavailableError();
      if (!line) {
        const parsed = parseFrame();
        if (parsed !== undefined) yield parsed;
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
      newline = buffer.indexOf('\n');
    }
    if (frameBytes + Buffer.byteLength(buffer) > MAX_SSE_FRAME_BYTES) throw new CommandProxyUnavailableError();
  }
  buffer += decoder.decode();
  if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
  const final = parseFrame();
  if (final !== undefined) yield final;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new CommandProxyUnavailableError();
  }
  if (!response.body) throw new CommandProxyUnavailableError();
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
      throw new CommandProxyUnavailableError();
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

function projectStatus(status: number): number {
  return status === 400 || status === 403 || status === 404 || status === 409 || status === 429
    ? status
    : 503;
}

export type CommandRunEventBase = Readonly<{
  runId: string;
  type: string;
  timestamp: string;
}>;

export type CommandRunControlStatus = Readonly<{
  runId: string;
  sessionId: string;
  status: LiveRunState;
  updatedAt: string;
  approval: LiveApproval | null;
  output: string | null;
  error: string | null;
  pendingSteer: string | null;
  usage: LiveRunUsage | null;
}>;
