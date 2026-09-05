import { writeFile } from 'node:fs/promises';
import { expect, test, type BrowserContext } from '@playwright/test';
import { startRealChain } from './real-chain.fixture';

test('compiled browser traverses authenticated BFF and both real proxies', async ({ browser }, testInfo) => {
  const chain = await startRealChain();
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ ...testInfo.project.use, extraHTTPHeaders: { 'cf-access-jwt-assertion': chain.assertion }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors: string[] = [];
    const failures: Promise<{ url: string; method: string; error: string | undefined; responseStatus: number | undefined }>[] = [];

    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => failures.push(request.response().then(response => ({ url: request.url(), method: request.method(), error: request.failure()?.errorText, responseStatus: response?.status() }))));

    await page.goto(chain.origin);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const picker = page.getByRole('combobox', { name: 'Session' });
    await picker.selectOption(chain.seedId);
    await expect(page.getByText('Synthetic historical message', { exact: true })).toBeVisible();
    const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/live/sessions') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'New Command session', exact: true }).click();
    const created = await (await createdResponse).json();
    const sessionId = created.session.id;
    expect(sessionId).toMatch(/^jc_[a-f0-9]{32}$/);
    await expect(picker).toHaveValue(sessionId);
    const admissionResponse = page.waitForResponse(response => response.url().endsWith('/api/live/runs') && response.request().method() === 'POST');
    await page.getByRole('textbox', { name: 'Message Jarvis' }).fill(chain.prompt);
    await page.getByRole('button', { name: 'Send message' }).click();
    expect((await admissionResponse).status()).toBe(200);
    const admission = JSON.parse(chain.payloads.find(payload => payload.path === '/api/live/runs')!.text);
    expect(admission).toMatchObject({ sessionId, publicRunId: expect.stringMatching(/^jcr_[a-f0-9]{32}$/), status: 'running' });
    await expect(page.getByText('Tool started: synthetic-tool — Synthetic tool preview')).toBeVisible();
    await expect(page.getByText('Run completed', { exact: true })).toBeVisible();
    await expect(page.getByText(chain.output, { exact: true })).toHaveCount(1);
    const status = await page.evaluate(async id => (await fetch('/api/live/runs/' + id)).json(), admission.publicRunId);
    expect(status).toMatchObject({ publicRunId: admission.publicRunId, sessionId, status: 'completed', output: chain.output });
    expect(chain.count('POST', '/api/sessions')).toBe(1);
    expect(chain.count('POST', '/v1/runs')).toBe(1);
    expect(chain.count('GET', '/v1/runs/' + chain.runId + '/events')).toBe(1);
    for (const path of ['/health/detailed', '/v1/capabilities', '/api/sessions']) expect(chain.count('GET', path)).toBeGreaterThan(0);
    expect(chain.runBody).toEqual({ session_id: sessionId, input: chain.prompt });
    expect(chain.idempotencyKey).toMatch(/^jc-v1-[a-f0-9]{64}$/);
    expect(chain.browserMutations).toEqual([
      { path: '/api/live/sessions', origin: chain.origin, marker: '1', contentType: 'application/json' },
      { path: '/api/live/runs', origin: chain.origin, marker: '1', contentType: 'application/json' },
    ]);
    const payloads = chain.payloads.map(payload => payload.text);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    const audit = await chain.audit();
    expect(audit).toContain(admission.publicRunId);
    for (const secret of [...chain.secrets, chain.assertion]) {
      expect(payloads.join('\n')).not.toContain(secret);
      expect(storage).not.toContain(secret);
      expect(audit).not.toContain(secret);
    }
    for (const privateText of [chain.prompt, chain.output, 'Synthetic steer never sent', chain.email]) expect(audit).not.toContain(privateText);
    expect(payloads.join('\n')).not.toContain(chain.runId);
    expect(chain.upstreamViolations).toEqual([]);
    expect(errors).toEqual([]);
    // The UI intentionally closes EventSource after its verified terminal event.
    // Chromium may report that successful lifecycle as ERR_ABORTED, not EOF.
    const observedFailures = await Promise.all(failures);
    for (const failure of observedFailures) {
      expect(failure).toMatchObject({ error: 'net::ERR_ABORTED', responseStatus: 200 });
      const path = new URL(failure.url).pathname;
      expect(failure.url.startsWith(chain.origin + '/')).toBe(true);
      if (path.endsWith('/events')) {
        expect(failure.method).toBe('GET');
        expect(path).toBe('/api/live/runs/' + admission.publicRunId + '/events');
      } else {
        expect([['POST', '/api/live/sessions'], ['POST', '/api/live/runs'], ['GET', '/api/live/runs/' + admission.publicRunId]]).toContainEqual([failure.method, path]);
        expect(chain.payloads.some(payload => payload.path === path)).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('real-chain.png'), fullPage: true });

    const before = chain.requests.length;
    const denied: { label: string; status: number }[] = [];
    for (const [label, assertion, origin, expected] of [
      ['missing', undefined, chain.origin, 401],
      ['invalid', 'synthetic-invalid-jwt', chain.origin, 401],
      ['unapproved', chain.unapprovedAssertion, chain.origin, 401],
      ['wrong-origin', chain.assertion, 'http://127.0.0.1:1', 403],
    ] as const) {
      for (const [path, body] of [
        ['/api/live/sessions', {}],
        ['/api/live/runs', { sessionId, clientRequestId: '11111111-1111-4111-8111-111111111111', input: 'Denied synthetic input' }],
        ['/api/live/runs/' + admission.publicRunId + '/approval', { requestId: 'synthetic-approval', choice: 'once' }],
        ['/api/live/runs/' + admission.publicRunId + '/steer', { input: 'Denied synthetic steer' }],
        ['/api/live/runs/' + admission.publicRunId + '/stop', {}],
        ['/api/live/sessions/' + sessionId + '/continue', {}],
      ] as const) {
        const response = await fetch(chain.origin + path, {
          method: 'POST', headers: { ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}), origin, 'x-jarvis-command': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        denied.push({ label: label + ':' + path, status: response.status });
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(response.headers.get('cache-control')).toContain('no-store');
        await response.text();
        expect(response.status, label + ':' + path).toBe(expected);
        expect(chain.requests).toHaveLength(before);
      }
    }
    await testInfo.attach('chain-evidence', { body: JSON.stringify({ syntheticAuth: true, realCloudflareLogin: false, origin: chain.origin, sessionId, publicRunId: admission.publicRunId, upstreamRunId: chain.runId, requests: chain.requests, denied, errors, failures: observedFailures, audit }, null, 2), contentType: 'application/json' });
  } finally {
    try { await context?.close(); } finally { await chain.close(); }
  }
});

