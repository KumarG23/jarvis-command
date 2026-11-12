import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { RoutingDefaultResponseSchema, type InferenceOptionsResponse, type InferenceOverride, type ProjectRoom, type RoutingDefaultSet, type RoutingDefaultTarget } from '@jarvis-command/contracts';
import { AuditLedger } from './audit-ledger';
import { createLiveRoomService } from './live-room-service';
import type { CommandProxyClient } from './command-client';
import { ReactionStore } from './reaction-store';
import { ProjectRoomStore } from './project-room-store';
import { buildApp } from './app';
import { loadConfig } from './config';
const sessionId = 'jc_' + 'a'.repeat(32), projectId = 'room_' + 'b'.repeat(32);
const a: InferenceOverride = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'low' };
const b: InferenceOverride = { ...a, model: 'gpt-6-sol' };
const command: InferenceOverride = { provider: 'openrouter', model: 'fixture/model:free' };
const thread: RoutingDefaultTarget = { scope: 'thread', sessionId, projectId };
const project: RoutingDefaultTarget = { scope: 'project', projectId };
const actor = createHash('sha256').update('alice').digest('hex');
const fixtureNow = () => new Date('2026-11-09T18:45:00Z');
const open: AuditLedger[] = [];
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(open.splice(0).map(ledger => ledger.close())); });
function inventory(): InferenceOptionsResponse {
  const choices = [a, b, command];
  return { default: { provider: command.provider, model: command.model }, options: choices.map(choice => ({ provider: choice.provider, model: choice.model, label: choice.model, reasoningEfforts: choice.provider === 'openai-codex' ? ['low', 'high'] : [] })) as InferenceOptionsResponse['options'], catalog: { entries: choices.map(choice => ({ provider: choice.provider, model: choice.model, advertised: true, authenticated: true, eligible: true, selectable: true, unavailableReason: null })), advertisedCount: 3, returned: 3, truncated: false } };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'command-routing-SYNTHETIC-')); await chmod(directory, 0o700);
  const path = join(directory, 'audit.jsonl'); let ledger = await AuditLedger.open(path, { now: fixtureNow }); open.push(ledger);
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
  let service = createLiveRoomService({ ledger, client, rooms, resolveImages, now: fixtureNow });
  return { path, directory, rooms, room, options, getSession, getInferenceOptions, startRun, getRun, resolveImages, now: fixtureNow,
    client, get ledger() { return ledger; }, get service() { return service; },
    async restart() { await ledger.close(); open.splice(open.indexOf(ledger), 1); ledger = await AuditLedger.open(path, { now: fixtureNow }); open.push(ledger); service = createLiveRoomService({ ledger, client, rooms: new ProjectRoomStore(directory), resolveImages, now: fixtureNow }); },
    set(selection: InferenceOverride | null, target = thread, expectedRevision = 0, clientRequestId = randomUUID(), subject = 'alice') { return service.setRoutingDefault(subject, { selection, target, expectedRevision, clientRequestId }); },
  };
}
const request = () => ({ sessionId, clientRequestId: randomUUID(), input: 'SYNTHETIC secret prompt never in ledger', routing: { mode: 'defaults' as const, projectId } });

