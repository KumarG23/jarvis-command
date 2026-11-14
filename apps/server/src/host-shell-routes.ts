import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CockpitRequestIdSchema, CockpitSessionIdSchema } from '@jarvis-command/contracts';
import type { AppConfig } from './config';
import { relayTerminal } from './cockpit-routes';

/**
 * Hermes host admin shell (docs/cockpit/HOST-SHELL.md): shell sessions on a separate session host
 * that runs on the Hermes machine as its own service, so it keeps working while Hermes is down.
 * Outside Projects: every session lives under one fixed host-side project id. Only shells; no lead
 * hand-off. Same Access, same-origin and rate checks as the cockpit; the host key never reaches the
 * browser. The audit records actor fingerprints and session events, never keystrokes or output.
 */
export const HOST_SHELL_PROJECT = 'host-shell';
const MAX_SESSIONS = 4;

type Dependencies = Readonly<{
  config: AppConfig;
  verifyAccess: (assertion: string | undefined) => Promise<{ subject: string }>;
}>;

const SessionParams = z.object({ sessionId: CockpitSessionIdSchema }).strict();
const CreateBody = z.object({
  requestId: CockpitRequestIdSchema,
  title: z.string().trim().min(1).max(120).optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
}).strict();
const OwnershipBody = z.object({ action: z.enum(['take', 'release']) }).strict();
const AttachQuery = z.object({
  cols: z.coerce.number().int().min(20).max(500).default(100),
  rows: z.coerce.number().int().min(5).max(200).default(30),
}).strict();
const ACTIVE = new Set(['connecting', 'running', 'waiting_for_input', 'unknown']);