for (const choice of ['once', 'deny'] as const) test(`real-chain approval ${choice} requires authoritative readback`, async ({ browser }, testInfo) => {
  const chain = await startRealChain('controls');
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ ...testInfo.project.use, extraHTTPHeaders: { 'cf-access-jwt-assertion': chain.assertion }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors: string[] = [];
    const failures: Promise<{ url: string; method: string; error: string | undefined; responseStatus: number | undefined; intentionalClose: boolean }>[] = [];
    let intentionalClose = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => {
      const wasIntentional = intentionalClose;
      failures.push(request.response().then(response => ({ url: request.url(), method: request.method(), error: request.failure()?.errorText, responseStatus: response?.status(), intentionalClose: wasIntentional })));
    });
    await page.goto(chain.origin);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.getByRole('combobox', { name: 'Session' }).selectOption(chain.seedId);
    await page.getByRole('textbox', { name: 'Message Jarvis' }).fill(chain.prompt);
    const admitted = page.waitForResponse(response => response.url() === chain.origin + '/api/live/runs' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Send message' }).click();
    expect((await admitted).status()).toBe(200);
    const admission = JSON.parse(chain.payloads.find(payload => payload.path === '/api/live/runs')!.text);
    const card = page.getByRole('region', { name: 'Awaiting approval', exact: true });
    await expect(card).toBeVisible();
    await expect(card.locator('pre')).toHaveText('printf synthetic-control ; printf /EXACT_SYNTHETIC_TARGET');
    await expect(card).toContainText('Request: synthetic-approval-exact');
    await expect(card).toContainText(`Run: ${admission.publicRunId} · Session: ${chain.seedId}`);
    // Read the actual BFF SSE bytes over a separate authenticated loopback socket.
    // No browser routing, response mocks, or private upstream values in the evidence.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 5_000);
    let sse = '';
    try {
      const response = await fetch(chain.origin + '/api/live/runs/' + admission.publicRunId + '/events', { headers: { 'cf-access-jwt-assertion': chain.assertion }, signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      try {
        while (!sse.includes('approval.request')) {
          const chunk = await reader.read();
          if (chunk.done) break;
          sse += new TextDecoder().decode(chunk.value);
        }
      } finally { controller.abort(); void reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      throw new Error('SSE probe failed: ' + JSON.stringify({ received: sse, requests: chain.requests }), { cause: error });
    } finally { clearTimeout(deadline); controller.abort(); }
    expect(sse).toContain('"publicRunId":"' + admission.publicRunId + '"');
    expect(sse).toContain('"requestId":"synthetic-approval-exact"');
    for (const privateValue of [...chain.secrets, chain.assertion, chain.runId]) expect(sse).not.toContain(privateValue);
    const readback = page.waitForResponse(response => response.url() === chain.origin + '/api/live/runs/' + admission.publicRunId && response.request().method() === 'GET');
    intentionalClose = true; // Successful control handling deliberately closes this exact SSE to poll status.
    await card.getByRole('button', { name: choice === 'once' ? 'Approve once' : 'Deny', exact: true }).click();
    expect((await readback).status()).toBe(200);
    expect(JSON.parse(chain.payloads.filter(payload => payload.path === '/api/live/runs/' + admission.publicRunId).at(-1)!.text)).toMatchObject({ publicRunId: admission.publicRunId, sessionId: chain.seedId, status: 'running', approval: null });
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
    expect(chain.count('POST', '/v1/runs/' + chain.runId + '/approval')).toBe(1);
    expect(chain.controls).toEqual([{ runId: chain.runId, path: '/v1/runs/' + chain.runId + '/approval', body: { request_id: 'synthetic-approval-exact', choice } }]);
    if (choice === 'once') {
      await page.getByRole('textbox', { name: 'Steer Jarvis' }).fill('Synthetic private queued guidance');
      await page.getByRole('button', { name: 'Queue steer', exact: true }).click();
      await expect(page.getByText('Steer queued — not executed. Checking status.', { exact: true })).toBeVisible();
      expect(chain.controls.at(-1)).toEqual({ runId: chain.runId, path: '/v1/runs/' + chain.runId + '/steer', body: { input: 'Synthetic private queued guidance' } });
      expect(chain.runBody).toEqual({ session_id: chain.seedId, input: chain.prompt });
      const identity = { sessionId: chain.seedId, clientRequestId: admission.clientRequestId, publicRunId: admission.publicRunId };
      const stored = () => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
      expect(await stored()).toEqual({ local: {}, session: { 'jarvis-command:live-turn': JSON.stringify(identity) } });
      const gate = chain.holdStatus();
      try {
        await page.reload();
        await gate.entered;
        await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toHaveCount(0);
        await expect(page.getByRole('textbox', { name: 'Steer Jarvis' })).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Current turn', exact: true })).toContainText(`Session: ${chain.seedId} · Request: ${admission.clientRequestId} · Run: ${admission.publicRunId}`);
      } finally { gate.release(); }
      await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
      expect(await stored()).toEqual({ local: {}, session: { 'jarvis-command:live-turn': JSON.stringify(identity) } });
      expect(chain.count('POST', '/v1/runs')).toBe(1);
      expect(chain.count('POST', '/v1/runs/' + chain.runId + '/steer')).toBe(1);
      // Close browser transports before restarting ONLY this owned BFF. Keep the
      // same tab/origin's sessionStorage, proxies, synthetic upstream and audit file.
      await page.goto('about:blank');
      const auditBeforeRestart = await chain.audit();
      expect(chain).toHaveProperty('restart');
      const restarted = await chain.restart();
      expect(restarted).toEqual({ previousStopped: true, origin: chain.origin });
      await page.goto(chain.origin);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
      expect(await stored()).toEqual({ local: {}, session: { 'jarvis-command:live-turn': JSON.stringify(identity) } });
      await expect(page.getByRole('region', { name: 'Current turn', exact: true })).toContainText(`Session: ${chain.seedId} · Request: ${admission.clientRequestId} · Run: ${admission.publicRunId}`);
      expect(await chain.audit()).toContain(auditBeforeRestart);
      expect(chain.count('POST', '/v1/runs')).toBe(1);
      expect(chain.count('POST', '/v1/runs/' + chain.runId + '/steer')).toBe(1);
      await page.getByRole('button', { name: 'Stop run', exact: true }).click();
      const dialog = page.getByRole('region', { name: 'Confirm stop', exact: true });
      await expect(dialog).toContainText(`Run: ${admission.publicRunId}`);
      await expect(dialog).toContainText(`Session: ${chain.seedId}`);
      expect(chain.count('POST', '/v1/runs/' + chain.runId + '/stop')).toBe(0);
      await dialog.getByRole('button', { name: 'Keep running', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(chain.count('POST', '/v1/runs/' + chain.runId + '/stop')).toBe(0);
      await page.getByRole('button', { name: 'Stop run', exact: true }).click();
      await dialog.getByRole('button', { name: 'Confirm stop', exact: true }).click();
      await expect(page.getByText('Stop requested — outcome unconfirmed until status read-back', { exact: true })).toBeVisible();
      await expect(page.getByText('Run stopping', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
      expect(chain.count('POST', '/v1/runs/' + chain.runId + '/stop')).toBe(1);
      expect(chain.controls.at(-1)).toEqual({ runId: chain.runId, path: '/v1/runs/' + chain.runId + '/stop', body: {} });
      chain.finish();
      await expect(page.getByText('Run cancelled', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled();
      await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Synthetic private queued guidance');
      expect(await stored()).toEqual({ local: {}, session: {} });
      await page.getByRole('textbox', { name: 'Message Jarvis' }).fill('Edited in memory');
      await page.getByRole('combobox', { name: 'Session' }).selectOption(chain.seedId);
      await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Edited in memory');
      await expect(page.getByRole('region', { name: 'Recover steer draft', exact: true })).toHaveCount(0);
      expect(chain.count('POST', '/v1/runs')).toBe(1);
    }
    await page.screenshot({ path: testInfo.outputPath('approval.png'), fullPage: true });
    const audit = await chain.audit();
    for (const privateValue of [...chain.secrets, chain.assertion, chain.prompt, chain.output, chain.email, 'Synthetic private queued guidance']) expect(audit).not.toContain(privateValue);
    expect(chain.upstreamViolations).toEqual([]);
    expect(errors).toEqual([]);
    // Control/reload cleanup aborts the exact old GET status reader as well as SSE.
    // Only accept those cancellations after control and authoritative readback assertions.
    const observedFailures = await Promise.all(failures);
    for (const failure of observedFailures) {
      expect(failure).toMatchObject({ error: 'net::ERR_ABORTED', responseStatus: 200 });
      const path = new URL(failure.url).pathname;
      expect(failure.url.startsWith(chain.origin + '/')).toBe(true);
      if (failure.method === 'GET') {
        expect(failure.intentionalClose).toBe(true);
        expect(['/api/live/runs/' + admission.publicRunId, '/api/live/runs/' + admission.publicRunId + '/events']).toContain(path);
      } else {
        expect(failure.method).toBe('POST');
        expect(['/api/live/runs', ...['approval', 'steer', 'stop'].map(action => '/api/live/runs/' + admission.publicRunId + '/' + action)]).toContain(path);
        expect(chain.payloads.some(payload => payload.path === path)).toBe(true);
      }
    }
    await writeFile(testInfo.outputPath('approval.json'), JSON.stringify({ choice, admission, requests: chain.requests, controls: chain.controls, errors, failures: observedFailures, sse, audit }, null, 2));
  } finally {
    try { await context?.close(); } finally { await chain.close(); }
  }
});
