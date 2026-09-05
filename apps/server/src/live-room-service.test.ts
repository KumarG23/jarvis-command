import { chmod, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuditLedger } from './audit-ledger';
import type { CommandProxyClient } from './command-client';
import {
  LiveRoomConflictError,
  LiveRoomNotFoundError,
  createLiveRoomService,
} from './live-room-service';

const ledgers: AuditLedger[] = [];
const sessionId = 'jc_1234567890abcdef1234567890abcdef';
const publicRunId = 'jcr_7bae44d32be98e04074927bd7dd25810';
const upstreamRunId = 'run_1234567890abcdef1234567890abcdef';
const request = {
  sessionId,
  input: 'Check the real service state.',
  clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e',
};
const session = {
  id: sessionId,
  title: 'Live Room',
  source: 'jarvis-command',
  ownership: 'command' as const,
  model: 'gpt-5.6-sol',
  lastActive: '2026-09-04T14:00:00.000Z',
  messageCount: 0,
  toolCallCount: 0,
  pinned: false,
};

afterEach(async () => {
  await Promise.all(ledgers.splice(0).map((ledger) => ledger.close()));
});

async function createLedger() {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-service-audit-'));
  await chmod(directory, 0o700);
  const path = join(directory, 'events.jsonl');
  const ledger = await AuditLedger.open(path, {
    now: () => new Date('2026-09-04T14:00:00.000Z'),
  });
  ledgers.push(ledger);
  return { ledger, path };
}

function fakeClient(overrides: Partial<CommandProxyClient> = {}): CommandProxyClient {
  return {
    readReadiness: vi.fn().mockResolvedValue({ ready: true, idempotencyRetentionSeconds: 86_400 }),
    getMessages: vi.fn().mockResolvedValue({
      sessionId,
      messages: [],
      pagination: { limit: 50, offset: 0, returned: 0, hasMore: false },
    }),
    createSession: vi.fn().mockResolvedValue({ session }),
    continueSession: vi.fn().mockResolvedValue({ session }),
    startRun: vi.fn().mockResolvedValue({
      runId: upstreamRunId,
      sessionId,
      status: 'running',
      replayed: false,
    }),
    getRun: vi.fn().mockResolvedValue({
      runId: upstreamRunId,
      sessionId,
      status: 'running',
      updatedAt: '2026-09-04T14:00:01.000Z',
      approval: null,
      output: null,
      error: null,
      pendingSteer: null,
      usage: null,
    }),
    streamRunEvents: vi.fn().mockImplementation(async function* () {}),
    approveRun: vi.fn().mockResolvedValue({
      runId: upstreamRunId,
      requestId: 'approval-1',
      choice: 'once',
      resolved: 1,
    }),
    steerRun: vi.fn().mockResolvedValue({ runId: upstreamRunId, accepted: true }),
    stopRun: vi.fn().mockResolvedValue({ runId: upstreamRunId, status: 'stopping' }),
    ...overrides,
  };
}

