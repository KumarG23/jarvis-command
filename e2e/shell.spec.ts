import { expect, test } from '@playwright/test';

const BOOTSTRAP_BASE = {
  identity: { provider: 'development' },
  command: { version: 'test', environment: 'test', generatedAt: '2026-09-04T12:00:00.000Z', liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } },
  hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio', 'session_resources'], readinessChecks: {} },
  sessions: [
    { id: 'jc_300d0e2efc094ab38ebc2398d13e5114', title: 'Narrow viewport test session', ownership: 'command', source: 'web', model: null, lastActive: '2026-09-04T12:00:00.000Z', messageCount: 0, toolCallCount: 0, pinned: false },
  ],
};

async function mockBootstrap(page: Page, extra: Record<string, unknown> = {}) {
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { ...BOOTSTRAP_BASE, ...extra } }));
  await page.route('**/api/rooms', route => route.fulfill({ json: { version: 1, rooms: [] } }));
  await page.route('**/api/live/session-controls', route => route.fulfill({ json: { sessionForkPreservesSource: true, sessionCompactionRuns: true } }));
  await page.route('**/api/live/model-options', route => route.fulfill({ json: { default: { provider: 'openai-codex', model: 'gpt-5.6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-5.6-sol', label: 'Sol', reasoningEfforts: ['medium'] }] } }));
  await page.route('**/api/live/sessions/*/context', route => {
    const sessionId = new URL(route.request().url()).pathname.split('/')[4]!;
    return route.fulfill({ json: { sessionId, state: 'available', updatedAt: new Date().toISOString(), receipt: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, contextUsedTokens: 1500, contextLimitTokens: 128000 } } });
  });
  await page.route('**/api/artifacts?*', route => route.fulfill({ json: { artifacts: [] } }));
  await page.route('**/api/sessions/*/messages?*', route => route.fulfill({ json: { sessionId: 'jc_300d0e2efc094ab38ebc2398d13e5114', messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
}

async function assertHeaderGeometry(page: Page, viewportLabel: string, maxHeaderHeight: number) {
  const header = page.locator('.command-header');
  await expect(header).toBeVisible();
  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  if (headerBox) {
    expect(headerBox.height).toBeLessThanOrEqual(maxHeaderHeight);
  }

  // Title should not wrap character-by-character (scrollWidth should not exceed clientWidth significantly)
  const title = page.getByLabel('Selected session');
  await expect(title).toBeVisible();
  const titleOverflow = await title.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(titleOverflow).toBeLessThanOrEqual(2); // Allow minimal subpixel rounding

  // Composer should be in viewport
  const composer = page.locator('.composer-wrap');
  await expect(composer).toBeVisible();
  const composerBox = await composer.boundingBox();
  const viewportHeight = page.viewportSize()!.height;
  expect(composerBox).not.toBeNull();
  if (composerBox) {
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(viewportHeight + 2); // Allow minimal subpixel rounding
  }

  // No horizontal overflow
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(2);

  // Screenshot for evidence
  await page.screenshot({ path: `test-results/header-${viewportLabel}.png`, fullPage: true });
}

test('header layout at narrow viewport 360x740', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only layout assertion');
  await page.setViewportSize({ width: 360, height: 740 });
  await mockBootstrap(page);
  await page.goto('/');

  // Open navigation to select session (mobile)
  const navButton = page.getByRole('button', { name: 'Open chat navigation' });
  await expect(navButton).toBeVisible();
  await navButton.click();
  await page.getByRole('button', { name: 'Narrow viewport test session', exact: true }).click();
  await expect(page.getByLabel('Selected session')).toHaveText('Narrow viewport test session');

  await assertHeaderGeometry(page, '360x740', 120); // Header should stay compact
});

test('header layout at narrow viewport 390x844', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only layout assertion');
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBootstrap(page);
  await page.goto('/');

  const navButton = page.getByRole('button', { name: 'Open chat navigation' });
  await expect(navButton).toBeVisible();
  await navButton.click();
  await page.getByRole('button', { name: 'Narrow viewport test session', exact: true }).click();
  await expect(page.getByLabel('Selected session')).toHaveText('Narrow viewport test session');

  await assertHeaderGeometry(page, '390x844', 120);
});

test('header layout at desktop viewport 1280x720', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop-only layout assertion');
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockBootstrap(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Narrow viewport test session', exact: true }).click();
  await expect(page.getByLabel('Selected session')).toHaveText('Narrow viewport test session');

  await assertHeaderGeometry(page, '1280x720', 80); // Desktop header should be compact
});

// Preserve existing tests below

test('renders the secure command shell without browser errors', async ({ page, request }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Jarvis Command');
  await expect(page.getByRole('heading', { name: 'Jarvis Command', exact: true })).toBeVisible();
  await expect(page.getByText('Operational snapshot')).toBeVisible();
  await expect(page.getByText('LIVE', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hermes unavailable' })).toBeVisible();
  await expect(page.getByText('Messaging is unavailable in this read-only slice.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toHaveCount(0);
  expect(await page.evaluate(() => {
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  })).toBe(true);

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const manifestBody = await manifest.json();
  expect(manifestBody).toMatchObject({ name: 'Jarvis Command', display: 'standalone' });
  expect(manifestBody.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: '/pwa-192.png', sizes: '192x192' }),
    expect.objectContaining({ src: '/pwa-512.png', sizes: '512x512' }),
  ]));
  const serviceWorker = await request.get('/sw.js');
  expect(serviceWorker.ok()).toBe(true);
  expect(await serviceWorker.text()).toContain('NavigationRoute');
  expect(browserErrors).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath('jarvis-command-shell.png'),
    fullPage: true,
  });
});

test('keeps the complete API namespace outside the PWA shell fallback', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });

  for (const apiPath of ['/api', '/api?probe=1', '/api/not-found']) {
    const response = await page.goto(apiPath);
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(404);
    expect(response!.headers()['content-type']).toContain('application/json');
    expect(response!.headers()['cache-control']).toBe('no-store');
    const body = await response!.text();
    expect(JSON.parse(body)).toEqual({ error: 'not_found' });
    expect(body).not.toContain('Jarvis Command');
  }

  await page.goto('/');
  const fetched = await page.evaluate(async () => {
    const response = await fetch('/api/bootstrap', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      body: await response.text(),
    };
  });
  expect(fetched.status).toBe(200);
  expect(fetched.contentType).toContain('application/json');
  expect(fetched.cacheControl).toBe('no-store');
  expect(JSON.parse(fetched.body)).toMatchObject({
    command: { version: '0.1.0-e2e' },
  });
  expect(fetched.body).not.toContain('<title>Jarvis Command</title>');
});

test('preserves supervision controls at a phone viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only layout assertion');
  await page.goto('/');

  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Project rooms' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Mission timeline' })).toBeVisible();
  await expect(page.getByText('Messaging is unavailable in this read-only slice.')).toBeVisible();
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNavigation.getByRole('button', { name: 'Agents' })).toBeDisabled();
  await expect(mobileNavigation.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(mobileNavigation.getByRole('button', { name: 'Artifacts' })).toBeDisabled();
  expect(await page.evaluate(() => {
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  })).toBe(true);
});
