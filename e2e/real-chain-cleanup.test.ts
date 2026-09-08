import { once } from 'node:events';
import { createConnection } from 'node:net';
import { expect, it } from 'vitest';
import { startRealChain } from './real-chain.fixture';

it.each(['open stream', 'aborted stream and probe'] as const)('closes a denied run with %s without waiting for stream expiry', async lifecycle => {
  const chain = await startRealChain('controls');
  const controller = new AbortController();
  const headers = { 'cf-access-jwt-assertion': chain.assertion, origin: chain.origin, 'content-type': 'application/json', 'x-jarvis-command': '1' };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closed = false;
  try {
    const admitted = await fetch(chain.origin + '/api/live/runs', { method: 'POST', headers, body: JSON.stringify({ sessionId: chain.seedId, input: chain.prompt, clientRequestId: '12345678-1234-4234-8234-123456789abc' }) });
    expect(admitted.status).toBe(200);
    const { publicRunId } = await admitted.json();
    const stream = await fetch(chain.origin + `/api/live/runs/${publicRunId}/events`, { headers, signal: controller.signal });
    expect(stream.status).toBe(200);
    reader = stream.body!.getReader();
    let received = '';
    while (!received.includes('approval.request')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Stream ended before approval');
      received += new TextDecoder().decode(chunk.value);
    }
    if (lifecycle === 'aborted stream and probe') {
      const probeController = new AbortController();
      let probeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const probe = await fetch(chain.origin + `/api/live/runs/${publicRunId}/events`, { headers, signal: probeController.signal });
        expect(probe.status).toBe(200);
        probeReader = probe.body!.getReader();
        let probed = '';
        while (!probed.includes('approval.request')) {
          const chunk = await probeReader.read();
          if (chunk.done) throw new Error('Probe ended before approval');
          probed += new TextDecoder().decode(chunk.value);
        }
      } finally {
        probeController.abort();
        await probeReader?.cancel().catch(() => {});
        probeReader?.releaseLock();
      }
      expect(chain.count('GET', `/v1/runs/${chain.runId}/events`)).toBe(2);
    }
    const denied = await fetch(chain.origin + `/api/live/runs/${publicRunId}/approval`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'synthetic-approval-exact', choice: 'deny' }) });
    expect(denied.status).toBe(200);
    await denied.arrayBuffer();
    expect(chain.controls).toHaveLength(1);
    if (lifecycle === 'aborted stream and probe') {
      controller.abort();
      await reader.cancel().catch(() => {});
      // Match the browser's authoritative readback after it closes EventSource.
      const status = await fetch(chain.origin + `/api/live/runs/${publicRunId}`, { headers });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ status: 'running', approval: null });
    }
    // The first case deliberately leaves the client/upstream stream open.
    await chain.close();
    closed = true;
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    if (!closed) await chain.close();
  }
}, 10_000);

it('closes an unused upstream replacement socket without waiting for an HTTP request', async () => {
  const chain = await startRealChain('controls');
  const upstream = new URL(chain.upstreamOrigin);
  // Model the zero-byte pool replacement observed after the browser SSE probe
  // aborts. Unlike a request/response, this socket never enters the streams set.
  const socket = createConnection({ host: upstream.hostname, port: Number(upstream.port) });
  let closing: Promise<void> | undefined;
  try {
    await once(socket, 'connect');
    expect(socket.bytesWritten).toBe(0);
    let closed = false;
    closing = chain.close().then(() => { closed = true; });
    await expect.poll(() => closed, { timeout: 1_000 }).toBe(true);
    await closing;
    await expect.poll(() => socket.destroyed).toBe(true);
  } finally {
    // On regression, release the socket only AFTER the failed assertion so the
    // test reports the cleanup bug without leaking its own stalled close task.
    socket.destroy();
    await (closing ?? chain.close());
  }
}, 10_000);
