import { expect, test } from '@playwright/test';

// Synthetic local fixture only: every API is intercepted and no Hermes run is created.
const sessionId = 'jc_' + 'c'.repeat(32);
const timestamp = '2026-10-31T18:00:00.000Z';
const session = { id: sessionId, title: 'SYNTHETIC · model catalog', source: 'web', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
const entry = (provider: string, model: string, unavailableReason: string | null, extra: Record<string, unknown> = {}) => ({
  provider, model, advertised: true, authenticated: true, eligible: unavailableReason === null, selectable: unavailableReason === null, unavailableReason, ...extra,
});
const catalog = {
  entries: [
    entry('openai-codex', 'gpt-6-sol', null),
    entry('anthropic', 'claude-haiku-5-5', 'not_approved_allowlist'),
    entry('openai', 'gpt-5.5', 'not_approved_allowlist'),
    entry('openrouter', 'thinkingmachines/inkling:free', 'not_approved_allowlist'),
    entry('openrouter', 'vendor/paid-model', 'not_approved_allowlist'),
    entry('xai-oauth', 'grok-4.7', 'not_advertised', { advertised: false, eligible: true }),
    entry('rogue-provider', 'claimed-selectable', null, { eligible: true, selectable: true }),
  ],
  advertisedCount: 6,
  returned: 7,
  truncated: false,
};

test('catalog search, provider groups, honest reasons and responsive picker stay inside the viewport', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const unexpected: string[] = [];
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { unexpected.push(request.method() + ' ' + path); return route.abort(); }
    if (path.endsWith('/messages')) return route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } });
    if (path.endsWith('/context')) return route.fulfill({ json: { sessionId, state: 'unavailable', receipt: null, updatedAt: null } });
    const responses: Record<string, unknown> = {
      '/api/bootstrap': { identity: { provider: 'development' }, command: { version: 'SYNTHETIC P10.2', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session] },
      '/api/rooms': { version: 1, rooms: [] },
      '/api/live/model-options': { default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'Synthetic Sol', reasoningEfforts: ['medium', 'xhigh'] }], catalog },
      '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false },
      '/api/notifications': { version: 1, items: [], unreadCount: 0, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } }, delivery: { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' } },
    };
    if (!(path in responses)) { unexpected.push(path); return route.abort(); }
    return route.fulfill({ json: responses[path] });
  });
  await page.goto('/');
  const chat = page.getByRole('button', { name: session.title, exact: true });
  if (!(await chat.isVisible())) await page.getByRole('button', { name: 'Open chat navigation' }).click();
  await chat.click();
  const chip = page.locator('.header-inference > summary');
  const catalogRegion = page.getByRole('region', { name: 'Advertised model catalog' });
  const search = catalogRegion.getByRole('searchbox', { name: 'Search advertised models' });
  await chip.click();
  await expect(catalogRegion).toBeVisible();
  await expect(catalogRegion).toContainText('7 catalog entries · 6 advertised');
  await expect(catalogRegion.getByRole('region', { name: 'Anthropic advertised models' })).toContainText('claude-haiku-5-5');
  await expect(catalogRegion.getByRole('region', { name: 'OpenAI API advertised models' })).toContainText('gpt-5.5');
  await expect(catalogRegion.getByRole('region', { name: 'OpenRouter advertised models' })).toContainText('vendor/paid-model');
  await expect(catalogRegion.getByText('Not on the approved Command list').first()).toBeVisible();
  await expect(catalogRegion.getByText(/OpenRouter entries are discovery only/)).toBeVisible();

  await search.fill('haiku');
  await expect(catalogRegion.getByRole('region', { name: 'Anthropic advertised models' })).toBeVisible();
  await expect(catalogRegion.getByRole('region', { name: 'OpenAI API advertised models' })).toBeHidden();
  await search.fill('claimed-selectable');
  await expect(catalogRegion.getByText('Not selectable in Command')).toBeVisible();
  await expect(catalogRegion.getByRole('button', { name: /^Use / })).toHaveCount(0);
  await search.fill('');
  await catalogRegion.getByRole('button', { name: 'Use OpenAI Codex gpt-6-sol' }).click();
  await expect(chip).toHaveText('Requested · Synthetic Sol · medium');

  for (const [width, height] of [[1280, 720], [320, 360], [360, 740], [390, 740], [430, 740]] as const) {
    await page.setViewportSize({ width, height });
    const open = await page.locator('.inference-control').evaluate(el => (el as HTMLDetailsElement).open);
    if (!open) await chip.click();
    await expect(search).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px horizontal overflow`).toBe(true);
    const panel = page.locator('.header-inference > .inference-fields');
    const box = await panel.boundingBox();
    expect(box!.x, `${width}px panel left`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${width}px panel right`).toBeLessThanOrEqual(width);
    const searchBox = await search.boundingBox();
    expect(searchBox!.x, `${width}px search left`).toBeGreaterThanOrEqual(0);
    expect(searchBox!.x + searchBox!.width, `${width}px search right`).toBeLessThanOrEqual(width);
    if ((width === 1280 && height === 720) || (width === 390 && height === 740)) {
      const path = testInfo.outputPath(`p10-catalog-${width}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`SYNTHETIC P10 catalog ${width}`, { path, contentType: 'image/png' });
    }
    await page.keyboard.press('Escape');
  }
  expect(unexpected).toEqual([]);
});
