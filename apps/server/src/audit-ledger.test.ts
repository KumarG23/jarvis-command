import { chmod, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AuditIntegrityError, AuditLedger } from './audit-ledger';

const ledgers: AuditLedger[] = [];

afterEach(async () => {
  await Promise.all(ledgers.splice(0).map((ledger) => ledger.close()));
});

async function temporaryLedgerPath() {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-audit-'));
  await chmod(directory, 0o700);
  return join(directory, 'events.jsonl');
}

const actor = 'a'.repeat(64);
const sessionId = 'jc_1234567890abcdef1234567890abcdef';
const publicRunId = 'jcr_1234567890abcdef1234567890abcdef';
const upstreamRunId = 'run_1234567890abcdef1234567890abcdef';
const clientRequestId = 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e';
const requestFingerprint = 'b'.repeat(64);

describe('AuditLedger', () => {
  it.each(['corrupt', 'replace'])('poisons live storage on %s before verification or append', async (change) => {
    for (const operation of ['verify', 'append']) {
      const path = await temporaryLedgerPath();
      const ledger = await AuditLedger.open(path); ledgers.push(ledger);
      const event = { action: 'session.created' as const, actor, sessionId: 'pending', publicRunId: null, clientRequestId: null, upstreamRunId: null, requestId: null, outcome: 'requested' as const, status: null, choice: null };
      await ledger.append(event);
      const original = await readFile(path, 'utf8');
      if (change === 'corrupt') await writeFile(path, original.replace('pending', 'changed'));
      else { await rename(path, path + '.old'); await writeFile(path, '', { mode: 0o600 }); }
      await expect(operation === 'verify' ? ledger.verifyStorage() : ledger.append(event)).rejects.toBeInstanceOf(AuditIntegrityError);
      expect(() => ledger.assertHealthy()).toThrow(AuditIntegrityError);
      if (change === 'replace') expect(await readFile(path + '.old', 'utf8')).toBe(original);
    }
  });

  it('serializes integrity verification with its own concurrent appends', async () => {
    const path = await temporaryLedgerPath();
    const ledger = await AuditLedger.open(path); ledgers.push(ledger);
    const event = { action: 'session.created' as const, actor, sessionId, publicRunId: null, clientRequestId: null, upstreamRunId: null, requestId: null, outcome: 'requested' as const, status: null, choice: null };
    await Promise.all(Array.from({ length: 20 }, () => Promise.all([ledger.append(event), ledger.verifyStorage()])));
    await ledger.verifyStorage();
  });

  it('creates a mode-0600 hash-chained ledger and reconstructs run mappings after restart', async () => {
    const path = await temporaryLedgerPath();
    const ledger = await AuditLedger.open(path, {
      now: () => new Date('2026-09-04T14:00:00.000Z'),
    });
    ledgers.push(ledger);

    const requested = await ledger.appendOnce(`request:${actor}:${clientRequestId}`, {
      action: 'run.requested',
      actor,
      sessionId,
      publicRunId,
      clientRequestId,
      upstreamRunId: null,
      requestId: null,
      requestFingerprint,
      outcome: 'requested',
      status: 'queued',
      choice: null,
    });
    const started = await ledger.appendOnce(`started:${publicRunId}`, {
      action: 'run.started',
      actor,
      sessionId,
      publicRunId,
      clientRequestId,
      upstreamRunId,
      requestId: null,
      requestFingerprint,
      outcome: 'succeeded',
      status: 'running',
      choice: null,
    });

    expect(requested.sequence).toBe(1);
    expect(requested.previousHash).toBe('0'.repeat(64));
    expect(started.sequence).toBe(2);
    expect(started.previousHash).toBe(requested.hash);
    expect(started.hash).toMatch(/^[a-f0-9]{64}$/);
    expect((await ledger.fileMetadata()).mode).toBe(0o600);
    expect(ledger.findRunByClientRequest(actor, clientRequestId)).toMatchObject({
      publicRunId,
      upstreamRunId,
      sessionId,
    });

    await ledger.close();
    ledgers.pop();
    const reopened = await AuditLedger.open(path);
    ledgers.push(reopened);
    expect(reopened.findRunByPublicId(actor, publicRunId)).toMatchObject({
      publicRunId,
      upstreamRunId,
      sessionId,
      clientRequestId,
    });

    const lines = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0].hash).toBe(lines[1].previousHash);
  });

  it('deduplicates the same semantic receipt instead of appending twice', async () => {
    const path = await temporaryLedgerPath();
    const ledger = await AuditLedger.open(path);
    ledgers.push(ledger);
    const event = {
      action: 'run.stop' as const,
      actor,
      sessionId,
      publicRunId,
      clientRequestId,
      upstreamRunId,
      requestId: null,
      outcome: 'succeeded' as const,
      status: 'stopping' as const,
      choice: null,
    };

    const first = await ledger.appendOnce(`stop:${publicRunId}`, event);
    const second = await ledger.appendOnce(`stop:${publicRunId}`, event);

    expect(second).toEqual(first);
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('rejects corruption, truncation, symlinks, and unsafe file modes', async () => {
    const corruptPath = await temporaryLedgerPath();
    const ledger = await AuditLedger.open(corruptPath);
    ledgers.push(ledger);
    await ledger.append({
      action: 'session.created',
      actor,
      sessionId,
      publicRunId: null,
      clientRequestId: null,
      upstreamRunId: null,
      requestId: null,
      outcome: 'succeeded',
      status: null,
      choice: null,
    });
    await ledger.close();
    ledgers.pop();
    const original = await readFile(corruptPath, 'utf8');
    await writeFile(corruptPath, original.replace('session.created', 'session.continued'));
    await expect(AuditLedger.open(corruptPath)).rejects.toBeInstanceOf(AuditIntegrityError);

    const truncatedPath = await temporaryLedgerPath();
    await writeFile(truncatedPath, '{"schemaVersion":1');
    await chmod(truncatedPath, 0o600);
    await expect(AuditLedger.open(truncatedPath)).rejects.toBeInstanceOf(AuditIntegrityError);

    const targetPath = await temporaryLedgerPath();
    await writeFile(targetPath, '');
    await chmod(targetPath, 0o600);
    const linkPath = `${targetPath}.link`;
    await symlink(targetPath, linkPath);
    await expect(AuditLedger.open(linkPath)).rejects.toBeInstanceOf(AuditIntegrityError);

    const permissivePath = await temporaryLedgerPath();
    await writeFile(permissivePath, '');
    await chmod(permissivePath, 0o644);
    await expect(AuditLedger.open(permissivePath)).rejects.toBeInstanceOf(AuditIntegrityError);
  });

  it('rejects arbitrary payload fields so prompts and credentials cannot enter the ledger', async () => {
    const path = await temporaryLedgerPath();
    const ledger = await AuditLedger.open(path);
    ledgers.push(ledger);

    await expect(ledger.append({
      action: 'run.steer',
      actor,
      sessionId,
      publicRunId,
      clientRequestId,
      upstreamRunId,
      requestId: null,
      outcome: 'succeeded',
      status: 'running',
      choice: null,
      input: 'Bearer must-not-be-written',
    } as never)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('');
  });
});

it('rejects conflicting durable client/public/upstream mappings before appending', async () => {
  for (const conflict of [
    { publicRunId: 'jcr_' + 'b'.repeat(32) },
    { clientRequestId: 'f68e1bc3-d6d8-4eec-b50c-20fbfdafd515' },
    { upstreamRunId: 'run_' + 'b'.repeat(32) },
    { requestFingerprint: 'c'.repeat(64) },
    { sessionId: 'jc_' + 'b'.repeat(32) },
  ]) {
    const path = await temporaryLedgerPath();
    const ledger = await AuditLedger.open(path); ledgers.push(ledger);
    const event = { action: 'run.started' as const, actor, sessionId, publicRunId, clientRequestId, upstreamRunId, requestFingerprint, requestId: null, outcome: 'succeeded' as const, status: 'running' as const, choice: null };
    await ledger.append(event);
    const before = await readFile(path, 'utf8');
    await expect(ledger.append({ ...event, ...conflict })).rejects.toBeInstanceOf(AuditIntegrityError);
    expect(await readFile(path, 'utf8')).toBe(before);
  }
});

it('refuses to append after live ledger truncation or a permission downgrade', async () => {
  for (const change of ['truncate', 'chmod']) {
    const path = await temporaryLedgerPath();
    const ledger = await AuditLedger.open(path); ledgers.push(ledger);
    const event = { action: 'session.created' as const, actor, sessionId, publicRunId: null, clientRequestId: null, upstreamRunId: null, requestId: null, outcome: 'requested' as const, status: null, choice: null };
    await ledger.append(event);
    if (change === 'truncate') await writeFile(path, ''); else await chmod(path, 0o644);
    const before = await readFile(path, 'utf8');
    await expect(ledger.append(event)).rejects.toBeInstanceOf(AuditIntegrityError);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(() => ledger.assertHealthy()).toThrow();
  }
});

it('never returns a deduped admission from a closed ledger', async () => {
  const path = await temporaryLedgerPath();
  const ledger = await AuditLedger.open(path);
  const event = { action: 'session.created' as const, actor, sessionId, publicRunId: null, clientRequestId: null, upstreamRunId: null, requestId: null, outcome: 'requested' as const, status: null, choice: null };
  await ledger.appendOnce('session-one', event);
  await ledger.close();
  await expect(ledger.appendOnce('session-one', event)).rejects.toBeInstanceOf(AuditIntegrityError);
});
