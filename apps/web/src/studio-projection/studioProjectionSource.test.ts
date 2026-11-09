import { describe, expect, it } from 'vitest';

import { ProjectionTooLarge, readBoundedText } from './studioProjectionSource';

describe('readBoundedText', () => {
  it('reads a body inside the bound', async () => {
    expect(await readBoundedText(new Response('{"a":1}'), 100)).toBe('{"a":1}');
  });
  it('rejects a declared length over the bound without reading', async () => {
    const response = new Response('x', { headers: { 'content-length': '5000' } });
    await expect(readBoundedText(response, 100)).rejects.toBeInstanceOf(ProjectionTooLarge);
  });
  it('stops a streamed body that outgrows the bound even with no content-length', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(40)); if (pulled > 50) controller.close(); } });
    await expect(readBoundedText(new Response(stream), 100)).rejects.toBeInstanceOf(ProjectionTooLarge);
    expect(pulled).toBeLessThan(10);
  });
});
