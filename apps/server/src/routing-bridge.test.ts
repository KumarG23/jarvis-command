import type * as RoutingWriteState from './routing-write-state';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { InferenceOptionsResponse, InferenceOverride, ProjectRoom, RoutingDefaultTarget } from '@jarvis-command/contracts';
import { AuditLedger } from './audit-ledger';
import { createLiveRoomService } from './live-room-service';
import type { CommandProxyClient } from './command-client';
import { ReactionStore } from './reaction-store';
import { ProjectRoomStore } from './project-room-store';
import { buildApp } from './app';
import { loadConfig } from './config';
// Historical PR153 disabled bridge fixture, isolated from the active writer suite.
// Preserve the unavailable guard and recovery assertions for compatible rollback.
vi.mock('./routing-write-state', async importOriginal => {
  const original = await importOriginal<typeof RoutingWriteState>();
  return { ...original, ROUTING_WRITES_AVAILABLE: false, requireRoutingWrites: () => { throw new original.RoutingWritesUnavailableError(); } };
});
const sessionId = 'jc_' + 'a'.repeat(32), projectId = 'room_' + 'b'.repeat(32);
const a: InferenceOverride = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'low' };
const b: InferenceOverride = { ...a, model: 'gpt-6-sol' };
const command: InferenceOverride = { provider: 'openrouter', model: 'fixture/model:free' };
const thread: RoutingDefaultTarget = { scope: 'thread', sessionId, projectId };
const project: RoutingDefaultTarget = { scope: 'project', projectId };
const actor = createHash('sha256').update('alice').digest('hex');
const open: AuditLedger[] = [];
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(open.splice(0).map(ledger => ledger.close())); });
function inventory(): InferenceOptionsResponse {
  const choices = [a, b, command];
  return { default: { provider: command.provider, model: command.model }, options: choices.map(choice => ({ provider: choice.provider, model: choice.model, label: choice.model, reasoningEfforts: choice.provider === 'openai-codex' ? ['low', 'high'] : [] })) as InferenceOptionsResponse['options'], catalog: { entries: choices.map(choice => ({ provider: choice.provider, model: choice.model, advertised: true, authenticated: true, eligible: true, selectable: true, unavailableReason: null })), advertisedCount: 3, returned: 3, truncated: false } };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'command-routing-SYNTHETIC-')); await chmod(directory, 0o700);
  const path = join(directory, 'audit.jsonl'); let ledger = await AuditLedger.open(path, { now: () => new Date('2026-11-09T18:45:00Z') }); open.push(ledger);
  const rooms = new ProjectRoomStore(directory);
  const room: ProjectRoom = { id: projectId, name: 'SYNTHETIC route scope', goal: 'Synthetic only', instructions: '', archived: false, repository: '', notes: [], sessionIds: [sessionId], lastSessionId: sessionId };
  await rooms.update(() => [room]);
  const options = inventory();
  const getSession = vi.fn().mockResolvedValue({ session: { id: sessionId, title: 'SYNTHETIC owned', source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-11-09T15:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false } });
  const getInferenceOptions = vi.fn(async () => structuredClone(options));
  const startRun = vi.fn().mockResolvedValue({ runId: 'run_' + 'c'.repeat(32), sessionId, status: 'running', replayed: false });
  const getRun = vi.fn().mockResolvedValue({ runId: 'run_' + 'c'.repeat(32), sessionId, status: 'running', updatedAt: '2026-11-09T15:00:00Z', approval: null, output: '', error: null, pendingSteer: null, usage: null });
  const client = { getSession, getInferenceOptions, startRun, getRun } as unknown as CommandProxyClient;
  const resolveImages = vi.fn().mockResolvedValue([{ mime: 'image/png', bytes: Buffer.from('SYNTHETIC image') }]);
  let service = createLiveRoomService({ ledger, client, rooms, resolveImages, now: () => new Date('2026-11-09T18:45:00Z') });
  return { path, directory, rooms, room, options, getSession, getInferenceOptions, startRun, getRun, resolveImages,
    client, get ledger() { return ledger; }, get service() { return service; },
    async restart() { await ledger.close(); open.splice(open.indexOf(ledger), 1); ledger = await AuditLedger.open(path, { now: () => new Date('2026-11-09T18:45:00Z') }); open.push(ledger); service = createLiveRoomService({ ledger, client, rooms: new ProjectRoomStore(directory), resolveImages, now: () => new Date('2026-11-09T18:45:00Z') }); },
    set(selection: InferenceOverride | null, target = thread, expectedRevision = 0, clientRequestId = randomUUID(), subject = 'alice') { return service.setRoutingDefault(subject, { selection, target, expectedRevision, clientRequestId }); },
  };
}
const request = () => ({ sessionId, clientRequestId: randomUUID(), input: 'SYNTHETIC secret prompt never in ledger', routing: { mode: 'defaults' as const, projectId } });

