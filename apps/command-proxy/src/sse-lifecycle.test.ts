import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { buildCommandProxy } from './app';
import type { CommandProxyConfig } from './config';

const runId = 'run_1234567890abcdef1234567890abcdef';
const config: CommandProxyConfig = {
  host: '127.0.0.1', port: 8644,
  commandProxyKey: 'command-proxy-key-that-is-long-enough-123456',
  hermesBaseUrl: 'http://127.0.0.1:8642',
  hermesApiKey: 'hermes-api-key-that-is-long-enough-12345678',
  maxStreamSeconds: 1800,
};
const encode = (text: string) => new TextEncoder().encode(text);
async function until(check: () => boolean, milliseconds = 500) {
  const deadline = Date.now() + milliseconds;
  while (!check() && Date.now() < deadline) await delay(5);
  expect(check()).toBe(true);
}
async function connect(app: ReturnType<typeof buildCommandProxy>) {
  if (!app.server.listening) await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return await new Promise<IncomingMessage>((resolve, reject) => {
    get(`http://127.0.0.1:${address.port}/v1/runs/${runId}/events`, {
      agent: false, headers: { authorization: `Bearer ${config.commandProxyKey}` },
    }, resolve).on('error', reject);
  });
}
function idleSource(cancel = vi.fn<() => void | Promise<void>>(() => undefined)) {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { source = c; }, cancel });
  return { body, cancel, finish() { try { source.close(); } catch { /* already cancelled */ } } };
}
async function cleanup(app: ReturnType<typeof buildCommandProxy>, response: IncomingMessage, finish: () => void) {
  response.destroy();
  finish();
  app.server.closeAllConnections();
  await app.close();
}

