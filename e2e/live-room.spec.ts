import { expect, test } from '@playwright/test';

// Synthetic browser fixtures only: no privileged upstream or production mutation.
test.use({ serviceWorkers: 'block' });
test('streams a synthetic turn through the compiled UI', async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const timestamp = '2026-09-04T12:00:00.000Z';
  const sessionId = 'jc_browser_turn';
  const publicRunId = 'jcr_' + 'a'.repeat(32);
  const session = { id: sessionId, title: 'Synthetic live conversation with a long project title for phone readability', ownership: 'command', source: 'web', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
  await page.route('**/api/bootstrap', (route) => route.fulfill({ json: {
    identity: { provider: 'development' }, command: { version: 'test', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } },
    hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session],
  } }));
  await page.route('**/api/sessions/*/messages?*', (route) => route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
  let sends = 0;
  await page.route('**/api/live/runs', async (route) => {
    sends++;
    const body = route.request().postDataJSON();
    expect(body).toEqual({ sessionId, input: 'Synthetic hello', clientRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(route.request().headers()['x-jarvis-command']).toBe('1');
    await route.fulfill({ json: { sessionId, publicRunId, clientRequestId: body.clientRequestId, status: 'running', replayed: false } });
  });
  await page.route(`**/api/live/runs/${publicRunId}/events`, (route) => route.fulfill({ contentType: 'text/event-stream', body: [
    { type: 'message.delta', delta: 'Browser streamed answer' },
    { type: 'tool.started', tool: 'synthetic', preview: 'No real commands' },
    { type: 'run.completed', output: 'Browser streamed answer', pendingSteer: null, usage: null },
  ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, publicRunId, timestamp })}\n\n`).join('') }));
  await page.route(`**/api/live/runs/${publicRunId}`, (route) => route.fulfill({ json: { publicRunId, sessionId, status: 'completed', updatedAt: timestamp, approval: null, output: 'Browser streamed answer', error: null, pendingSteer: null, usage: null } }));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Session' }).selectOption(sessionId);
  await page.getByRole('textbox', { name: 'Message Jarvis' }).fill('Synthetic hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Run completed', { exact: true })).toBeVisible();
  await expect(page.getByText('Browser streamed answer', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Tool started: synthetic — No real commands')).toBeVisible();
  await expect(page.getByText('No saved messages in session history yet.', { exact: true })).toBeVisible();
  const responseCard = page.getByRole('article', { name: 'Jarvis response' });
  await expect(responseCard).toBeVisible();
  await expect(page.getByRole('list', { name: 'Run activity' })).toBeVisible();
  const title = page.getByLabel('Selected session');
  await expect(title).toHaveText(session.title);
  expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await title.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('normal');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await responseCard.getByRole('button', { name: 'Copy response' }).click();
  await expect(responseCard.getByText('Response copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Browser streamed answer');
  await page.screenshot({ path: testInfo.outputPath('live-conversation.png'), fullPage: true });
  expect(await page.locator('.timeline').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(sends).toBe(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
test('reloads a known synthetic run with identifiers only and no second admission', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const timestamp = '2026-09-04T12:00:00.000Z';
  const sessionId = 'jc_browser_reload'; const publicRunId = 'jcr_' + 'c'.repeat(32);
  const key = 'jarvis-command:live-turn'; const input = 'Synthetic private input not persisted';
  let state = 'running'; let posts = 0; let reads = 0;
  const session = { id: sessionId, title: 'Synthetic reload', ownership: 'command', source: 'web', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
  await page.route('**/api/bootstrap', (route) => route.fulfill({ json: {
    identity: { provider: 'development' }, command: { version: 'test', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } },
    hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session],
  } }));
  await page.route('**/api/sessions/*/messages?*', (route) => route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
  await page.route('**/api/live/runs', async (route) => {
    posts++;
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ sessionId, input });
    expect(JSON.parse(await page.evaluate((key) => sessionStorage.getItem(key), key) ?? 'null')).toEqual({ sessionId, clientRequestId: body.clientRequestId, publicRunId: null });
    await route.fulfill({ json: { sessionId, publicRunId, clientRequestId: body.clientRequestId, status: 'running', replayed: false } });
  });
  await page.route(`**/api/live/runs/${publicRunId}/events`, (route) => route.fulfill({ contentType: 'text/event-stream', body: ': synthetic stream\n\n' }));
  await page.route(`**/api/live/runs/${publicRunId}`, (route) => {
    reads++;
    return route.fulfill({ json: { sessionId, publicRunId, status: state, updatedAt: timestamp, approval: null, output: null, error: null, pendingSteer: state === 'completed' ? 'Recovered memory-only guidance' : null, usage: null } });
  });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Session' }).selectOption(sessionId);
  await page.getByRole('textbox', { name: 'Message Jarvis' }).fill(input);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(async () => JSON.parse(await page.evaluate((key) => sessionStorage.getItem(key), key) ?? 'null')?.publicRunId).toBe(publicRunId);
  const saved = JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), key))!);
  expect(Object.keys(saved).sort()).toEqual(['clientRequestId', 'publicRunId', 'sessionId']);
  expect(JSON.stringify(saved)).not.toContain(input);
  const before = reads;
  await page.reload();
  await expect(page.getByText(/Original message unavailable/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Session' })).toHaveValue(sessionId);
  await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
  await expect.poll(() => reads).toBeGreaterThan(before);
  expect(JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), key))!)).toEqual(saved);
  expect(posts).toBe(1);
  state = 'completed';
  await expect(page.getByText('Run completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('Recovered memory-only guidance');
  await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
  expect(posts).toBe(1); expect(errors).toEqual([]);
});
for (const choice of ['once', 'deny'] as const) test(`performs synthetic ${choice} approval and confirmed stop`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const timestamp = '2026-09-04T12:00:00.000Z';
  const sessionId = 'jc_browser_controls';
  const publicRunId = 'jcr_' + 'b'.repeat(32);
  const approval = { requestId: 'approval:browser', command: `Synthetic command ${'complete-target-'.repeat(40)} END-TARGET`, description: 'Synthetic only; no real command', tool: 'synthetic' };
  const session = { id: sessionId, title: 'Synthetic controls', ownership: 'command', source: 'web', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
  let state = 'waiting_for_approval';
  let approvals = 0;
  let stops = 0;
  let statusReads = 0;
  await page.route('**/api/bootstrap', (route) => route.fulfill({ json: {
    identity: { provider: 'development' }, command: { version: 'test', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } },
    hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session],
  } }));
  await page.route('**/api/sessions/*/messages?*', (route) => route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
  await page.route('**/api/live/runs', (route) => route.fulfill({ json: { sessionId, publicRunId, clientRequestId: route.request().postDataJSON().clientRequestId, status: 'running', replayed: false } }));
  await page.route(`**/api/live/runs/${publicRunId}/events`, (route) => route.fulfill({ contentType: 'text/event-stream', body: `event: approval.request\ndata: ${JSON.stringify({ type: 'approval.request', approval, publicRunId, timestamp })}\n\n` }));
  await page.route(`**/api/live/runs/${publicRunId}`, (route) => {
    statusReads++;
    return route.fulfill({ json: { publicRunId, sessionId, status: state, updatedAt: timestamp, approval: state === 'waiting_for_approval' ? approval : null, output: null, error: null, pendingSteer: null, usage: null } });
  });
  await page.route(`**/api/live/runs/${publicRunId}/approval`, (route) => {
    approvals++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-jarvis-command']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({ requestId: approval.requestId, choice });
    state = 'running';
    return route.fulfill({ json: { publicRunId, requestId: approval.requestId, choice, resolved: 1 } });
  });
  await page.route(`**/api/live/runs/${publicRunId}/stop`, (route) => {
    stops++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-jarvis-command']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({});
    state = 'stopping';
    return route.fulfill({ json: { publicRunId, status: 'stopping' } });
  });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Session' }).selectOption(sessionId);
  await page.getByRole('textbox', { name: 'Message Jarvis' }).fill('Synthetic controls');
  await page.getByRole('button', { name: 'Send message' }).click();
  const card = page.getByRole('region', { name: 'Awaiting approval' });
  await expect(card.locator('pre')).toHaveText(approval.command);
  await expect(card).toContainText(approval.requestId);
  await expect(card).toContainText(publicRunId);
  await expect(card).toContainText(sessionId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('approval.png'), fullPage: true });
  await page.getByRole('button', { name: 'Approve once', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Approve once', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('approval-actions.png'), fullPage: true });
  const readsBefore = statusReads;
  await page.getByRole('button', { name: choice === 'once' ? 'Approve once' : 'Deny', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => statusReads).toBeGreaterThan(readsBefore);
  await page.getByRole('button', { name: 'Stop run', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Confirm stop' })).toContainText(publicRunId);
  await page.getByRole('button', { name: 'Keep running' }).click();
  expect(stops).toBe(0);
  await page.getByRole('button', { name: 'Stop run', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('confirm-stop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Current turn' }).getByText('Run stopping', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeDisabled();
  state = 'cancelled';
  await expect(page.getByText('Run cancelled', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled();
  expect(approvals).toBe(1);
  expect(stops).toBe(1);
  expect(errors).toEqual([]);
});
test('queues synthetic steer and recovers terminal guidance to the same room draft once', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const timestamp = '2026-09-04T12:00:00.000Z';
  const sessionId = 'jc_browser_steer'; const publicRunId = 'jcr_' + 'c'.repeat(32);
  const input = '  Synthetic guidance\nkeep exact  ';
  const session = { id: sessionId, title: 'Synthetic steer', ownership: 'command', source: 'web', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
  let steers = 0; let sends = 0; let terminal = false;
  await page.route('**/api/bootstrap', (route) => route.fulfill({ json: {
    identity: { provider: 'development' }, command: { version: 'test', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } },
    hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session, { ...session, id: 'jc_other', title: 'Other room' }],
  } }));
  await page.route('**/api/sessions/*/messages?*', (route) => route.fulfill({ json: { sessionId: route.request().url().includes('jc_other') ? 'jc_other' : sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
  await page.route('**/api/live/runs', (route) => { sends++; return route.fulfill({ json: { sessionId, publicRunId, clientRequestId: route.request().postDataJSON().clientRequestId, status: 'running', replayed: false } }); });
  await page.route(`**/api/live/runs/${publicRunId}/events`, (route) => route.fulfill({ contentType: 'text/event-stream', body: ': synthetic stream\n\n' }));
  await page.route(`**/api/live/runs/${publicRunId}`, (route) => route.fulfill({ json: { publicRunId, sessionId, status: terminal ? 'completed' : 'running', updatedAt: timestamp, approval: null, output: null, error: null, pendingSteer: terminal ? input : null, usage: null } }));
  await page.route(`**/api/live/runs/${publicRunId}/steer`, (route) => {
    steers++; expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-jarvis-command']).toBe('1');
    expect(route.request().headers()['content-type']).toBe('application/json');
    expect(route.request().postDataJSON()).toEqual({ input });
    return route.fulfill({ json: { publicRunId, accepted: true, state: 'queued' } });
  });
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Session' });
  const draft = page.getByRole('textbox', { name: 'Message Jarvis' });
  await picker.selectOption(sessionId); await draft.fill('Synthetic hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('textbox', { name: 'Steer Jarvis' }).fill(input);
  await page.getByRole('button', { name: 'Queue steer' }).click();
  await expect(page.getByText('Steer queued — not executed. Checking status.')).toBeVisible();
  await expect(draft).toBeDisabled();
  await picker.selectOption('jc_other'); terminal = true;
  await expect(draft).toBeEnabled(); await expect(draft).toHaveValue('');
  await picker.selectOption(sessionId); await expect(draft).toHaveValue(input);
  await draft.fill('Edited after restoration');
  await picker.selectOption('jc_other'); await picker.selectOption(sessionId);
  await expect(draft).toHaveValue('Edited after restoration');
  expect(steers).toBe(1); expect(sends).toBe(1); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
test('selects history and creates a room at desktop and phone widths', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => failed.push(request.url()));
  const session = { id: 'browser:external+exact', title: 'Synthetic history room', ownership: 'external', source: 'discord', model: null, lastActive: '2026-09-04T12:00:00.000Z', messageCount: 1, toolCallCount: 0, pinned: false };
  const created = { ...session, id: 'jc_browser', title: 'Synthetic Command room', ownership: 'command', source: 'web', messageCount: 0 };
  const content = `First line\nSecond line\n${'long-output-'.repeat(80)}`;
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.command.liveRoom.enabled = true;
    body.sessions = [session];
    await route.fulfill({ json: body });
  });
  await page.route('**/api/sessions/*/messages?*', async (route) => {
    const empty = route.request().url().includes('/jc_browser/');
    await route.fulfill({ json: {
      sessionId: empty ? created.id : session.id,
      messages: empty ? [] : [{ id: 'message:exact', sessionId: session.id, role: 'tool', content, timestamp: null, toolName: 'synthetic terminal', displayKind: null }],
      pagination: { limit: 50, offset: 0, returned: empty ? 0 : 1, hasMore: false },
    } });
  });
  let creations = 0;
  await page.route('**/api/live/sessions', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-jarvis-command']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({});
    creations += 1;
    await route.fulfill({ json: { session: created } });
  });
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Session' });
  await expect(picker).toBeVisible();
  await picker.selectOption(session.id);
  await expect(page.getByText('External session · Read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue in Command' })).toBeDisabled();
  const output = page.locator('.history-message .event-body p');
  await expect(output).toHaveText(content);
  expect(await output.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('pre-wrap');
  expect(await page.locator('.timeline').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('history.png'), fullPage: true });
  await page.getByRole('button', { name: 'New Command session', exact: true }).click();
  await expect(page.getByRole('heading', { name: created.title })).toBeVisible();
  await expect(picker).toHaveValue(created.id);
  await expect(page.getByText('No saved messages in session history yet.')).toBeVisible();
  expect(creations).toBe(1);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('created.png'), fullPage: true });
});
