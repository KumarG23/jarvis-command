import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AuditLedger } from './audit-ledger';
import { buildApp } from './app';
import { loadConfig } from './config';
import { CommandProxyUnavailableError, type CommandProxyClient } from './command-client';
import { createLiveRoomService } from './live-room-service';
import { ReactionStore } from './reaction-store';
import { NotificationStore } from './notification-store';
import { ProjectRoomStore } from './project-room-store';

const roots: string[] = [];
const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const sessionId = `jc_${'a'.repeat(32)}`;
const otherSession = `jc_${'b'.repeat(32)}`;
const actor = createHash('sha256').update('fixture-actor').digest('hex');
const headers = { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example', 'x-jarvis-command': '1', 'content-type': 'application/json' };
const session = { id: sessionId, title: 'SYNTHETIC reaction fixture', source: 'jarvis-command', ownership: 'command' as const, model: null, lastActive: '2026-11-06T12:00:00Z', messageCount: 2, toolCallCount: 0, pinned: false };
const messages = ['stored-1', 'stored-2'].map(id => ({ id, sessionId, role: 'assistant' as const, content: 'SYNTHETIC repeated text PRIVATE', timestamp: null, toolName: null, displayKind: null }));
const target = { sessionId, messageId: 'stored-2', offset: 0 };
const mutation = () => ({ ...target, emoji: '👍' as const, action: 'toggle' as const, clientRequestId: randomUUID() });
const runRequest = () => ({ sessionId, inference: { provider: 'openai-codex' as const, model: 'gpt-6-sol' as const, reasoningEffort: 'low' as const }, input: 'SYNTHETIC explicit send PRIVATE', clientRequestId: randomUUID() });

async function fixture(enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'jc-reactions-')); roots.push(root);
  const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', ...(enabled ? { REACTIONS_MODE: 'enabled' } : {}), PUBLIC_ORIGIN: headers.origin, HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: join(root, 'events.jsonl'), ARTIFACTS_MODE: 'disabled' });
  let ledger = await AuditLedger.open(config.command!.auditLogPath); closes.push(() => ledger.close());
  const client = {
    readReadiness: vi.fn(async () => ({ ready: true, idempotencyRetentionSeconds: 86_400, sessionForkPreservesSource: true, sessionCompactionRuns: true })),
    getSession: vi.fn(async () => ({ session })),
    getMessages: vi.fn(async () => ({ sessionId, messages: structuredClone(messages), pagination: { limit: 100, offset: 0, returned: 2, hasMore: false } })),
    startRun: vi.fn<CommandProxyClient['startRun']>(async request => ({ runId: `run_${request.idempotencyKey.slice(-32)}`, sessionId, status: 'completed', replayed: false })),
    getRun: vi.fn(async (runId: string) => ({ runId, sessionId, status: 'completed', updatedAt: '2026-11-06T12:00:00Z', approval: null, output: null, error: null, pendingSteer: null, usage: null })),
    startContextCompaction: vi.fn(),
  };
  let store = new ReactionStore(root);
  const make = (active = enabled, withStore = true) => createLiveRoomService({ client: client as unknown as CommandProxyClient, ledger, ...(withStore ? { reactions: store } : {}), reactionsEnabled: active });
  let service = make();
  const app = buildApp({ config, get liveRoom() { return service; }, hermes: { readSnapshot: vi.fn() }, verifyAccess: async assertion => {
    if (assertion !== 'valid' && assertion !== 'other') throw Error();
    return { subject: assertion === 'valid' ? 'fixture-actor' : 'other-actor', provider: 'cloudflare-access' };
  } }); closes.push(() => app.close());
  const post = (route: string, payload: unknown, overrides = {}) => app.inject({ method: 'POST', url: `/api/live/reactions/${route}`, headers: { ...headers, ...overrides }, payload: JSON.stringify(payload) });
  const restart = async (active = enabled) => { await ledger.close(); ledger = await AuditLedger.open(config.command!.auditLogPath); store = new ReactionStore(root); service = make(active); return service; };
  return { root, client, app, post, restart, make, get ledger() { return ledger; }, get service() { return service; }, get store() { return store; } };
}