it('persists actor/scope isolated preferences, CAS revisions, replay and clear without sessions/runs or metadata changes', async () => {
  const f = await fixture(), id = randomUUID(), metadata = await readFile(join(f.directory, 'project-rooms.json'));
  expect(RoutingDefaultResponseSchema.parse(await f.service.readRoutingDefault('alice', thread))).toMatchObject({ revision: 0, selection: null, writesAvailable: true });
  expect(await f.set(a, thread, 0, id)).toMatchObject({ revision: 1, selection: a, replayed: false, writesAvailable: true });
  expect(await f.set(a, thread, 0, id)).toMatchObject({ revision: 1, replayed: true });
  await expect(f.set(b, thread, 0, id)).rejects.toMatchObject({ statusCode: 409 });
  await expect(f.set(b)).rejects.toMatchObject({ statusCode: 409 });
  expect(await f.service.readRoutingDefault('bob', thread)).toMatchObject({ revision: 0, selection: null });
  expect(await f.service.readRoutingDefault('alice', project)).toMatchObject({ revision: 0, selection: null });
  await f.restart(); expect(await f.service.readRoutingDefault('alice', thread)).toMatchObject({ revision: 1, selection: a });
  expect(await f.set(null, thread, 1)).toMatchObject({ revision: 2, selection: null, writesAvailable: true });
  expect(await f.set(a, thread, 0, id)).toMatchObject({ revision: 1, replayed: true });
  expect(await f.service.readRoutingDefault('alice', thread)).toMatchObject({ revision: 2, selection: null });
  await f.restart();
  expect(RoutingDefaultResponseSchema.parse(await f.service.readRoutingDefault('alice', thread))).toMatchObject({ revision: 2, selection: null, writesAvailable: true });
  expect(f.startRun).not.toHaveBeenCalled(); expect(await readFile(join(f.directory, 'project-rooms.json'))).toEqual(metadata);
});
it('serializes competing revisions and rejects UUID reuse across targets and run admission', async () => {
  const f = await fixture(); const results = await Promise.allSettled([f.set(a), f.set(b)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const id = randomUUID(); await f.set(a, project, 0, id);
  await expect(f.set(a, thread, 1, id)).rejects.toMatchObject({ statusCode: 409 });
  await expect(f.service.submitRun('alice', { ...request(), clientRequestId: id })).rejects.toMatchObject({ statusCode: 409 });
  expect(f.startRun).not.toHaveBeenCalled();
});
it('keeps different owned threads, projects and actors isolated after writer restart', async () => {
  const f = await fixture(), otherSessionId = 'jc_' + 'd'.repeat(32), otherProjectId = 'room_' + 'e'.repeat(32);
  const owned = (await f.getSession()).session;
  f.getSession.mockImplementation(async (id: string) => ({ session: { ...owned, id } }));
  await f.rooms.update(rooms => [...rooms, { ...f.room, id: otherProjectId, sessionIds: [otherSessionId], lastSessionId: otherSessionId }]);
  const otherThread: RoutingDefaultTarget = { scope: 'thread', sessionId: otherSessionId, projectId: otherProjectId };
  const otherProject: RoutingDefaultTarget = { scope: 'project', projectId: otherProjectId };
  await f.set(a); await f.set(b, project);
  await f.set(b, otherThread); await f.set(a, otherProject);
  await f.set(command, thread, 0, randomUUID(), 'bob');
  await f.restart();
  for (const [subject, target, selection] of [['alice', thread, a], ['alice', project, b], ['alice', otherThread, b], ['alice', otherProject, a], ['bob', thread, command]] as const) {
    expect(await f.service.readRoutingDefault(subject, target)).toMatchObject({ revision: 1, selection, writesAvailable: true });
  }
  expect(await f.service.readRoutingDefault('bob', otherThread)).toMatchObject({ revision: 0, selection: null });
  expect(await f.service.readRoutingDefault('bob', project)).toMatchObject({ revision: 0, selection: null });
  expect(f.startRun).not.toHaveBeenCalled();
});
it.each(['external', 'id-mismatch', 'missing', 'archived-room', 'archived-thread', 'wrong-project', 'unavailable-store'])('denies %s target without any preference or run append', async mode => {
  const f = await fixture(); const before = await readFile(f.path);
  if (mode === 'external') f.getSession.mockResolvedValue({ session: { ...(await f.getSession()).session, ownership: 'external' } });
  if (mode === 'id-mismatch') f.getSession.mockResolvedValue({ session: { ...(await f.getSession()).session, id: 'jc_' + 'd'.repeat(32) } });
  if (mode === 'missing') f.getSession.mockRejectedValue(Error('Unavailable'));
  if (mode === 'archived-room') await f.rooms.update(rooms => rooms.map(room => ({ ...room, archived: true })));
  if (mode === 'archived-thread') await f.rooms.update(rooms => rooms.map(room => ({ ...room, threads: [{ sessionId, title: 'Archived', archived: true, createdAt: '2026-11-09T15:00:00Z' }] })));
  if (mode === 'wrong-project') await f.rooms.update(rooms => rooms.map(room => ({ ...room, sessionIds: [], lastSessionId: null })));
  if (mode === 'unavailable-store') await writeFile(join(f.directory, 'project-rooms.json'), '{invalid');
  await expect(f.set(a)).rejects.toThrow();
  await expect(f.service.readRoutingDefault('alice', thread)).rejects.toThrow();
  await expect(f.service.submitRun('alice', request())).rejects.toThrow();
  expect(await readFile(f.path)).toEqual(before); expect(f.startRun).not.toHaveBeenCalled();
});
it.each(['advertised', 'authenticated', 'eligible', 'selectable', 'removed', 'effort', 'paid'])('fails closed for %s preferences and admission', async mode => {
  const f = await fixture(); await f.set(a);
  if (mode === 'removed') f.options.options = [];
  else if (mode === 'effort') f.options.options[0]!.reasoningEfforts = ['high'];
  else if (mode !== 'paid') f.options.catalog!.entries[0]![mode as 'advertised'] = false;
  const before = await readFile(f.path);
  const invalid = mode === 'paid' ? { provider: 'openrouter', model: 'fixture/model:free-paid' } as InferenceOverride : a;
  await expect(f.set(invalid, project)).rejects.toThrow();
  await expect(f.service.submitRun('alice', { ...request(), ...(mode === 'paid' ? { inference: invalid } : {}) })).rejects.toThrow();
  expect(await readFile(f.path)).toEqual(before); expect(f.startRun).not.toHaveBeenCalled();
});
it.each(['prompt', 'thread', 'project', 'command'])('resolves %s precedence and records requested provenance without executed claims', async source => {
  const f = await fixture();
  if (source !== 'command') await f.set(b, project);
  if (source === 'thread' || source === 'prompt') await f.set(a);
  const req = { ...request(), ...(source === 'prompt' ? { inference: command } : {}) };
  await f.service.submitRun('alice', req);
  const expected = source === 'thread' ? a : source === 'project' ? b : command;
  expect(f.startRun).toHaveBeenCalledWith(expect.objectContaining({ inference: expected }));
  const record = f.ledger.findRunByClientRequest(actor, req.clientRequestId)!;
  expect(record.routing).toMatchObject({ source, inference: expected, projectId }); expect(record.receipt).toBeNull();
  const bytes = await readFile(f.path, 'utf8'); expect(bytes).not.toContain(req.input); expect(bytes.indexOf('run.requested')).toBeLessThan(bytes.indexOf('run.started'));
});
it('cleared thread falls through to project; unknown Command effort fails rather than guessing Inherit', async () => {
  const f = await fixture(); await f.set(a); await f.set(null, thread, 1); await f.set(b, project);
  const req = request(); await f.service.submitRun('alice', req);
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)!.routing).toMatchObject({ source: 'project', threadRevision: 2, inference: b });
  const other = await fixture(); other.options.default = { provider: a.provider, model: a.model };
  // Refused before anything is recorded or sent, so the client is told definitely (422), not "uncertain".
  const refused = request();
  await expect(other.service.submitRun('alice', refused)).rejects.toThrow(/Nothing was sent/); expect(other.startRun).not.toHaveBeenCalled();
  expect(other.ledger.findRunByClientRequest(actor, refused.clientRequestId)).toBeNull();
  // The log reason names exactly why: the Command default route needs an explicit effort.
  await expect(other.service.submitRun('alice', request())).rejects.toMatchObject({ name: 'RoutingRefusedError', reason: 'default_needs_explicit_effort', statusCode: 422 });
  const unauthenticated = await fixture(); unauthenticated.options.catalog!.entries.find(entry => entry.model === command.model)!.authenticated = false;
  await expect(unauthenticated.service.submitRun('alice', request())).rejects.toMatchObject({ reason: 'model_not_authenticated' });
});
it('freezes the pre-edit tuple/revision when a default changes during inventory validation', async () => {
  const f = await fixture(); await f.set(a); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.getInferenceOptions.mockImplementationOnce(async () => { await gate; return inventory(); });
  const req = request(), send = f.service.submitRun('alice', req);
  await vi.waitFor(() => expect(f.getInferenceOptions).toHaveBeenCalledTimes(2));
  await f.set(b, thread, 1); release(); await send;
  expect(f.startRun).toHaveBeenCalledWith(expect.objectContaining({ inference: a }));
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)!.routing).toMatchObject({ threadRevision: 1, inference: a });
});
it('lost ACK + restart reuses frozen choice, UUID, reaction-free fingerprint and image references after defaults change', async () => {
  const f = await fixture(); await f.set(a); const upstream = new Map<string, string>(); let executions = 0;
  f.startRun.mockImplementation(async (payload: { idempotencyKey: string }) => {
    if (!upstream.has(payload.idempotencyKey)) { upstream.set(payload.idempotencyKey, 'run_' + 'c'.repeat(32)); executions++; throw Error('SYNTHETIC ACK lost'); }
    return { runId: upstream.get(payload.idempotencyKey), sessionId, status: 'running', replayed: true };
  });
  const req = { ...request(), images: [{ artifactId: 'art_' + 'e'.repeat(32), version: 1 }] };
  await expect(f.service.submitRun('alice', req)).rejects.toThrow('ACK lost');
  const frozen = f.ledger.findRunByClientRequest(actor, req.clientRequestId)!;
  await f.set(b, thread, 1); await f.restart();
  expect(await f.service.submitRun('alice', req)).toMatchObject({ publicRunId: frozen.publicRunId, clientRequestId: req.clientRequestId, replayed: true });
  expect(executions).toBe(1); expect(f.startRun.mock.calls[0]![0]).toEqual(f.startRun.mock.calls[1]![0]);
  expect(f.resolveImages).toHaveBeenCalledTimes(2);
  await expect(f.service.submitRun('alice', { ...req, input: 'changed' })).rejects.toMatchObject({ statusCode: 409 });
  await expect(f.service.submitRun('bob', req)).rejects.toThrow(); // active session; cannot recover Alice's admission
  const before = await readFile(f.path);
  await f.restart(); f.getInferenceOptions.mockRejectedValue(Error('SYNTHETIC inventory unavailable'));
  expect(await f.service.submitRun('alice', req)).toMatchObject({ publicRunId: frozen.publicRunId, clientRequestId: req.clientRequestId, replayed: true });
  expect(f.startRun).toHaveBeenCalledTimes(2); expect(executions).toBe(1);
  expect(await readFile(f.path)).toEqual(before);
  expect((await readFile(f.path, 'utf8'))).not.toContain(req.input);
});
it('refuses frozen pending route removal after restart instead of re-resolving edited defaults', async () => {
  const f = await fixture(); await f.set(a); f.startRun.mockRejectedValueOnce(Error('ACK lost'));
  const req = request(); await expect(f.service.submitRun('alice', req)).rejects.toThrow();
  await f.set(b, thread, 1); await f.restart(); f.options.options = f.options.options.filter(option => option.model !== a.model);
  await expect(f.service.submitRun('alice', req)).rejects.toThrow(/Routing selection is unavailable/);
  expect(f.startRun).toHaveBeenCalledTimes(1); expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)!.routing!.inference).toEqual(a);
});
it('legacy envelopes keep their fingerprint and recovery meaning across restart with defaults present', async () => {
  const f = await fixture(); const req = { sessionId, clientRequestId: randomUUID(), input: 'SYNTHETIC legacy' };
  f.startRun.mockRejectedValueOnce(Error('ACK lost')); await expect(f.service.submitRun('alice', req)).rejects.toThrow();
  const before = await readFile(f.path); expect(before.toString()).not.toContain('routing');
  await f.set(a); await f.restart(); await f.service.submitRun('alice', req);
  expect(f.startRun.mock.calls[1]![0]).not.toHaveProperty('inference');
  await expect(f.service.submitRun('alice', { ...req, routing: { mode: 'defaults', projectId } })).rejects.toMatchObject({ statusCode: 409 });
});
it('unavailable/tampered ledger cannot save defaults or admit a run', async () => {
  const f = await fixture(); await writeFile(f.path, 'tampered\n');
  await expect(f.set(a)).rejects.toThrow(); await expect(f.service.submitRun('alice', request())).rejects.toThrow(); expect(f.startRun).not.toHaveBeenCalled();
});
it('BFF read/set enforce existing JWT/origin/JSON guards and strict bodies with no admission', async () => {
  const f = await fixture();
  const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: f.path });
  const app = buildApp({ config, hermes: { readSnapshot: vi.fn() }, liveRoom: f.service, verifyAccess: async assertion => { if (assertion !== 'valid') throw Error('denied'); return { subject: 'alice', provider: 'cloudflare-access' as const }; } }); apps.push(app);
  const headers = { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example', 'x-jarvis-command': '1' };
  const payload: RoutingDefaultSet = { target: thread, selection: a, clientRequestId: randomUUID(), expectedRevision: 0 };
  const post = (body: unknown, h = headers, url = '/api/live/routing-defaults/set') => app.inject({ method: 'POST', url, headers: h, payload: body as object });
  expect((await post(payload, { ...headers, 'cf-access-jwt-assertion': 'invalid' })).statusCode).toBe(401);
  expect((await post(payload, { ...headers, origin: 'https://other.invalid' })).statusCode).toBe(403);
  expect((await post({ ...payload, extra: true })).statusCode).toBe(400);
  expect((await post({ ...payload, expectedRevision: -1 })).statusCode).toBe(400);
  const set = await post(payload); expect(set.statusCode).toBe(200);
  expect(RoutingDefaultResponseSchema.parse(set.json())).toMatchObject({ revision: 1, selection: a, writesAvailable: true });
  const read = await post(thread, headers, '/api/live/routing-defaults/read'); expect(read.statusCode).toBe(200); expect(read.headers['cache-control']).toBe('no-store'); expect(RoutingDefaultResponseSchema.parse(read.json())).toMatchObject({ revision: 1, selection: a, writesAvailable: true });
  const clear = await post({ ...payload, selection: null, expectedRevision: 1, clientRequestId: randomUUID() });
  expect(clear.statusCode).toBe(200); expect(RoutingDefaultResponseSchema.parse(clear.json())).toMatchObject({ revision: 2, selection: null, writesAvailable: true });
  const bytes = await readFile(f.path, 'utf8');
  for (const credential of [headers['cf-access-jwt-assertion'], 'r'.repeat(32), 'c'.repeat(32)]) expect(bytes).not.toContain(credential);
  expect(f.startRun).not.toHaveBeenCalled();
});

