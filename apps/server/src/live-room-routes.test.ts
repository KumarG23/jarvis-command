import type { FastifyReply } from 'fastify';
import { get, type IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { CommandProxyUnavailableError } from './command-client';
import { loadConfig } from './config';
import type { createLiveRoomService } from './live-room-service';

const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: '/unused/audit.jsonl' });
const headers = { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example', 'x-jarvis-command': '1', 'content-type': 'application/json' };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
function setup(liveStreamLimits?: { maxStreams?: number; lifetimeMs?: number; keepaliveMs?: number; maximumBytes?: number }) {
  const createSession = vi.fn().mockResolvedValue({ session: { id: 'jc_' + 'a'.repeat(32), title: 'Room', source: 'jarvis-command', ownership: 'command', model: null, lastActive: null, messageCount: 0, toolCallCount: 0, pinned: false } });
  const liveRoom = { createSession } as unknown as ReturnType<typeof createLiveRoomService>;
  const verifyAccess = vi.fn(async (assertion) => { if (assertion !== 'valid') throw new Error('secret JWT detail'); return { subject: 'operator', provider: 'cloudflare-access' as const }; });
  const app = buildApp({ config, verifyAccess, hermes: { readSnapshot: vi.fn() }, liveRoom, ...(liveStreamLimits ? { liveStreamLimits } : {}) });
  apps.push(app);
  return { app, createSession, liveRoom, verifyAccess };
}

it.each(['disconnect', 'lifetime', 'shutdown'])('cancels held SSE preflight on %s without retaining a slot or starting a stream', async (reason) => {
  const { app, liveRoom } = setup({ maxStreams: 1, lifetimeMs: reason === 'lifetime' ? 100 : 60_000 });
  const id = 'jcr_' + 'a'.repeat(32);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const getRun = vi.fn().mockImplementationOnce(() => held).mockResolvedValue({ publicRunId: id });
  const streamRunEvents = vi.fn().mockImplementation(async function* () {});
  Object.assign(liveRoom, { getRun, streamRunEvents });
  let firstReply: FastifyReply | undefined;
  app.addHook('preHandler', async (_request, reply) => { firstReply ??= reply; });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `/api/live/runs/${id}/events`;
  const req = get(address + url, { agent: false, headers }, response => response.resume());
  req.on('error', () => {});
  try {
    await vi.waitFor(() => expect(getRun).toHaveBeenCalledTimes(1));
    if (reason === 'disconnect') req.destroy();
    let closing: Promise<void> | undefined;
    let closed = false;
    if (reason === 'shutdown') closing = app.close().then(() => { closed = true; });
    await vi.waitFor(() => expect(firstReply!.raw.destroyed).toBe(true), { timeout: 800 });
    expect(firstReply!.raw.listeners('close').filter(fn => fn.name === 'onClose')).toHaveLength(0);
    // Completion must not wait for the held upstream promise (Fastify reply is thenable).
    await vi.waitFor(() => expect(firstReply!.sent).toBe(true), { timeout: 800 });
    if (reason === 'shutdown') {
      await vi.waitFor(() => expect(closed).toBe(true), { timeout: 800 });
      await closing;
    } else {
      const replacement = await app.inject({ url, headers });
      expect(replacement.statusCode).toBe(200);
      expect(streamRunEvents).toHaveBeenCalledTimes(1);
    }
    const started = streamRunEvents.mock.calls.length;
    release(); await delay(30);
    expect(streamRunEvents).toHaveBeenCalledTimes(started);
    expect(firstReply!.raw.listeners('close').filter(fn => fn.name === 'onClose')).toHaveLength(0);
  } finally { release(); req.destroy(); app.server.closeAllConnections(); await app.close(); }
});

it('preserves JSON errors and releases the SSE slot when open preflight rejects', async () => {
  const { app, liveRoom } = setup({ maxStreams: 1 });
  const id = 'jcr_' + 'a'.repeat(32);
  const getRun = vi.fn().mockRejectedValueOnce(new CommandProxyUnavailableError()).mockResolvedValue({ publicRunId: id });
  const streamRunEvents = vi.fn().mockImplementation(async function* () {});
  Object.assign(liveRoom, { getRun, streamRunEvents });
  const replies: FastifyReply[] = [];
  app.addHook('preHandler', async (_request, reply) => { replies.push(reply); });
  const url = `/api/live/runs/${id}/events`;
  const failed = await app.inject({ url, headers });
  expect(failed.statusCode).toBe(503);
  expect(failed.json()).toEqual({ error: 'live_room_unavailable' });
  expect(streamRunEvents).not.toHaveBeenCalled();
  expect(replies[0]!.raw.listeners('close').filter(fn => fn.name === 'onClose')).toHaveLength(0);
  expect((await app.inject({ url, headers })).statusCode).toBe(200);
});

it('does not start preflight or streaming for an already destroyed response', async () => {
  const { app, liveRoom } = setup({ maxStreams: 1 });
  const getRun = vi.fn();
  const streamRunEvents = vi.fn();
  Object.assign(liveRoom, { getRun, streamRunEvents });
  let captured: FastifyReply | undefined;
  app.addHook('preHandler', async (_request, reply) => { captured = reply; reply.raw.destroy(); });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const req = get(address + '/api/live/runs/jcr_' + 'a'.repeat(32) + '/events', { agent: false, headers });
  req.on('error', () => {});
  try {
    await vi.waitFor(() => expect(captured?.sent).toBe(true));
    expect(getRun).not.toHaveBeenCalled();
    expect(streamRunEvents).not.toHaveBeenCalled();
    expect(captured!.raw.listeners('close').filter(fn => fn.name === 'onClose')).toHaveLength(0);
  } finally { req.destroy(); app.server.closeAllConnections(); }
});

it.each(['lifetime', 'shutdown'])('reclaims a paused real SSE socket on %s', async (reason) => {
  const { app, liveRoom } = setup({ maxStreams: 1, lifetimeMs: reason === 'lifetime' ? 500 : 60_000, maximumBytes: 67_108_864 });
  const id = 'jcr_' + 'a'.repeat(32);
  let pulls = 0;
  Object.assign(liveRoom, {
    getRun: vi.fn().mockResolvedValue({ publicRunId: id }),
    streamRunEvents: async function* (_actor: string, _id: string, signal: AbortSignal) {
      while (!signal.aborted) { pulls++; yield { publicRunId: id, type: 'message.delta', timestamp: '2026-09-04T14:00:00Z', delta: 'x'.repeat(32768) }; }
    },
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const connect = () => new Promise<IncomingMessage>((resolve, reject) => { get(address + `/api/live/runs/${id}/events`, { agent: false, headers }, resolve).on('error', reject); });
  const response = await connect(); response.pause();
  let replacement: IncomingMessage | undefined;
  try {
    await delay(250); const stoppedAt = pulls; await delay(100);
    expect(pulls).toBe(stoppedAt); expect(pulls).toBeLessThan(1000);
    if (reason === 'lifetime') {
      await delay(450);
      replacement = await connect(); replacement.pause();
      expect(replacement.statusCode).toBe(200);
    }
    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 800 });
    await closing;
  } finally { response.destroy(); replacement?.destroy(); app.server.closeAllConnections(); await app.close(); }
});

it('keeps a default quiet SSE connection alive through the first 15-second heartbeat', async () => {
  const { app, liveRoom } = setup();
  const id = 'jcr_' + 'a'.repeat(32);
  Object.assign(liveRoom, { getRun: vi.fn().mockResolvedValue({ publicRunId: id }),
    // eslint-disable-next-line require-yield
    streamRunEvents: async function* (_actor: string, _id: string, signal: AbortSignal) {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = await new Promise<IncomingMessage>((resolve, reject) => { get(address + `/api/live/runs/${id}/events`, { agent: false, headers }, resolve).on('error', reject); });
  let text = ''; let closed = false;
  response.on('data', chunk => { text += chunk.toString(); });
  response.on('error', () => {}); response.on('close', () => { closed = true; });
  try {
    await delay(15_300);
    expect(closed).toBe(false);
    expect(text).toContain(': keepalive');
  } finally { response.destroy(); app.server.closeAllConnections(); }
}, 20_000);

it('flushes the terminal SSE frame on natural completion', async () => {
  const { app, liveRoom } = setup();
  const id = 'jcr_' + 'a'.repeat(32);
  Object.assign(liveRoom, { getRun: vi.fn().mockResolvedValue({ publicRunId: id }), streamRunEvents: async function* () {
    yield { publicRunId: id, type: 'run.completed', timestamp: '2026-09-04T14:00:00Z', output: 'x'.repeat(65_536) + 'terminal-end', pendingSteer: null, usage: null };
  } });
  const response = await app.inject({ url: `/api/live/runs/${id}/events`, headers });
  expect(response.body).toContain('event: run.completed');
  const data = response.body.split('data: ')[1]!.trim();
  expect(JSON.parse(data).output).toBe('x'.repeat(65_536) + 'terminal-end');
});

it('gates session creation with Access and exact origin/custom header/JSON before service invocation', async () => {
  const { app, createSession, verifyAccess } = setup();
  for (const [changed, status] of [
    [{ 'cf-access-jwt-assertion': '' }, 401],
    [{ origin: 'https://command.example.evil' }, 403],
    [{ origin: 'https://command.example/' }, 403],
    [{ origin: '' }, 403],
    [{ 'x-jarvis-command': '' }, 403],
    [{ 'content-type': 'text/plain' }, 415],
  ] as const) {
    const response = await app.inject({ method: 'POST', url: '/api/live/sessions', headers: { ...headers, ...changed }, payload: '{}' });
    expect(response.statusCode).toBe(status);
    expect(createSession).not.toHaveBeenCalled();
  }
  const response = await app.inject({ method: 'POST', url: '/api/live/sessions', headers, payload: '{}' });
  expect(response.statusCode).toBe(200);
  expect(verifyAccess).toHaveBeenCalledWith('valid');
  expect(createSession).toHaveBeenCalledExactlyOnceWith('operator', {});
});

it('serves authenticated bounded paginated history without accepting unknown query fields', async () => {
  const { app, liveRoom } = setup();
  const page = { sessionId: 'discord_1', messages: [], pagination: { limit: 20, offset: 2, returned: 0, hasMore: false } };
  Object.assign(liveRoom, { getMessages: vi.fn().mockResolvedValue(page) });
  expect((await app.inject('/api/sessions/discord_1/messages')).statusCode).toBe(401);
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=1000001', 'limit=2&limit=3', 'other=1']) {
    expect((await app.inject({ url: '/api/sessions/discord_1/messages?' + query, headers })).statusCode).toBe(400);
  }
  expect(liveRoom.getMessages).not.toHaveBeenCalled();
  const response = await app.inject({ url: '/api/sessions/discord_1/messages?limit=20&offset=2', headers });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual(page);
  expect(liveRoom.getMessages).toHaveBeenCalledExactlyOnceWith('operator', 'discord_1', 20, 2);
});

it('submits a bounded run and polls its opaque status behind Access', async () => {
  const { app, liveRoom } = setup();
  const request = { sessionId: 'jc_' + 'a'.repeat(32), input: 'Check health', clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e' };
  const publicRunId = 'jcr_' + 'b'.repeat(32);
  const submitted = { ...request, input: undefined, publicRunId, status: 'running', replayed: false };
  Object.assign(liveRoom, { submitRun: vi.fn().mockResolvedValue(submitted), getRun: vi.fn().mockResolvedValue({ publicRunId, status: 'running' }) });
  expect((await app.inject({ method: 'POST', url: '/api/live/runs', payload: request })).statusCode).toBe(401);
  for (const bad of [{ ...request, input: ' ' }, { ...request, input: 'x'.repeat(16001) }, { ...request, extra: true }, { ...request, clientRequestId: 'invalid' }]) {
    expect((await app.inject({ method: 'POST', url: '/api/live/runs', headers, payload: bad })).statusCode).toBe(400);
  }
  expect(liveRoom.submitRun).not.toHaveBeenCalled();
  expect((await app.inject({ method: 'POST', url: '/api/live/runs', headers, payload: request })).statusCode).toBe(200);
  expect(liveRoom.submitRun).toHaveBeenCalledExactlyOnceWith('operator', request);
  expect((await app.inject('/api/live/runs/' + publicRunId)).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/live/runs/run_' + 'b'.repeat(32), headers })).statusCode).toBe(400);
  expect((await app.inject({ url: '/api/live/runs/' + publicRunId, headers })).json()).toEqual({ publicRunId, status: 'running' });
});

it('gates exact approval, queued steer, cooperative stop, and owned continuation operations', async () => {
  const { app, liveRoom } = setup();
  const id = 'jcr_' + 'a'.repeat(32);
  for (const [suffix, method, payload, receipt, bad] of [
    ['approval', 'approveRun', { requestId: 'approval-1', choice: 'once' }, { publicRunId: id, requestId: 'approval-1', choice: 'once', resolved: 1 }, { requestId: 'approval-1', choice: 'always' }],
    ['steer', 'steerRun', { input: 'Safer' }, { publicRunId: id, accepted: true, state: 'queued' }, { input: 'x'.repeat(4001) }],
    ['stop', 'stopRun', {}, { publicRunId: id, status: 'stopping' }, { force: true }],
  ] as const) {
    const fn = vi.fn().mockResolvedValue(receipt);
    Object.assign(liveRoom, { [method]: fn });
    const url = `/api/live/runs/${id}/${suffix}`;
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://evil.example' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers, payload: bad })).statusCode).toBe(400);
    expect(fn).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url, headers, payload })).json()).toEqual(receipt);
  }
  Object.assign(liveRoom, { continueSession: vi.fn().mockResolvedValue({ session: { id: 'jc_' + 'b'.repeat(32) } }) });
  const url = '/api/live/sessions/jc_' + 'a'.repeat(32) + '/continue';
  expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url, headers, payload: { title: 'Fork' } })).statusCode).toBe(200);
  expect(liveRoom.continueSession).toHaveBeenCalledWith('operator', 'jc_' + 'a'.repeat(32), { title: 'Fork' });
});

