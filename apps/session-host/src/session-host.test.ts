import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildSessionHostApp } from './app';
import { loadSessionHostConfig, type SessionHostConfig } from './config';
import { buildMcpApp } from './mcp';
import { SessionManager } from './sessions';

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
const KEY = 'k'.repeat(40);
const MCP_KEY = 'm'.repeat(40);
const auth = { authorization: `Bearer ${KEY}` };

const waitFor = async <T>(probe: () => Promise<T | undefined> | T | undefined, timeoutMs = 10_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};

describe.skipIf(!hasTmux)('session host (real tmux)', () => {
  let root: string;
  let config: SessionHostConfig;
  let manager: SessionManager;
  let app: FastifyInstance;
  let mcp: FastifyInstance;
  let base: string;

  const makeConfig = () => loadSessionHostConfig({
    SESSION_HOST_KEY: KEY, SESSION_HOST_MCP_KEY: MCP_KEY, SESSION_HOST_PORT: '0', SESSION_HOST_MCP_PORT: '0',
    SESSION_HOST_STATE_DIR: join(root, 'state'), SESSION_HOST_PROJECTS_DIR: join(root, 'projects'),
    SESSION_HOST_WORKTREES_DIR: join(root, 'worktrees'), SESSION_HOST_SHELL: '/bin/bash', SESSION_HOST_NAME: 'test-host',
    SESSION_HOST_REFRESH_MS: '250', HOME: root, PATH: process.env.PATH ?? '',
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'cockpit-'));
    config = makeConfig();
    manager = new SessionManager(config, { HOME: root, HISTFILE: '/dev/null', PATH: process.env.PATH ?? '', ANTHROPIC_API_KEY: 'sk-ant-should-not-leak-0000000000', SESSION_HOST_KEY: KEY });
    app = buildSessionHostApp(manager);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    base = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    mcp = buildMcpApp(manager);
    await mcp.ready();
  });

  afterEach(async () => {
    manager.stop();
    await app.close();
    await mcp.close();
    spawnSync('tmux', ['-S', join(root, 'state', 'tmux.sock'), 'kill-server']);
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { console.warn('leftover', root, String(error)); }
  });

  const create = (body: Record<string, unknown>) => app.inject({
    method: 'POST', url: '/v1/sessions', headers: auth,
    payload: { requestId: 'req-00000001', projectId: 'proj1', title: 'Shell', kind: 'shell', ...body },
  });
  const tail = async (id: string, projectId = 'proj1') => (await app.inject({
    method: 'GET', url: `/v1/sessions/${id}/tail?projectId=${projectId}`, headers: auth,
  })).json<{ text: string }>().text;
  const rpc = async (method: string, params?: unknown) => (await mcp.inject({
    method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${MCP_KEY}` },
    payload: { jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) },
  })).json<{ result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }; error?: unknown }>();
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await rpc('tools/call', { name, arguments: args });
    const text = response.result?.content?.[0]?.text ?? '';
    return { isError: response.result?.isError === true, text, json: () => JSON.parse(text) as Record<string, unknown> };
  };

  it('rejects requests without the service key and never accepts the lead key', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/sessions?projectId=proj1' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/sessions?projectId=proj1', headers: { authorization: `Bearer ${MCP_KEY}` } })).statusCode).toBe(401);
    expect((await mcp.inject({ method: 'POST', url: '/mcp', headers: auth, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } })).statusCode).toBe(401);
  });

  it('runs a real shell in tmux, types into it, and strips provider keys from the worker', async () => {
    const response = await create({});
    expect(response.statusCode).toBe(201);
    const { session } = response.json<{ session: { id: string; state: string; owner: string; host: string } }>();
    expect(session, JSON.stringify(session)).toMatchObject({ state: 'running', owner: 'human', host: 'test-host' });
    const input = await app.inject({
      method: 'POST', url: `/v1/sessions/${session.id}/input`, headers: auth,
      payload: { projectId: 'proj1', data: 'echo "marker-$((40+2)) key=[${ANTHROPIC_API_KEY:-none}] host=[${SESSION_HOST_KEY:-none}]"', submit: true },
    });
    expect(input.statusCode).toBe(200);
    const text = await waitFor(async () => { const value = await tail(session.id); return value.includes('marker-42') ? value : undefined; });
    expect(text).toContain('key=[none] host=[none]');
  });

  it('admits a repeated request id exactly once', async () => {
    const [first, second] = await Promise.all([create({}), create({})]);
    const ids = [first, second].map(response => response.json<{ session: { id: string } }>().session.id);
    expect(ids[0]).toBe(ids[1]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201]);
    const panes = await manager.tmux.panes();
    expect([...(panes?.keys() ?? [])]).toEqual([ids[0]]);
    expect((await create({ kind: 'codex', title: 'Other' })).statusCode).toBe(409);
  });

  it('hides sessions from other projects', async () => {
    const { session } = (await create({})).json<{ session: { id: string } }>();
    for (const url of [`/v1/sessions/${session.id}?projectId=other`, `/v1/sessions/${session.id}/tail?projectId=other`]) {
      expect((await app.inject({ method: 'GET', url, headers: auth })).statusCode).toBe(404);
    }
    const input = await app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/input`, headers: auth, payload: { projectId: 'other', data: 'x' } });
    expect(input.statusCode).toBe(404);
    expect((await call('get_session', { projectId: 'other', sessionId: session.id })).isError).toBe(true);
  });

  it('reports a launch failure without leaving a process behind', async () => {
    const response = await create({ kind: 'shell', repository: '/does/not/exist' });
    expect(response.json<{ session: { state: string; failure: string } }>().session).toMatchObject({ state: 'failed' });
    expect([...((await manager.tmux.panes())?.keys() ?? [])]).toEqual([]);
  });

  it('records exit status and stop, and marks vanished processes lost without relaunching', async () => {
    const { session } = (await create({})).json<{ session: { id: string } }>();
    await manager.input(session.id, 'proj1', 'human', 'exit 7', true);
    await waitFor(async () => { await manager.refresh(); return manager.get(session.id, 'proj1').state === 'exited' || undefined; });
    expect(manager.get(session.id, 'proj1').exitCode).toBe(7);

    const second = (await create({ requestId: 'req-00000002' })).json<{ session: { id: string } }>().session;
    const stopped = await app.inject({ method: 'POST', url: `/v1/sessions/${second.id}/stop`, headers: auth, payload: { projectId: 'proj1' } });
    expect(stopped.json<{ session: { state: string } }>().session.state).toBe('stopped');

    const third = (await create({ requestId: 'req-00000003' })).json<{ session: { id: string } }>().session;
    spawnSync('tmux', ['-S', join(root, 'state', 'tmux.sock'), 'kill-session', '-t', third.id]);
    await manager.refresh();
    expect(manager.get(third.id, 'proj1').state).toBe('lost');
    expect((await manager.tmux.panes())?.has(third.id)).toBe(false);
  });

  it('keeps sessions alive across a session-host restart', async () => {
    const { session } = (await create({})).json<{ session: { id: string } }>();
    manager.stop();
    await app.close();
    const restarted = new SessionManager(makeConfig(), { HOME: root, HISTFILE: '/dev/null', PATH: process.env.PATH ?? '' });
    await restarted.refresh();
    expect(restarted.get(session.id, 'proj1').state).toBe('running');
    await restarted.input(session.id, 'proj1', 'human', 'echo still-here', true);
    await waitFor(async () => ((await restarted.tail(session.id, 'proj1')).includes('still-here') ? true : undefined));
    app = buildSessionHostApp(restarted);
    manager = restarted;
  });

  it('enforces input ownership between Neal and the lead', async () => {
    const { session } = (await create({})).json<{ session: { id: string } }>();
    // Neal owns a session he opened; the lead cannot type or take it.
    expect((await call('send_input', { projectId: 'proj1', sessionId: session.id, text: 'echo lead' })).isError).toBe(true);
    expect((await call('take_input', { projectId: 'proj1', sessionId: session.id })).isError).toBe(true);
    // Neal hands it over; now the lead types and Neal is refused.
    await app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/ownership`, headers: auth, payload: { projectId: 'proj1', action: 'hand_to_lead' } });
    expect((await call('send_input', { projectId: 'proj1', sessionId: session.id, text: 'echo from-lead-1' })).isError).toBe(false);
    const refused = await app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/input`, headers: auth, payload: { projectId: 'proj1', data: 'x' } });
    expect(refused.json()).toMatchObject({ error: 'not_owner', owner: 'lead' });
    // Takeover is immediate; the lead is refused afterwards.
    await app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/ownership`, headers: auth, payload: { projectId: 'proj1', action: 'take' } });
    expect((await call('send_input', { projectId: 'proj1', sessionId: session.id, text: 'echo from-lead-2' })).isError).toBe(true);
    // The lead cannot stop a session Neal started.
    expect((await call('stop_session', { projectId: 'proj1', sessionId: session.id })).isError).toBe(true);
    await waitFor(async () => ((await tail(session.id)).includes('from-lead-1') ? true : undefined));
    expect(await tail(session.id)).not.toContain('from-lead-2');
  });

  it('lets the lead start a worker in its own worktree, then read the diff and run a check', async () => {
    const repo = join(root, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'math.sh'), 'add() { echo $(( $1 + $2 )); }\n');
    writeFileSync(join(repo, 'test.sh'), 'source ./math.sh\n[ "$(add 2 2)" = 4 ] && echo PASS || { echo FAIL; exit 1; }\n');
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    execFileSync('git', ['-C', repo, 'add', '.'], { env: gitEnv });
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'init'], { env: gitEnv });

    const tools = (await rpc('tools/list')).result?.tools?.map(item => item.name) ?? [];
    expect(tools).toEqual(expect.arrayContaining(['create_session', 'send_input', 'get_diff', 'run_check']));

    const args = { projectId: 'proj1', requestId: 'lead-req-0001', title: 'Worker A', kind: 'shell', repository: repo, task: 'echo "# note" >> math.sh' };
    const created = (await call('create_session', args)).json();
    const again = (await call('create_session', args)).json();
    const worker = created.session as { id: string; branch: string; cwd: string; owner: string };
    expect(again).toMatchObject({ created: false, session: { id: worker.id } });
    expect(worker).toMatchObject({ owner: 'lead', branch: `cockpit/${worker.id}` });
    expect(worker.cwd).toContain(join('worktrees', 'proj1', worker.id));

    const second = (await call('create_session', { ...args, requestId: 'lead-req-0002', title: 'Worker B', task: 'true' })).json().session as { cwd: string };
    expect(second.cwd).not.toBe(worker.cwd);

    const diff = await waitFor(async () => {
      const value = (await call('get_diff', { projectId: 'proj1', sessionId: worker.id })).json() as { patch: string };
      return value.patch.includes('+# note') ? value : undefined;
    });
    expect(diff).toMatchObject({ branch: `cockpit/${worker.id}` });
    // The original checkout is untouched.
    expect(execFileSync('git', ['-C', repo, 'status', '--porcelain']).toString()).toBe('');
    const check = (await call('run_check', { projectId: 'proj1', sessionId: worker.id, command: 'bash test.sh' })).json();
    expect(check).toMatchObject({ exitCode: 0 });
    expect(String(check.output)).toContain('PASS');
  });

  it('streams the real terminal over a WebSocket and refuses typing without ownership', async () => {
    const { session } = (await create({})).json<{ session: { id: string } }>();
    const socket = new WebSocket(`ws://${base}/v1/sessions/${session.id}/terminal?projectId=proj1&cols=100&rows=30`, { headers: auth });
    let screen = '';
    const frames: { type: string; reason?: string }[] = [];
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) screen += data.toString('utf8');
      else frames.push(JSON.parse(data.toString('utf8')) as { type: string });
    });
    await new Promise(resolve => socket.once('open', resolve));
    socket.send(JSON.stringify({ type: 'input', data: 'echo ws-$((6*7))\r' }));
    await waitFor(() => (screen.includes('ws-42') ? true : undefined));
    socket.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    manager.ownership(session.id, 'proj1', 'human', 'hand_to_lead');
    socket.send(JSON.stringify({ type: 'input', data: 'echo blocked\r' }));
    await waitFor(() => (frames.some(frame => frame.type === 'input_refused') ? true : undefined));
    socket.close();
    // Closing the viewer detaches only; the session keeps running.
    await waitFor(async () => { await manager.refresh(); return manager.get(session.id, 'proj1').state === 'running' || undefined; });

    const bad = new WebSocket(`ws://${base}/v1/sessions/${session.id}/terminal?projectId=proj1`);
    const status = await new Promise<number>(resolve => bad.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0)));
    expect(status).toBe(401);
  });
});