export function registerHostShellRoutes(app: FastifyInstance, dependencies: Dependencies) {
  const shell = dependencies.config.hostShell;
  const command = dependencies.config.command;
  if (!shell || !command) {
    app.get('/api/host-shell/status', async () => ({ enabled: false }));
    return;
  }
  const auditPath = join(dirname(command.auditLogPath), 'host-shell-audit.jsonl');
  const fingerprint = (subject: string) => createHash('sha256').update(subject).digest('hex');
  const audit = (subject: string, action: string, detail: Record<string, unknown>) => appendFile(
    auditPath, `${JSON.stringify({ at: new Date().toISOString(), actor: fingerprint(subject), action, ...detail })}\n`, { mode: 0o600 },
  ).catch(() => undefined);

  const host = async (method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 30_000) => {
    const response = await fetch(`${shell.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${shell.key}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  };
  const unreachable = { error: 'host_shell_unavailable', message: `${shell.name} is not reachable. Its shell service may be stopped, or the network path is down.` };
  const relay = async (reply: FastifyReply, call: Promise<{ status: number; payload: unknown }>) => {
    try {
      const { status, payload } = await call;
      return reply.code(status >= 500 ? 502 : status).send(payload);
    } catch {
      return reply.code(503).send(unreachable);
    }
  };

  app.register(async (routes) => {
    await routes.register(websocket, { options: { maxPayload: 128 * 1024 } });
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'bad_request' });
      const status = (error as { statusCode?: unknown }).statusCode;
      return reply.code(typeof status === 'number' && status >= 400 && status < 500 ? status : 500)
        .send({ error: typeof status === 'number' && status < 500 ? 'bad_request' : 'internal_error' });
    });
    const subjects = new WeakMap<FastifyRequest, string>();
    const rates = new Map<string, { reset: number; count: number }>();
    routes.addHook('onRequest', async (request, reply) => {
      try {
        const assertion = request.headers['cf-access-jwt-assertion'];
        subjects.set(request, (await dependencies.verifyAccess(typeof assertion === 'string' ? assertion : undefined)).subject);
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const upgrade = request.headers.upgrade?.toLowerCase() === 'websocket';
      const mutating = request.method === 'POST';
      if ((mutating || upgrade) && request.headers.origin !== command.publicOrigin) return reply.code(403).send({ error: 'forbidden' });
      if (mutating && request.headers['x-jarvis-command'] !== '1') return reply.code(403).send({ error: 'forbidden' });
      const now = Date.now();
      for (const [key, rate] of rates) if (rate.reset <= now) rates.delete(key);
      const key = `${subjects.get(request)}:${mutating ? 'write' : 'read'}`;
      const rate = rates.get(key) ?? { reset: now + 60_000, count: 0 };
      if (rate.count >= (mutating ? 30 : 600)) return reply.header('retry-after', '60').code(429).send({ error: 'rate_limited' });
      rate.count++;
      rates.set(key, rate);
    });
    const actor = (request: FastifyRequest) => subjects.get(request) ?? 'unknown';

    routes.get('/api/host-shell/status', async (_request, reply) => {
      try {
        const { status, payload } = await host('GET', '/v1/health', undefined, 5_000);
        const hostName = (payload as { host?: unknown }).host;
        return reply.header('cache-control', 'no-store').send({ enabled: true, name: shell.name, reachable: status === 200, ...(typeof hostName === 'string' ? { host: hostName.slice(0, 80) } : {}) });
      } catch {
        return reply.header('cache-control', 'no-store').send({ enabled: true, name: shell.name, reachable: false });
      }
    });

    routes.get('/api/host-shell/sessions', async (_request, reply) => relay(reply, host('GET', `/v1/sessions?projectId=${HOST_SHELL_PROJECT}`)));

    routes.post('/api/host-shell/sessions', async (request, reply) => {
      const body = CreateBody.parse(request.body);
      try {
        const listed = await host('GET', `/v1/sessions?projectId=${HOST_SHELL_PROJECT}`);
        const sessions = (listed.payload as { sessions?: Array<{ state?: unknown }> }).sessions ?? [];
        if (listed.status === 200 && sessions.filter(item => typeof item.state === 'string' && ACTIVE.has(item.state)).length >= MAX_SESSIONS) {
          return reply.code(409).send({ error: 'too_many_sessions', message: `At most ${MAX_SESSIONS} shells can run at once. Stop one first.` });
        }
      } catch { return reply.code(503).send(unreachable); }
      void audit(actor(request), 'session.create', { requestId: body.requestId });
      return relay(reply, host('POST', '/v1/sessions', {
        requestId: body.requestId, title: body.title ?? 'Shell', kind: 'shell', projectId: HOST_SHELL_PROJECT,
        ...(body.cols ? { cols: body.cols } : {}), ...(body.rows ? { rows: body.rows } : {}),
      }));
    });

    routes.post('/api/host-shell/sessions/:sessionId/ownership', async (request, reply) => {
      const { sessionId } = SessionParams.parse(request.params);
      const { action } = OwnershipBody.parse(request.body);
      return relay(reply, host('POST', `/v1/sessions/${sessionId}/ownership`, { projectId: HOST_SHELL_PROJECT, action }));
    });

    for (const action of ['interrupt', 'stop'] as const) {
      routes.post(`/api/host-shell/sessions/:sessionId/${action}`, async (request, reply) => {
        const { sessionId } = SessionParams.parse(request.params);
        z.object({}).strict().parse(request.body ?? {});
        void audit(actor(request), `session.${action}`, { sessionId });
        return relay(reply, host('POST', `/v1/sessions/${sessionId}/${action}`, { projectId: HOST_SHELL_PROJECT }));
      });
    }

    routes.get('/api/host-shell/sessions/:sessionId/terminal', { websocket: true }, (socket, request) => {
      request.raw.socket?.setTimeout?.(0);
      let target: string;
      let sessionId: string;
      try {
        ({ sessionId } = SessionParams.parse(request.params));
        const { cols, rows } = AttachQuery.parse(request.query);
        const url = new URL(shell.url);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = `/v1/sessions/${sessionId}/terminal`;
        url.search = new URLSearchParams({ projectId: HOST_SHELL_PROJECT, cols: String(cols), rows: String(rows) }).toString();
        target = url.toString();
      } catch {
        socket.close(4400, 'bad request');
        return;
      }
      void audit(actor(request), 'terminal.attach', { sessionId });
      socket.on('close', () => { void audit(actor(request), 'terminal.detach', { sessionId }); });
      relayTerminal(socket, target, shell.key);
    });
  });
}
