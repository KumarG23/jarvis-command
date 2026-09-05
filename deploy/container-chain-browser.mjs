/* global process, setTimeout, clearTimeout, fetch, AbortController, TextDecoder, navigator, localStorage, sessionStorage, document */
import assert from 'node:assert/strict';
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium, devices, expect } from '@playwright/test';
import { exerciseControls } from './container-chain-controls.mjs';
import { finalizeBrowser } from './container-chain-lifecycle.mjs';
const directory = process.env.JC_CHAIN_PRIVATE, evidence = process.env.JC_CHAIN_EVIDENCE;
const config = JSON.parse(readFileSync(directory + '/browser.json'));
const origin = 'https://127.0.0.1:8443', seed = 'jc_' + 'a'.repeat(32);
async function bounded(url, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    reader = response.body.getReader(); let text = '';
    while (true) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); assert.ok(text.length <= 262144); }
    return { status: response.status, text };
  } finally { clearTimeout(timer); controller.abort(); if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
const counts = async () => JSON.parse((await bounded('http://127.0.0.1:18640/fixture-counts')).text);
let previousPassed = true;
for (const mode of ['desktop', 'phone']) test('containerized compiled PWA ' + mode, { timeout: 65000 }, async t => {
  assert.ok(previousPassed, 'Previous browser failed: shared ledger isolation unproven; refusing cascading admission');
  previousPassed = false;
  const certificate = new X509Certificate(readFileSync(directory + '/tls.crt'));
  const spki = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors-spki-list=' + spki] });
  let context, page;
  const errors = [], failures = [], denied = [];
  const crashErrors = [];
  let crashPath = null;
  const responseStatuses = new WeakMap(), lifecycle = [];
  const record = value => { lifecycle.push(value); writeFileSync(evidence + '/' + mode + '-lifecycle.json', JSON.stringify(lifecycle, null, 2)); };
  const abort = () => { record({ stage: 'test-cancelled', ok: false }); void browser.close().catch(error => record({ stage: 'cancel-close', ok: false, error: String(error) })); };
  t.signal.addEventListener('abort', abort, { once: true });
  try {
    const transportStart = (await counts()).transport.length;
    context = await browser.newContext({ ...(mode === 'phone' ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }), ignoreHTTPSErrors: true, serviceWorkers: 'allow', extraHTTPHeaders: { 'cf-access-jwt-assertion': config.assertion } });
    context.setDefaultTimeout(5000);
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (crashPath && message.location().url === origin + crashPath && message.text() === 'Failed to load resource: the server responded with a status of 502 (Bad Gateway)') crashErrors.push({ url: message.location().url, message: message.text() });
      else errors.push(message.text());
    });
    page.on('response', response => responseStatuses.set(response.request(), response.status()));
    page.on('requestfailed', request => { failures.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText, responseStatus: responseStatuses.get(request), expectedCrash: Boolean(crashPath && request.url() === origin + crashPath && request.method() === 'GET' && responseStatuses.get(request) === 502) }); writeFileSync(evidence + '/' + mode + '-failures.json', JSON.stringify(failures, null, 2)); });
    await page.goto(origin);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.getByRole('combobox', { name: 'Session' }).selectOption(seed);
    await expect(page.getByText('Synthetic historical message', { exact: true })).toBeVisible();
    const before = await counts();
    for (const path of ['/health/detailed', '/v1/capabilities', '/api/sessions', '/api/sessions/' + seed + '/messages']) assert.ok(before.requests.some(r => r.path === path));
    // Negative matrix precedes the first admission in each browser path.
    for (const [label, token, requestOrigin, expected] of [['missing', null, origin, 401], ['invalid', 'synthetic-invalid', origin, 401], ['unapproved', config.unapproved, origin, 401], ['wrong-origin', config.assertion, 'https://127.0.0.1:1', 403]]) {
      for (const [path, body] of [['/api/live/sessions', {}], ['/api/live/runs', { sessionId: seed, clientRequestId: '11111111-1111-4111-8111-111111111111', input: 'Denied synthetic input' }], ...['approval', 'steer', 'stop'].map(action => ['/api/live/runs/jcr_' + 'd'.repeat(32) + '/' + action, action === 'approval' ? { requestId: 'synthetic', choice: 'once' } : action === 'steer' ? { input: 'Denied steer' } : {}]), ['/api/live/sessions/' + seed + '/continue', {}]]) {
        // Direct HTTP BFF socket with the exact externally configured HTTPS Origin.
        const result = await bounded('http://127.0.0.1:3000' + path, { method: 'POST', headers: { ...(token ? { 'cf-access-jwt-assertion': token } : {}), origin: requestOrigin, 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: JSON.stringify(body) });
        assert.equal(result.status, expected, label + path); denied.push({ label, path, status: result.status });
        assert.deepEqual((await counts()).requests, before.requests);
      }
    }
    for (const [port, path, wrong] of [[18642, '/api/sessions', config.command], [18643, '/_ready', config.read]]) {
      for (const token of [null, wrong, config.upstream, config.assertion]) {
        const r = await bounded('http://127.0.0.1:' + port + path, { headers: token ? { authorization: 'Bearer ' + token } : {} }); assert.equal(r.status, 401);
      }
    }
    assert.deepEqual((await counts()).requests, before.requests);
    const admissionResponse = page.waitForResponse(r => r.url() === origin + '/api/live/runs' && r.request().method() === 'POST');
    await page.getByRole('textbox', { name: 'Message Jarvis' }).fill('Synthetic private container prompt');
    await page.getByRole('button', { name: 'Send message' }).click();
    const response = await admissionResponse; assert.equal(response.status(), 200);
    const submitted = response.request().postDataJSON();
    await expect.poll(async () => (await counts()).transport.slice(transportStart).some(r => r.path === '/api/live/runs' && r.method === 'POST' && r.complete)).toBe(true);
    const captured = (await counts()).transport.slice(transportStart).filter(r => r.path === '/api/live/runs' && r.method === 'POST');
    assert.equal(captured.length, 1); assert.equal(captured[0].status, 200);
    assert.deepEqual(JSON.parse(captured[0].requestText), submitted);
    const admission = JSON.parse(captured[0].text); assert.match(admission.publicRunId, /^jcr_[a-f0-9]{32}$/);
    assert.equal(admission.clientRequestId, submitted.clientRequestId); assert.equal(admission.sessionId, seed);
    assert.equal(submitted.sessionId, seed); assert.equal(submitted.input, 'Synthetic private container prompt');
    await expect(page.getByText('Tool started: synthetic-tool — Synthetic tool preview')).toBeVisible();
    await expect(page.getByText('Run completed', { exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic streamed answer', { exact: true })).toHaveCount(1);
    const status = await bounded('http://127.0.0.1:3000/api/live/runs/' + admission.publicRunId, { headers: { 'cf-access-jwt-assertion': config.assertion } });
    assert.equal(status.status, 200);
    const authoritative = JSON.parse(status.text);
    for (const key of ['publicRunId', 'sessionId']) assert.equal(authoritative[key], admission[key]);
    assert.equal(authoritative.status, 'completed'); assert.equal(authoritative.output, 'Synthetic streamed answer');
    const after = await counts();
    assert.equal(after.requests.filter(r => r.method === 'POST' && r.path === '/v1/runs').length - before.requests.filter(r => r.method === 'POST' && r.path === '/v1/runs').length, 1);
    assert.deepEqual(after.violations, []);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    const observedPayloads = after.transport.slice(transportStart);
    assert.ok(observedPayloads.length > 0);
    for (const payload of observedPayloads) { assert.ok(payload.text.length > 0); assert.ok(payload.complete || (payload.path === '/api/live/runs/' + admission.publicRunId + '/events' && payload.text.includes('run.completed'))); }
    assert.equal(after.runs.length - before.runs.length, 1);
    const upstreamRun = after.runs.at(-1);
    assert.deepEqual(upstreamRun.body, { session_id: seed, input: submitted.input });
    assert.match(upstreamRun.key, /^jc-v1-[a-f0-9]{64}$/); assert.equal(upstreamRun.completed, true);
    assert.equal(after.requests.filter(r => r.method === 'GET' && r.path === '/v1/runs/' + upstreamRun.run_id + '/events').length, 1);
    for (const secret of [config.read, config.command, config.upstream, config.assertion, config.unapproved, ...after.runs.map(r => r.run_id)]) { assert.ok(!JSON.stringify(observedPayloads).includes(secret)); assert.ok(!storage.includes(secret)); assert.ok(!status.text.includes(secret)); }
    assert.deepEqual(errors, []);
    const observedFailures = await Promise.all(failures);
    for (const failure of observedFailures) {
      assert.equal(failure.error, 'net::ERR_ABORTED'); assert.equal(failure.responseStatus, 200);
      assert.ok([['POST', origin + '/api/live/runs'], ['GET', origin + '/api/live/runs/' + admission.publicRunId], ['GET', origin + '/api/live/runs/' + admission.publicRunId + '/events']].some(([method, url]) => method === failure.method && url === failure.url));
      assert.ok(observedPayloads.some(r => origin + r.path === failure.url && r.method === failure.method && r.status === 200));
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.screenshot({ path: evidence + '/' + mode + '.png', fullPage: true });
    writeFileSync(evidence + '/' + mode + '.json', JSON.stringify({ admission, authoritative, submitted, before, after, denied, proxyCredentialDenials: 8, errors, failures: observedFailures, payloads: observedPayloads, serviceWorker: await page.evaluate(() => navigator.serviceWorker.controller.scriptURL) }, null, 2));
    await exerciseControls({ page, counts, directory, evidence, mode, seed, crashWindow: path => { crashPath = path; }, recoveredDenials: async path => {
      const before = await counts(), denied = [];
      for (const [label, token, requestOrigin, expected] of [['invalid-auth', 'synthetic-invalid', origin, 401], ['wrong-origin', config.assertion, 'https://127.0.0.1:1', 403]]) {
        const response = await bounded('http://127.0.0.1:3000' + path + '/stop', { method: 'POST', headers: { 'cf-access-jwt-assertion': token, origin: requestOrigin, 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: '{}' });
        assert.equal(response.status, expected); denied.push({ label, path: path + '/stop', ...response });
        const after = await counts();
        assert.deepEqual(after.runs, before.runs);
        assert.deepEqual(after.requests.filter(r => r.method === 'POST'), before.requests.filter(r => r.method === 'POST'));
      }
      return denied;
    } });
    const controlled = await counts();
    const allPayloads = controlled.transport.slice(transportStart);
    for (const secret of [config.read, config.command, config.upstream, config.assertion, config.unapproved, ...controlled.runs.map(r => r.run_id)]) assert.ok(!JSON.stringify(allPayloads).includes(secret));
    assert.deepEqual(errors, []);
    assert.ok(crashErrors.length <= 2);
    for (const error of crashErrors) assert.ok(allPayloads.some(r => origin + r.path === error.url && r.status === 502 && r.method === 'GET' && r.complete));
    for (const failure of await Promise.all(failures)) {
      if (failure.expectedCrash) {
        assert.equal(failure.error, 'net::ERR_ABORTED');
        assert.ok(allPayloads.some(r => origin + r.path === failure.url && r.status === 502 && r.method === 'GET' && r.complete));
        continue;
      }
      assert.equal(failure.error, 'net::ERR_ABORTED'); assert.equal(failure.responseStatus, 200);
      assert.ok(allPayloads.some(r => origin + r.path === failure.url && r.method === failure.method && r.status === 200 && r.text.length > 0 && (r.complete || (r.path.endsWith('/events') && /approval.request|message.delta|run.completed/.test(r.text)))));
    }
    previousPassed = true;
  } catch (error) {
    record({ stage: 'original-failure', ok: false, error: String(error.stack ?? error) });
    throw error;
  } finally {
    await finalizeBrowser({ diagnostic: async () => {
      if (page && !page.isClosed()) await page.screenshot({ path: evidence + '/' + mode + '-final.png', timeout: 1000, fullPage: true });
      writeFileSync(evidence + '/' + mode + '-diagnostics.json', JSON.stringify({ errors, crashErrors, failures, counts: await counts() }, null, 2));
    }, contextClose: () => context?.close(), browserClose: () => browser.close(), record });
    t.signal.removeEventListener('abort', abort);
  }
});