it.each(['pending', 'accepted'])('replays a real pre-change f37537d %s ledger fixture without rewriting it or applying defaults', async mode => {
  const f = await fixture(); await f.ledger.close();
  const bytes = await readFile(new URL('./fixtures/routing-legacy-f37537d.jsonl', import.meta.url), 'utf8');
  const prefix = mode === 'pending' ? bytes.split('\n')[0] + '\n' : bytes;
  await writeFile(f.path, prefix); await f.restart(); await f.set(a);
  const req = { sessionId, input: 'SYNTHETIC pre-default envelope', clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e' };
  expect((await f.service.submitRun('alice', req)).replayed).toBe(true);
  expect((await readFile(f.path, 'utf8')).startsWith(prefix)).toBe(true);
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)).not.toHaveProperty('routing');
  expect(f.startRun).toHaveBeenCalledTimes(mode === 'pending' ? 1 : 0);
  if (mode === 'pending') expect(f.startRun.mock.calls[0]![0]).not.toHaveProperty('inference');
});
it('freezes reaction claims with resolved inference across lost ACK/restart/default edits', async () => {
  const f = await fixture(), store = new ReactionStore(f.directory);
  await store.mutate(actor, { sessionId, messageId: 'SYNTHETIC-message', offset: 0, emoji: '👍', action: 'add', clientRequestId: randomUUID() }, 'assistant');
  let service = createLiveRoomService({ ledger: f.ledger, client: f.client, rooms: f.rooms, reactions: store, reactionsEnabled: true, now: f.now });
  await f.set(a); f.startRun.mockRejectedValueOnce(Error('ACK lost')); const req = request();
  await expect(service.submitRun('alice', req)).rejects.toThrow();
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)?.requestedAt).toBe(f.now().toISOString());
  await f.set(b, thread, 1); await f.restart();
  service = createLiveRoomService({ ledger: f.ledger, client: f.client, rooms: f.rooms, reactions: new ReactionStore(f.directory), reactionsEnabled: true, now: f.now });
  await service.submitRun('alice', req);
  expect(f.startRun.mock.calls[0]![0]).toEqual(f.startRun.mock.calls[1]![0]);
  expect(f.startRun.mock.calls[1]![0].input).toContain('SYNTHETIC-message');
});
it('conflicting concurrent default/run UUID cannot poison storage or create a second kind of claim', async () => {
  const f = await fixture(), req = request();
  const results = await Promise.allSettled([f.set(a, thread, 0, req.clientRequestId), f.service.submitRun('alice', req)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  await f.ledger.verifyStorage(); await f.restart();
  expect(f.startRun.mock.calls.length).toBeLessThanOrEqual(1);
});
it('revalidates frozen project membership before an image-delayed admission', async () => {
  const f = await fixture(); await f.set(a); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.resolveImages.mockImplementationOnce(async () => { await gate; return [{ mime: 'image/png', bytes: Buffer.from('SYNTHETIC') }]; });
  const req = { ...request(), images: [{ artifactId: 'art_' + 'e'.repeat(32), version: 1 }] }, send = f.service.submitRun('alice', req);
  await vi.waitFor(() => expect(f.resolveImages).toHaveBeenCalledTimes(1));
  await f.rooms.update(rooms => rooms.map(room => ({ ...room, sessionIds: [], lastSessionId: null }))); release();
  await expect(send).rejects.toThrow(); expect(f.startRun).not.toHaveBeenCalled();
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)!.routing!.inference).toEqual(a);
});
it('refuses a freshly removed route after freezing but before any upstream execution', async () => {
  const f = await fixture(); await f.set(a);
  const removed = inventory(); removed.options = removed.options.filter(option => option.model !== a.model);
  f.getInferenceOptions.mockResolvedValueOnce(inventory()).mockResolvedValueOnce(removed);
  const req = request(); await expect(f.service.submitRun('alice', req)).rejects.toThrow(/Routing selection is unavailable/);
  expect(f.startRun).not.toHaveBeenCalled(); expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)!.routing!.inference).toEqual(a);
  await f.set(b, thread, 1); await f.restart(); await f.service.submitRun('alice', req);
  expect(f.startRun).toHaveBeenCalledWith(expect.objectContaining({ inference: a }));
});
it('serializes a held preference change against an admission with the same UUID without poisoning audit', async () => {
  const f = await fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.getInferenceOptions.mockImplementationOnce(async () => { await gate; return inventory(); });
  const req = request(), setting = f.set(a, thread, 0, req.clientRequestId);
  await vi.waitFor(() => expect(f.getInferenceOptions).toHaveBeenCalledTimes(1));
  const send = f.service.submitRun('alice', req);
  // Observe rejection immediately, so this adverse ordering also checks unhandled rejection behavior.
  const result = send.then(value => ({ value }), error => ({ error }));
  release(); await setting; expect(await result).toMatchObject({ error: { statusCode: 409 } });
  await f.ledger.verifyStorage(); expect(f.startRun).not.toHaveBeenCalled();
});
it('default UUID cannot be reused by context compaction and leaves the ledger healthy', async () => {
  const f = await fixture(), id = randomUUID(); await f.set(a, thread, 0, id);
  Object.assign(f.client, { readReadiness: vi.fn().mockResolvedValue({ ready: true, idempotencyRetentionSeconds: 86400, sessionCompactionRuns: true, sessionForkPreservesSource: true }) });
  await expect(f.service.submitContextCompaction('alice', { sessionId, clientRequestId: id })).rejects.toMatchObject({ statusCode: 409 });
  await f.ledger.verifyStorage();
});