// Seed through the PR151 ledger writer, then close/reopen actual persisted bytes.
// Only the synthetic fixture writer bypasses the production service guard.
async function persisted(mode: 'pending' | 'accepted') {
  const f = await fixture();
  const id = randomUUID();
  await f.ledger.setRoutingDefault(actor, { target: thread, selection: a, expectedRevision: 0, clientRequestId: id });
  const req = request();
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  };
  const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
  const common = { actor, sessionId, publicRunId: 'jcr_' + 'd'.repeat(32), clientRequestId: req.clientRequestId, requestFingerprint: hash({ inference: JSON.stringify(a), images: '', input: req.input, sessionId }), requestId: null, choice: null };
  await f.ledger.appendOnce(`request:${actor}:${req.clientRequestId}`, { ...common, action: 'run.requested', upstreamRunId: null, status: 'queued', outcome: 'requested', routing: { envelopeFingerprint: hash({ inference: '', images: '', input: req.input, sessionId, routing: JSON.stringify(req.routing) }), inference: a, source: 'thread', projectId, threadRevision: 1, projectRevision: 0 } });
  // Later default edits must never re-resolve the original frozen choice or receipt.
  await f.ledger.setRoutingDefault(actor, { target: thread, selection: b, expectedRevision: 1, clientRequestId: randomUUID() });
  if (mode === 'accepted') await f.ledger.appendOnce(`started:${common.publicRunId}`, { ...common, action: 'run.started', upstreamRunId: 'run_' + 'c'.repeat(32), status: 'running', outcome: 'succeeded' });
  await f.restart();
  return { f, req, id, common };
}

it('historical disabled bridge fixture returns typed unavailable before new writes, reaction/image claims or upstream admission', async () => {
  const f = await fixture(), reactions = new ReactionStore(f.directory);
  const forSend = vi.spyOn(reactions, 'forSend');
  const service = createLiveRoomService({ ledger: f.ledger, client: f.client, rooms: f.rooms, reactions, reactionsEnabled: true, resolveImages: f.resolveImages });
  const config = loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'cloudflare', CF_ACCESS_TEAM_DOMAIN: 'synthetic.cloudflareaccess.com', CF_ACCESS_AUD: 'a'.repeat(64), CF_ACCESS_EMAIL_SHA256: 'b'.repeat(64), CF_ACCESS_JWKS_FILE: join(f.directory, 'synthetic-jwks.json'), HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: f.path });
  const app = buildApp({ config, hermes: { readSnapshot: vi.fn() }, liveRoom: service, verifyAccess: async () => ({ subject: 'alice', provider: 'cloudflare-access' as const }) }); apps.push(app);
  const headers = { 'cf-access-jwt-assertion': 'synthetic', origin: 'https://command.example', 'x-jarvis-command': '1' };
  const before = await readFile(f.path), metadata = await readFile(join(f.directory, 'project-rooms.json'));
  for (const [url, payload] of [
    ['/api/live/routing-defaults/set', { target: thread, selection: a, expectedRevision: 0, clientRequestId: randomUUID() }],
    ['/api/live/routing-defaults/set', { target: project, selection: null, expectedRevision: 0, clientRequestId: randomUUID() }],
    ['/api/live/runs', { ...request(), images: [{ artifactId: 'art_' + 'e'.repeat(32), version: 1 }] }],
  ] as const) {
    const response = await app.inject({ method: 'POST', url, headers, payload });
    expect(response.statusCode).toBe(503); expect(response.json()).toMatchObject({ error: 'routing_writes_unavailable' });
  }
  const read = await app.inject({ method: 'POST', url: '/api/live/routing-defaults/read', headers, payload: thread });
  expect(read.statusCode).toBe(200); expect(read.headers['cache-control']).toBe('no-store'); expect(read.json()).toMatchObject({ revision: 0, writesAvailable: false });
  expect(await readFile(f.path)).toEqual(before); expect(await readFile(join(f.directory, 'project-rooms.json'))).toEqual(metadata);
  expect(forSend).not.toHaveBeenCalled(); expect(f.startRun).not.toHaveBeenCalled(); expect(f.resolveImages).not.toHaveBeenCalled(); expect(f.getInferenceOptions).not.toHaveBeenCalled();
});