it('returns sanitized service-unavailable status for command transport failure', async () => {
  const { app, createSession } = setup();
  createSession.mockRejectedValue(new CommandProxyUnavailableError());
  const response = await app.inject({ method: 'POST', url: '/api/live/sessions', headers, payload: {} });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ error: 'live_room_unavailable' });
});

it('rejects unlisted live-route query fields before service invocation', async () => {
  const { app, liveRoom, createSession } = setup();
  Object.assign(liveRoom, { getRun: vi.fn().mockResolvedValue({ status: 'running' }) });
  const created = await app.inject({ method: 'POST', url: '/api/live/sessions?extra=secret', headers, payload: {} });
  expect(created.statusCode).toBe(400);
  const status = await app.inject({ url: '/api/live/runs/jcr_' + 'a'.repeat(32) + '?extra=secret', headers });
  expect(status.statusCode).toBe(400);
  expect(createSession).not.toHaveBeenCalled();
  expect(liveRoom.getRun).not.toHaveBeenCalled();
});

it('rate limits authenticated mutations per actor before service invocation', async () => {
  const { app, createSession } = setup();
  for (let i = 0; i < 30; i++) {
    expect((await app.inject({ method: 'POST', url: '/api/live/sessions', headers, payload: {} })).statusCode).toBe(200);
  }
  const response = await app.inject({ method: 'POST', url: '/api/live/sessions', headers, payload: {} });
  expect(response.statusCode).toBe(429);
  expect(createSession).toHaveBeenCalledTimes(30);
});

