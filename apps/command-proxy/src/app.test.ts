import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCommandProxy } from './app';
import type { CommandProxyConfig } from './config';

const commandKey = 'command-proxy-key-that-is-long-enough-123456';
const hermesKey = 'hermes-api-key-that-is-long-enough-12345678';
const commandSessionId = 'jc_1234567890abcdef1234567890abcdef';
const externalSessionId = 'discord_1234567890';
const runId = 'run_1234567890abcdef1234567890abcdef';

const config: CommandProxyConfig = Object.freeze({
  host: '127.0.0.1',
  port: 8644,
  commandProxyKey: commandKey,
  hermesBaseUrl: 'http://127.0.0.1:8642',
  hermesApiKey: hermesKey,
  maxStreamSeconds: 1_800,
});

const apps: ReturnType<typeof buildCommandProxy>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp(fetcher: typeof fetch, randomUUID = () => '12345678-90ab-cdef-1234-567890abcdef') {
  const app = buildCommandProxy({
    config,
    fetcher,
    randomUUID,
    now: () => new Date('2026-09-04T14:00:00.000Z'),
  });
  apps.push(app);
  return app;
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${commandKey}`,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function upstreamSession(id: string, source: string) {
  return {
    object: 'hermes.session',
    session: {
      id,
      source,
      title: source === 'jarvis-command' ? 'Live Room' : 'Discord thread',
      model: 'gpt-5.6-sol',
      last_active: 1_788_530_400,
      message_count: 2,
      tool_call_count: 1,
      pinned: false,
    },
  };
}

describe('command proxy route boundary', () => {
  it.each(['漢'.repeat(16_000), '\u0000'.repeat(16_000)])('accepts worst-case encoded input within the character cap', async (input) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(upstreamSession(commandSessionId, 'jarvis-command'))).mockResolvedValueOnce(jsonResponse({ run_id: runId, status: 'running' }));
    const app = createApp(fetcher);
    const response = await app.inject({ method: 'POST', url: '/v1/runs', headers: authHeaders({ 'idempotency-key': 'jc-v1-' + 'a'.repeat(64) }), payload: { sessionId: commandSessionId, input } });
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body)).input).toBe(input);
  });

  it('cancels and releases rejected upstream JSON bodies', async () => {
    for (const mode of ['http', 'declared', 'oversize']) {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ start(c) { if (mode === 'oversize') c.enqueue(new Uint8Array(2097153)); }, cancel });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(body, { status: mode === 'http' ? 500 : 200, headers: { 'content-type': 'application/json', ...(mode === 'declared' ? { 'content-length': '3000000' } : {}) } }));
      const app = createApp(fetcher);
      expect((await app.inject({ url: `/v1/runs/${runId}`, headers: authHeaders() })).statusCode).toBe(503);
      expect(cancel, mode).toHaveBeenCalled();
      expect(body.locked, mode).toBe(false);
    }
  });

  it('rejects shared credentials and sanitizes parser and unexpected query failures', async () => {
    expect(() => buildCommandProxy({ config: { ...config, commandProxyKey: hermesKey } })).toThrow('Command proxy credentials must be distinct');
    const fetcher = vi.fn<typeof fetch>();
    const app = createApp(fetcher);
    for (const url of ['/_ready?secret=private', `/v1/runs/${runId}?secret=private`, `/api/sessions/${commandSessionId}/messages?limit=oops`, `/api/sessions/${commandSessionId}/messages?limit=1&limit=2`]) {
      const response = await app.inject({ url, headers: authHeaders() });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
    }
    const response = await app.inject({ method: 'POST', url: '/api/sessions', headers: authHeaders({ 'content-type': 'application/json' }), payload: '{"private-credential"' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never exposes raw failed or interrupted errors in status or events', async () => {
    for (const event of ['run.failed', 'run.interrupted']) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ event, run_id: runId, timestamp: 1788530400, error: 'Bearer private-credential' })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
      const app = createApp(fetcher);
      const response = await app.inject({ url: `/v1/runs/${runId}/events`, headers: authHeaders() });
      expect(response.payload).toContain(`"type":"${event}"`);
      expect(response.payload).toContain('Hermes run unavailable');
      expect(response.payload).not.toContain('private-credential');
      fetcher.mockResolvedValueOnce(jsonResponse({ run_id: runId, session_id: commandSessionId, status: 'failed', updated_at: 1788530400, error: 'private-credential' }));
      expect((await app.inject({ url: `/v1/runs/${runId}`, headers: authHeaders() })).json().error).toBe('Hermes run unavailable');
    }
  });

  it('rejects upstream identity substitution across status, controls, creation and fork', async () => {
    const other = 'run_' + 'b'.repeat(32);
    const cases = [
      { method: 'GET' as const, url: `/v1/runs/${runId}`, body: { run_id: other, session_id: commandSessionId, status: 'running', updated_at: 1788530400 } },
      { method: 'POST' as const, url: `/v1/runs/${runId}/stop`, payload: {}, body: { run_id: other, status: 'stopping' } },
      { method: 'POST' as const, url: `/v1/runs/${runId}/steer`, payload: { input: 'hello' }, body: { run_id: other, accepted: true } },
      ...[{ run_id: other }, { request_id: 'other' }, { choice: 'once' }].map(change => ({ method: 'POST' as const, url: `/v1/runs/${runId}/approval`, payload: { requestId: 'a', choice: 'deny' }, body: { run_id: runId, request_id: 'a', choice: 'deny', resolved: 1, ...change } })),
      ...['discord', 'jarvis-command'].map(source => ({ method: 'POST' as const, url: '/api/sessions', payload: {}, body: upstreamSession(source === 'discord' ? commandSessionId : 'jc_' + 'b'.repeat(32), source) })),
      { method: 'POST' as const, url: `/api/sessions/${commandSessionId}/fork`, payload: {}, body: upstreamSession(commandSessionId, 'discord'), fork: true },
    ];
    for (const test of cases) {
      const fetcher = vi.fn<typeof fetch>();
      if ('fork' in test) fetcher.mockResolvedValueOnce(jsonResponse(upstreamSession(commandSessionId, 'jarvis-command')));
      fetcher.mockResolvedValueOnce(jsonResponse(test.body));
      const app = createApp(fetcher);
      const response = await app.inject({ method: test.method, url: test.url, headers: authHeaders(), ...('payload' in test ? { payload: test.payload } : {}) });
      expect(response.statusCode, test.url + JSON.stringify(test.body)).toBe(503);
      expect(response.json()).toEqual({ error: 'upstream_unavailable' });
    }
  });
  it('exposes only an anonymous health route plus authenticated exact routes', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = createApp(fetcher);

    expect((await app.inject({ method: 'GET', url: '/_health' })).json()).toEqual({
      status: 'ok',
      service: 'jarvis-command-command-proxy',
    });
    expect((await app.inject({ method: 'GET', url: `/api/sessions/${commandSessionId}/messages` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/sessions/${commandSessionId}/messages`, headers: authHeaders() })).statusCode).not.toBe(401);
    expect((await app.inject({ method: 'HEAD', url: '/_health' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/models', headers: authHeaders() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${commandSessionId}/messages`, headers: authHeaders({ 'content-type': 'application/json' }), payload: {} })).statusCode).toBe(404);
  });

  it('uses constant-time bearer comparison semantics and rejects malformed authorization', async () => {
    const app = createApp(vi.fn<typeof fetch>());

    for (const authorization of [
      'Basic nope',
      'Bearer short',
      `Bearer ${commandKey}x`,
      `bearer ${commandKey}`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/sessions/${commandSessionId}/messages`,
        headers: { authorization },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    }
  });
});

describe('session projection and ownership', () => {
  it.each([' padded', 'padded ', 'id\n', 'a b', 'é', 9007199254740992, 1.5])('rejects noncanonical message identity %j', async (id) => {
    const body = { session_id: commandSessionId, data: [{ id, session_id: commandSessionId, role: 'assistant', content: 'Synthetic' }], pagination: { limit: 1, offset: 0, returned: 1, order: 'oldest' } };
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(body)));
    try {
      expect((await app.inject({ url: `/api/sessions/${commandSessionId}/messages?limit=1&offset=0`, headers: authHeaders() })).statusCode).toBe(503);
    } finally { await app.close(); }
  });

  it('rejects oversized message identities instead of collapsing them', async () => {
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      session_id: externalSessionId,
      data: ['a', 'b'].map(suffix => ({ id: 'm'.repeat(160) + suffix, session_id: externalSessionId, role: 'assistant', content: 'Synthetic room output' })),
      pagination: { limit: 2, offset: 7, returned: 2, order: 'oldest' },
    })));
    const response = await app.inject({ url: `/api/sessions/${externalSessionId}/messages?limit=2&offset=7`, headers: authHeaders() });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'upstream_unavailable' });
  });

  it.each([undefined, null, 'newest', 'latest', 'OLDEST'])('rejects missing or contradictory upstream history order %s', async (order) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      session_id: externalSessionId,
      data: [{ id: 1, session_id: externalSessionId, role: 'assistant', content: 'Synthetic room output' }],
      pagination: { limit: 2, offset: 7, returned: 1, order },
    }));
    const app = createApp(fetcher);
    const response = await app.inject({ url: `/api/sessions/${externalSessionId}/messages?limit=2&offset=7`, headers: authHeaders() });
    expect(String(fetcher.mock.calls[0]![0])).toContain('&order=oldest');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'upstream_unavailable' });
  });

  it.each(['envelope', 'message', 'mixed', 'message-suffix', 'limit', 'offset', 'returned', 'over-limit'])('rejects unbound history %s before projection', async (fault) => {
    const message = { id: 1, session_id: externalSessionId, role: 'assistant', content: 'Synthetic room output' };
    const page = {
      session_id: externalSessionId,
      data: [message, { ...message, id: 2 }],
      pagination: { limit: 2, offset: 7, returned: 2, order: 'oldest' },
    };
    if (fault === 'envelope') page.session_id = commandSessionId;
    if (fault === 'message') page.data = page.data.map(item => ({ ...item, session_id: commandSessionId }));
    if (fault === 'mixed') page.data[1]!.session_id = commandSessionId;
    if (fault === 'message-suffix') page.data[1]!.session_id = externalSessionId + ' '.repeat(160);
    if (fault === 'limit') page.pagination.limit = 50;
    if (fault === 'offset') page.pagination.offset = 8;
    if (fault === 'returned') page.pagination.returned = 1;
    if (fault === 'over-limit') { page.data.push({ ...message, id: 3 }); page.pagination.returned = 3; }
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(page)));
    const response = await app.inject({ url: `/api/sessions/${externalSessionId}/messages?limit=2&offset=7`, headers: authHeaders() });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'upstream_unavailable' });
  });

  it.each([0, 1, 2])('preserves correctly bound history and pagination with %i messages', async (count) => {
    const data = Array.from({ length: count }, (_, id) => ({ id, session_id: externalSessionId, role: 'assistant', content: 'Synthetic room output' }));
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      session_id: externalSessionId, data, pagination: { limit: 2, offset: 7, returned: count, order: 'oldest' },
    })));
    const response = await app.inject({ url: `/api/sessions/${externalSessionId}/messages?limit=2&offset=7`, headers: authHeaders() });
    expect(response.statusCode).toBe(200);
    expect(response.json().pagination).toEqual({ limit: 2, offset: 7, returned: count, hasMore: count === 2 });
    expect(response.json().messages).toHaveLength(count);
  });

  it('creates a generated command-owned session while ignoring client control of id/source', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(upstreamSession(commandSessionId, 'jarvis-command'), 201));
    const app = createApp(fetcher);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders({ 'content-type': 'application/json' }),
      payload: { title: 'Live Room' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      session: {
        id: commandSessionId,
        title: 'Live Room',
        source: 'jarvis-command',
        ownership: 'command',
        model: 'gpt-5.6-sol',
        lastActive: '2026-09-04T14:00:00.000Z',
        messageCount: 2,
        toolCallCount: 1,
        pinned: false,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8642/api/sessions');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.parse(String(init?.body))).toEqual({
      id: commandSessionId,
      source: 'jarvis-command',
      title: 'Live Room',
    });
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${hermesKey}`);
  });

  it('forks a verified command-owned session into a generated mission', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(upstreamSession('jc_' + 'b'.repeat(32), 'jarvis-command')))
      .mockResolvedValueOnce(jsonResponse(upstreamSession(commandSessionId, 'api_server'), 201));
    const app = createApp(fetcher);

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${'jc_' + 'b'.repeat(32)}/fork`,
      headers: authHeaders({ 'content-type': 'application/json' }),
      payload: { title: 'Discord thread — Command mission' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().session).toMatchObject({
      id: commandSessionId,
      ownership: 'command',
      source: 'api_server',
    });
    const [url, init] = fetcher.mock.calls[1]!;
    expect(url).toBe(`http://127.0.0.1:8642/api/sessions/${'jc_' + 'b'.repeat(32)}/fork`);
    expect(JSON.parse(String(init?.body))).toEqual({
      id: commandSessionId,
      title: 'Discord thread — Command mission',
    });
  });

  it('projects bounded paginated history and strips reasoning and tool arguments', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      object: 'list',
      session_id: externalSessionId,
      data: [{
        id: 42,
        session_id: externalSessionId,
        role: 'assistant',
        content: 'Safe output',
        timestamp: 1_788_530_400,
        tool_name: null,
        display_kind: 'message',
        reasoning: 'must not cross',
        tool_calls: [{ function: { arguments: '{"token":"nope"}' } }],
      }],
      pagination: { limit: 50, offset: 0, order: 'oldest', returned: 1 },
    }));
    const app = createApp(fetcher);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${externalSessionId}/messages?limit=50&offset=0`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      sessionId: externalSessionId,
      messages: [{
        id: '42',
        sessionId: externalSessionId,
        role: 'assistant',
        content: 'Safe output',
        timestamp: '2026-09-04T14:00:00.000Z',
        toolName: null,
        displayKind: 'message',
      }],
      pagination: { limit: 50, offset: 0, returned: 1, hasMore: false },
    });
    expect(JSON.stringify(body)).not.toContain('reasoning');
    expect(JSON.stringify(body)).not.toContain('tool_calls');
    expect(fetcher.mock.calls[0]![0]).toBe(`http://127.0.0.1:8642/api/sessions/${externalSessionId}/messages?limit=50&offset=0&order=oldest`);
  });
});