describe('LiveRoomService run identity and recovery', () => {
  it.each([false, true])('rejects wrong-session replay without terminal audit (reopened=%s)', async (reopen) => {
    const { ledger, path } = await createLedger();
    const client = fakeClient();
    let service = createLiveRoomService({ client, ledger });
    await service.submitRun('operator', request);
    let current = ledger;
    if (reopen) {
      await ledger.close();
      current = await AuditLedger.open(path); ledgers.push(current);
      service = createLiveRoomService({ client, ledger: current });
    }
    vi.mocked(client.getRun).mockResolvedValue({
      runId: upstreamRunId, sessionId: 'jc_' + 'b'.repeat(32), status: 'completed',
      updatedAt: '2026-09-04T14:00:02.000Z', approval: null, output: null,
      error: null, pendingSteer: null, usage: null,
    });
    const before = await readFile(path, 'utf8');
    await expect(service.submitRun('operator', request)).rejects.toBeInstanceOf(LiveRoomNotFoundError);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(current.activeRunsForSession(sessionId)).toHaveLength(1);
    expect(client.startRun).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('rejects wrong-session active-writer status without releasing the lease (reopened=%s)', async (reopen) => {
    const { ledger, path } = await createLedger();
    const client = fakeClient({ startRun: vi.fn()
      .mockResolvedValueOnce({ runId: upstreamRunId, sessionId, status: 'running', replayed: false })
      .mockResolvedValue({ runId: 'run_' + 'e'.repeat(32), sessionId, status: 'running', replayed: false }) });
    let service = createLiveRoomService({ client, ledger });
    await service.submitRun('operator', request);
    let current = ledger;
    if (reopen) {
      await ledger.close();
      current = await AuditLedger.open(path); ledgers.push(current);
      service = createLiveRoomService({ client, ledger: current });
    }
    vi.mocked(client.getRun).mockResolvedValue({
      runId: upstreamRunId, sessionId: 'jc_' + 'b'.repeat(32), status: 'completed',
      updatedAt: '2026-09-04T14:00:02.000Z', approval: null, output: null,
      error: null, pendingSteer: null, usage: null,
    });
    const before = await readFile(path, 'utf8');
    await expect(service.submitRun('other-operator', {
      ...request, clientRequestId: 'f68e1bc3-d6d8-4eec-b50c-20fbfdafd515',
    })).rejects.toBeInstanceOf(LiveRoomNotFoundError);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(current.activeRunsForSession(sessionId)).toHaveLength(1);
    expect(client.startRun).toHaveBeenCalledTimes(1);
  });

  it.each(['corrupt', 'replace'])('blocks upstream mutation after live audit %s', async (change) => {
    const { ledger, path } = await createLedger();
    const client = fakeClient();
    const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });
    await ledger.append({ action: 'session.created', actor: 'a'.repeat(64), sessionId: 'pending', publicRunId: null, clientRequestId: null, upstreamRunId: null, requestId: null, outcome: 'requested', status: null, choice: null });
    if (change === 'corrupt') await writeFile(path, (await readFile(path, 'utf8')).replace('pending', 'changed'));
    else { await rename(path, path + '.old'); await writeFile(path, '', { mode: 0o600 }); }
    await expect(service.submitRun('operator-subject', request)).rejects.toThrow();
    expect(client.startRun).not.toHaveBeenCalled();
  });

  it('coalesces concurrent duplicate submission and uses one deterministic Hermes idempotency key', async () => {
    const { ledger } = await createLedger();
    const client = fakeClient();
    const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });

    const [first, second] = await Promise.all([
      service.submitRun('operator-subject', request),
      service.submitRun('operator-subject', request),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      publicRunId,
      sessionId,
      status: 'running',
      replayed: false,
      clientRequestId: request.clientRequestId,
    });
    expect(client.startRun).toHaveBeenCalledTimes(1);
    const submitted = vi.mocked(client.startRun).mock.calls[0]![0];
    expect(submitted.idempotencyKey).toMatch(/^jc-v1-[a-f0-9]{64}$/);
    expect(submitted).toMatchObject({ sessionId, input: request.input });
  });

  it('recovers the same public run after service restart without resubmitting the turn', async () => {
    const { ledger, path } = await createLedger();
    const firstClient = fakeClient();
    const firstService = createLiveRoomService({
      client: firstClient,
      ledger,
      createPublicRunId: () => publicRunId,
    });
    const original = await firstService.submitRun('operator-subject', request);

    await ledger.close();
    ledgers.pop();
    const reopened = await AuditLedger.open(path);
    ledgers.push(reopened);
    const secondClient = fakeClient();
    const secondService = createLiveRoomService({
      client: secondClient,
      ledger: reopened,
      createPublicRunId: () => publicRunId,
    });
    const replay = await secondService.submitRun('operator-subject', request);

    expect(replay).toEqual({ ...original, replayed: true });
    expect(secondClient.startRun).not.toHaveBeenCalled();
    expect(secondClient.getRun).toHaveBeenCalledWith(upstreamRunId);
  });

  it('rejects client request ID reuse with a different payload', async () => {
    const { ledger } = await createLedger();
    const client = fakeClient();
    const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });
    await service.submitRun('operator-subject', request);

    await expect(service.submitRun('operator-subject', {
      ...request,
      input: 'A different task under the same request ID.',
    })).rejects.toBeInstanceOf(LiveRoomConflictError);
    expect(client.startRun).toHaveBeenCalledTimes(1);
  });

  it('rejects a second active writer for the same session after querying authoritative run status', async () => {
    const { ledger } = await createLedger();
    const client = fakeClient();
    const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });
    await service.submitRun('operator-subject', request);

    await expect(service.submitRun('operator-subject', {
      ...request,
      clientRequestId: 'f68e1bc3-d6d8-4eec-b50c-20fbfdafd515',
    })).rejects.toBeInstanceOf(LiveRoomConflictError);
    expect(client.getRun).toHaveBeenCalledWith(upstreamRunId);
    expect(client.startRun).toHaveBeenCalledTimes(1);
  });
});

