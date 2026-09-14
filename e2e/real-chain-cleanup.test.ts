import { expect, it } from 'vitest';
import { startRealChain } from './real-chain.fixture';

it('closes a denied run with an open upstream SSE without waiting for stream expiry', async () => {
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
    const denied = await fetch(chain.origin + `/api/live/runs/${publicRunId}/approval`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'synthetic-approval-exact', choice: 'deny' }) });
    expect(denied.status).toBe(200);
    await denied.arrayBuffer();
    expect(chain.controls).toHaveLength(1);
    // Deliberately leave the client and upstream stream open during teardown.
    await chain.close();
    closed = true;
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    if (!closed) await chain.close();
  }
}, 10_000);