describe('run creation and control', () => {
  it('verifies command ownership then forwards one exact idempotent run request', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(upstreamSession(commandSessionId, 'jarvis-command')))
      .mockResolvedValueOnce(jsonResponse({ run_id: runId, status: 'started', replayed: false }, 202));
    const app = createApp(fetcher);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: authHeaders({
        'content-type': 'application/json',
        'idempotency-key': 'jc-turn-1234567890abcdef',
      }),
      payload: { sessionId: commandSessionId, input: 'Check the service.' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      runId,
      sessionId: commandSessionId,
      status: 'queued',
      replayed: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1]!;
    expect(url).toBe('http://127.0.0.1:8642/v1/runs');
    expect(JSON.parse(String(init?.body))).toEqual({
      session_id: commandSessionId,
      input: 'Check the service.',
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toBe('jc-turn-1234567890abcdef');
    expect(headers.get('authorization')).toBe(`Bearer ${hermesKey}`);
  });

  it('rejects a run for an external or forged session before mutation', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(upstreamSession(externalSessionId, 'discord')))
      .mockResolvedValueOnce(jsonResponse(upstreamSession(commandSessionId, 'discord')));
    const app = createApp(fetcher);

    for (const sessionId of [externalSessionId, commandSessionId]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: authHeaders({
          'content-type': 'application/json',
          'idempotency-key': 'jc-turn-1234567890abcdef',
        }),
        payload: { sessionId, input: 'Do not run.' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'session_read_only' });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('requires a visible bounded idempotency key', async () => {
    const app = createApp(vi.fn<typeof fetch>());
    for (const idempotencyKey of ['', 'has a space', 'x'.repeat(256)]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: authHeaders({
          'content-type': 'application/json',
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        }),
        payload: { sessionId: commandSessionId, input: 'Nope.' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('permits only exact once or deny approval responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      object: 'hermes.run.approval_response',
      run_id: runId,
      request_id: 'approval-1',
      choice: 'once',
      resolved: 1,
    }));
    const app = createApp(fetcher);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/runs/${runId}/approval`,
      headers: authHeaders({ 'content-type': 'application/json' }),
      payload: { requestId: 'approval-1', choice: 'once' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ runId, requestId: 'approval-1', choice: 'once', resolved: 1 });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({
      request_id: 'approval-1',
      choice: 'once',
    });

    for (const choice of ['session', 'always', 'approve']) {
      const denied = await app.inject({
        method: 'POST',
        url: `/v1/runs/${runId}/approval`,
        headers: authHeaders({ 'content-type': 'application/json' }),
        payload: { requestId: 'approval-1', choice },
      });
      expect(denied.statusCode).toBe(400);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('forwards bounded steer and stop controls without extra fields', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ object: 'hermes.run.steer', run_id: runId, accepted: true }))
      .mockResolvedValueOnce(jsonResponse({ run_id: runId, status: 'stopping' }));
    const app = createApp(fetcher);

    const steer = await app.inject({
      method: 'POST',
      url: `/v1/runs/${runId}/steer`,
      headers: authHeaders({ 'content-type': 'application/json' }),
      payload: { input: 'Use the read-only route.' },
    });
    const stop = await app.inject({
      method: 'POST',
      url: `/v1/runs/${runId}/stop`,
      headers: authHeaders({ 'content-type': 'application/json' }),
      payload: {},
    });

    expect(steer.json()).toEqual({ runId, accepted: true });
    expect(stop.json()).toEqual({ runId, status: 'stopping' });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ input: 'Use the read-only route.' });
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({});
  });
});

describe('run status and event projection', () => {
  it.each([
    ['tool.started', 'preview'],
    ['subagent.start', 'goal'],
    ['subagent.complete', 'summary'],
  ])('omits quoted credentials in %s metadata without losing subsequent typed events', async (type, field) => {
    const values = [
      'API_KEY="SYNTHETIC_QUOTED_SECRET" curl /exact-target',
      "password='SYNTHETIC_SINGLE_QUOTED_SECRET' exact-target",
      'Bearer "SYNTHETIC_BEARER_SECRET" exact-target',
      '"api_key": "SYNTHETIC_JSON_SECRET"',
      "'secret': 'SYNTHETIC_JSON_SECRET'",
    ];
    const events = values.map(value => ({ event: type, run_id: runId, timestamp: 1788530400, tool: 'terminal', subagent_id: 'child', [field]: value }));
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(new Response([
      ...events, { event: 'run.completed', run_id: runId, timestamp: 1788530401, output: 'Safe completion' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })));
    const response = await app.inject({ url: `/v1/runs/${runId}/events`, headers: authHeaders() });
    expect(response.statusCode).toBe(200);
    expect(response.payload).not.toContain('SYNTHETIC_');
    const projected = response.payload.trim().split('\n\n').map(frame => JSON.parse(frame.slice(6)));
    expect(projected).toHaveLength(values.length + 1);
    for (const event of projected.slice(0, -1)) expect(event).toMatchObject({ type, [field]: '[Metadata omitted]' });
    expect(projected.at(-1)).toMatchObject({ type: 'run.completed', output: 'Safe completion' });
  });

  it.each([
    ['tool.started', 'preview', 'preview', 2_048],
    ['subagent.start', 'goal', 'goal', 2_048],
    ['subagent.start', 'preview', 'goal', 2_048],
    ['subagent.complete', 'summary', 'summary', 4_096],
    ['subagent.complete', 'preview', 'summary', 4_096],
  ] as const)('fails closed on ambiguous or oversized %s %s metadata before truncation', async (type, inputField, outputField, maximum) => {
    const omitted = '[Metadata omitted]';
    const cases: [unknown, string][] = [
      [String.raw`\"token\": \"SYNTHETIC_ESCAPED_KEY\"`, omitted],
      ['token=abc\nSYNTHETIC_CONTINUATION', omitted],
      ['Bearer abc\r\nSYNTHETIC_CONTINUATION', omitted],
      ['token=\nSYNTHETIC_NEWLINE', omitted],
      ['token="SYNTHETIC_UNCLOSED', omitted],
      ["secret='SYNTHETIC_MISMATCH\"", omitted],
      [String.raw`password="SYNTHETIC_ESCAPED\" more"`, omitted],
      [String.raw`token=SYNTHETIC_ESCAPED\ value`, omitted],
      ['token=SYNTHETIC_OPERATOR;touch /exact-target', omitted],
      ['token=$(SYNTHETIC_SUBSTITUTION)', omitted],
      ['token="SYNTHETIC_MULTI\nLINE"', omitted],
      ['Bearer\nSYNTHETIC_BEARER', omitted],
      ['token=', omitted],
      ['safe '.repeat(maximum), omitted],
      [' '.repeat(maximum - 8) + 'token=x"SYNTHETIC_CUT', omitted],
      ['token=x '.repeat(Math.floor(maximum / 8)), omitted],
      ['token=' + 'SYNTHETIC_LONG'.repeat(maximum), omitted],
      ['token=x Bearer q password=z secret=v API-KEY=k ; inspect /exact-target', 'token=[REDACTED] Bearer [REDACTED] password=[REDACTED] secret=[REDACTED] API-KEY=[REDACTED] ; inspect /exact-target'],
      ['Check "healthy" status\nNo changes', 'Check "healthy" status\nNo changes'],
      ['safe'.padEnd(maximum, '.'), 'safe'.padEnd(maximum, '.')],
      ['token=abcdefghij '.padEnd(maximum, '.'), 'token=[REDACTED] '.padEnd(maximum, '.')],
      [undefined, ''],
      [42, ''],
    ];
    const events = cases.map(([value]) => ({ event: type, run_id: runId, timestamp: 1788530400, tool: 'terminal', subagent_id: 'child', [inputField]: value }));
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(new Response([
      ...events, { event: 'tool.completed', run_id: runId, timestamp: 1788530401, tool: 'terminal', duration: 1 },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })));
    const response = await app.inject({ url: `/v1/runs/${runId}/events`, headers: authHeaders() });
    expect(response.statusCode).toBe(200);
    const projected = response.payload.trim().split('\n\n').map(frame => JSON.parse(frame.slice(6)));
    expect(projected.slice(0, -1).map(event => event[outputField])).toEqual(cases.map(([, expected]) => expected));
    expect(response.payload).not.toContain('SYNTHETIC_');
    expect(projected.at(-1)).toMatchObject({ type: 'tool.completed', tool: 'terminal' });
  });

  it('rejects malformed sibling event identities instead of clipping, trimming or inventing them', async () => {
    for (const type of ['tool.started', 'tool.completed', 'subagent.start', 'subagent.complete']) {
      const field = type.startsWith('tool.') ? 'tool' : 'subagent_id';
      for (const identity of ['x'.repeat(161), ' padded', 'padded ', 'id\n', '', undefined]) {
        const event = { event: type, run_id: runId, timestamp: '2026-09-04T14:00:00Z', [field]: identity };
        const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })));
        try {
          const response = await app.inject({ url: `/v1/runs/${runId}/events`, headers: authHeaders() });
          expect(response.payload, `${type}: ${JSON.stringify(identity)}`).toContain('stream_unavailable');
          expect(response.payload).not.toContain(`"type":"${type}"`);
        } finally { await app.close(); }
      }
    }
  });

  it('preserves exact-limit event identities and the supported child-session alias', async () => {
    for (const type of ['tool.started', 'tool.completed', 'subagent.start', 'subagent.complete']) {
      const field = type.startsWith('tool.') ? 'tool' : 'child_session_id';
      const identity = 'x'.repeat(160);
      const event = { event: type, run_id: runId, timestamp: '2026-09-04T14:00:00Z', [field]: identity };
      const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })));
      try {
        const response = await app.inject({ url: `/v1/runs/${runId}/events`, headers: authHeaders() });
        expect(JSON.parse(response.payload.slice(6))).toMatchObject({ type, [type.startsWith('tool.') ? 'tool' : 'subagentId']: identity });
      } finally { await app.close(); }
    }
  });

  it.each(['x'.repeat(161), ' padded', 'padded ', 'id\n'])('refuses malformed upstream status session identities %j', async (sessionId) => {
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ run_id: runId, session_id: sessionId, status: 'running', updated_at: '2026-09-04T14:00:00Z' })));
    try {
      const response = await app.inject({ url: `/v1/runs/${runId}`, headers: authHeaders() });
      expect(response.statusCode).toBe(503);
    } finally { await app.close(); }
  });

  it.each(['a'.repeat(257), ' approval', 'approval ', 'approval\n', 'a b', 'é', ''])('refuses invalid approval responded identities without normalization: %j', async (requestId) => {
    const event = { event: 'approval.responded', run_id: runId, timestamp: '2026-09-04T14:00:00Z', request_id: requestId, choice: 'once' };
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })));
    const response = await app.inject({ url: `/v1/runs/${runId}/events`, headers: authHeaders() });
    expect(response.payload).toContain('stream_unavailable');
    expect(response.payload).not.toContain('"type":"approval.responded"');
    await app.close();
  });

  it('preserves an exact maximum-length approval response identity', async () => {
    const requestId = 'a'.repeat(256);
    const event = { event: 'approval.responded', run_id: runId, timestamp: '2026-09-04T14:00:00Z', request_id: requestId, choice: 'once' };
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })));
    const response = await app.inject({ url: `/v1/runs/${runId}/events`, headers: authHeaders() });
    expect(JSON.parse(response.payload.slice(6))).toMatchObject({ type: 'approval.responded', requestId });
    await app.close();
  });

  it.each(['status', 'events'])('refuses quoted or shell-active credentials in every approval field via %s', async (transport) => {
    const unsafe = [
      "API_KEY='SYNTHETIC_SECRET'", 'password: "SYNTHETIC_SECRET"',
      "token='SYNTHETIC_SECRET'", 'Bearer "SYNTHETIC_SECRET"',
      '"api_key": "SYNTHETIC_SECRET"', "'secret': 'SYNTHETIC_SECRET'",
      'token=x;touch /SYNTHETIC_TARGET', 'token=x&&touch /SYNTHETIC_TARGET',
      'token=x|touch /SYNTHETIC_TARGET', 'token=x>/SYNTHETIC_TARGET',
      'token=$(touch /SYNTHETIC_TARGET)', 'token=`touch /SYNTHETIC_TARGET`',
      'token=x\\\\;touch /SYNTHETIC_TARGET', 'token="$(touch /SYNTHETIC_TARGET)"',
    ];
    for (const field of ['command', 'description', 'tool']) {
      for (const value of unsafe) {
        const approval = { request_id: 'approval-exact', command: 'echo safe', description: 'Synthetic fixture', tool: 'terminal', [field]: value };
        const upstream = transport === 'status'
          ? jsonResponse({ run_id: runId, session_id: commandSessionId, status: 'waiting_for_approval', updated_at: 1788530400, approval })
          : new Response(`data: ${JSON.stringify({ event: 'approval.request', run_id: runId, timestamp: 1788530400, ...approval })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
        const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(upstream));
        const response = await app.inject({ url: `/v1/runs/${runId}${transport === 'events' ? '/events' : ''}`, headers: authHeaders() });
        if (transport === 'status') expect(response.statusCode, `${field}: ${value}`).toBe(503);
        else expect(response.payload, `${field}: ${value}`).toContain('stream_unavailable');
        expect(response.payload).not.toContain('SYNTHETIC_SECRET');
        expect(response.payload).not.toContain('approval-exact');
      }
    }
  });

  it.each(['status', 'events'])('redacts simple credential tokens while preserving the complete suffix via %s', async (transport) => {
    const suffix = ' ; touch /SYNTHETIC_TARGET';
    for (const prefix of ['token=', 'API_KEY=', 'password: ', 'secret=', 'Bearer ']) {
      const approval = { request_id: 'approval-exact', command: prefix + 'abc_123+/=' + suffix, description: 'Synthetic fixture' };
      const upstream = transport === 'status'
        ? jsonResponse({ run_id: runId, session_id: commandSessionId, status: 'waiting_for_approval', updated_at: 1788530400, approval })
        : new Response(`data: ${JSON.stringify({ event: 'approval.request', run_id: runId, timestamp: 1788530400, ...approval })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(upstream));
      const response = await app.inject({ url: `/v1/runs/${runId}${transport === 'events' ? '/events' : ''}`, headers: authHeaders() });
      expect(response.statusCode).toBe(200);
      const projected = transport === 'status' ? response.json() : JSON.parse(response.payload.slice(6).trim());
      expect(projected.approval.command).toBe(prefix + '[REDACTED]' + suffix);
    }
  });

  it.each(['status', 'events'])('rejects approval redaction expansion without hiding the target via %s', async (transport) => {
    const suffix = '; rm -rf /SYNTHETIC_TARGET';
    const command = 'echo token=x ; '.repeat(200).padEnd(4_096 - suffix.length, ' ') + suffix;
    expect(command).toHaveLength(4_096);
    const approval = { request_id: 'approval-exact', command, description: 'Synthetic display-only fixture' };
    const upstream = transport === 'status'
      ? jsonResponse({ run_id: runId, session_id: commandSessionId, status: 'waiting_for_approval', updated_at: 1788530400, approval })
      : new Response(`data: ${JSON.stringify({ event: 'approval.request', run_id: runId, timestamp: 1788530400, ...approval })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(upstream));
    const response = await app.inject({ url: `/v1/runs/${runId}${transport === 'events' ? '/events' : ''}`, headers: authHeaders() });
    if (transport === 'status') {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'upstream_unavailable' });
    } else {
      expect(response.payload).toContain('stream_unavailable');
      expect(response.payload).not.toContain('approval.request');
    }
    expect(response.payload).not.toContain('approval-exact');
  });

  it.each(['status', 'events'])('preserves the complete redacted approval at the exact limit via %s', async (transport) => {
    const suffix = '; rm -rf /SYNTHETIC_TARGET';
    const expected = 'echo token=[REDACTED] ; '.padEnd(4_096 - suffix.length, ' ') + suffix;
    const command = expected.replace('[REDACTED]', 'x');
    const approval = { request_id: 'approval-exact', command, description: 'Synthetic display-only fixture' };
    const upstream = transport === 'status'
      ? jsonResponse({ run_id: runId, session_id: commandSessionId, status: 'waiting_for_approval', updated_at: 1788530400, approval })
      : new Response(`data: ${JSON.stringify({ event: 'approval.request', run_id: runId, timestamp: 1788530400, ...approval })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(upstream));
    const response = await app.inject({ url: `/v1/runs/${runId}${transport === 'events' ? '/events' : ''}`, headers: authHeaders() });
    expect(response.statusCode).toBe(200);
    const projected = transport === 'status' ? response.json() : JSON.parse(response.payload.slice(6).trim());
    expect(projected.approval).toMatchObject({ requestId: 'approval-exact', command: expected });
    expect(projected.approval.command).toHaveLength(4_096);
  });

  it.each([{ command: 'x'.repeat(4097) }, { request_id: ' approval-1 ' }, { command: undefined }])('refuses truncated approval commands or repaired request identities %#', async (change) => {
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      run_id: runId, session_id: commandSessionId, status: 'waiting_for_approval', updated_at: 1788530400,
      approval: { request_id: 'approval-1', command: 'echo safe', description: 'Visible target', ...change },
    })));
    const response = await app.inject({ url: `/v1/runs/${runId}`, headers: authHeaders() });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'upstream_unavailable' });
  });
  it('projects pollable status without upstream identifiers outside the command boundary', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      run_id: runId,
      session_id: commandSessionId,
      status: 'waiting_for_approval',
      updated_at: 1_788_530_400,
      approval: {
        request_id: 'approval-1',
        command: 'rm [REDACTED]',
        description: 'Delete the disposable canary.',
        pattern_keys: ['rm'],
        allow_session: true,
        allow_permanent: true,
      },
      internal_owner: 'must-not-cross',
    }));
    const app = createApp(fetcher);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runId,
      sessionId: commandSessionId,
      status: 'waiting_for_approval',
      updatedAt: '2026-09-04T14:00:00.000Z',
      approval: {
        requestId: 'approval-1',
        command: 'rm [REDACTED]',
        description: 'Delete the disposable canary.',
        tool: null,
      },
      output: null,
      error: null,
      pendingSteer: null,
      usage: null,
    });
  });

  it('re-emits only bounded typed SSE events and drops reasoning/unknown fields', async () => {
    const sse = [
      ': keepalive',
      '',
      `data: ${JSON.stringify({ event: 'message.delta', run_id: runId, timestamp: 1_788_530_400, delta: 'Checking' })}`,
      '',
      `data: ${JSON.stringify({ event: 'reasoning.available', run_id: runId, timestamp: 1_788_530_400, text: 'private thought' })}`,
      '',
      `data: ${JSON.stringify({ event: 'tool.started', run_id: runId, timestamp: 1_788_530_401, tool: 'terminal', preview: 'Check status', args: { token: 'nope' } })}`,
      '',
      `data: ${JSON.stringify({ event: 'run.completed', run_id: runId, timestamp: 1_788_530_402, output: 'Healthy', usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 }, internal: 'nope' })}`,
      '',
      ': stream closed',
      '',
    ].join('\n');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const app = createApp(fetcher);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}/events`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.payload).toContain(': keepalive');
    expect(response.payload).toContain('"type":"message.delta"');
    expect(response.payload).toContain('"type":"tool.started"');
    expect(response.payload).toContain('"type":"run.completed"');
    expect(response.payload).not.toContain('reasoning');
    expect(response.payload).not.toContain('private thought');
    expect(response.payload).not.toContain('token');
    expect(response.payload).not.toContain('internal');
  });

  it('returns generic bounded errors instead of upstream bodies or headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: 'Bearer secret-upstream-value exploded' },
    }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'x-upstream-debug': 'secret-upstream-value',
      },
    }));
    const app = createApp(fetcher);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'upstream_unavailable' });
    expect(response.payload).not.toContain('secret-upstream-value');
    expect(response.headers['x-upstream-debug']).toBeUndefined();
  });
});

it('never forks a gateway-owned session, including forged jc_ IDs with external source', async () => {
  for (const source of [externalSessionId, commandSessionId]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(upstreamSession(source, 'discord')));
    const app = createApp(fetcher);
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${source}/fork`, headers: authHeaders(), payload: {} });
    expect(response.statusCode).toBe(403);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  }
});
