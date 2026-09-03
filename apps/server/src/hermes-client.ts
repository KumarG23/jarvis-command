import type {
  CheckState,
  HermesState,
  SessionSummary,
} from '@jarvis-command/contracts';

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
  apiKey: string;
  modelLabel: string;
  providerLabel: string;
  fetcher?: typeof fetch;
}>;

export function createHermesClient(options: HermesClientOptions) {
  const fetcher = options.fetcher ?? fetch;
  const headers = Object.freeze({
    accept: 'application/json',
    authorization: `Bearer ${options.apiKey}`,
  });

  async function request(path: string): Promise<Record<string, unknown>> {
    try {
      const response = await fetcher(`${options.baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        throw new HermesUpstreamError();
      }

      const body: unknown = await response.json();
      if (!isRecord(body)) {
        throw new HermesUpstreamError();
      }

      return body;
    } catch (error) {
      if (error instanceof HermesUpstreamError) {
        throw error;
      }

      throw new HermesUpstreamError();
    }
  }

  return Object.freeze({
    async readSnapshot(): Promise<HermesSnapshot> {
      const [health, capabilities, sessions] = await Promise.all([
        request('/health/detailed'),
        request('/v1/capabilities'),
        request('/api/sessions?limit=12&offset=0'),
      ]);
      const readinessChecks = projectReadinessChecks(health);

      return Object.freeze({
        state: deriveState(health.status, readinessChecks),
        version: stringOrNull(health.version),
        model: options.modelLabel || stringOrNull(capabilities.model),
        provider: options.providerLabel || null,
        gatewayState: normalizeGatewayState(health.gateway_state),
        activeAgents: nonnegativeInteger(health.active_agents),
        capabilities: projectCapabilities(capabilities.features),
        readinessChecks,
        sessions: projectSessions(sessions.data),
      });
    },
  });
}

function projectReadinessChecks(health: Record<string, unknown>): Record<string, CheckState> {
  const readiness = isRecord(health.readiness) ? health.readiness : {};
  const checks = isRecord(readiness.checks) ? readiness.checks : {};

  return Object.fromEntries(
    Object.entries(checks).map(([name, value]) => {
      const status = isRecord(value) ? value.status : value;
      return [snakeToCamel(name), normalizeCheckState(status)];
    }),
  );
}

function projectCapabilities(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value)
    .filter((entry): entry is [string, true] => entry[1] === true)
    .map(([name]) => name)
    .slice(0, 100);
}

function projectSessions(value: unknown): SessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate): SessionSummary[] => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !candidate.id) {
      return [];
    }

    return [{
      id: candidate.id.slice(0, 160),
      title: stringOrFallback(candidate.title, 'Untitled session').slice(0, 160),
      source: stringOrFallback(candidate.source, 'unknown').slice(0, 40),
      model: stringOrNull(candidate.model)?.slice(0, 160) ?? null,
      lastActive: toIsoTimestamp(candidate.last_active),
      preview: stringOrFallback(candidate.preview, '').slice(0, 500),
      messageCount: nonnegativeInteger(candidate.message_count),
      toolCallCount: nonnegativeInteger(candidate.tool_call_count),
      pinned: Boolean(candidate.pinned),
    }];
  }).slice(0, 50);
}

function deriveState(
  status: unknown,
  checks: Record<string, CheckState>,
): HermesState {
  if (status !== 'ready' && status !== 'ok') {
    return status === 'offline' ? 'offline' : 'degraded';
  }

  return Object.values(checks).every((check) => check === 'pass')
    ? 'online'
    : 'degraded';
}

function normalizeCheckState(value: unknown): CheckState {
  if (typeof value !== 'string') {
    return 'unknown';
  }

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
      return 'fail';
    default:
      return 'unknown';
  }
}

function normalizeGatewayState(value: unknown): 'idle' | 'busy' | 'unknown' {
  return value === 'idle' || value === 'busy' ? value : 'unknown';
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function toIsoTimestamp(value: unknown): string {
  const date = typeof value === 'number'
    ? new Date(value * 1_000)
    : typeof value === 'string'
      ? new Date(value)
      : new Date(0);

  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
