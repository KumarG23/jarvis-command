import { expect, test as base } from '@playwright/test';
import { CommandBootstrapSchema } from '@jarvis-command/contracts';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';
import { handleThreadState } from './thread-state-route';

// Use the same owned-context lifecycle as the accepted #97 wrapper fixture.
const test = base.extend({
  browser: async ({ playwright }, use) => {
    const endpoint = process.env.STUDIO_BROWSER_CDP_ENDPOINT;
    if (!endpoint) throw Error('Run through the Studio browser QA wrapper');
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    await use(browser);
    // The shared browser stays running; the runner disconnects on exit.
  },
});

test('SYNTHETIC OpenRouter free selector stays honest at desktop, 360px and short keyboard height', async ({ page, context }, info) => {
  test.setTimeout(90_000);
  const diagnostics: unknown[] = [];
  const requests: string[] = [];
  const errors: string[] = [];
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') diagnostics.push({ console: message.text() }); });
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith('/api/')) diagnostics.push({ path, status: response.status() });
    });
    const sessionId = `jc_${'9'.repeat(32)}`;
    const runId = `jcr_${'8'.repeat(32)}`;
    const timestamp = '2026-11-06T18:00:00.000Z';
    const session = { id: sessionId, title: 'SYNTHETIC OpenRouter free fixture', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
    const bootstrap = CommandBootstrapSchema.parse({
      identity: { provider: 'development' },
      command: { version: 'SYNTHETIC issue-96 fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } },
      hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} },
      sessions: [session],
    });
    const free = { provider: 'openrouter', model: 'z-ai/glm-4.5-air:free', label: 'Free · z-ai/glm-4.5-air:free', reasoningEfforts: [] };
    const paid = { provider: 'openrouter', model: 'vendor/paid-model', advertised: true, authenticated: true, eligible: false, selectable: false, unavailableReason: 'not_approved_allowlist' };
    const freeEntry = { provider: free.provider, model: free.model, advertised: true, authenticated: true, eligible: true, selectable: true, unavailableReason: null };
    const catalog = { entries: [freeEntry, paid], advertisedCount: 2, returned: 2, truncated: false };
    const unexpected: string[] = [];
    let inventoryReads = 0;
    const posts: Record<string, unknown>[] = [];
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      requests.push(`${request.method()} ${path}`);
      // Accepted shared seams: strict foreground-presence POST and Unknown (never unread) thread state.
      if (handlePresence(route) || handleThreadState(route, [sessionId])) return;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (path === '/api/live/runs' && request.method() === 'POST') {
        const payload = request.postDataJSON() as Record<string, unknown>;
        posts.push(payload);
        expect(Object.keys(payload).sort()).toEqual(['clientRequestId', 'inference', 'input', 'sessionId']);
        expect(payload.sessionId).toBe(sessionId);
        expect(payload.input).toBe('SYNTHETIC issue-96 draft');
        expect(payload.inference).toEqual({ provider: free.provider, model: free.model });
        expect(Object.keys(payload.inference as object).sort()).toEqual(['model', 'provider']);
        return route.fulfill({ status: 202, json: { publicRunId: runId, sessionId, clientRequestId: payload.clientRequestId, status: 'completed', replayed: false } });
      }
      if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${path}`); return route.abort(); }
      if (path.endsWith('/messages')) return json({ sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
      if (path.endsWith('/context')) return json({ sessionId, state: 'unavailable', receipt: null, updatedAt: null });
      if (path === `/api/live/runs/${runId}`) return json({ publicRunId: runId, sessionId, status: 'completed', updatedAt: timestamp, approval: null, output: 'SYNTHETIC reply', error: null, pendingSteer: null, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, apiCalls: 0 } });
      if (path === '/api/live/model-options') {
        inventoryReads++;
        if (inventoryReads === 2) return route.fulfill({ status: 429, json: { error: 'SYNTHETIC inventory unavailable' } });
        return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [free], catalog });
      }
      const responses: Record<string, unknown> = {
        '/api/bootstrap': bootstrap,
        '/api/rooms': { version: 1, rooms: [] },
        '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false },
        '/api/notifications': emptyInbox,
      };
      if (!(path in responses)) { unexpected.push(path); return route.abort(); }
      return json(responses[path]);
    });
    const bootstrapResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap');
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    const response = await bootstrapResponse;
    expect(response.status()).toBe(200);
    expect(CommandBootstrapSchema.safeParse(await response.json()).success).toBe(true);
    await expect(page.getByText('Development preview · SYNTHETIC issue-96 fixture', { exact: true })).toBeVisible();
    const chat = page.getByRole('button', { name: session.title, exact: true });
    if (!(await chat.isVisible())) await page.getByRole('button', { name: 'Open chat navigation' }).click();
    await chat.click();
    await expect.poll(() => inventoryReads).toBeGreaterThanOrEqual(1);
    const picker = page.locator('.header-inference > summary');
    await picker.click();
    const catalogRegion = page.getByRole('region', { name: 'Advertised model catalog' });
    const group = catalogRegion.getByRole('region', { name: 'OpenRouter advertised models' });
    await expect(group).toContainText(`Free · ${free.model}`);
    await expect(group.getByRole('button', { name: `Use OpenRouter ${free.model}` })).toBeVisible();
    await expect(group.getByText('vendor/paid-model')).toBeVisible();
    await expect(group.getByText('Not on the approved Command list')).toBeVisible();
    await catalogRegion.getByRole('searchbox', { name: 'Search advertised models' }).fill('glm');
    await expect(group.getByRole('button', { name: `Use OpenRouter ${free.model}` })).toBeVisible();
    await group.getByRole('button', { name: `Use OpenRouter ${free.model}` }).click();
    await expect(page.getByRole('combobox', { name: 'Model for this prompt' })).toHaveValue(`openrouter:${free.model}`);
    const effort = page.getByRole('combobox', { name: 'Reasoning for this prompt' });
    await expect(effort).toBeDisabled();
    await expect(page.getByRole('option', { name: 'Provider default' })).toBeAttached();
    await expect(picker).toContainText('provider default');

    const draft = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
    await draft.fill('SYNTHETIC issue-96 draft');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText('Model choices unavailable. Retry choices before sending this request, or explicitly choose Inherit.')).toBeVisible();
    await expect(draft).toHaveValue('SYNTHETIC issue-96 draft');
    expect(posts).toHaveLength(0);
    // Send is outside the picker and dismisses it; retry is inside the picker.
    await picker.click();
    await page.getByRole('button', { name: 'Retry model choices', exact: true }).click();
    await expect.poll(() => inventoryReads).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => posts).toHaveLength(1);
    await expect(draft).toHaveValue('');

    await picker.click();
    for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) {
      await page.setViewportSize({ width, height });
      await expect(catalogRegion).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}x${height} horizontal overflow`).toBe(true);
      const panel = page.locator('.header-inference > .inference-fields');
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`issue-96-free-selector-${width}x${height}.png`) });
      await page.keyboard.press('Escape');
      await expect(catalogRegion).toBeHidden();
      await picker.click();
    }
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('synthetic-network-diagnostic', { body: JSON.stringify({ diagnostics, requests, errors }), contentType: 'application/json' });
    console.log('SYNTHETIC network diagnostic', JSON.stringify({ diagnostics, requests, errors }));
    await context.close();
    expect(context.pages()).toHaveLength(0);
    console.log('SYNTHETIC owned context closed');
  }
});
