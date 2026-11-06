import { expect, test } from '@playwright/test';
import { emptyInbox } from './empty-inbox';

test('SYNTHETIC OpenRouter free selector stays honest at desktop, 360px and short keyboard height', async ({ playwright }) => {
  const endpoint = process.env.STUDIO_BROWSER_CDP_ENDPOINT;
  if (!endpoint) throw Error('Run through the Studio browser QA wrapper');
  const browser = await playwright.chromium.connectOverCDP(endpoint);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const sessionId = `jc_${'9'.repeat(32)}`;
    const timestamp = '2026-11-06T18:00:00.000Z';
    const session = { id: sessionId, title: 'SYNTHETIC OpenRouter free fixture', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
    const free = { provider: 'openrouter', model: 'z-ai/glm-4.5-air:free', label: 'Free · z-ai/glm-4.5-air:free', reasoningEfforts: [] };
    const paid = { provider: 'openrouter', model: 'vendor/paid-model', advertised: true, authenticated: true, eligible: false, selectable: false, unavailableReason: 'not_approved_allowlist' };
    const freeEntry = { provider: free.provider, model: free.model, advertised: true, authenticated: true, eligible: true, selectable: true, unavailableReason: null };
    const catalog = { entries: [freeEntry, paid], advertisedCount: 2, returned: 2, truncated: false };
    const unexpected: string[] = [];
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${path}`); return route.abort(); }
      if (path.endsWith('/messages')) return json({ sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
      if (path.endsWith('/context')) return json({ sessionId, state: 'unavailable', receipt: null, updatedAt: null });
      const responses: Record<string, unknown> = {
        '/api/bootstrap': { identity: { provider: 'development' }, command: { version: 'SYNTHETIC issue-96 fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session] },
        '/api/rooms': { version: 1, rooms: [] },
        '/api/live/model-options': { default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [free], catalog },
        '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false },
        '/api/notifications': emptyInbox,
      };
      if (!(path in responses)) { unexpected.push(path); return route.abort(); }
      return json(responses[path]);
    });
    await page.goto('http://127.0.0.1:3197/');
    const chat = page.getByRole('button', { name: session.title, exact: true });
    if (!(await chat.isVisible())) await page.getByRole('button', { name: 'Open chat navigation' }).click();
    await chat.click();
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

    for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) {
      await page.setViewportSize({ width, height });
      await expect(catalogRegion).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}x${height} horizontal overflow`).toBe(true);
      const panel = page.locator('.header-inference > .inference-fields');
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(catalogRegion).toBeHidden();
      await picker.click();
    }
    expect(unexpected).toEqual([]);
  } finally {
    await context.close();
    // The shared browser belongs to Studio; never close it from this test.
  }
});