it('persists exact durable targets, add/remove audit, actor isolation and retry receipts without run admission', async () => {
  const f = await fixture(); const request = mutation();
  expect((await f.post('mutate', request)).json()).toMatchObject({ messageId: 'stored-2', active: true, changed: true, replayed: false });
  expect((await f.post('mutate', request)).json()).toMatchObject({ active: true, replayed: true });
  expect((await f.post('read', target)).json().emojis).toEqual(['👍']);
  expect((await f.post('read', { ...target, messageId: 'stored-1' })).json().emojis).toEqual([]);
  expect((await f.post('read', target, { 'cf-access-jwt-assertion': 'other' })).json().emojis).toEqual([]);
  await f.post('mutate', mutation(), { 'cf-access-jwt-assertion': 'other' });
  expect((await f.post('mutate', { ...mutation(), action: 'add' })).json().changed).toBe(false);
  expect((await f.post('mutate', mutation())).json().active).toBe(false);
  // Retry of the first toggle retains its original receipt, never toggles again.
  await f.restart(); expect((await f.post('mutate', request)).json()).toMatchObject({ active: true, replayed: true });
  expect((await f.post('read', target)).json().emojis).toEqual([]);
  expect((await f.post('read', target, { 'cf-access-jwt-assertion': 'other' })).json().emojis).toEqual(['👍']);
  expect((await f.post('mutate', { ...request, messageId: 'stored-1' })).statusCode).toBe(409);
  const state = JSON.parse(await readFile(join(f.root, 'reactions.json'), 'utf8'));
  expect(state.events.map((e: { action: string }) => e.action)).toEqual(['add', 'add', 'remove']);
  expect(state.events[0]).toMatchObject({ actor, sessionId, messageId: 'stored-2', role: 'assistant' });
  expect((await stat(join(f.root, 'reactions.json'))).mode & 0o777).toBe(0o600);
  expect(await readFile(join(f.root, 'events.jsonl'), 'utf8')).toBe('');
  expect(JSON.stringify(state)).not.toContain('PRIVATE');
  expect(f.client.startRun).not.toHaveBeenCalled(); expect(f.client.startContextCompaction).not.toHaveBeenCalled();
});

it('fails closed for disabled, unauthorized, hostile, oversize and foreign requests', async () => {
  const disabled = await fixture(false);
  expect((await disabled.post('mutate', mutation())).statusCode).toBe(409);
  expect((await disabled.post('read', target)).json()).toEqual({ error: 'reactions_unavailable' });
  expect(disabled.client.getMessages).not.toHaveBeenCalled();
  const f = await fixture();
  for (const override of [{ 'cf-access-jwt-assertion': '' }, { origin: 'https://foreign.example' }, { 'x-jarvis-command': '' }, { 'content-type': 'text/plain' }]) expect((await f.post('mutate', mutation(), override)).statusCode).toBeGreaterThanOrEqual(400);
  for (const change of [{ actor: 'forged' }, { emoji: '🚀' }, { action: 'execute' }, { messageId: 'id\n' }, { offset: -1 }, { offset: 1_000_001 }, { messageId: 'x'.repeat(161) }]) expect((await f.post('mutate', { ...mutation(), ...change })).statusCode).toBe(400);
  expect((await f.post('mutate', { ...mutation(), messageId: 'x'.repeat(2000) })).statusCode).toBe(413);
  expect((await f.post('mutate', { ...mutation(), messageId: 'foreign-message' })).statusCode).toBe(404);
  f.client.getSession.mockResolvedValueOnce({ session: { ...session, id: otherSession } });
  expect((await f.post('mutate', mutation())).statusCode).toBe(404);
  f.client.getSession.mockResolvedValueOnce({ session: { ...session, ownership: 'external' as 'command' } });
  expect((await f.post('mutate', mutation())).statusCode).toBe(404);
  f.client.getSession.mockResolvedValueOnce({ session: { ...session, id: 'discord:fixture' } });
  expect((await f.post('mutate', { ...mutation(), sessionId: 'discord:fixture' })).statusCode).toBe(404);
  expect(f.client.startRun).not.toHaveBeenCalled();
});