describe('SSE real socket lifecycle', () => {
  it('keeps a default quiet proxy stream alive beyond the 10-second connection timeout', async () => {
    const source = idleSource();
    const app = buildCommandProxy({ config, fetcher: async () => new Response(source.body, { headers: { 'content-type': 'text/event-stream' } }) });
    const response = await connect(app);
    let closed = false;
    response.on('error', () => {}); response.on('close', () => { closed = true; }); response.resume();
    try { await delay(15_300); expect(closed).toBe(false); expect(source.cancel).not.toHaveBeenCalled(); }
    finally { await cleanup(app, response, source.finish); }
  }, 20_000);

  it('disconnect closes the real upstream Node HTTP response', async () => {
    let upstreamResponse: ServerResponse | undefined;
    let upstreamClosed = false;
    const upstream = createServer((_request, response) => {
      upstreamResponse = response;
      response.on('close', () => { upstreamClosed = true; });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Missing upstream address');
    const app = buildCommandProxy({ config: { ...config, hermesBaseUrl: `http://127.0.0.1:${address.port}` } });
    const response = await connect(app);
    try {
      response.destroy();
      await until(() => upstreamClosed);
    } finally {
      await cleanup(app, response, () => upstreamResponse?.destroy());
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  });
  it('keeps the four-stream cap and reclaims a disconnected slot', async () => {
    const sources: ReturnType<typeof idleSource>[] = [];
    const app = buildCommandProxy({ config, fetcher: async () => {
      const source = idleSource(); sources.push(source);
      return new Response(source.body, { headers: { 'content-type': 'text/event-stream' } });
    } });
    const responses: IncomingMessage[] = [];
    try {
      for (let i = 0; i < 4; i++) responses.push(await connect(app));
      const rejected = await connect(app); responses.push(rejected); rejected.resume();
      expect(rejected.statusCode).toBe(429);
      expect(sources).toHaveLength(4);
      responses[0]!.destroy();
      await until(() => sources[0]!.cancel.mock.calls.length === 1);
      const replacement = await connect(app); responses.push(replacement);
      expect(replacement.statusCode).toBe(200);
      expect(sources).toHaveLength(5);
    } finally {
      for (const response of responses) response.destroy();
      for (const source of sources) source.finish();
      app.server.closeAllConnections(); await app.close();
    }
  });
  it('app.close does not wait for a paused socket to drain', async () => {
    const cancel = vi.fn();
    const chunk = encode(`data: ${JSON.stringify({ event: 'message.delta', run_id: runId, timestamp: 1788530400, delta: 'x'.repeat(32768) })}\n\n`);
    const body = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(chunk); }, cancel });
    const app = buildCommandProxy({ config, fetcher: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) });
    const response = await connect(app);
    response.pause();
    await delay(100);
    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    try {
      await until(() => closed);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    } finally { await cleanup(app, response, () => {}); await closing; }
  });
  it('lifetime ends an ignored-signal fetch and cancels its late response body', async () => {
    const source = idleSource();
    let resolve!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    const app = buildCommandProxy({ config: { ...config, maxStreamSeconds: 0.05 }, fetcher: async (_url, init) => {
      signal = init?.signal;
      return await new Promise<Response>(r => { resolve = r; });
    } });
    const connection = connect(app);
    let response: IncomingMessage | undefined;
    void connection.then(r => { response = r; r.resume(); });
    try {
      await until(() => response !== undefined);
      expect(response!.statusCode).toBe(503);
      expect(signal?.aborted).toBe(true);
      resolve(new Response(source.body, { headers: { 'content-type': 'text/event-stream' } }));
      await until(() => source.cancel.mock.calls.length === 1);
    } finally {
      resolve(new Response(null, { headers: { 'content-type': 'text/event-stream' } }));
      source.finish();
      await cleanup(app, await connection, source.finish);
    }
  });
  it('lifetime closes an idle stream whose source ignores abort and never settles cancel', async () => {
    const source = idleSource(vi.fn(() => new Promise<void>(() => {})));
    const app = buildCommandProxy({ config: { ...config, maxStreamSeconds: 0.05 }, fetcher: async () => new Response(source.body, { headers: { 'content-type': 'text/event-stream' } }) });
    const response = await connect(app);
    let ended = false;
    response.on('end', () => { ended = true; });
    response.resume();
    try {
      await until(() => ended);
      expect(source.cancel).toHaveBeenCalledTimes(1);
      expect(source.body.locked).toBe(false);
    } finally { await cleanup(app, response, source.finish); }
  });
  it.each(['http', 'media'])('cancels rejected %s SSE bodies without awaiting cancellation', async (mode) => {
    const source = idleSource(vi.fn(() => new Promise<void>(() => {})));
    const app = buildCommandProxy({ config, fetcher: async () => new Response(source.body, {
      status: mode === 'http' ? 500 : 200,
      headers: { 'content-type': mode === 'media' ? 'application/json' : 'text/event-stream', 'x-private': 'secret' },
    }) });
    const response = await connect(app);
    response.resume();
    try {
      expect(response.statusCode).toBe(503);
      expect(response.headers['x-private']).toBeUndefined();
      await until(() => source.cancel.mock.calls.length === 1);
      expect(source.body.locked).toBe(false);
    } finally { await cleanup(app, response, source.finish); }
  });
  it('rejects accumulated multiline data before a frame delimiter arrives', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    let finish!: () => void;
    let signal: AbortSignal | null | undefined;
    const body = new ReadableStream<Uint8Array>({ start(c) { finish = () => { try { c.close(); } catch { /* Cancellation may already have closed the synthetic source. */ } }; }, pull(c) {
      if (++pulls <= 9) c.enqueue(encode(`data: ${'x'.repeat(65536)}\n`));
    }, cancel });
    const app = buildCommandProxy({ config, fetcher: async (_url, init) => {
      signal = init?.signal;
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    } });
    const response = await connect(app);
    response.resume();
    try {
      await until(() => cancel.mock.calls.length === 1);
      expect(signal?.aborted).toBe(true);
      expect(body.locked).toBe(false);
      expect(pulls).toBeLessThanOrEqual(10);
    } finally { await cleanup(app, response, finish); }
  });
  it('pausing a real downstream socket bounds upstream pulling until drain', async () => {
    let pulls = 0;
    const chunk = encode(`data: ${JSON.stringify({ event: 'message.delta', run_id: runId, timestamp: 1788530400, delta: 'x'.repeat(32768) })}\n\n`);
    const body = new ReadableStream<Uint8Array>({ pull(c) {
      pulls += 1;
      if (pulls <= 700) c.enqueue(chunk); else c.close();
    } });
    const app = buildCommandProxy({ config, fetcher: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) });
    const response = await connect(app);
    try {
      response.pause();
      await delay(150);
      const stoppedAt = pulls;
      expect(stoppedAt).toBeLessThan(200);
      await delay(100);
      expect(pulls).toBe(stoppedAt);
      response.resume();
      await until(() => pulls === 701, 2000);
    } finally { await cleanup(app, response, () => {}); }
  });
  it('app.close ends connected streams even when source cancellation never settles', async () => {
    const source = idleSource(vi.fn(() => new Promise<void>(() => {})));
    let signal: AbortSignal | null | undefined;
    const app = buildCommandProxy({ config, fetcher: async (_url, init) => {
      signal = init?.signal;
      return new Response(source.body, { headers: { 'content-type': 'text/event-stream' } });
    } });
    const response = await connect(app);
    response.resume();
    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    try {
      await until(() => closed);
      expect(signal?.aborted).toBe(true);
      expect(source.cancel).toHaveBeenCalledTimes(1);
      expect(source.body.locked).toBe(false);
    } finally { await cleanup(app, response, source.finish); await closing; }
  });
  it('downstream socket disconnect aborts upstream and cancels an idle Web stream', async () => {
    const source = idleSource();
    let signal: AbortSignal | null | undefined;
    const app = buildCommandProxy({ config, fetcher: async (_url, init) => {
      signal = init?.signal;
      return new Response(source.body, { headers: { 'content-type': 'text/event-stream' } });
    } });
    const response = await connect(app);
    try {
      expect(signal?.aborted).toBe(false);
      response.destroy();
      await until(() => signal?.aborted === true);
      await until(() => source.cancel.mock.calls.length === 1);
      await until(() => !source.body.locked);
    } finally { await cleanup(app, response, source.finish); }
  });
});
