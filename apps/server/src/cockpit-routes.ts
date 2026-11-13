import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { z } from 'zod';
import {
  CockpitKindSchema, CockpitRequestIdSchema, CockpitSessionIdSchema, CockpitTerminalClientFrameSchema,
} from '@jarvis-command/contracts';
import type { AppConfig } from './config';
import { ProjectRoomIdSchema, type ProjectRoom } from '@jarvis-command/contracts';
import { ProjectRoomStore } from './project-room-store';

type Dependencies = Readonly<{
  config: AppConfig;
  verifyAccess: (assertion: string | undefined) => Promise<{ subject: string }>;
}>;

const RoomParams = z.object({ roomId: ProjectRoomIdSchema }).strict();
const SessionParams = z.object({ roomId: ProjectRoomIdSchema, sessionId: CockpitSessionIdSchema }).strict();
const CreateBody = z.object({
  requestId: CockpitRequestIdSchema,
  title: z.string().trim().min(1).max(120),
  kind: CockpitKindSchema,
  worktree: z.boolean().optional(),
  initialInput: z.string().max(16_000).optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
}).strict();
const OwnershipBody = z.object({ action: z.enum(['take', 'hand_to_lead', 'release']) }).strict();
const AttachQuery = z.object({
  cols: z.coerce.number().int().min(20).max(500).default(100),
  rows: z.coerce.number().int().min(5).max(200).default(30),
}).strict();

// Only real git remotes or absolute host paths are handed to the session host as a repository.
export function repositoryFor(room: Pick<ProjectRoom, 'repository'>) {
  const value = room.repository.trim();
  return /^(https?:\/\/|ssh:\/\/|git@[^:\s]+:|\/)\S+$/.test(value) ? value : undefined;
}

// Long-lived terminals still re-authenticate: the browser reconnects (and Access re-verifies) at least this often.
const MAX_TERMINAL_MS = 8 * 60 * 60 * 1000;

