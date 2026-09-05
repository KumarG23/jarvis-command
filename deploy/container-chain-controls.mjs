/* global localStorage, sessionStorage */
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { expect } from '@playwright/test';
import { writeGate } from './container-chain-gate.mjs';

// Node-only fixture orchestration. No HTTP control endpoint or browser-supplied ID.
export async function exerciseControls({ page, counts, directory, evidence, mode, seed, recoveredDenials, crashWindow }) {
  for (const choice of ['once', 'deny']) {
    const before = await counts(), start = before.transport.length;
    let crashStart = -1, crashEnd = -1;
    const captured = async (path, method = 'POST') => {
      await expect.poll(async () => (await counts()).transport.slice(start).filter(r => r.path === path && r.method === method && r.complete).length).toBeGreaterThan(0);
      const records = (await counts()).transport.slice(start).filter(r => r.path === path && r.method === method && r.complete);
      if (method === 'POST') assert.equal(records.length, 1);
      assert.equal(records.at(-1).status, 200);
      return records.at(-1);
    };
    await page.getByRole('textbox', { name: 'Message Jarvis' }).fill('Synthetic container controls');
    await page.getByRole('button', { name: 'Send message' }).click();
    const admissionPayload = await captured('/api/live/runs');
    const admission = JSON.parse(admissionPayload.text), submitted = JSON.parse(admissionPayload.requestText);
    assert.equal(admission.sessionId, seed); assert.equal(admission.clientRequestId, submitted.clientRequestId);
    const upstream = (await counts()).runs.at(-1), path = '/api/live/runs/' + admission.publicRunId;
    assert.equal(upstream.body.input, submitted.input);
    const gate = action => {
      assert.ok(['hold', 'release', 'finish'].includes(action));
      writeGate(directory + '/synthetic', { run_id: upstream.run_id, action });
    };
    const card = page.getByRole('region', { name: 'Awaiting approval', exact: true });
    await expect(card).toBeVisible();
    await expect(card.locator('pre')).toHaveText('printf synthetic-control ; printf /EXACT_SYNTHETIC_TARGET');
    await expect(card).toContainText('Request: synthetic-approval-exact');
    await expect(card).toContainText(`Run: ${admission.publicRunId} · Session: ${seed}`);
    await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
    await page.screenshot({ path: evidence + '/' + mode + '-' + choice + '-approval.png', fullPage: true });
    await card.getByRole('button', { name: choice === 'once' ? 'Approve once' : 'Deny', exact: true }).click();
    const approval = await captured(path + '/approval');
    assert.deepEqual(JSON.parse(approval.requestText), { requestId: 'synthetic-approval-exact', choice });
    assert.equal(JSON.parse(approval.text).publicRunId, admission.publicRunId);
    assert.equal(JSON.parse(approval.text).requestId, 'synthetic-approval-exact');
    assert.equal(JSON.parse(approval.text).choice, choice);
    await expect.poll(async () => JSON.parse((await captured(path, 'GET')).text).approval).toBe(null);
    const authoritative = JSON.parse((await captured(path, 'GET')).text);
    assert.equal(authoritative.publicRunId, admission.publicRunId); assert.equal(authoritative.sessionId, seed); assert.equal(authoritative.status, 'running');
    await expect(card).toHaveCount(0);
    const stored = () => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    const identity = { sessionId: seed, clientRequestId: admission.clientRequestId, publicRunId: admission.publicRunId };
    if (choice === 'once') {
      await page.getByRole('textbox', { name: 'Steer Jarvis' }).fill('Synthetic private queued guidance');
      await page.getByRole('button', { name: 'Queue steer', exact: true }).click();
      await expect(page.getByText('Steer queued — not executed. Checking status.', { exact: true })).toBeVisible();
      const steer = await captured(path + '/steer');
      assert.deepEqual(JSON.parse(steer.requestText), { input: 'Synthetic private queued guidance' });
      assert.equal(JSON.parse(steer.text).publicRunId, admission.publicRunId);
      assert.deepEqual(await stored(), { local: {}, session: { 'jarvis-command:live-turn': JSON.stringify(identity) } });
      gate('hold');
      try {
        const preReplacement = await counts();
        crashStart = preReplacement.transport.length - 1;
        crashWindow(path);
        writeFileSync(directory + '/recovery-request.tmp', JSON.stringify({ mode }), { flag: 'wx', mode: 0o600 });
        renameSync(directory + '/recovery-request.tmp', directory + '/recovery-request.json');
        await expect.poll(() => existsSync(directory + '/recovery-ack.json'), { timeout: 25000 }).toBe(true);
        assert.deepEqual(JSON.parse(readFileSync(directory + '/recovery-ack.json')), { mode });
        unlinkSync(directory + '/recovery-ack.json');
        assert.deepEqual((await counts()).runs, preReplacement.runs);
        await page.reload();
        await expect(page.getByRole('region', { name: 'Current turn', exact: true })).toContainText(admission.publicRunId);
        await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toHaveCount(0);
        await expect(page.getByRole('textbox', { name: 'Steer Jarvis' })).toHaveCount(0);
        await page.screenshot({ path: evidence + '/' + mode + '-replacement-unbound.png', fullPage: true });
      } finally { gate('release'); }
      await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
      await expect.poll(async () => JSON.parse((await captured(path, 'GET')).text).pendingSteer).toBe('Synthetic private queued guidance');
      const recovered = JSON.parse((await captured(path, 'GET')).text);
      assert.equal(recovered.publicRunId, admission.publicRunId); assert.equal(recovered.sessionId, seed);
      assert.equal(recovered.status, 'running');
      crashEnd = (await counts()).transport.length;
      crashWindow(null);
      const denied = await recoveredDenials(path);
      writeFileSync(evidence + '/' + mode + '-recovered.json', JSON.stringify({ admission, recovered, denied, storage: await stored(), upstream: (await counts()).runs.at(-1) }, null, 2));
      await page.screenshot({ path: evidence + '/' + mode + '-replacement-bound.png', fullPage: true });
      assert.deepEqual(await stored(), { local: {}, session: { 'jarvis-command:live-turn': JSON.stringify(identity) } });
    }
    await page.getByRole('button', { name: 'Stop run', exact: true }).click();
    const dialog = page.getByRole('region', { name: 'Confirm stop', exact: true });
    await expect(dialog).toContainText(admission.publicRunId); await expect(dialog).toContainText(seed);
    await dialog.getByRole('button', { name: 'Keep running', exact: true }).click();
    assert.equal((await counts()).runs.at(-1).controls.filter(c => c.path.endsWith('/stop')).length, 0);
    await page.getByRole('button', { name: 'Stop run', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm stop', exact: true }).click();
    const stop = await captured(path + '/stop');
    assert.deepEqual(JSON.parse(stop.requestText), {}); assert.equal(JSON.parse(stop.text).publicRunId, admission.publicRunId);
    await expect(page.getByText('Run stopping', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
    gate('finish');
    await expect(page.getByText('Run cancelled', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled();
    if (choice === 'once') await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Synthetic private queued guidance');
    assert.deepEqual(await stored(), { local: {}, session: {} });
    const after = await counts(), run = after.runs.at(-1);
    assert.equal(after.runs.length - before.runs.length, 1);
    assert.equal(after.requests.filter(r => r.method === 'POST' && r.path === '/v1/runs').length - before.requests.filter(r => r.method === 'POST' && r.path === '/v1/runs').length, 1);
    assert.deepEqual(run.controls.map(c => c.path.split('/').at(-1)), choice === 'once' ? ['approval', 'steer', 'stop'] : ['approval', 'stop']);
    assert.deepEqual(run.controls[0].body, { request_id: 'synthetic-approval-exact', choice });
    assert.equal(run.cancelled, true);
    const payloads = after.transport.slice(start);
    for (const [index, r] of payloads.entries()) {
      if (r.status === 502) {
        assert.equal(choice, 'once'); assert.equal(r.path, path); assert.equal(r.method, 'GET');
        assert.ok(index + start >= crashStart && index + start < crashEnd);
        assert.equal(r.text, ''); assert.equal(r.complete, true);
        continue;
      }
      assert.ok(r.text.length > 0);
      if (!r.complete) {
        assert.equal(r.method, 'GET'); assert.equal(r.path, path + '/events'); assert.equal(r.status, 200);
        assert.ok(r.text.includes('approval.request') || r.text.includes('message.delta'));
      }
    }
    await page.screenshot({ path: evidence + '/' + mode + '-' + choice + '-cancelled.png', fullPage: true });
    writeFileSync(evidence + '/' + mode + '-' + choice + '-controls.json', JSON.stringify({ choice, admission, submitted, authoritative, before, after, payloads, deliberateLifecycle: 'approval/steer status polling, same-tab reload, explicit stop then fixture terminal release; deny is nonterminal and separately stopped', restart: choice === 'once' }, null, 2));
  }
}