it('requires a supported matching bounded page and unambiguous conversational row on every read and mutation', async () => {
  const f = await fixture(); const page = await f.client.getMessages();
  for (const change of [
    { messages: [messages[1]!, messages[1]!] },
    { messages: messages.map(m => ({ ...m, sessionId: otherSession })) },
    { sessionId: otherSession },
    { pagination: { ...page.pagination, offset: 1 } },
    { pagination: { ...page.pagination, returned: 1 } },
    { messages: messages.map(m => ({ ...m, role: 'system' as 'assistant' })) },
    { messages: messages.map(m => ({ ...m, role: 'tool' as 'assistant' })) },
    { messages: messages.map(m => ({ ...m, displayKind: 'setup' as unknown as null })) },
  ]) {
    f.client.getMessages.mockResolvedValueOnce({ ...page, ...change });
    expect((await f.post('mutate', mutation())).statusCode).toBe(404);
  }
  f.client.getMessages.mockRejectedValueOnce(new CommandProxyUnavailableError());
  expect((await f.post('mutate', mutation())).statusCode).toBe(503);
  expect(f.client.getMessages).toHaveBeenLastCalledWith(sessionId, 100, 0);
  expect(f.client.startRun).not.toHaveBeenCalled();
});

it('freezes context before an unknown upstream ACK, excludes concurrent events, and recovers identical input/key after restart', async () => {
  const f = await fixture(); await f.post('mutate', mutation());
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const waiting = new Promise<void>(resolve => { release = resolve; });
  f.client.startRun.mockImplementationOnce(async () => { entered(); await waiting; throw Error('SYNTHETIC lost ACK'); });
  const request = runRequest(); const send = f.service.submitRun('fixture-actor', request);
  const failed = expect(send).rejects.toThrow('lost ACK'); await started;
  const retry = expect(f.service.submitRun('fixture-actor', request)).rejects.toThrow('lost ACK');
  await f.post('mutate', mutation()); // removal belongs to the next send
  release(); await Promise.all([failed, retry]);
  expect(f.client.startRun).toHaveBeenCalledTimes(1);
  const first = f.client.startRun.mock.calls[0]![0];
  expect(first.inference).toEqual(request.inference);
  expect(first.input).toContain(request.input); expect(first.input).toContain('"action":"add"'); expect(first.input).not.toContain('"action":"remove"');
  // Disabled control stops new claims, but previously frozen admissions must recover intact.
  await f.restart(false);
  expect((await f.service.submitRun('fixture-actor', request)).replayed).toBe(true);
  expect(f.client.startRun.mock.calls[1]![0]).toEqual(first);
  await expect(f.service.submitRun('fixture-actor', { ...request, input: 'changed' })).rejects.toMatchObject({ statusCode: 409 });
  await expect(f.service.submitRun('fixture-actor', { ...request, inference: { ...request.inference, reasoningEffort: 'high' } })).rejects.toMatchObject({ statusCode: 409 });
  await f.restart();
  const next = runRequest(); await f.service.submitRun('fixture-actor', next);
  const second = f.client.startRun.mock.calls[2]![0]; expect(second.input).toContain('"action":"remove"'); expect(second.input).not.toContain('"action":"add"');
  await f.restart(); await f.service.submitRun('fixture-actor', next); expect(f.client.startRun).toHaveBeenCalledTimes(3);
  await f.service.submitRun('fixture-actor', runRequest()); expect(f.client.startRun.mock.calls[3]![0].input).not.toContain('reaction context');
});

