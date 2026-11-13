import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { AppConfig } from './config';
import { buildApp } from './app';

const SHELL_KEY = 's'.repeat(40);
const ORIGIN = 'https://command.example.test';
const SESSION = 'cs_' + 'a'.repeat(24);
const roots: string[] = [];
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fakeShellHost(active = 0) {
  const seen: { method: string; url: string; auth?: string | undefined; body?: unknown }[] = [];
  const host = Fastify();
  await host.register(websocket);
  host.addHook('onRequest', async request => { seen.push({ method: request.method, url: request.url, auth: request.headers.authorization }); });
  host.get('/v1/health', async () => ({ ok: true, host: 'dell' }));
  host.get('/v1/sessions', async () => ({ sessions: Array.from({ length: active }, (_, index) => ({ id: `cs_${String(index).repeat(24)}`, state: 'running' })) }));
  host.post('/v1/sessions', async (request, reply) => { seen.at(-1)!.body = request.body; return reply.code(201).send({ session: { id: SESSION } }); });
  host.post('/v1/sessions/:id/stop', async request => { seen.at(-1)!.body = request.body; return { session: { id: SESSION } }; });
  host.get('/v1/sessions/:id/terminal', { websocket: true }, (socket, request) => {
    if (request.headers.authorization !== `Bearer ${SHELL_KEY}`) { socket.close(4401); return; }
    socket.on('message', (raw: Buffer) => socket.send(Buffer.from(`echo:${raw.toString('utf8')}`), { binary: true }));
  });
  await host.listen({ host: '127.0.0.1', port: 0 });
  closers.push(() => host.close());
  const address = host.server.address();
  return { seen, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` };
}

async function makeApp(url: string | null) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-host-shell-test-'));
  roots.push(root);
  await mkdir(join(root, 'audit'), { mode: 0o700 });
  const config = {
    nodeEnv: 'test', host: '127.0.0.1', port: 0, appVersion: 'host-shell-test', authMode: 'cloudflare',
    cloudflare: { teamDomain: 'team.cloudflareaccess.com', audience: 'a'.repeat(64), allowedEmailHash: 'b'.repeat(64), jwksFile: '/dev/null' },
    hermes: { baseUrl: 'http://127.0.0.1:18642', readProxyKey: 'server-side-read-proxy-secret' },
    command: { baseUrl: 'http://127.0.0.1:18643', commandProxyKey: 'server-side-command-proxy-secret', auditLogPath: join(root, 'audit', 'events.jsonl'), publicOrigin: ORIGIN },
    webDistDir: undefined,
    artifacts: { enabled: false, root: null, maxFileBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 10 },
    cockpit: null,
    hostShell: url ? { url, key: SHELL_KEY, name: 'Hermes host' } : null,
  } as unknown as AppConfig;
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

describe('host shell routes', () => {
  it('reports disabled when not configured', async () => {
    const { app } = await makeApp(null);
    expect((await app.inject({ url: '/api/host-shell/status' })).json()).toEqual({ enabled: false });
    expect((await app.inject({ url: '/api/host-shell/sessions', headers: readHeaders })).statusCode).toBe(404);
  });

  it('requires Access and same-origin writes, and refuses before reaching the host', async () => {
    const host = await fakeShellHost();
    const { app } = await makeApp(host.url);
    expect((await app.inject({ url: '/api/host-shell/status' })).statusCode).toBe(401);
    const create = { requestId: 'req-00000001' };
    expect((await app.inject({ method: 'POST', url: '/api/host-shell/sessions', headers: { ...writeHeaders, origin: 'https://evil.example' }, payload: create })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/host-shell/sessions', headers: { ...writeHeaders, 'x-jarvis-command': '0' }, payload: create })).statusCode).toBe(403);
    expect(host.seen).toEqual([]);
  });

  it('starts only shells in the fixed host project, refuses lead hand-off, caps sessions and audits fingerprints', async () => {
    const host = await fakeShellHost();
    const { app, root } = await makeApp(host.url);
    expect((await app.inject({ url: '/api/host-shell/status', headers: readHeaders })).json()).toEqual({ enabled: true, name: 'Hermes host', reachable: true, host: 'dell' });
    const created = await app.inject({ method: 'POST', url: '/api/host-shell/sessions', headers: writeHeaders, payload: { requestId: 'req-00000001', cols: 80, rows: 24 } });
    expect(created.statusCode).toBe(201);
    expect(host.seen.find(entry => entry.method === 'POST')?.body).toEqual({ requestId: 'req-00000001', title: 'Shell', kind: 'shell', projectId: 'host-shell', cols: 80, rows: 24 });
    // The browser can't pick a CLI, a project, a repository or the lead.
    expect((await app.inject({ method: 'POST', url: '/api/host-shell/sessions', headers: writeHeaders, payload: { requestId: 'req-00000002', kind: 'claude' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/host-shell/sessions', headers: writeHeaders, payload: { requestId: 'req-00000003', projectId: 'room_x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/host-shell/sessions/${SESSION}/ownership`, headers: writeHeaders, payload: { action: 'hand_to_lead' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/host-shell/sessions/${SESSION}/stop`, headers: writeHeaders, payload: {} })).statusCode).toBe(200);
    expect(host.seen.find(entry => entry.url.endsWith('/stop'))?.body).toEqual({ projectId: 'host-shell' });
    expect(host.seen.every(entry => entry.auth === `Bearer ${SHELL_KEY}`)).toBe(true);
    const audit = (await readFile(join(root, 'audit', 'host-shell-audit.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    expect(audit.map(line => line.action)).toEqual(['session.create', 'session.stop']);
    expect(audit[0]!.actor).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit)).not.toMatch(/neal|sss/);

    const full = await fakeShellHost(4);
    const capped = await makeApp(full.url);
    const refused = await capped.app.inject({ method: 'POST', url: '/api/host-shell/sessions', headers: writeHeaders, payload: { requestId: 'req-00000004' } });
    expect([refused.statusCode, refused.json().error]).toEqual([409, 'too_many_sessions']);
    expect(full.seen.some(entry => entry.method === 'POST')).toBe(false);
  });

  it('reports an unreachable host plainly', async () => {
    const { app } = await makeApp('http://127.0.0.1:9');
    expect((await app.inject({ url: '/api/host-shell/status', headers: readHeaders })).json()).toEqual({ enabled: true, name: 'Hermes host', reachable: false });
    const listed = await app.inject({ url: '/api/host-shell/sessions', headers: readHeaders });
    expect([listed.statusCode, listed.json().error]).toEqual([503, 'host_shell_unavailable']);
  });

  it('relays the terminal with the shell key for an authenticated same-origin viewer', async () => {
    const host = await fakeShellHost();
    const { app } = await makeApp(host.url);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const url = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/host-shell/sessions/${SESSION}/terminal?cols=80&rows=24`;
    const refused = await new Promise<number>(resolve => {
      const ws = new WebSocket(url, { headers: { 'cf-access-jwt-assertion': 'valid', origin: 'https://evil.example' } });
      ws.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
      ws.on('open', () => { ws.close(); resolve(101); });
    });
    expect(refused).toBe(403);
    const ws = new WebSocket(url, { headers: { 'cf-access-jwt-assertion': 'valid', origin: ORIGIN } });
    const frames: string[] = [];
    ws.on('message', (data: Buffer) => frames.push(data.toString('utf8')));
    await new Promise(resolve => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'input', data: 'sudo systemctl restart hermes-gateway.service\r' }));
    const deadline = Date.now() + 5_000;
    while (!frames.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    expect(frames[0]).toContain('hermes-gateway');
    expect(host.seen.find(entry => entry.url.includes('/terminal'))?.url).toBe(`/v1/sessions/${SESSION}/terminal?projectId=host-shell&cols=80&rows=24`);
    ws.close();
  });
});
