import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRoom } from '@jarvis-command/contracts';
import { createScheduledRunsServer, projectChat, scheduledInput } from './scheduled-runs';
import { LiveRoomConflictError } from './live-room-service';

const KEY = 'k'.repeat(40);
const OWNER = 'a'.repeat(64);
const ROOM = `room_${'1'.repeat(32)}`;
const LEAD = `jc_${'2'.repeat(32)}`;
const OTHER = `jc_${'3'.repeat(32)}`;
const ID = '6f1c1b8e-3d2a-4c55-9a3e-0b1c2d3e4f50';

const room = (overrides: Partial<ProjectRoom> = {}) => ({
  id: ROOM, name: 'Homelab', sessionIds: [LEAD, OTHER], lastSessionId: OTHER, leadSessionId: LEAD, archived: false, ...overrides,
}) as unknown as ProjectRoom;

function setup(options: { rooms?: ProjectRoom[]; submit?: ReturnType<typeof vi.fn>; getRun?: ReturnType<typeof vi.fn> } = {}) {
  const submitRun = options.submit ?? vi.fn(async (_subject: unknown, request: { sessionId: string; clientRequestId: string }) => ({
    publicRunId: `jcr_${'4'.repeat(32)}`, sessionId: request.sessionId, status: 'queued', replayed: false, clientRequestId: request.clientRequestId,
  }));
  const getRun = options.getRun ?? vi.fn(async () => ({ status: 'completed' }));
  const logs: Array<Record<string, unknown>> = [];
  const app = createScheduledRunsServer({
    config: { host: '127.0.0.1', port: 0, key: KEY, ownerActor: OWNER },
    liveRoom: () => ({ submitRun, getRun }) as never,
    rooms: () => ({ list: async () => options.rooms ?? [room()] }),
    pollMs: 5, watchMs: 1_000,
    log: fields => { logs.push(fields); },
  });
  return { app, submitRun, getRun, logs };
}

const auth = { authorization: `Bearer ${KEY}` };
const body = { id: ID, target: { projectId: ROOM }, prompt: 'Check disk usage on all servers and report anything over 80%.', label: 'Disk check' };

describe('scheduled runs', () => {
  let app: ReturnType<typeof setup>['app'] | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('refuses a missing or wrong key', async () => {
    const ctx = setup(); app = ctx.app;
    expect((await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: body })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: body, headers: { authorization: `Bearer ${'x'.repeat(40)}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/scheduled-runs/targets' })).statusCode).toBe(401);
    expect(ctx.submitRun).not.toHaveBeenCalled();
  });

  it('starts a run in the project lead chat as the configured owner', async () => {
    const ctx = setup(); app = ctx.app;
    const response = await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: body, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ projectId: ROOM, sessionId: LEAD, status: 'queued', replayed: false });
    expect(ctx.submitRun).toHaveBeenCalledWith({ actor: OWNER }, {
      sessionId: LEAD, clientRequestId: ID, input: scheduledInput(body), routing: { mode: 'defaults', projectId: ROOM },
    });
    // The server-side watcher polls until the run is terminal, which drives inbox and push.
    await vi.waitFor(() => expect(ctx.getRun).toHaveBeenCalledWith({ actor: OWNER }, `jcr_${'4'.repeat(32)}`));
    expect(JSON.stringify(ctx.logs)).not.toContain('disk');
  });

  it('accepts an explicit chat in a project and refuses chats outside projects', async () => {
    const ctx = setup(); app = ctx.app;
    const ok = await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: { ...body, target: { sessionId: OTHER } }, headers: auth });
    expect(ok.json()).toMatchObject({ sessionId: OTHER, projectId: ROOM });
    const missing = await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: { ...body, target: { sessionId: `jc_${'9'.repeat(32)}` } }, headers: auth });
    expect(missing.statusCode).toBe(404);
  });

  it('falls back to the latest chat and skips archived projects', async () => {
    const noLead = setup({ rooms: [room({ leadSessionId: null })] }); app = noLead.app;
    expect((await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: body, headers: auth })).json()).toMatchObject({ sessionId: OTHER });
    await app.close();
    const archived = setup({ rooms: [room({ archived: true })] }); app = archived.app;
    expect((await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: body, headers: auth })).statusCode).toBe(404);
  });

  it('rejects malformed requests and maps conflicts', async () => {
    const submit = vi.fn(async () => { throw new LiveRoomConflictError(); });
    const ctx = setup({ submit }); app = ctx.app;
    expect((await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: { ...body, id: 'nope' }, headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: { ...body, label: 'a\nb' }, headers: auth })).statusCode).toBe(400);
    const conflict = await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: body, headers: auth });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'conflict' });
  });

  it('lists targets', async () => {
    const ctx = setup({ rooms: [room(), room({ id: `room_${'5'.repeat(32)}`, archived: true })] }); app = ctx.app;
    const response = await app.inject({ method: 'GET', url: '/v1/scheduled-runs/targets', headers: auth });
    expect(response.json()).toEqual({ targets: [{ projectId: ROOM, name: 'Homelab', sessionId: LEAD }] });
  });

  it('formats the chat input and picks the project chat', () => {
    expect(scheduledInput({ prompt: 'Hi', label: undefined })).toBe('[Scheduled task]\n\nHi');
    expect(projectChat(room({ leadSessionId: null, lastSessionId: null }))).toBeNull();
  });
});