it('never adds later reactions to empty frozen sends or legacy admissions, including retries before ledger write', async () => {
  const f = await fixture(); const request = runRequest();
  const append = vi.spyOn(f.ledger, 'appendOnce'); append.mockRejectedValueOnce(Error('before audit write'));
  await expect(f.service.submitRun('fixture-actor', request)).rejects.toThrow('before audit write');
  await f.post('mutate', mutation());
  await expect(f.service.submitContextCompaction('fixture-actor', { sessionId, clientRequestId: request.clientRequestId })).rejects.toMatchObject({ statusCode: 409 });
  expect(f.client.startContextCompaction).not.toHaveBeenCalled();
  await expect(f.service.submitRun('fixture-actor', runRequest())).rejects.toMatchObject({ statusCode: 409 });
  await f.restart(); await f.service.submitRun('fixture-actor', request);
  expect(f.client.startRun.mock.calls[0]![0].input).toBe(request.input);
  await f.service.submitRun('fixture-actor', runRequest()); expect(f.client.startRun.mock.calls[1]![0].input).toContain('reaction context');
  const g = await fixture(); const legacy = g.make(false, false); const legacyRequest = runRequest();
  g.client.startRun.mockRejectedValueOnce(Error('legacy lost ACK'));
  await expect(legacy.submitRun('fixture-actor', legacyRequest)).rejects.toThrow('legacy lost ACK');
  await g.post('mutate', mutation()); await g.restart(); await g.service.submitRun('fixture-actor', legacyRequest);
  expect(g.client.startRun.mock.calls[1]![0].input).toBe(legacyRequest.input);
  await g.service.submitRun('fixture-actor', runRequest()); expect(g.client.startRun.mock.calls[2]![0].input).toContain('reaction context');
});

it('retains old-reader ledger/registry compatibility and fails safely on rollback of a pending augmented send', async () => {
  const f = await fixture(); await new NotificationStore(f.root).read(actor); await new ProjectRoomStore(f.root).update(() => []);
  const registry = await readFile(join(f.root, 'project-rooms.json'));
  const notifications = await readFile(join(f.root, 'notifications.json'));
  await f.post('mutate', mutation()); const request = runRequest(); f.client.startRun.mockRejectedValueOnce(Error('lost ACK'));
  await expect(f.service.submitRun('fixture-actor', request)).rejects.toThrow('lost ACK');
  await f.restart(); // AuditLedger and registry schemas are unchanged from the accepted base.
  await f.ledger.verifyStorage(); expect(await new ProjectRoomStore(f.root).list()).toEqual([]);
  expect(await readFile(join(f.root, 'project-rooms.json'))).toEqual(registry);
  expect(await readFile(join(f.root, 'notifications.json'))).toEqual(notifications);
  const rollback = f.make(false, false);
  await expect(rollback.submitRun('fixture-actor', request)).rejects.toMatchObject({ statusCode: 409 });
  expect(f.client.startRun).toHaveBeenCalledTimes(1);
  await f.service.submitRun('fixture-actor', request); expect(f.client.startRun).toHaveBeenCalledTimes(2);
  expect(await readFile(join(f.root, 'reactions.json'), 'utf8')).not.toContain(request.input);
  expect(await readFile(join(f.root, 'events.jsonl'), 'utf8')).not.toContain('reaction.');
});

it('rejects total input and context limits before admission without losing pending events', async () => {
  const f = await fixture(); await f.post('mutate', mutation()); const request = { ...runRequest(), input: 'x'.repeat(16_000) };
  await expect(f.service.submitRun('fixture-actor', request)).rejects.toMatchObject({ statusCode: 409 });
  expect(f.client.startRun).not.toHaveBeenCalled(); expect(await readFile(join(f.root, 'events.jsonl'), 'utf8')).toBe('');
  await f.service.submitRun('fixture-actor', { ...request, input: 'Short explicit message' });
  expect(f.client.startRun.mock.calls[0]![0].input).toContain('"action":"add"');
  const g = await fixture(); for (let i = 0; i < 33; i++) await g.store.mutate(actor, mutation(), 'assistant');
  await expect(g.service.submitRun('fixture-actor', runRequest())).rejects.toMatchObject({ statusCode: 409 });
  expect(g.client.startRun).not.toHaveBeenCalled();
});

it('refuses corrupt storage and never silently replaces a previously seen reaction file', async () => {
  const f = await fixture(); await f.post('mutate', mutation());
  await writeFile(join(f.root, 'reactions.json'), '{invalid');
  expect((await f.post('read', target)).statusCode).toBe(503);
  expect((await f.post('mutate', mutation())).statusCode).toBe(503);
  await expect(f.service.submitRun('fixture-actor', runRequest())).rejects.toMatchObject({ statusCode: 503 });
  expect(f.client.startRun).not.toHaveBeenCalled();
});
