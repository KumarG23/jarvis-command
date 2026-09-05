import { describe, expect, it, vi } from 'vitest';

import { CommandProxyUnavailableError, createCommandProxyClient } from './command-client';

const baseUrl = 'http://127.0.0.1:18643';
const commandProxyKey = 'command-proxy-key-that-is-long-enough-123456';
const sessionId = 'jc_1234567890abcdef1234567890abcdef';
const runId = 'run_1234567890abcdef1234567890abcdef';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Command proxy client', () => {
  it('rejects malformed identifiers at the client boundary before event/status projection', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });
    const timestamp = '2026-09-04T14:00:00Z';
    for (const identity of [' padded', 'padded ', 'id\n', 'a b', 'é', 'x'.repeat(257)]) {
      const approval = { requestId: identity, command: 'echo safe', description: 'Synthetic', tool: null };
      const events = [
        { type: 'approval.responded', requestId: identity, choice: 'once' },
        { type: 'approval.request', approval },
        { type: 'subagent.start', subagentId: identity, goal: '', status: null },
        { type: 'subagent.complete', subagentId: identity, summary: '', status: null },
        { type: 'tool.started', tool: identity, preview: '' },
        { type: 'tool.completed', tool: identity, durationSeconds: 0, error: false },
      ];
      for (const event of events) {
        fetcher.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ runId, timestamp, ...event })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
        await expect(client.streamRunEvents(runId, new AbortController().signal).next(), `${event.type}: ${JSON.stringify(identity)}`).rejects.toEqual(new CommandProxyUnavailableError());
      }
      fetcher.mockResolvedValueOnce(jsonResponse({ runId, sessionId, status: 'waiting_for_approval', updatedAt: timestamp, approval, output: null, error: null, pendingSteer: null, usage: null }));
      await expect(client.getRun(runId)).rejects.toEqual(new CommandProxyUnavailableError());
    }
  });

  it.each(['envelope', 'message', 'mixed', 'limit', 'offset', 'returned', 'over-limit', 'has-more'])('rejects unbound history %s at the client boundary', async (fault) => {
    const other = 'discord_other';
    const message = { id: '1', sessionId, role: 'assistant', content: 'Synthetic room output', timestamp: null, toolName: null, displayKind: null };
    const page = { sessionId, messages: [message, { ...message, id: '2' }], pagination: { limit: 2, offset: 7, returned: 2, hasMore: true } };
    if (fault === 'envelope') page.sessionId = other;
    if (fault === 'message') page.messages = page.messages.map(item => ({ ...item, sessionId: other }));
    if (fault === 'mixed') page.messages[1]!.sessionId = other;
    if (fault === 'limit') page.pagination.limit = 50;
    if (fault === 'offset') page.pagination.offset = 8;
    if (fault === 'returned') page.pagination.returned = 1;
    if (fault === 'over-limit') { page.messages.push({ ...message, id: '3' }); page.pagination.returned = 3; }
    if (fault === 'has-more') page.pagination.hasMore = false;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(page));
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });
    await expect(client.getMessages(sessionId, 2, 7)).rejects.toEqual(new CommandProxyUnavailableError());
  });

  it.each([0, 1, 2])('accepts exactly bound history with %i messages', async (count) => {
    const messages = Array.from({ length: count }, (_, id) => ({ id: String(id), sessionId, role: 'assistant', content: 'Synthetic room output', timestamp: null, toolName: null, displayKind: null }));
    const page = { sessionId, messages, pagination: { limit: 2, offset: 7, returned: count, hasMore: count === 2 } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(page));
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });
    await expect(client.getMessages(sessionId, 2, 7)).resolves.toEqual(page);
  });

  it('cancels and releases abandoned, invalid and overlarge response streams', async () => {
    for (const mode of ['break', 'schema', 'http', 'json-http', 'declared', 'frame']) {
      const cancel = vi.fn();
      let count = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          count++;
          if (mode === 'frame') controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(100000) + '\n'));
          else if (count === 1) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(mode === 'schema' ? { secret: 'private' } : { runId, type: 'run.cancelled', timestamp: '2026-09-04T14:00:00Z' })}\n\n`));
          else if (mode === 'frame' || count > 20) controller.close();
        }, cancel,
      });
      const json = mode === 'json-http' || mode === 'declared';
      const response = new Response(body, { status: mode.includes('http') ? 500 : 200, headers: { 'content-type': json ? 'application/json' : 'text/event-stream', ...(mode === 'declared' ? { 'content-length': '3000000' } : {}) } });
      const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher: vi.fn<typeof fetch>().mockResolvedValueOnce(response) });
      if (json) await expect(client.getRun(runId)).rejects.toEqual(new CommandProxyUnavailableError());
      else if (mode === 'break') { for await (const event of client.streamRunEvents(runId, new AbortController().signal)) { expect(event.runId).toBe(runId); break; } }
      else await expect(client.streamRunEvents(runId, new AbortController().signal).next()).rejects.toEqual(new CommandProxyUnavailableError());
      expect(cancel, mode).toHaveBeenCalled();
      expect(body.locked, mode).toBe(false);
      if (mode === 'frame') expect(count).toBeLessThan(10);
    }
  });

  it('projects interrupted and failed terminal events with generic errors and bound identity', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });
    for (const type of ['run.interrupted', 'run.failed']) {
      fetcher.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ runId, type, timestamp: '2026-09-04T14:00:00Z', error: 'Bearer private-credential' })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
      const events = [];
      for await (const event of client.streamRunEvents(runId, new AbortController().signal)) events.push(event);
      expect(events).toEqual([{ runId, type, timestamp: '2026-09-04T14:00:00Z', error: 'Hermes run unavailable' }]);
    }
    fetcher.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ runId: 'run_' + 'b'.repeat(32), type: 'run.cancelled', timestamp: '2026-09-04T14:00:00Z' })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    await expect(client.streamRunEvents(runId, new AbortController().signal).next()).rejects.toEqual(new CommandProxyUnavailableError());
    fetcher.mockResolvedValueOnce(jsonResponse({ runId, sessionId, status: 'failed', updatedAt: '2026-09-04T14:00:00Z', approval: null, output: null, error: 'Bearer private-credential', pendingSteer: null, usage: null }));
    expect((await client.getRun(runId)).error).toBe('Hermes run unavailable');
  });

  it('rejects mismatched run identity and approval acknowledgements', async () => {
    const other = 'run_' + 'b'.repeat(32);
    const fetcher = vi.fn<typeof fetch>();
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });
    const cases: [unknown, () => Promise<unknown>][] = [
      [{ runId: other, sessionId, status: 'failed', updatedAt: '2026-09-04T14:00:00Z', approval: null, output: null, error: null, pendingSteer: null, usage: null }, () => client.getRun(runId)],
      [{ runId: other, status: 'stopping' }, () => client.stopRun(runId)],
      [{ runId: other, accepted: true }, () => client.steerRun(runId, { input: 'hello' })],
      ...[{ runId: other }, { requestId: 'other' }, { choice: 'once' }].map(change => [{ runId, requestId: 'a', choice: 'deny', resolved: 1, ...change }, () => client.approveRun(runId, { requestId: 'a', choice: 'deny' })] as [unknown, () => Promise<unknown>]),
      [{ runId, sessionId: 'jc_' + 'b'.repeat(32), status: 'queued', replayed: false }, () => client.startRun({ sessionId, input: 'hello', idempotencyKey: 'hello' })],
    ];
    for (const [body, call] of cases) {
      fetcher.mockResolvedValueOnce(jsonResponse(body));
      await expect(call()).rejects.toEqual(new CommandProxyUnavailableError());
    }
  });

  it('reads durable readiness through the exact authenticated bridge contract', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ ready: true, durableIdempotency: true, retentionSeconds: 86400, externalContinue: false }));
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });
    await expect(client.readReadiness()).resolves.toEqual({ ready: true, idempotencyRetentionSeconds: 86400 });
    expect(fetcher.mock.calls[0]![0]).toBe(`${baseUrl}/_ready`);
    fetcher.mockResolvedValueOnce(jsonResponse({ ready: true, durableIdempotency: false, retentionSeconds: 86400, externalContinue: false }));
    await expect(client.readReadiness()).rejects.toEqual(new CommandProxyUnavailableError());
  });
  it('sends the server-only credential and exact idempotent run body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      runId,
      sessionId,
      status: 'queued',
      replayed: false,
    }, 202));
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });

    await expect(client.startRun({
      sessionId,
      input: 'Check health.',
      idempotencyKey: `jc-v1-${'a'.repeat(64)}`,
    })).resolves.toEqual({ runId, sessionId, status: 'queued', replayed: false });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${baseUrl}/v1/runs`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.parse(String(init?.body))).toEqual({ sessionId, input: 'Check health.' });
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${commandProxyKey}`);
    expect(headers.get('idempotency-key')).toBe(`jc-v1-${'a'.repeat(64)}`);
  });

  it('projects session history and session mutations through exact routes', async () => {
    const session = {
      id: sessionId,
      title: 'Live Room',
      source: 'jarvis-command',
      ownership: 'command',
      model: 'gpt-5.6-sol',
      lastActive: '2026-09-04T14:00:00.000Z',
      messageCount: 1,
      toolCallCount: 0,
      pinned: false,
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        sessionId,
        messages: [],
        pagination: { limit: 50, offset: 0, returned: 0, hasMore: false },
      }))
      .mockResolvedValueOnce(jsonResponse({ session }, 201))
      .mockResolvedValueOnce(jsonResponse({ session }, 201));
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });

    await expect(client.getMessages(sessionId, 50, 0)).resolves.toMatchObject({ sessionId });
    await expect(client.createSession({ title: 'Live Room' })).resolves.toEqual({ session });
    await expect(client.continueSession('discord_123', { title: 'Mission' })).resolves.toEqual({ session });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${baseUrl}/api/sessions/${sessionId}/messages?limit=50&offset=0`,
      `${baseUrl}/api/sessions`,
      `${baseUrl}/api/sessions/discord_123/fork`,
    ]);
  });

  it('parses a chunked typed event stream and rejects internal extra fields', async () => {
    const valid = `data: ${JSON.stringify({
      runId,
      type: 'tool.started',
      timestamp: '2026-09-04T14:00:01.000Z',
      tool: 'terminal',
      preview: 'Check health',
    })}\n\n`;
    const chunks = [valid.slice(0, 17), valid.slice(17)];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(next));
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });
    const events = [];

    for await (const event of client.streamRunEvents(runId, new AbortController().signal)) {
      events.push(event);
    }

    expect(events).toEqual([{
      runId,
      type: 'tool.started',
      timestamp: '2026-09-04T14:00:01.000Z',
      tool: 'terminal',
      preview: 'Check health',
    }]);
  });

  it('forwards exact approval, steer, and stop payloads', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ runId, requestId: 'approval-1', choice: 'deny', resolved: 1 }))
      .mockResolvedValueOnce(jsonResponse({ runId, accepted: true }))
      .mockResolvedValueOnce(jsonResponse({ runId, status: 'stopping' }));
    const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });

    await client.approveRun(runId, { requestId: 'approval-1', choice: 'deny' });
    await client.steerRun(runId, { input: 'Take the read-only path.' });
    await client.stopRun(runId);

    expect(fetcher.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
      [`${baseUrl}/v1/runs/${runId}/approval`, { requestId: 'approval-1', choice: 'deny' }],
      [`${baseUrl}/v1/runs/${runId}/steer`, { input: 'Take the read-only path.' }],
      [`${baseUrl}/v1/runs/${runId}/stop`, {}],
    ]);
  });

  it('normalizes upstream bodies, transport failures, and schema drift to one sanitized error', async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: 'Bearer upstream-secret' }, 500)),
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ runId, unexpected: 'upstream-secret' })),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED with secret')),
    ]) {
      const client = createCommandProxyClient({ baseUrl, commandProxyKey, fetcher });
      await expect(client.getRun(runId)).rejects.toEqual(new CommandProxyUnavailableError());
    }
  });
});