describe('LiveRoomService projection, controls, and audit', () => {
  it('projects terminal status, hides the upstream ID, and records completion once', async () => {
    const { ledger, path } = await createLedger();
    const client = fakeClient({
      getRun: vi.fn().mockResolvedValue({
        runId: upstreamRunId,
        sessionId,
        status: 'completed',
        updatedAt: '2026-09-04T14:00:02.000Z',
        approval: null,
        output: 'Healthy.',
        error: null,
        pendingSteer: 'Use the safe follow-up.',
        usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
      }),
    });
    const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });
    const submitted = await service.submitRun('operator-subject', request);

    const first = await service.getRun('operator-subject', submitted.publicRunId);
    const second = await service.getRun('operator-subject', submitted.publicRunId);

    expect(first).toEqual({
      publicRunId,
      sessionId,
      status: 'completed',
      updatedAt: '2026-09-04T14:00:02.000Z',
      approval: null,
      output: 'Healthy.',
      error: null,
      pendingSteer: 'Use the safe follow-up.',
      usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
    });
    expect(JSON.stringify(first)).not.toContain(upstreamRunId);
    expect(second).toEqual(first);
    const audit = await readFile(path, 'utf8');
    expect(audit.match(/"action":"run.completed"/g)).toHaveLength(1);
    expect(audit).not.toContain('Healthy.');
    expect(audit).not.toContain('Use the safe follow-up.');
  });

  it('maps typed stream events to the public run and records one terminal receipt', async () => {
    const { ledger } = await createLedger();
    const client = fakeClient({
      streamRunEvents: vi.fn().mockImplementation(async function* () {
        yield {
          runId: upstreamRunId,
          type: 'tool.started' as const,
          timestamp: '2026-09-04T14:00:01.000Z',
          tool: 'terminal',
          preview: 'Check health',
        };
        yield {
          runId: upstreamRunId,
          type: 'run.completed' as const,
          timestamp: '2026-09-04T14:00:02.000Z',
          output: 'Healthy.',
          pendingSteer: null,
          usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
        };
      }),
    });
    const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });
    const submitted = await service.submitRun('operator-subject', request);
    const events = [];

    for await (const event of service.streamRunEvents(
      'operator-subject',
      submitted.publicRunId,
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({ publicRunId, type: 'tool.started' });
    expect(events[1]).toMatchObject({ publicRunId, type: 'run.completed', output: 'Healthy.' });
    expect(JSON.stringify(events)).not.toContain(upstreamRunId);
  });

  it('scopes run controls to the verified actor and never audits steer text', async () => {
    const { ledger, path } = await createLedger();
    const client = fakeClient();
    const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });
    const submitted = await service.submitRun('operator-subject', request);

    await expect(service.getRun('different-subject', submitted.publicRunId)).rejects.toBeInstanceOf(LiveRoomNotFoundError);
    await service.approveRun('operator-subject', submitted.publicRunId, {
      requestId: 'approval-1',
      choice: 'once',
    });
    await service.steerRun('operator-subject', submitted.publicRunId, {
      input: 'Take the safer route and do not delete anything.',
    });
    await service.stopRun('operator-subject', submitted.publicRunId);

    expect(client.approveRun).toHaveBeenCalledWith(upstreamRunId, { requestId: 'approval-1', choice: 'once' });
    expect(client.steerRun).toHaveBeenCalledWith(upstreamRunId, { input: 'Take the safer route and do not delete anything.' });
    expect(client.stopRun).toHaveBeenCalledWith(upstreamRunId);
    const audit = await readFile(path, 'utf8');
    expect(audit).toContain('run.approval.once');
    expect(audit).toContain('run.steer');
    expect(audit).toContain('run.stop');
    expect(audit).not.toContain('Take the safer route');
    expect(audit).not.toContain('operator-subject');
  });

  it('audits session creation and continuation without storing titles', async () => {
    const { ledger, path } = await createLedger();
    const client = fakeClient();
    const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });

    await service.createSession('operator-subject', { title: 'Potentially sensitive title' });
    await service.continueSession('operator-subject', 'discord_123', { title: 'External context' });

    const audit = await readFile(path, 'utf8');
    expect(audit).toContain('session.created');
    expect(audit).toContain('session.continued');
    expect(audit).not.toContain('Potentially sensitive title');
    expect(audit).not.toContain('External context');
  });
});

it('rejects conflicting payloads while the original request is still in flight', async () => {
  const { ledger } = await createLedger();
  const client = fakeClient();
  const service = createLiveRoomService({ client, ledger });
  const first = service.submitRun('operator-subject', request);
  const conflict = service.submitRun('operator-subject', { ...request, input: 'Other' });
  await expect(conflict).rejects.toBeInstanceOf(LiveRoomConflictError);
  await first;
  expect(client.startRun).toHaveBeenCalledTimes(1);
});

