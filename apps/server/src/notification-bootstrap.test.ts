import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createCommandServer } from './bootstrap';
import { loadConfig } from './config';
import { AuditLedger } from './audit-ledger';

it('real factory resolves notification service after onReady for empty reconcile and owned run/session open across restart (#57)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jc-notification-bootstrap-'));
  await chmod(directory, 0o700);
  const sessionId = 'jc_' + 'a'.repeat(32), runId = 'run_' + 'b'.repeat(32), publicRunId = 'jcr_' + 'c'.repeat(32);
  const actor = createHash('sha256').update('development-operator').digest('hex');
  const requests: string[] = [];
  let sessionAvailable = true;
  const session = { id: sessionId, title: 'SYNTHETIC startup fixture', source: 'web', ownership: 'command', model: null, lastActive: new Date().toISOString(), messageCount: 0, toolCallCount: 0, pinned: false };
  const proxy = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/_ready') res.end(JSON.stringify({ ready: true, durableIdempotency: true, retentionSeconds: 86400, externalContinue: false }));
    else if (req.method === 'GET' && req.url === `/v1/runs/${runId}`) res.end(JSON.stringify({ runId, sessionId, status: 'completed', updatedAt: new Date().toISOString(), approval: null, output: 'SYNTHETIC completion', error: null, pendingSteer: null, usage: null }));
    else if (req.method === 'GET' && req.url === `/api/sessions/${sessionId}` && sessionAvailable) res.end(JSON.stringify({ session }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address(); if (!address || typeof address === 'string') throw new Error();
  const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', HERMES_COMMAND_API_BASE_URL: `http://127.0.0.1:${address.port}`, HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), PUBLIC_ORIGIN: 'https://command.example', COMMAND_AUDIT_LOG_PATH: join(directory, 'audit.jsonl'), ARTIFACTS_MODE: 'disabled' });
  const factory = () => createCommandServer(config, { hermes: { readSnapshot: async () => { throw new Error('SYNTHETIC unavailable'); } } });
  let app = factory();
  const post = (url: string) => app.inject({ method: 'POST', url, headers: { origin: 'https://command.example', 'x-jarvis-command': '1' }, payload: {} });
  try {
    expect((await app.inject('/api/notifications')).statusCode).toBe(200);
    const empty = await post('/api/notifications/reconcile');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ checked: 0, unavailable: 0 });
    await app.close();
    // Owned, reversible, correctly hashed audit fixture; no inference or upstream write.
    const ledger = await AuditLedger.open(config.command!.auditLogPath);
    const base = { actor, sessionId, publicRunId, clientRequestId: '00000000-0000-4000-8000-000000000001', requestId: null, requestFingerprint: 'f'.repeat(64), choice: null };
    await ledger.append({ ...base, action: 'run.requested', upstreamRunId: null, outcome: 'requested', status: 'queued' });
    await ledger.append({ ...base, action: 'run.started', upstreamRunId: runId, outcome: 'succeeded', status: 'running' });
    await ledger.close();
    app = factory();
    const reconciled = await post('/api/notifications/reconcile');
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.json()).toMatchObject({ checked: 1, unavailable: 0 });
    const id = reconciled.json().inbox.items[0].id as string;
    const opened = await post(`/api/notifications/${id}/open`);
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ state: 'available', sessionId, publicRunId, runStatus: 'completed', approvalPending: false, inbox: { unreadCount: 0 } });
    sessionAvailable = false;
    expect((await post(`/api/notifications/${id}/open`)).json()).toEqual({ state: 'missing' });
    await app.close(); app = factory();
    expect((await post('/api/notifications/reconcile')).json().inbox.items).toHaveLength(1);
    expect(requests.every(request => request.startsWith('GET '))).toBe(true);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