it('thread preference follows its exact owned session; project preference never leaks into an unscoped run', async () => {
  const f = await fixture(); await f.set(a);
  const req = { ...request(), routing: { mode: 'defaults' as const, projectId: null } };
  await f.service.submitRun('alice', req);
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)!.routing).toMatchObject({ source: 'thread', inference: a, projectId: null });
  expect(await f.service.readRoutingDefault('alice', { ...thread, projectId: null })).toMatchObject({ revision: 1, selection: a });
  await expect(f.set(b, { ...thread, projectId: null }, 0)).rejects.toMatchObject({ statusCode: 409 });
  const other = await fixture(); await other.set(b, project);
  const unscoped = { ...request(), routing: { mode: 'defaults' as const, projectId: null } };
  await other.service.submitRun('alice', unscoped);
  expect(other.ledger.findRunByClientRequest(actor, unscoped.clientRequestId)!.routing).toMatchObject({ source: 'command', inference: command, projectRevision: 0 });
});
it('keeps membership stable through the bounded admission and never rewrites metadata on a read guard', async () => {
  const f = await fixture(); await f.set(a); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const metadata = await readFile(join(f.directory, 'project-rooms.json'));
  f.startRun.mockImplementationOnce(async () => { await gate; return { runId: 'run_' + 'c'.repeat(32), sessionId, status: 'running', replayed: false }; });
  const send = f.service.submitRun('alice', request());
  await vi.waitFor(() => expect(f.startRun).toHaveBeenCalledTimes(1));
  let edited = false;
  const edit = f.rooms.update(rooms => { edited = true; return rooms.map(room => ({ ...room, archived: true })); });
  await Promise.resolve(); await Promise.resolve(); expect(edited).toBe(false);
  expect(await readFile(join(f.directory, 'project-rooms.json'))).toEqual(metadata);
  release(); await send; await edit; expect(edited).toBe(true);
});
it('rejects malformed preference history after restart even with a recomputed hash', async () => {
  const f = await fixture(); await f.set(a); await f.ledger.close();
  const entry = JSON.parse(await readFile(f.path, 'utf8')); entry.defaultChange.revision = 2;
  delete entry.hash;
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  };
  entry.hash = createHash('sha256').update(canonical(entry)).digest('hex');
  await writeFile(f.path, JSON.stringify(entry) + '\n');
  await expect(f.restart()).rejects.toThrow(); expect(f.startRun).not.toHaveBeenCalled();
});