it.each(['pending', 'accepted'] as const)('preserves persisted %s frozen identity, readback and immutable default replay across bridge restarts', async mode => {
  const { f, req, id, common } = await persisted(mode);
  const before = await readFile(f.path);
  expect(await f.service.readRoutingDefault('alice', thread)).toMatchObject({ revision: 2, selection: b, writesAvailable: false });
  expect(await f.service.readRoutingDefault('bob', thread)).toMatchObject({ revision: 0, selection: null, writesAvailable: false });
  expect(await f.set(a, thread, 0, id)).toMatchObject({ revision: 1, selection: a, replayed: true, writesAvailable: false });
  await expect(f.set(b, thread, 0, id)).rejects.toMatchObject({ statusCode: 409 });
  await expect(f.set(null, thread, 2)).rejects.toMatchObject({ statusCode: 503 });
  await expect(f.service.submitRun('alice', { ...req, input: 'changed' })).rejects.toMatchObject({ statusCode: 409 });
  expect(await readFile(f.path)).toEqual(before);
  // Synthetic upstream models an already executed pending admission with a lost ACK.
  const expectedKey = `jc-v1-${createHash('sha256').update(`${actor}\0${req.clientRequestId}`).digest('hex')}`;
  const executions = new Set([expectedKey]);
  f.startRun.mockImplementation(async (payload: { idempotencyKey: string }) => {
    executions.add(payload.idempotencyKey);
    return { runId: 'run_' + 'c'.repeat(32), sessionId, status: 'running', replayed: true };
  });
  if (mode === 'accepted') f.getInferenceOptions.mockRejectedValue(Error('inventory unavailable'));
  const result = await f.service.submitRun('alice', req);
  expect(result).toMatchObject({ publicRunId: common.publicRunId, clientRequestId: req.clientRequestId, replayed: true });
  expect(f.startRun).toHaveBeenCalledTimes(mode === 'pending' ? 1 : 0);
  if (mode === 'pending') expect(f.startRun).toHaveBeenCalledWith({ sessionId, input: req.input, inference: a, idempotencyKey: expectedKey });
  expect(executions.size).toBe(1);
  expect((await readFile(f.path)).subarray(0, before.length)).toEqual(before);
  const recovered = await readFile(f.path);
  await f.restart(); await f.service.submitRun('alice', req);
  expect(await readFile(f.path)).toEqual(recovered); expect(f.startRun).toHaveBeenCalledTimes(mode === 'pending' ? 1 : 0);
  expect((await readFile(f.path, 'utf8'))).not.toContain(req.input);
});

it.each(['removed-route', 'removed-membership', 'external', 'expired'] as const)('refuses persisted pending %s without fallback or losing its identity', async failure => {
  const { f, req, common } = await persisted('pending'); const before = await readFile(f.path);
  if (failure === 'removed-route') f.options.options = f.options.options.filter(option => option.model !== a.model);
  if (failure === 'removed-membership') await f.rooms.update(rooms => rooms.map(room => ({ ...room, sessionIds: [], lastSessionId: null })));
  if (failure === 'external') f.getSession.mockResolvedValue({ session: { ...(await f.getSession()).session, ownership: 'external' } });
  const service = failure === 'expired' ? createLiveRoomService({ ledger: f.ledger, client: f.client, rooms: f.rooms, now: () => new Date('2026-11-10T17:45:00Z') }) : f.service;
  await expect(service.submitRun('alice', req)).rejects.toThrow();
  expect(await readFile(f.path)).toEqual(before); expect(f.startRun).not.toHaveBeenCalled();
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)).toMatchObject({ publicRunId: common.publicRunId, upstreamRunId: null, routing: { inference: a } });
});

it.each(['pending', 'accepted'] as const)('continues real pre-change %s ledger envelopes unchanged in the historical disabled bridge fixture', async mode => {
  const f = await fixture(); await f.ledger.close();
  const bytes = await readFile(new URL('./fixtures/routing-legacy-f37537d.jsonl', import.meta.url), 'utf8');
  const prefix = mode === 'pending' ? bytes.split('\n')[0] + '\n' : bytes;
  await writeFile(f.path, prefix); await f.restart();
  const req = { sessionId, input: 'SYNTHETIC pre-default envelope', clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e' };
  expect((await f.service.submitRun('alice', req)).replayed).toBe(true);
  expect((await readFile(f.path, 'utf8')).startsWith(prefix)).toBe(true);
  expect(f.startRun).toHaveBeenCalledTimes(mode === 'pending' ? 1 : 0);
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)).not.toHaveProperty('routing');
  if (mode === 'pending') expect(f.startRun.mock.calls[0]![0]).not.toHaveProperty('inference');
});

it('preserves new legacy admissions without applying saved defaults in bridge state', async () => {
  const { f } = await persisted('accepted');
  f.getRun.mockResolvedValue({ ...(await f.getRun()), status: 'completed' });
  f.startRun.mockResolvedValue({ runId: 'run_' + 'e'.repeat(32), sessionId, status: 'running', replayed: false });
  const req = { sessionId, clientRequestId: randomUUID(), input: 'SYNTHETIC legacy' };
  await f.service.submitRun('alice', req);
  expect(f.startRun.mock.calls[0]![0]).not.toHaveProperty('inference');
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)).not.toHaveProperty('routing');
});