it('caps serialized SSE output and never turns stream truncation into a terminal run event', async () => {
  const { app, liveRoom } = setup({ maximumBytes: 2_000 });
  const id = 'jcr_' + 'a'.repeat(32);
  Object.assign(liveRoom, {
    getRun: vi.fn().mockResolvedValue({ publicRunId: id }),
    streamRunEvents: async function* () {
      for (let index = 0; index < 10; index++) yield { publicRunId: id, type: 'message.delta', timestamp: '2026-09-04T14:00:00.000Z', delta: 'x'.repeat(1_000) };
    },
  });
  const response = await app.inject({ url: `/api/live/runs/${id}/events`, headers });
  expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(2_000);
  expect(response.body.match(/event: message.delta/g)).toHaveLength(1);
  expect(response.body).not.toContain('event: run.');
});

it('sends keepalives while upstream has no typed events', async () => {
  const { app, liveRoom } = setup({ lifetimeMs: 100, keepaliveMs: 20 });
  const id = 'jcr_' + 'a'.repeat(32);
  Object.assign(liveRoom, {
    getRun: vi.fn().mockResolvedValue({ publicRunId: id }),
    // The idle upstream deliberately never yields a typed event.
    // eslint-disable-next-line require-yield
    streamRunEvents: async function* (_actor: string, _id: string, signal: AbortSignal) {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = await new Promise<IncomingMessage>((resolve, reject) => { get(address + `/api/live/runs/${id}/events`, { agent: false, headers }, resolve).on('error', reject); });
  let text = '';
  response.on('data', chunk => { text += chunk.toString(); });
  response.on('error', () => {});
  try {
    await new Promise<void>(resolve => response.once('close', resolve));
    expect(response.statusCode).toBe(200);
    expect(text).toContain(': keepalive');
    expect(text).not.toContain('event: run.');
  } finally { response.destroy(); }

});

it('expires a quiet SSE stream independently of upstream activity', async () => {
  const { app, liveRoom } = setup({ lifetimeMs: 100 });
  const id = 'jcr_' + 'a'.repeat(32);
  let upstreamSignal: AbortSignal | undefined;
  Object.assign(liveRoom, {
    getRun: vi.fn().mockResolvedValue({ publicRunId: id }),
    streamRunEvents: async function* (_actor: string, _id: string, signal: AbortSignal) {
      upstreamSignal = signal;
      yield { publicRunId: id, type: 'message.delta', timestamp: '2026-09-04T14:00:00.000Z', delta: 'Ready' };
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  try {
    const response = await fetch(`${address}/api/live/runs/${id}/events`, { headers, signal: controller.signal });
    await response.body!.getReader().read();
    await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true), { timeout: 2_000 });
  } finally { controller.abort(); }
});

it('bounds simultaneous SSE connections and aborts them before graceful shutdown drains', async () => {
  const { app, liveRoom } = setup({ maxStreams: 2 });
  const id = 'jcr_' + 'a'.repeat(32);
  const signals: AbortSignal[] = [];
  Object.assign(liveRoom, {
    getRun: vi.fn().mockResolvedValue({ publicRunId: id }),
    streamRunEvents: async function* (_actor: string, _id: string, signal: AbortSignal) {
      signals.push(signal);
      yield { publicRunId: id, type: 'message.delta', timestamp: '2026-09-04T14:00:00.000Z', delta: 'Ready' };
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controllers = [new AbortController(), new AbortController()];
  try {
    const responses = await Promise.all(controllers.map((controller) => fetch(`${address}/api/live/runs/${id}/events`, { headers, signal: controller.signal })));
    await Promise.all(responses.map((response) => response.body!.getReader().read()));
    const excessController = new AbortController();
    controllers.push(excessController);
    const excess = await fetch(`${address}/api/live/runs/${id}/events`, { headers, signal: excessController.signal });
    expect(excess.status).toBe(429);
    const closed = app.close();
    await vi.waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true), { timeout: 2_000 });
    await closed;
  } finally { controllers.forEach((controller) => controller.abort()); }
});

it('streams typed SSE only after Access and aborts upstream on real socket disconnect', async () => {
  const { app, liveRoom } = setup();
  const id = 'jcr_' + 'a'.repeat(32);
  let aborted = false;
  Object.assign(liveRoom, { getRun: vi.fn().mockResolvedValue({ publicRunId: id }), streamRunEvents: async function* (_actor: string, _id: string, signal: AbortSignal) {
    yield { publicRunId: id, type: 'message.delta', timestamp: '2026-09-04T14:00:00.000Z', delta: 'Hello' };
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }); });
  } });
  const url = `/api/live/runs/${id}/events`;
  expect((await app.inject(url)).statusCode).toBe(401);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const response = await fetch(address + url, { headers, signal: controller.signal });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toContain('no-store');
  const reader = response.body!.getReader();
  let text = '';
  while (!text.includes('Hello')) text += new TextDecoder().decode((await reader.read()).value);
  expect(text).toContain('event: message.delta');
  controller.abort();
  await reader.cancel().catch(() => undefined);
  await vi.waitFor(() => expect(aborted).toBe(true));
});
