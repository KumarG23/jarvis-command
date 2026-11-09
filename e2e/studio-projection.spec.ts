import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

// SYNTHETIC candidate fixtures in task-owned contexts of Studio's already configured browser. No login, no authenticated
// read, no Studio/GitHub/Hermes request. Original tabs, storage and Chrome are left untouched.
const test = base.extend({
  browser: async ({ playwright }, use) => {
    const endpoint = process.env.STUDIO_BROWSER_CDP_ENDPOINT;
    if (!endpoint || process.env.STUDIO_QA_TASK_ID !== 'command#issue-141') throw Error('Use the existing Studio browser QA wrapper for command#issue-141');
    await use(await playwright.chromium.connectOverCDP(endpoint));
  },
});

const sizes = [{ name: 'desktop', width: 1280, height: 720 }, { name: 'phone360', width: 360, height: 740 }, { name: 'short360', width: 360, height: 360 }] as const;
const origin = 'http://127.0.0.1:3198';

// Egress guard: installed on the context BEFORE any navigation. Anything that is not the loopback harness is aborted
// (never forwarded) and recorded, so a fixture miss cannot reach a live API.
const guards = new WeakMap<Page, string[]>();
async function guard(context: BrowserContext, page: Page) {
  const blocked: string[] = [];
  guards.set(page, blocked);
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    blocked.push(new URL(url).protocol + '//<other-origin>');
    return route.abort();
  });
}

async function open(page: Page, fixture: string, extra = '') {
  const foreign = guards.get(page)!;
  await page.goto(`/studio-projection-candidate.html?fixture=${fixture}${extra}`);
  return foreign;
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.spv-root, .spv-disabled-root')!.scrollWidth <= document.querySelector('.spv-root, .spv-disabled-root')!.clientWidth + 1)).toBe(true);

for (const size of sizes) {
  test.describe(size.name, () => {
    test('overview → project → work detail by keyboard, with ≥44px targets and no overflow', async ({ browser }, info) => {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
      const page = await context.newPage();
      await guard(context, page);
      try {
        const foreign = await open(page, 'healthy', '&age=30');
        await expect(page.getByRole('heading', { level: 2, name: 'Studio projects' })).toBeVisible();
        await expect(page.getByText('SYNTHETIC candidate fixture')).toBeVisible();
        await noOverflow(page);
        await page.screenshot({ path: info.outputPath(`${size.name}-overview.png`) });
        for (const button of await page.locator('.spv-root button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        const card = page.getByRole('button', { name: /Jarvis Command/ });
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { level: 2, name: 'Jarvis Command' })).toBeFocused();
        await noOverflow(page);
        await page.screenshot({ path: info.outputPath(`${size.name}-project.png`), fullPage: false });
        const item = page.getByRole('button', { name: /#6 SYNTHETIC blocked on dependency/ });
        await item.scrollIntoViewIfNeeded();
        await item.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('region', { name: 'Blocker' })).toBeVisible();
        await expect(page.getByText('Executed route: unknown.')).toBeVisible();
        await noOverflow(page);
        await page.screenshot({ path: info.outputPath(`${size.name}-detail.png`) });
        await page.keyboard.press('Escape');
        await expect(item).toBeFocused();
        await page.getByRole('button', { name: 'All projects' }).click();
        await expect(card).toBeFocused();
        expect(foreign, 'fixtures must not attempt any other origin').toEqual([]);
      } finally { await context.close(); }
    });

    test('states: disabled, loading, unreachable, malformed, unsupported version, last known, stale', async ({ browser }, info) => {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
      const page = await context.newPage();
      await guard(context, page);
      try {
        const expectations: Array<[string, string, string]> = [
          ['disabled', '', 'Live team status is not connected in this build.'], ['loading', '', 'Loading Studio projection…'], ['unreachable', '', 'Studio is unreachable.'],
          ['malformed', '', 'Studio data was rejected as untrustworthy.'], ['version', '', 'Studio projection version is not supported.'],
          ['healthy', '&age=172800', 'Stale.'],
        ];
        for (const [fixture, extra, text] of expectations) {
          await open(page, fixture, extra);
          await expect(page.getByText(text).first()).toBeVisible();
          await noOverflow(page);
          await page.screenshot({ path: info.outputPath(`${size.name}-${fixture}-${extra ? 'stale' : 'state'}.png`) });
        }
        await open(page, 'lastknown', '&age=90');
        await expect(page.getByText('Jarvis Command')).toBeVisible();
        await page.getByRole('button', { name: 'Refresh' }).click();
        await expect(page.getByText('not current')).toBeVisible();
        await expect(page.getByText('Last known data')).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${size.name}-lastknown.png`) });
        expect(guards.get(page), 'fixtures must not attempt any other origin').toEqual([]);
      } finally { await context.close(); }
    });
  });
}