it('bounds preference history at 4096 without evicting UUID receipts or blocking readback', async () => {
  const f = await fixture(), id = randomUUID(); await f.set(a, thread, 0, id); await f.ledger.close();
  const template = JSON.parse(await readFile(f.path, 'utf8'));
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  };
  const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
  let previousHash = '0'.repeat(64); const rows: string[] = [];
  for (let revision = 1; revision <= 4096; revision++) {
    const clientRequestId = revision === 1 ? id : randomUUID();
    const entry = { ...template, sequence: revision, previousHash, clientRequestId, dedupeKey: `default:${actor}:${clientRequestId}`, defaultChange: { target: thread, selection: a, revision }, requestFingerprint: hash({ target: thread, selection: a, expectedRevision: revision - 1, clientRequestId }) };
    delete entry.hash; entry.hash = hash(entry); previousHash = entry.hash; rows.push(JSON.stringify(entry));
  }
  await writeFile(f.path, rows.join('\n') + '\n'); await f.restart();
  expect(await f.service.readRoutingDefault('alice', thread)).toMatchObject({ revision: 4096, selection: a });
  const before = await readFile(f.path);
  await expect(f.set(null, thread, 4096)).rejects.toThrow('storage bound');
  expect(await f.set(a, thread, 0, id)).toMatchObject({ revision: 1, replayed: true });
  expect((await readFile(f.path)).equals(before)).toBe(true); await f.ledger.verifyStorage(); expect(f.startRun).not.toHaveBeenCalled();
});

