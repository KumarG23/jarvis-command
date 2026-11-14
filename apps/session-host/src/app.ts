import { timingSafeEqual } from 'node:crypto';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CockpitInputRequestSchema, CockpitOwnershipRequestSchema, CockpitProjectIdSchema, CockpitSessionCreateSchema,
  CockpitSessionIdSchema, CockpitTerminalClientFrameSchema, type CockpitSession, type CockpitTerminalServerFrame,
} from '@jarvis-command/contracts';
import { describeAdapters } from './adapters';
import { ConflictError, NotFoundError, type SessionManager } from './sessions';
import { WorkspaceError } from './workspace';

export function keyMatches(header: string | undefined, key: string) {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match?.[1]) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof NotFoundError) return reply.code(404).send({ error: 'not_found', message: error.message });
  if (error instanceof ConflictError) return reply.code(409).send({ error: error.code, message: error.message, owner: error.owner ?? null });
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request', message: z.prettifyError(error) });
  if (error instanceof WorkspaceError) return reply.code(422).send({ error: 'workspace', message: error.message });
  return reply.code(500).send({ error: 'internal', message: 'Session host error' });
}

const ProjectQuery = z.object({ projectId: CockpitProjectIdSchema }).strict();
const SessionParams = z.object({ id: CockpitSessionIdSchema }).strict();
const TailQuery = z.object({ projectId: CockpitProjectIdSchema, lines: z.coerce.number().int().min(1).max(400).optional() }).strict();
const CheckBody = z.object({ projectId: CockpitProjectIdSchema, command: z.string().min(1).max(4_000), timeoutSeconds: z.number().int().min(1).max(3_600).optional() }).strict();
const AttachQuery = z.object({
  projectId: CockpitProjectIdSchema,
  cols: z.coerce.number().int().min(20).max(500).default(120),
  rows: z.coerce.number().int().min(5).max(200).default(32),
}).strict();

// Main API. Only the Command BFF holds SESSION_HOST_KEY; every call here acts for the human.
// The lead uses the separate MCP listener, which can only act as the lead.
export function buildSessionHostApp(manager: SessionManager) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  void app.register(websocket, { options: { maxPayload: 128 * 1024 } });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/v1/health') return;
    if (!keyMatches(request.headers.authorization, manager.config.key)) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/v1/health', async () => ({ ok: true, host: manager.config.hostName }));

  app.get('/v1/adapters', async () => ({
    host: manager.config.hostName,
    adapters: await describeAdapters(manager.config.shell, manager.config.qualified, manager.env),
  }));

  app.get('/v1/sessions', async (request, reply) => {
    try {
      const { projectId } = ProjectQuery.parse(request.query);
      return { sessions: manager.list(projectId) };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/sessions', async (request, reply) => {
    try {
      const body = CockpitSessionCreateSchema.parse(request.body);
      const { session, created } = await manager.create(body, 'human');
      return reply.code(created ? 201 : 200).send({ session, created });
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/v1/sessions/:id', async (request, reply) => {
    try {
      const { id } = SessionParams.parse(request.params);
      const { projectId } = ProjectQuery.parse(request.query);
      return { session: manager.get(id, projectId) };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/sessions/:id/input', async (request, reply) => {
    try {
      const { id } = SessionParams.parse(request.params);
      const body = CockpitInputRequestSchema.parse(request.body);
      await manager.input(id, body.projectId, 'human', body.data, body.submit ?? false);
      return { ok: true };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/sessions/:id/ownership', async (request, reply) => {
    try {
      const { id } = SessionParams.parse(request.params);
      const body = CockpitOwnershipRequestSchema.parse(request.body);
      return { session: manager.ownership(id, body.projectId, 'human', body.action) };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/sessions/:id/interrupt', async (request, reply) => {
    try {
      const { id } = SessionParams.parse(request.params);
      const { projectId } = ProjectQuery.parse(request.body);
      await manager.interrupt(id, projectId, 'human');
      return { ok: true };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/sessions/:id/stop', async (request, reply) => {
    try {
      const { id } = SessionParams.parse(request.params);
      const { projectId } = ProjectQuery.parse(request.body);
      return { session: await manager.stopSession(id, projectId, 'human') };
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/v1/sessions/:id/tail', async (request, reply) => {
    try {
      const { id } = SessionParams.parse(request.params);
      const { projectId, lines } = TailQuery.parse(request.query);
      return { text: await manager.tail(id, projectId, lines) };
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/v1/sessions/:id/diff', async (request, reply) => {
    try {
      const { id } = SessionParams.parse(request.params);
      const { projectId } = ProjectQuery.parse(request.query);
      return { diff: await manager.diff(id, projectId) };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/v1/sessions/:id/check', async (request, reply) => {
    try {
      const { id } = SessionParams.parse(request.params);
      const body = CheckBody.parse(request.body);
      return { check: await manager.check(id, body.projectId, 'human', body.command, body.timeoutSeconds) };
    } catch (error) { return sendError(reply, error); }
  });

  void app.register(async (scoped) => {
    scoped.get('/v1/sessions/:id/terminal', { websocket: true }, (socket, request: FastifyRequest) => {
      const send = (frame: CockpitTerminalServerFrame) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
      };
      let id: string;
      let projectId: string;
      let cols: number;
      let rows: number;
      try {
        id = SessionParams.parse(request.params).id;
        ({ projectId, cols, rows } = AttachQuery.parse(request.query));
        const session = manager.get(id, projectId);
        if (session.state === 'connecting' || session.state === 'failed' || session.state === 'lost' || session.state === 'stopped') {
          send({ type: 'session', session });
          send({ type: 'closed', reason: `Session is ${session.state}` });
          socket.close(1000);
          return;
        }
        send({ type: 'session', session });
      } catch {
        send({ type: 'closed', reason: 'Session not found' });
        socket.close(4404);
        return;
      }

      const viewer = manager.attach(id, projectId, cols, rows);
      const onSession = (session: CockpitSession) => { if (session.id === id) send({ type: 'session', session }); };
      manager.on('session', onSession);
      const output = viewer.onData((data) => {
        if (socket.readyState === socket.OPEN) socket.send(Buffer.from(data, 'utf8'), { binary: true });
      });
      const exit = viewer.onExit(() => {
        send({ type: 'closed', reason: 'Terminal detached' });
        socket.close(1000);
      });
      // Size the window to this viewer on attach (latest viewer wins).
      void manager.resize(id, projectId, cols, rows).catch(() => undefined);

      socket.on('message', (raw: Buffer, isBinary: boolean) => {
        if (isBinary) return;
        let frame;
        try {
          frame = CockpitTerminalClientFrameSchema.parse(JSON.parse(raw.toString('utf8')));
        } catch {
          return;
        }
        if (frame.type === 'resize') {
          viewer.resize(frame.cols, frame.rows);
          void manager.resize(id, projectId, frame.cols, frame.rows).catch(() => undefined);
          return;
        }
        if (frame.type === 'report') {
          // Answers this viewer's own read-only tmux client; it cannot type into the pane.
          viewer.write(frame.data);
          return;
        }
        manager.input(id, projectId, 'human', frame.data).catch((error: unknown) => {
          send({ type: 'input_refused', reason: error instanceof Error ? error.message : 'Input refused' });
        });
      });
      socket.on('close', () => {
        manager.off('session', onSession);
        output.dispose();
        exit.dispose();
        // Detaches this viewer only; the session keeps running in tmux.
        viewer.kill();
      });
    });
  });

  return app;
}
