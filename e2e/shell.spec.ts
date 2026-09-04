import { expect, test } from '@playwright/test';

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