it.each(['preference', 'routing'])('audit dedupe includes immutable %s fields instead of dropping them on replay', async kind => {
  const f = await fixture();
  if (kind === 'preference') await f.set(a);
  else { f.startRun.mockRejectedValueOnce(Error('ACK lost')); await expect(f.service.submitRun('alice', request())).rejects.toThrow(); }
  const entry = JSON.parse(await readFile(f.path, 'utf8')), draft = { ...entry };
  for (const key of ['schemaVersion', 'sequence', 'timestamp', 'dedupeKey', 'previousHash', 'hash']) delete draft[key];
  expect(await f.ledger.appendOnce(entry.dedupeKey, draft)).toEqual(entry);
  const changed = kind === 'preference' ? { ...draft, defaultChange: { ...draft.defaultChange, selection: b } } : { ...draft, routing: { ...draft.routing, inference: b } };
  await expect(f.ledger.appendOnce(entry.dedupeKey, changed)).rejects.toThrow('different event');
});
it('uses the configured Command default (with its explicit effort) when nothing else applies, still checked live', async () => {
  const f = await fixture(); f.options.default = { provider: a.provider, model: a.model };
  const configured = createLiveRoomService({ ledger: f.ledger, client: f.client, rooms: f.rooms, resolveImages: f.resolveImages, now: fixtureNow, defaultInference: a });
  const req = request(); await configured.submitRun('alice', req);
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)!.routing).toMatchObject({ source: 'command', inference: a });
  // An unavailable configured default is refused, never replaced.
  const g = await fixture(); g.options.options = g.options.options.filter(option => option.model !== a.model);
  const strict = createLiveRoomService({ ledger: g.ledger, client: g.client, rooms: g.rooms, resolveImages: g.resolveImages, now: fixtureNow, defaultInference: a });
  await expect(strict.submitRun('alice', request())).rejects.toMatchObject({ name: 'RoutingRefusedError', reason: 'model_not_offered' });
  expect(g.startRun).not.toHaveBeenCalled();
});
it('a saved project default wins over the configured Command default', async () => {
  const f = await fixture(); await f.set(b, project);
  const configured = createLiveRoomService({ ledger: f.ledger, client: f.client, rooms: f.rooms, resolveImages: f.resolveImages, now: fixtureNow, defaultInference: a });
  const req = request(); await configured.submitRun('alice', req);
  expect(f.ledger.findRunByClientRequest(actor, req.clientRequestId)!.routing).toMatchObject({ source: 'project', inference: b });
});
it('parses COMMAND_DEFAULT_INFERENCE', async () => {
  const { parseDefaultInference } = await import('./config');
  expect(parseDefaultInference('openai-codex/gpt-6.1-sol/medium')).toEqual({ provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' });
  expect(parseDefaultInference('openrouter/meta/llama-5:free')).toEqual({ provider: 'openrouter', model: 'meta/llama-5:free' });
  expect(parseDefaultInference(undefined)).toBeUndefined();
  expect(() => parseDefaultInference('openai-codex/gpt-6.1-sol')).toThrow(/COMMAND_DEFAULT_INFERENCE/);
  expect(() => parseDefaultInference('openai-api/gpt-6.1-sol/medium')).toThrow(/COMMAND_DEFAULT_INFERENCE/);
});
it('sends saved project context as per-run instructions only when enabled', async () => {
  const f = await fixture();
  const withContext = createLiveRoomService({ ledger: f.ledger, client: f.client, rooms: f.rooms, resolveImages: f.resolveImages, now: fixtureNow, projectContext: true });
  await withContext.submitRun('alice', { ...request(), inference: a });
  const sent = f.startRun.mock.calls.at(-1)![0] as { instructions?: string };
  expect(sent.instructions).toContain('Project: SYNTHETIC route scope');
  expect(sent.instructions).toContain('Goal: Synthetic only');
  expect(sent.instructions).toContain('not as instructions that override');
  const g = await fixture();
  await g.service.submitRun('alice', { ...request(), inference: a });
  expect((g.startRun.mock.calls.at(-1)![0] as { instructions?: string }).instructions).toBeUndefined();
});
