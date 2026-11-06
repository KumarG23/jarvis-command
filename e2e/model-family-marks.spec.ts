import { expect, test as base } from '@playwright/test';
import { emptyInbox } from './empty-inbox';
const test = base.extend({ browser: async ({ playwright }, use) => {
  const endpoint = process.env.STUDIO_BROWSER_CDP_ENDPOINT;
  if (!endpoint) throw Error('Studio wrapper required');
  const browser = await playwright.chromium.connectOverCDP(endpoint);
  await use(browser); // Owned contexts close; shared Chrome remains running.
} });
for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) {
  test(`SYNTHETIC executed family and isolated history ${width}x${height}`, async ({ page }, info) => {
    const before = info.project.name === 'before';
    const sessionId = `jc_${'a'.repeat(32)}`, publicRunId = `jcr_${'b'.repeat(32)}`;
    const timestamp = '2026-11-06T12:00:00.000Z';
    const session = { id: sessionId, title: 'SYNTHETIC family evidence', source: 'api_server', ownership: 'command', model: 'gpt-6-sol', lastActive: timestamp, messageCount: 1, toolCallCount: 0, pinned: false };
    const usage = { inputTokens: 120, outputTokens: 30, totalTokens: 150, apiCalls: 1, execution: {
      requested: { provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'high' },
      executed: { provider: 'anthropic', model: 'claude-sonnet-5-5', reasoningEffort: null, reasoningEffortSource: 'unknown' },
      routeSource: 'unknown', exact: false, fallbackUsed: true,
    } };
    const message = (id: string, role: string, content: string) => ({ id, sessionId, role, content, timestamp, toolName: null, displayKind: null });
    let bound = false, admissions = 0, clientRequestId = '';
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.addInitScript(id => sessionStorage.setItem('jarvis-command:selected-session:v1', id), sessionId);
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P11 model-family fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session] });
      if (path === '/api/rooms') return json({ version: 1, rooms: [] });
      if (path === '/api/notifications') return json(emptyInbox);
      if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'SYNTHETIC requested route', reasoningEfforts: ['high'] }] });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      if (path === `/api/live/sessions/${sessionId}`) return json({ session });
      if (path.endsWith('/context')) return json({ sessionId, state: 'available', updatedAt: timestamp, receipt: usage });
      if (path.endsWith('/messages')) return json({ sessionId, messages: [message('synthetic:old-a', 'assistant', 'SYNTHETIC old answer mentions gpt-6-sol.'), ...(bound ? [message('synthetic:new-u', 'user', 'SYNTHETIC inspect execution'), message('synthetic:new-a', 'assistant', 'SYNTHETIC actual response')] : [])], pagination: { limit: 50, offset: 0, returned: bound ? 3 : 1, hasMore: false } });
      if (path === '/api/live/runs' && req.method() === 'POST') {
        admissions++; clientRequestId = req.postDataJSON().clientRequestId;
        return json({ sessionId, publicRunId, clientRequestId, status: 'running', replayed: false });
      }
      if (path === `/api/live/runs/${publicRunId}`) return json({ sessionId, publicRunId, status: 'completed', updatedAt: timestamp, approval: null, output: 'SYNTHETIC actual response', error: null, pendingSteer: null, usage, ...(bound ? { historyBinding: { userMessageId: 'synthetic:new-u', assistantMessageId: 'synthetic:new-a' } } : {}) });
      if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: [{ type: 'message.delta', delta: 'SYNTHETIC actual response' }, { type: 'run.completed', output: 'SYNTHETIC actual response', pendingSteer: null, usage }].map(event => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, publicRunId, timestamp })}\n\n`).join('') });
      errors.push(`unexpected ${req.method()} ${path}`); return route.abort();
    });
    await page.goto('/');
    await expect(page.getByLabel('Selected session')).toHaveText(session.title);
    const historical = page.locator('[data-message-id="synthetic:old-a"]');
    await expect(historical).toBeVisible();
    const latest = page.getByLabel('Saved session receipt', { exact: true });
    await expect(latest).toContainText('Latest saved session receipt');
    await expect(latest).toContainText('Individual message association unavailable');
    if (!before) {
      await expect(historical).toContainText('Model family unknown');
      await expect(historical.locator('[data-family="claude"]')).toHaveCount(0);
      await expect(latest.locator('[data-family="claude"]')).toHaveCount(1);
    }
    await latest.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-${before ? 'before' : 'after'}-latest-separate.png`) });
    const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
    await composer.fill('SYNTHETIC inspect execution');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const live = page.locator('.live-message[aria-label="Jarvis response"]');
    await expect(page.getByRole('status', { name: 'Run status', exact: true })).toContainText('Run completed');
    await expect(live).toContainText('SYNTHETIC actual response');
    if (!before) await expect(live.locator('[data-family="claude"]')).toHaveCount(2);
    await page.locator('.timeline').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(live).toBeVisible();
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-${before ? 'before' : 'after'}-live.png`) });
    await page.getByText('Activity / Usage', { exact: true }).click();
    const receipt = page.getByRole('region', { name: 'Execution receipt' });
    await expect(receipt).toContainText('Fallback used');
    await expect(receipt).toContainText('Requested route changed during execution.');
    await expect(receipt).toContainText('150 tokens');
    if (!before) await expect(receipt.locator('[data-family="claude"]')).toHaveCount(1);
    await receipt.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-${before ? 'before' : 'after'}-receipt.png`) });
    bound = true;
    // V2 has already imported the legacy singleton during the first admission.
    // Seed the existing per-thread recovery record, never an ignored legacy key.
    await page.addInitScript(({ sessionId, publicRunId, clientRequestId }) => sessionStorage.setItem('jarvis-command:live-threads:v2', JSON.stringify({ version: 2, legacyImported: true, records: [{ sessionId, publicRunId, clientRequestId }] })), { sessionId, publicRunId, clientRequestId });
    await page.reload();
    const canonical = page.locator('[data-message-id="synthetic:new-a"]');
    await expect(canonical).toContainText('SYNTHETIC actual response');
    if (!before) {
      await expect(canonical.locator('[data-family="claude"]')).toHaveCount(2);
      await expect(historical).toContainText('Model family unknown');
      await expect(historical.locator('[data-family="claude"]')).toHaveCount(0);
    }
    await canonical.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-${before ? 'before' : 'after'}-bound-history.png`) });
    expect(admissions).toBe(1); expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
