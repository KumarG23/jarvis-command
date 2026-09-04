import type {
  CheckState,
  HermesState,
  SessionSummary,
} from '@jarvis-command/contracts';
import { z } from 'zod';

const ReadinessCheckSchema = z.union([
  z.string(),
  z.object({ status: z.string() }).passthrough(),
]);

const HealthDetailedSchema = z.object({
  status: z.enum(['ok', 'ready', 'degraded', 'offline']),
  version: z.string().min(1).max(80),
  gateway_state: z.string().nullable().optional(),
  gateway_busy: z.boolean().optional(),
  active_agents: z.number().int().nonnegative(),
  readiness: z.object({
    status: z.string(),
    checks: z.record(z.string(), ReadinessCheckSchema),
  }).passthrough(),
}).passthrough();

const CapabilitiesSchema = z.object({
  object: z.literal('hermes.api_server.capabilities').optional(),
  model: z.string().min(1).max(160),
  features: z.record(z.string(), z.unknown()),
}).passthrough();

const UpstreamSessionSchema = z.object({
  id: z.string().min(1).max(512),
  title: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  last_active: z.union([z.number(), z.string()]).nullable().optional(),
  started_at: z.union([z.number(), z.string()]).nullable().optional(),
  message_count: z.number().int().nonnegative().optional(),
  tool_call_count: z.number().int().nonnegative().optional(),
  pinned: z.boolean().optional(),
}).passthrough();

const SessionsSchema = z.object({
  object: z.literal('list'),
  data: z.array(UpstreamSessionSchema).max(250),
  limit: z.number().int().nonnegative().max(200),
  offset: z.number().int().nonnegative(),
  has_more: z.boolean(),
}).passthrough();

const VISIBLE_CAPABILITIES = new Set([
  'approval_events',
  'model_options',
  'run_approval_response',
  'run_events_sse',
  'run_steer',
  'run_stop',
  'session_chat_streaming',
  'session_resources',
  'tool_progress_events',
]);

export class HermesUpstreamError extends Error {
  public constructor(message = 'Hermes control plane is unavailable') {
    super(message);
    this.name = 'HermesUpstreamError';
  }
}

export type HermesSnapshot = Readonly<{
  state: HermesState;
  version: string | null;
  model: string | null;
  provider: string | null;
  gatewayState: 'idle' | 'busy' | 'unknown';
  activeAgents: number;
  capabilities: string[];
  readinessChecks: Record<string, CheckState>;
  sessions: SessionSummary[];
}>;

type HermesClientOptions = Readonly<{
  baseUrl: string;
  readProxyKey: string;
  fetcher?: typeof fetch;
}>;

export function createHermesClient(options: HermesClientOptions) {
  const fetcher = options.fetcher ?? fetch;
  const headers = Object.freeze({
    accept: 'application/json',
    authorization: `Bearer ${options.readProxyKey}`,
  });

  async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    try {
      const response = await fetcher(`${options.baseUrl}${path}`, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        throw new HermesUpstreamError();
      }

      return schema.parse(await response.json());
    } catch (error) {
      if (error instanceof HermesUpstreamError) {
        throw error;
      }

      throw new HermesUpstreamError();
    }
  }

  return Object.freeze({
    async readSnapshot(): Promise<HermesSnapshot> {
      try {
        const [health, capabilities, sessions] = await Promise.all([
          request('/health/detailed', HealthDetailedSchema),
          request('/v1/capabilities', CapabilitiesSchema),
          request('/api/sessions?limit=12&offset=0&include_children=false', SessionsSchema),
        ]);
        const readinessChecks = projectReadinessChecks(health.readiness.checks);

        return Object.freeze({
          state: deriveState(health.status, readinessChecks),
          version: health.version,
          model: capabilities.model,
          provider: null,
          gatewayState: normalizeGatewayState(health),
          activeAgents: health.active_agents,
          capabilities: projectCapabilities(capabilities.features),
          readinessChecks,
          sessions: projectSessions(sessions.data),
        });
      } catch {
        throw new HermesUpstreamError();
      }
    },
  });
}

function projectReadinessChecks(
  checks: z.infer<typeof HealthDetailedSchema>['readiness']['checks'],
): Record<string, CheckState> {
  return Object.fromEntries(
    Object.entries(checks).map(([name, value]) => {
      const status = typeof value === 'string' ? value : value.status;
      return [snakeToCamel(name), normalizeCheckState(status)];
    }),
  );
}

function projectCapabilities(value: Record<string, unknown>): string[] {
  return Object.entries(value)
    .filter((entry): entry is [string, true] => (
      entry[1] === true && VISIBLE_CAPABILITIES.has(entry[0])
    ))
    .map(([name]) => name)
    .sort();
}

function projectSessions(value: z.infer<typeof UpstreamSessionSchema>[]): SessionSummary[] {
  return value.map((candidate) => ({
    id: candidate.id.slice(0, 160),
    title: stringOrFallback(candidate.title, 'Untitled session').slice(0, 160),
    source: stringOrFallback(candidate.source, 'unknown').slice(0, 40),
    model: stringOrNull(candidate.model)?.slice(0, 160) ?? null,
    lastActive: toIsoTimestamp(candidate.last_active ?? candidate.started_at),
    messageCount: candidate.message_count ?? 0,
    toolCallCount: candidate.tool_call_count ?? 0,
    pinned: candidate.pinned ?? false,
  })).slice(0, 50);
}

function deriveState(
  status: string,
  checks: Record<string, CheckState>,
): HermesState {
  if (status !== 'ready' && status !== 'ok') {
    return status === 'offline' ? 'offline' : 'degraded';
  }

  return Object.values(checks).every((check) => check === 'pass')
    ? 'online'
    : 'degraded';
}

function normalizeCheckState(value: string): CheckState {
  switch (value.toLowerCase()) {
    case 'ok':
    case 'pass':
    case 'ready':
      return 'pass';
    case 'warn':
    case 'warning':
    case 'degraded':
      return 'warn';
    case 'error':
    case 'fail':
    case 'failed':
    case 'unavailable':
      return 'fail';
    default:
      return 'unknown';
  }
}

function normalizeGatewayState(
  health: z.infer<typeof HealthDetailedSchema>,
): 'idle' | 'busy' | 'unknown' {
  if (health.gateway_busy === true || health.gateway_state === 'busy') {
    return 'busy';
  }

  if (health.gateway_state === 'idle' || health.gateway_state === 'running') {
    return 'idle';
  }

  return 'unknown';
}

function toIsoTimestamp(value: number | string | null | undefined): string {
  const date = typeof value === 'number'
    ? new Date(value * 1_000)
    : typeof value === 'string'
      ? new Date(value)
      : new Date(0);

  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function stringOrFallback(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function stringOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
