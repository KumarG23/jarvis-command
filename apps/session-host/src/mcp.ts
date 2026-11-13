import Fastify from 'fastify';
import { z } from 'zod';
import {
  CockpitKindSchema, CockpitProjectIdSchema, CockpitRepositorySchema, CockpitRequestIdSchema, CockpitSessionIdSchema,
} from '@jarvis-command/contracts';
import { describeAdapters } from './adapters';
import { keyMatches } from './app';
import { ConflictError, NotFoundError, type SessionManager } from './sessions';

// MCP (Streamable HTTP, JSON responses) for the project lead running in Hermes.
// Every call through this listener acts as the lead and can never act as Neal.

// The Command project ID (room_…) given as "Cockpit projectId" in the project context. A chat or
// thread ID, or a UUID from a chat title, puts sessions where Command's Terminals panel never looks.
const projectId = CockpitProjectIdSchema.describe('The Command project ID, exactly as given by "Cockpit projectId" in the project context (room_ followed by 32 hex characters). Never a chat, thread or session ID.');
const sessionId = CockpitSessionIdSchema;

type Tool = {
  name: string;
  description: string;
  schema: z.ZodObject;
  run: (manager: SessionManager, args: never) => Promise<unknown>;
};

const tool = <T extends z.ZodObject>(name: string, description: string, schema: T, run: (manager: SessionManager, args: z.infer<T>) => Promise<unknown>): Tool => (
  { name, description, schema, run: run as Tool['run'] }
);

const summary = (session: { id: string; title: string; kind: string; state: string; owner: string; branch: string | null; cwd: string; exitCode: number | null; failure: string | null; billing: string; stateAt: string }) => ({
  id: session.id, title: session.title, kind: session.kind, state: session.state, owner: session.owner,
  branch: session.branch, cwd: session.cwd, exitCode: session.exitCode, failure: session.failure,
  billing: session.billing, stateSince: session.stateAt,
});

export const TOOLS: Tool[] = [
  tool('list_adapters', 'List the agent CLIs available on the execution host, with version, billing route and whether Neal has qualified them.',
    z.object({}).strict(), async manager => describeAdapters(manager.config.shell, manager.config.qualified, manager.env)),
  tool('list_sessions', 'List the cockpit sessions (threads) in a project with their state and who has input.',
    z.object({ projectId }).strict(), async (manager, args) => manager.list(args.projectId).map(summary)),
  tool('create_session',
    'Start a new working session in the project: an official agent CLI (claude, codex, agy, gemini, opencode) or a shell, in its own git worktree when a repository is given. The task text is given to the agent as its first message. Reusing a requestId returns the same session instead of starting another. You get input ownership of sessions you start.',
    z.object({
      projectId, requestId: CockpitRequestIdSchema, title: z.string().min(1).max(120), kind: CockpitKindSchema,
      repository: CockpitRepositorySchema.optional(), worktree: z.boolean().optional(), task: z.string().max(16_000).optional(),
    }).strict(),
    async (manager, args) => {
      const { session, created } = await manager.create({
        projectId: args.projectId, requestId: args.requestId, title: args.title, kind: args.kind,
        ...(args.repository ? { repository: args.repository } : {}),
        ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
        ...(args.task ? { initialInput: args.task } : {}),
      }, 'lead');
      return { created, session: summary(session) };
    }),
  tool('get_session', 'Get one session\'s current state, owner, branch and working directory.',
    z.object({ projectId, sessionId }).strict(), async (manager, args) => summary(manager.get(args.sessionId, args.projectId))),
  tool('read_tail', 'Read the last lines of a session\'s terminal as plain text (escape codes removed, likely secrets masked). Use sparingly; prefer get_session and get_diff.',
    z.object({ projectId, sessionId, lines: z.number().int().min(1).max(400).optional() }).strict(),
    async (manager, args) => ({ text: await manager.tail(args.sessionId, args.projectId, args.lines ?? 60) })),
  tool('send_input', 'Type text into a session you have input ownership of, then press Enter unless submit is false. Refused while Neal has input. Never use this to answer permission, login or payment prompts; tell Neal instead.',
    z.object({ projectId, sessionId, text: z.string().min(1).max(16_000), submit: z.boolean().optional() }).strict(),
    async (manager, args) => {
      await manager.input(args.sessionId, args.projectId, 'lead', args.text, args.submit ?? true);
      return { ok: true };
    }),
  tool('take_input', 'Take input ownership of a session nobody currently controls. Refused if Neal has it.',
    z.object({ projectId, sessionId }).strict(), async (manager, args) => summary(manager.ownership(args.sessionId, args.projectId, 'lead', 'take'))),
  tool('release_input', 'Give up input ownership of a session.',
    z.object({ projectId, sessionId }).strict(), async (manager, args) => summary(manager.ownership(args.sessionId, args.projectId, 'lead', 'release'))),
  tool('interrupt', 'Send Ctrl+C to a session you have input ownership of.',
    z.object({ projectId, sessionId }).strict(), async (manager, args) => {
      await manager.interrupt(args.sessionId, args.projectId, 'lead');
      return { ok: true };
    }),
  tool('stop_session', 'Stop a session you started and still control. Its worktree, branch and files are kept.',
    z.object({ projectId, sessionId }).strict(), async (manager, args) => summary(await manager.stopSession(args.sessionId, args.projectId, 'lead'))),
  tool('get_diff', 'Show the git status, diffstat and patch of a session\'s working tree against its HEAD.',
    z.object({ projectId, sessionId }).strict(), async (manager, args) => manager.diff(args.sessionId, args.projectId)),
  tool('run_check', 'Run a verification command (tests, build, lint) in a session\'s working directory and return its exit code and output.',
    z.object({ projectId, sessionId, command: z.string().min(1).max(4_000), timeoutSeconds: z.number().int().min(1).max(3_600).optional() }).strict(),
    async (manager, args) => manager.check(args.sessionId, args.projectId, 'lead', args.command, args.timeoutSeconds)),
];

const RpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

function toolError(error: unknown) {
  if (error instanceof NotFoundError || error instanceof ConflictError || error instanceof Error) return error.message;
  return 'Tool failed';
}

export function buildMcpApp(manager: SessionManager) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const mcpKey = manager.config.mcpKey ?? '';

  app.addHook('onRequest', async (request, reply) => {
    if (!mcpKey || !keyMatches(request.headers.authorization, mcpKey)) await reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/mcp', async (_request, reply) => reply.code(405).header('allow', 'POST').send());
  app.delete('/mcp', async (_request, reply) => reply.code(405).header('allow', 'POST').send());

  app.post('/mcp', async (request, reply) => {
    const parsed = RpcSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
    const message = parsed.data;
    if (message.id === undefined) return reply.code(202).send(); // notification
    const result = (value: unknown) => ({ jsonrpc: '2.0', id: message.id, result: value });
    const failure = (code: number, text: string) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });

    switch (message.method) {
      case 'initialize': {
        const requested = (message.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
        const protocolVersion = typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
        return result({
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'jarvis-cockpit', version: '0.1.0' },
          instructions: 'Tools for the Jarvis Command project lead to run and supervise agent sessions on the execution host. '
            + 'You only have input on sessions you started or that Neal handed to you. Never answer login, permission or payment prompts for Neal.',
        });
      }
      case 'ping':
        return result({});
      case 'tools/list':
        return result({
          tools: TOOLS.map(item => ({ name: item.name, description: item.description, inputSchema: z.toJSONSchema(item.schema) })),
        });
      case 'tools/call': {
        const params = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }).safeParse(message.params);
        if (!params.success) return failure(-32602, 'Invalid params');
        const selected = TOOLS.find(item => item.name === params.data.name);
        if (!selected) return failure(-32602, `Unknown tool ${params.data.name}`);
        const args = selected.schema.safeParse(params.data.arguments ?? {});
        if (!args.success) {
          return result({ isError: true, content: [{ type: 'text', text: `Invalid arguments: ${z.prettifyError(args.error)}` }] });
        }
        try {
          const value = await selected.run(manager, args.data as never);
          return result({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
        } catch (error) {
          return result({ isError: true, content: [{ type: 'text', text: toolError(error) }] });
        }
      }
      default:
        return failure(-32601, `Method not found: ${message.method}`);
    }
  });

  return app;
}