export function registerCockpitRoutes(app: FastifyInstance, dependencies: Dependencies) {
  const cockpit = dependencies.config.cockpit;
  const command = dependencies.config.command;
  if (!cockpit || !command) {
    app.get('/api/cockpit/status', async () => ({ enabled: false }));
    return;
  }
  const rooms = new ProjectRoomStore(dirname(command.auditLogPath));
  const auditPath = join(dirname(command.auditLogPath), 'cockpit-audit.jsonl');
  const audit = (subject: string, action: string, detail: Record<string, unknown>) => appendFile(
    auditPath, `${JSON.stringify({ at: new Date().toISOString(), actor: subject, action, ...detail })}\n`, { mode: 0o600 },
  ).catch(() => undefined);

  const host = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const response = await fetch(`${cockpit.sessionHostUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${cockpit.sessionHostKey}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(method === 'POST' && path.endsWith('/sessions') ? 600_000 : 30_000),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  };
  const relay = async (reply: FastifyReply, call: Promise<{ status: number; payload: unknown }>) => {
    try {
      const { status, payload } = await call;
      return reply.code(status >= 500 ? 502 : status).send(payload);
    } catch {
      return reply.code(503).send({ error: 'session_host_unavailable', message: 'The execution host is not reachable.' });
    }
  };

  app.register(async (routes) => {
    await routes.register(websocket, { options: { maxPayload: 128 * 1024 } });
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'bad_request' });
      const status = (error as { statusCode?: unknown }).statusCode;
      if (status === 404) return reply.code(404).send({ error: 'project_not_found' });
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
      // Browsers always send Origin on WebSocket upgrades; a foreign page cannot attach.
      if ((mutating || upgrade) && request.headers.origin !== command.publicOrigin) return reply.code(403).send({ error: 'forbidden' });
      if (mutating && request.headers['x-jarvis-command'] !== '1') return reply.code(403).send({ error: 'forbidden' });
      const now = Date.now();
      for (const [key, rate] of rates) if (rate.reset <= now) rates.delete(key);
      const key = `${subjects.get(request)}:${mutating ? 'write' : 'read'}`;
      const rate = rates.get(key) ?? { reset: now + 60_000, count: 0 };
      if (rate.count >= (mutating ? 60 : 600)) return reply.header('retry-after', '60').code(429).send({ error: 'rate_limited' });
      rate.count++;
      rates.set(key, rate);
      const roomId = (request.params as { roomId?: unknown } | undefined)?.roomId;
      if (roomId !== undefined) {
        const parsed = ProjectRoomIdSchema.safeParse(roomId);
        const room = parsed.success ? (await rooms.list()).find(item => item.id === parsed.data) : undefined;
        if (!room) return reply.code(404).send({ error: 'project_not_found' });
      }
    });

    const roomFor = async (roomId: string) => {
      const room = (await rooms.list()).find(item => item.id === roomId);
      if (!room) throw Object.assign(new Error('project_not_found'), { statusCode: 404 });
      return room;
    };

    routes.get('/api/cockpit/status', async () => ({ enabled: true }));
    routes.get('/api/cockpit/adapters', async (_request, reply) => relay(reply, host('GET', '/v1/adapters')));

    routes.get('/api/cockpit/projects/:roomId/sessions', async (request, reply) => {
      const { roomId } = RoomParams.parse(request.params);
      return relay(reply, host('GET', `/v1/sessions?projectId=${roomId}`));
    });

    routes.post('/api/cockpit/projects/:roomId/sessions', async (request, reply) => {
      const { roomId } = RoomParams.parse(request.params);
      const body = CreateBody.parse(request.body);
      const room = await roomFor(roomId);
      const repository = repositoryFor(room);
      // Cloning a repository can outlast the server's 10s idle socket timeout.
      request.raw.socket?.setTimeout?.(620_000);
      void audit(subjects.get(request) ?? 'unknown', 'session.create', { roomId, requestId: body.requestId, kind: body.kind });
      return relay(reply, host('POST', '/v1/sessions', { ...body, projectId: roomId, ...(repository ? { repository } : {}) }));
    });

    routes.post('/api/cockpit/projects/:roomId/sessions/:sessionId/ownership', async (request, reply) => {
      const { roomId, sessionId } = SessionParams.parse(request.params);
      const { action } = OwnershipBody.parse(request.body);
      void audit(subjects.get(request) ?? 'unknown', `ownership.${action}`, { roomId, sessionId });
      return relay(reply, host('POST', `/v1/sessions/${sessionId}/ownership`, { projectId: roomId, action }));
    });

    for (const action of ['interrupt', 'stop'] as const) {
      routes.post(`/api/cockpit/projects/:roomId/sessions/:sessionId/${action}`, async (request, reply) => {
        const { roomId, sessionId } = SessionParams.parse(request.params);
        z.object({}).strict().parse(request.body ?? {});
        void audit(subjects.get(request) ?? 'unknown', `session.${action}`, { roomId, sessionId });
        return relay(reply, host('POST', `/v1/sessions/${sessionId}/${action}`, { projectId: roomId }));
      });
    }

    routes.get('/api/cockpit/projects/:roomId/sessions/:sessionId/diff', async (request, reply) => {
      const { roomId, sessionId } = SessionParams.parse(request.params);
      return relay(reply, host('GET', `/v1/sessions/${sessionId}/diff?projectId=${roomId}`));
    });

    routes.get('/api/cockpit/projects/:roomId/sessions/:sessionId/terminal', { websocket: true }, (socket, request) => {
      let target: string;
      // The terminal is long-lived and often idle; the lifetime timer below bounds it instead.
      request.raw.socket?.setTimeout?.(0);
      try {
        const { roomId, sessionId } = SessionParams.parse(request.params);
        const { cols, rows } = AttachQuery.parse(request.query);
        const url = new URL(cockpit.sessionHostUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = `/v1/sessions/${sessionId}/terminal`;
        url.search = new URLSearchParams({ projectId: roomId, cols: String(cols), rows: String(rows) }).toString();
        target = url.toString();
      } catch {
        socket.close(4400, 'bad request');
        return;
      }
      void audit(subjects.get(request) ?? 'unknown', 'terminal.attach', { url: target.replace(/^.*\/v1\//, '/v1/') });
      relayTerminal(socket, target, cockpit.sessionHostKey);
    });
  });
}


/**
 * Relays one browser terminal to a session host's terminal WebSocket. Only well-formed input and
 * resize frames go upstream; the viewer is closed after MAX_TERMINAL_MS so Access re-verifies.
 * A browser leaving only detaches its viewer: the process keeps running on the host.
 */
export function relayTerminal(socket: WebSocket, target: string, key: string) {
  const upstream = new WebSocket(target, { headers: { authorization: `Bearer ${key}` }, maxPayload: 8 * 1024 * 1024 });
  const pending: string[] = [];
  const lifetime = setTimeout(() => socket.close(4401, 'reauthenticate'), MAX_TERMINAL_MS);
  const closeBoth = (code: number, reason: string) => {
    clearTimeout(lifetime);
    if (socket.readyState === socket.OPEN) socket.close(code, reason);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  };
  upstream.on('open', () => { for (const frame of pending.splice(0)) upstream.send(frame); });
  upstream.on('message', (data: Buffer, isBinary: boolean) => {
    if (socket.readyState === socket.OPEN) socket.send(isBinary ? data : data.toString('utf8'), { binary: isBinary });
  });
  upstream.on('unexpected-response', () => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'closed', reason: 'The execution host refused the terminal.' }));
    closeBoth(1011, 'upstream refused');
  });
  upstream.on('error', () => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'closed', reason: 'The execution host is not reachable.' }));
    closeBoth(1011, 'upstream unavailable');
  });
  upstream.on('close', () => closeBoth(1000, 'closed'));
  socket.on('message', (raw: Buffer, isBinary: boolean) => {
    if (isBinary) return;
    const text = raw.toString('utf8');
    // Only well-formed input/resize frames reach the host.
    try { CockpitTerminalClientFrameSchema.parse(JSON.parse(text)); } catch { return; }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
    else if (upstream.readyState === WebSocket.CONNECTING && pending.length < 64) pending.push(text);
  });
  // A browser leaving only detaches its viewer; the agent keeps running on the host.
  socket.on('close', () => closeBoth(1000, 'viewer left'));
}
