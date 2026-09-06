import { expect, test, type Page } from '@playwright/test';
import { accessFixture } from './access-callback.fixture';
import { resolve } from 'node:path';

async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((done) => navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true }));
    }
  });
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw.js$/);
}

test('built worker reserves edge and API namespaces while retaining app fallback', async ({ page }, info) => {
  const fixture = await accessFixture();
  const observations = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(fixture.origin);
    await controlled(page);
    for (const path of ['/cdn-cgi/access/authorized?fixture=harmless-local', '/cdn-cgi/access/login', '/cdn-cgi/access/logout', '/cdn-cgi', '/cdn-cgi?fixture=local', '/cdn-cgi/other', '/api', '/api?fixture=local', '/api/not-found']) {
      const pathname = new URL(path, fixture.origin).pathname;
      const before = fixture.hits.filter((hit) => hit === pathname).length;
      const response = await page.goto(`${fixture.origin}${path}`);
      const body = await response!.text();
      const reached = fixture.hits.filter((hit) => hit === pathname).length > before;
      observations.push({ pathname, reached, fromServiceWorker: response!.fromServiceWorker(), status: response!.status() });
      expect.soft(reached, `${pathname} must reach the LOCAL network fixture`).toBe(true);
      expect.soft(body).not.toContain('<title>Jarvis Command</title>');
      expect.soft(response!.headers()['cache-control']).toBe('no-store');
      if (pathname.startsWith('/cdn-cgi')) expect.soft(body).toContain('LOCAL edge reached');
      else expect.soft(response!.status()).toBe(404);
    }
    for (const path of ['/room/local', '/cdn-cgi-extra', '/apiculture']) {
      const response = await page.goto(`${fixture.origin}${path}`);
      expect(response!.fromServiceWorker()).toBe(true);
      expect(await response!.text()).toContain('<title>Jarvis Command</title>');
    }
    expect(errors).toEqual([]);
  } finally {
    await info.attach('LOCAL-routing-observations', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
    await fixture.close();
  }
});

test('explicit recovery escapes an OLD controller even when worker updates are blocked', async ({ page }, info) => {
  test.skip(!process.env.ACCESS_OLD_WEB_DIST, 'Set ACCESS_OLD_WEB_DIST to the built approved base for upgrade/recovery evidence');
  const fixture = await accessFixture(process.env.ACCESS_OLD_WEB_DIST);
  try {
    await page.goto(fixture.origin);
    await controlled(page);
    await page.goto(`${fixture.origin}/cdn-cgi/access/authorized?fixture=harmless-local`);
    await expect(page.getByText('SECURE SESSION FAILED', { exact: true })).toBeVisible();
    expect(fixture.hits).not.toContain('/cdn-cgi/access/authorized');
    fixture.setRoot(resolve('apps/web/dist'));
    fixture.blockWorker();
    // Test-only network shell supplies recovery code without replacing the old
    // controller. This does NOT claim expired Access can deliver these bytes.
    await page.goto(`${fixture.origin}/api/local-current-shell`);
    await controlled(page);
    await page.evaluate(async () => {
      localStorage.setItem('local-preserve-pending-work', 'fixture');
      await caches.open('local-unrelated-cache');
    });
    await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('LOCAL-recovery.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page.getByRole('heading', { name: 'LOCAL edge reached' })).toBeVisible();
    expect(fixture.hits).toContain('/api/auth/recover');
    expect(fixture.hits).toContain('/cdn-cgi/access/authorized');
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('local-preserve-pending-work'))).toBe('fixture');
    expect(await page.evaluate(() => caches.has('local-unrelated-cache'))).toBe(true);
  } finally { await fixture.close(); }
});

test('current shell trapped by an old worker discards callback location before bootstrap', async ({ page }) => {
  test.skip(!process.env.ACCESS_OLD_WEB_DIST, 'Set ACCESS_OLD_WEB_DIST to the built approved base');
  const fixture = await accessFixture();
  fixture.useWorkerFrom(process.env.ACCESS_OLD_WEB_DIST!);
  try {
    await page.goto(fixture.origin);
    await controlled(page);
    const before = fixture.hits.filter((path) => path === '/api/bootstrap').length;
    await page.goto(`${fixture.origin}/cdn-cgi/access/authorized?fixture=LOCAL_ONLY_DO_NOT_PERSIST#LOCAL_ONLY_DO_NOT_PERSIST`);
    await expect(page).toHaveURL(`${fixture.origin}/`);
    await expect(page.getByRole('alert')).toHaveText('Sign-in required');
    expect(fixture.hits.filter((path) => path === '/api/bootstrap').length).toBe(before);
    expect(await page.evaluate(async () => {
      const keys = (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))).flat();
      return JSON.stringify([history.state, localStorage, sessionStorage, keys]);
    })).not.toContain('LOCAL_ONLY_DO_NOT_PERSIST');
    await page.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page.getByRole('heading', { name: 'LOCAL edge reached' })).toBeVisible();
  } finally { await fixture.close(); }
});

test('old cached shell upgrades to exact current worker when new bytes are reachable', async ({ page, request }, info) => {
  test.skip(!process.env.ACCESS_OLD_WEB_DIST, 'Set ACCESS_OLD_WEB_DIST to the built approved base');
  const fixture = await accessFixture(process.env.ACCESS_OLD_WEB_DIST);
  try {
    await page.goto(fixture.origin);
    await controlled(page);
    await page.goto(`${fixture.origin}/cdn-cgi/access/authorized?fixture=harmless-local`);
    await expect(page.getByText('SECURE SESSION FAILED', { exact: true })).toBeVisible();
    expect(fixture.hits).not.toContain('/cdn-cgi/access/authorized');
    fixture.setRoot(resolve('apps/web/dist'));
    const served = await (await request.get(`${fixture.origin}/sw.js`)).body();
    const { readFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const candidate = await readFile('apps/web/dist/sw.js');
    expect(served.equals(candidate)).toBe(true);
    await info.attach('LOCAL-upgrade-worker-sha256', { body: createHash('sha256').update(served).digest('hex'), contentType: 'text/plain' });
    await page.evaluate(async () => {
      const changed = new Promise<void>((done) => navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true }));
      await (await navigator.serviceWorker.getRegistration('/'))!.update();
      await changed;
    });
    await page.goto(fixture.origin);
    await expect(page.getByRole('alert')).toHaveText('Sign-in required');
    await page.goto(`${fixture.origin}/cdn-cgi/access/authorized?fixture=harmless-local`);
    await expect(page.getByRole('heading', { name: 'LOCAL edge reached' })).toBeVisible();
    expect(fixture.hits).toContain('/cdn-cgi/access/authorized');
  } finally { await fixture.close(); }
});
