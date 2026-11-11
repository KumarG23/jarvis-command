import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { AppConfig } from './config';
import { buildApp } from './app';
import { ProjectRoomStore } from './project-room-store';

const HOST_KEY = 'h'.repeat(40);
const ORIGIN = 'https://command.example.test';
const ROOM = 'room_' + 'c'.repeat(32);
const SESSION = 'cs_' + 'a'.repeat(24);
const roots: string[] = [];
const closers: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

// A stand-in session host that records what the BFF forwards and echoes terminal input.
async function fakeHost() {
  const seen: { method: string; url: string; auth?: string | undefined; body?: unknown }[] = [];
  const host = Fastify();
  await host.register(websocket);
  host.addHook('onRequest', async request => { seen.push({ method: request.method, url: request.url, auth: request.headers.authorization }); });
  host.get('/v1/adapters', async () => ({ adapters: [] }));
  host.get('/v1/sessions', async () => ({ sessions: [] }));
  host.post('/v1/sessions', async (request, reply) => { seen.at(-1)!.body = request.body; return reply.code(201).send({ session: { id: SESSION } }); });
  host.post('/v1/sessions/:id/stop', async () => { throw new Error('boom'); });
  host.get('/v1/sessions/:id/terminal', { websocket: true }, (socket, request) => {
    if (request.headers.authorization !== `Bearer ${HOST_KEY}`) { socket.close(4401); return; }
    socket.send(JSON.stringify({ type: 'session' }));
    socket.send(Buffer.from('hello from tmux'), { binary: true });
    socket.on('message', (raw: Buffer) => socket.send(Buffer.from(`echo:${raw.toString('utf8')}`), { binary: true }));
  });
  await host.listen({ host: '127.0.0.1', port: 0 });
  closers.push(() => host.close());
  const address = host.server.address();
  return { seen, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` };
}

async function makeApp(sessionHostUrl: string | null, repository = '') {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-cockpit-test-'));
  roots.push(root);
  await mkdir(join(root, 'audit'), { mode: 0o700 });
  await new ProjectRoomStore(join(root, 'audit')).update(() => [
    { id: ROOM, name: 'Cockpit', goal: 'Test', repository, notes: [], sessionIds: [], lastSessionId: null },
  ]);
  const config: AppConfig = {
    nodeEnv: 'test', host: '127.0.0.1', port: 0, appVersion: 'cockpit-test', authMode: 'cloudflare',
    cloudflare: { teamDomain: 'team.cloudflareaccess.com', audience: 'a'.repeat(64), allowedEmailHash: 'b'.repeat(64), jwksFile: '/dev/null' },
    hermes: { baseUrl: 'http://127.0.0.1:18642', readProxyKey: 'server-side-read-proxy-secret' },
    command: { baseUrl: 'http://127.0.0.1:18643', commandProxyKey: 'server-side-command-proxy-secret', auditLogPath: join(root, 'audit', 'events.jsonl'), publicOrigin: ORIGIN },
    webDistDir: undefined,
    artifacts: { enabled: false, root: null, maxFileBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 10 },
    cockpit: sessionHostUrl ? { sessionHostUrl, sessionHostKey: HOST_KEY } : null,
  } as AppConfig;
  const app: FastifyInstance = buildApp({
    config,
    verifyAccess: vi.fn(async (assertion: string | undefined) => {
      if (assertion !== 'valid') throw new Error('denied');
      return { subject: 'neal', provider: 'cloudflare-access' as const };
    }),
    hermes: { readSnapshot: vi.fn() },
  } as unknown as Parameters<typeof buildApp>[0]);
  closers.push(() => app.close());
  return { app, root };
}

const writeHeaders = { 'cf-access-jwt-assertion': 'valid', origin: ORIGIN, 'x-jarvis-command': '1', 'content-type': 'application/json' };
const readHeaders = { 'cf-access-jwt-assertion': 'valid' };

describe('cockpit routes', () => {
  it('reports disabled and exposes nothing else when no session host is configured', async () => {
    const { app } = await makeApp(null);
    expect((await app.inject({ method: 'GET', url: '/api/cockpit/status' })).json()).toEqual({ enabled: false });
    expect((await app.inject({ method: 'GET', url: `/api/cockpit/projects/${ROOM}/sessions`, headers: readHeaders })).statusCode).toBe(404);
  });

  it('requires Access, a same-origin write header and a known project', async () => {
    const host = await fakeHost();
    const { app } = await makeApp(host.url);
    expect((await app.inject({ method: 'GET', url: '/api/cockpit/adapters' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/cockpit/adapters', headers: { 'cf-access-jwt-assertion': 'forged' } })).statusCode).toBe(401);
    const create = { requestId: 'req-00000001', title: 'Shell', kind: 'shell' };
    expect((await app.inject({ method: 'POST', url: `/api/cockpit/projects/${ROOM}/sessions`, headers: { ...writeHeaders, origin: 'https://evil.example' }, payload: create })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/cockpit/projects/${ROOM}/sessions`, headers: { ...writeHeaders, 'x-jarvis-command': '0' }, payload: create })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/cockpit/projects/room_${'d'.repeat(32)}/sessions`, headers: readHeaders })).json()).toEqual({ error: 'project_not_found' });
    expect((await app.inject({ method: 'GET', url: '/api/cockpit/projects/not-a-room/sessions', headers: readHeaders })).statusCode).toBe(404);
    // None of the refused requests reached the session host.
    expect(host.seen).toEqual([]);
  });

  it('relays with the host key, pins the project and repository server-side, and audits writes', async () => {
    const host = await fakeHost();
    const { app, root } = await makeApp(host.url, 'git@github.com:example/repo.git');
    const adapters = await app.inject({ method: 'GET', url: '/api/cockpit/adapters', headers: readHeaders });
    expect(adapters.statusCode).toBe(200);
    const created = await app.inject({
      method: 'POST', url: `/api/cockpit/projects/${ROOM}/sessions`, headers: writeHeaders,
      payload: { requestId: 'req-00000001', title: 'Shell', kind: 'shell', worktree: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ session: { id: SESSION } });
    // The browser cannot choose another project or repository.
    const smuggled = await app.inject({
      method: 'POST', url: `/api/cockpit/projects/${ROOM}/sessions`, headers: writeHeaders,
      payload: { requestId: 'req-00000002', title: 'Shell', kind: 'shell', repository: '/etc', projectId: 'other' },
    });
    expect(smuggled.statusCode).toBe(400);
    expect(host.seen.every(entry => entry.auth === `Bearer ${HOST_KEY}`)).toBe(true);
    expect(host.seen.find(entry => entry.method === 'POST')?.body).toEqual({
      requestId: 'req-00000001', title: 'Shell', kind: 'shell', worktree: true, projectId: ROOM, repository: 'git@github.com:example/repo.git',
    });
    // Host 5xx becomes 502 rather than leaking as our own failure.
    const stopped = await app.inject({ method: 'POST', url: `/api/cockpit/projects/${ROOM}/sessions/${SESSION}/stop`, headers: writeHeaders, payload: {} });
    expect(stopped.statusCode).toBe(502);
    const audit = (await readFile(join(root, 'audit', 'cockpit-audit.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    expect(audit.map(line => line.action)).toEqual(['session.create', 'session.stop']);
    expect(audit[0]).toMatchObject({ actor: 'neal', roomId: ROOM });
    expect(JSON.stringify(audit)).not.toContain(HOST_KEY);
  });

  it('returns 503 when the session host is down', async () => {
    const { app } = await makeApp('http://127.0.0.1:9');
    const response = await app.inject({ method: 'GET', url: '/api/cockpit/adapters', headers: readHeaders });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'session_host_unavailable' });
  });

  it('relays the terminal WebSocket only for an authenticated same-origin viewer', async () => {
    const host = await fakeHost();
    const { app } = await makeApp(host.url);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const url = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/cockpit/projects/${ROOM}/sessions/${SESSION}/terminal?cols=80&rows=24`;
    const refused = (headers: Record<string, string>) => new Promise<number>(resolve => {
      const ws = new WebSocket(url, { headers });
      ws.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
      ws.on('open', () => { ws.close(); resolve(101); });
    });
    expect(await refused({ origin: ORIGIN })).toBe(401);
    expect(await refused({ 'cf-access-jwt-assertion': 'valid', origin: 'https://evil.example' })).toBe(403);

    const ws = new WebSocket(url, { headers: { 'cf-access-jwt-assertion': 'valid', origin: ORIGIN } });
    const frames: string[] = [];
    ws.on('message', (data: Buffer, isBinary: boolean) => frames.push(`${isBinary ? 'bin' : 'text'}:${data.toString('utf8')}`));
    await new Promise(resolve => ws.on('open', resolve));
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'exec', command: 'rm -rf /' }));
    ws.send(JSON.stringify({ type: 'input', data: 'ls\r' }));
    const deadline = Date.now() + 5_000;
    while (!frames.some(frame => frame.startsWith('bin:echo')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    expect(frames).toEqual(['text:{"type":"session"}', 'bin:hello from tmux', 'bin:echo:{"type":"input","data":"ls\\r"}']);
    const terminalRequest = host.seen.find(entry => entry.url.includes('/terminal'));
    expect(terminalRequest?.url).toBe(`/v1/sessions/${SESSION}/terminal?projectId=${ROOM}&cols=80&rows=24`);
    ws.close();
  });
});