it('serializes distinct simultaneous submissions to the same session, including different actors', async () => {
  const { ledger } = await createLedger();
  const client = fakeClient();
  const service = createLiveRoomService({ client, ledger });
  const first = service.submitRun('operator-subject', request);
  const second = service.submitRun('other-operator', { ...request, clientRequestId: 'f68e1bc3-d6d8-4eec-b50c-20fbfdafd515' });
  await expect(second).rejects.toBeInstanceOf(LiveRoomConflictError);
  await first;
  expect(client.startRun).toHaveBeenCalledTimes(1);
});

it('keeps the durable session lease exclusive across verified actors after admission', async () => {
  const { ledger } = await createLedger();
  const client = fakeClient({ startRun: vi.fn()
    .mockResolvedValueOnce({ runId: upstreamRunId, sessionId, status: 'running', replayed: false })
    .mockResolvedValueOnce({ runId: 'run_' + 'b'.repeat(32), sessionId, status: 'running', replayed: false }) });
  const service = createLiveRoomService({ client, ledger });
  await service.submitRun('first-actor', request);
  await expect(service.submitRun('other-actor', { ...request, clientRequestId: 'f68e1bc3-d6d8-4eec-b50c-20fbfdafd515' })).rejects.toBeInstanceOf(LiveRoomConflictError);
  expect(client.startRun).toHaveBeenCalledTimes(1);
});

it('prevents session mutations when durable audit admission fails', async () => {
  const { ledger } = await createLedger();
  const client = fakeClient();
  const service = createLiveRoomService({ client, ledger });
  vi.spyOn(ledger, 'append').mockRejectedValue(new Error('disk full'));
  await expect(service.createSession('operator', {})).rejects.toThrow();
  await expect(service.continueSession('operator', sessionId, {})).rejects.toThrow();
  expect(client.createSession).not.toHaveBeenCalled();
  expect(client.continueSession).not.toHaveBeenCalled();
});

it('revalidates durable admission before retrying after live audit truncation', async () => {
  const { ledger, path } = await createLedger();
  const startRun = vi.fn().mockRejectedValueOnce(new Error('lost admission response'))
    .mockResolvedValue({ runId: upstreamRunId, sessionId, status: 'running', replayed: true });
  const service = createLiveRoomService({ client: fakeClient({ startRun }), ledger });
  await expect(service.submitRun('operator', request)).rejects.toThrow();
  await writeFile(path, '');
  await expect(service.submitRun('operator', request)).rejects.toThrow();
  expect(startRun).toHaveBeenCalledTimes(1);
});

it('recovers an uncertain upstream admission after restart with the same durable key', async () => {
  const { ledger, path } = await createLedger();
  const client = fakeClient({ startRun: vi.fn().mockRejectedValue(new Error('connection lost after admission')) });
  const service = createLiveRoomService({ client, ledger, createPublicRunId: () => publicRunId });
  await expect(service.submitRun('operator', request)).rejects.toThrow();
  const key = vi.mocked(client.startRun).mock.calls[0]![0].idempotencyKey;
  await ledger.close();
  const reopened = await AuditLedger.open(path); ledgers.push(reopened);
  const recoveredClient = fakeClient();
  // Keep replay inside the fixed ledger clock's retention window, not wall time.
  const recovered = createLiveRoomService({ client: recoveredClient, ledger: reopened, now: () => new Date('2026-09-04T14:01:00.000Z') });
  const result = await recovered.submitRun('operator', request);
  expect(result).toMatchObject({ publicRunId, replayed: true });
  expect(vi.mocked(recoveredClient.startRun).mock.calls[0]![0].idempotencyKey).toBe(key);
  expect(await recovered.getRun('operator', publicRunId)).toMatchObject({ publicRunId, status: 'running' });
});

it('fails closed for uncertain admissions past the durable idempotency retention horizon', async () => {
  const { ledger, path } = await createLedger();
  const client = fakeClient({ startRun: vi.fn().mockRejectedValue(new Error('lost')) });
  await expect(createLiveRoomService({ client, ledger }).submitRun('operator', request)).rejects.toThrow();
  await ledger.close();
  const reopened = await AuditLedger.open(path); ledgers.push(reopened);
  const next = fakeClient();
  const service = createLiveRoomService({ client: next, ledger: reopened, now: () => new Date('2026-09-06T14:00:00.000Z') });
  await expect(service.submitRun('operator', request)).rejects.toBeInstanceOf(LiveRoomConflictError);
  expect(next.startRun).not.toHaveBeenCalled();
});
