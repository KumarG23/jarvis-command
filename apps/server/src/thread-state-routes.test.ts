import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import type { createLiveRoomService } from './live-room-service';
it('uses existing actor authorization and mutation guards, strict target schemas and no admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jc-read-route-'));
  const id = 'jc_' + 'a'.repeat(32);
  const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(root, 'audit.jsonl') });
  const headers = { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example', 'x-jarvis-command': '1', 'content-type': 'application/json' };
  const getSession = vi.fn(async (actor: string) => { expect(actor).toBe('verified-actor'); return { session: { id, ownership: 'command' } }; });
  const submitRun = vi.fn();
  const liveRoom = { getSession, submitRun, getRosterStatus: vi.fn(async () => ({ status: 'unknown', runUpdatedAt: null })), getMessages: vi.fn(async () => ({ sessionId: id, messages: [{ id: 'm:1', sessionId: id, role: 'assistant', content: 'test', timestamp: null, toolName: null, displayKind: null }], pagination: { limit: 100, offset: 0, returned: 1, hasMore: false } })) } as unknown as ReturnType<typeof createLiveRoomService>;
  const app = buildApp({ config, liveRoom, hermes: { readSnapshot: vi.fn() }, verifyAccess: async assertion => { if (assertion !== 'valid') throw Error('denied'); return { subject: 'verified-actor', provider: 'cloudflare-access' as const }; } });
  try {
    const url = `/api/live/sessions/${id}/read`;
    const payload = { messageId: 'm:1', position: 0 };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://other.example' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...payload, actor: 'spoof' } })).statusCode).toBe(400);
    expect(getSession).not.toHaveBeenCalled();
    const before = await app.inject({ url: `/api/live/sessions/${id}/thread-state`, headers });
    expect(before.statusCode).toBe(200); expect(before.json().unread).toBe(true); expect(before.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'POST', url, headers, payload })).json().unread).toBe(false);
    getSession.mockRejectedValueOnce(Object.assign(Error('denied'), { statusCode: 403 }));
    expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(403);
    expect(submitRun).not.toHaveBeenCalled();
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
