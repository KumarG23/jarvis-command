import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';

// Only Studio's already configured browser, in task-owned pages. No browser launch/login.
const test = base.extend({
  browser: async ({ playwright }, use) => {
    const endpoint = process.env.STUDIO_BROWSER_CDP_ENDPOINT;
    if (!endpoint || process.env.STUDIO_QA_TASK_ID !== 'command#issue-132') throw Error('Use the existing Studio browser QA wrapper for command#issue-132');
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    await use(browser); // The connection ends on process exit; leave Chrome and discovery tabs running.
  },
});

const timestamp = new Date().toISOString();
const session = { id: `jc_${'a'.repeat(32)}`, title: 'SYNTHETIC Studio draft chat', source: 'jarvis-command', ownership: 'command', model: null, lastActive: timestamp, messageCount: 1, toolCallCount: 0, pinned: false };
const messages = { sessionId: session.id, messages: [{ id: 'stored:one', sessionId: session.id, role: 'user', content: 'SYNTHETIC owned question', timestamp, toolName: null, displayKind: null }], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } };

async function openShell(page: Page) {
  const requests: string[] = [];
  page.on('request', request => requests.push(`${request.method()} ${request.url()}`));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (handlePresence(route)) return;
    if (request.method() !== 'GET') return route.abort();
    if (path === '/api/bootstrap') return json({
      identity: { provider: 'development' },
      command: { version: 'SYNTHETIC P14 unavailable fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } },
      hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} },
      sessions: [session],
    });
    if (path === '/api/rooms') return json({ version: 1, rooms: [] });
    if (path === '/api/notifications') return json(emptyInbox);
    if (path === `/api/sessions/${session.id}/messages`) return json(messages);
    if (path === `/api/live/sessions/${session.id}/context`) return json({ sessionId: session.id, state: 'unavailable', receipt: null, updatedAt: null });
    if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [] });
    if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
    return route.abort();
  });
  await page.addInitScript(id => sessionStorage.setItem('jarvis-command:selected-session:v1', id), session.id);
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
  await expect(page.getByText('SYNTHETIC owned question')).toBeVisible();
  await expect(composer).toBeEnabled();
  return { composer, requests };
}

async function revealEntry(page: Page, width: number) {
  const entry = page.getByRole('button', { name: /Studio crew/ });
  if (width <= 760) {
    const opener = page.getByRole('button', { name: 'Open chat navigation' });
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(page.getByRole('button', { name: 'Close chat navigation' })).toBeVisible();
  }
  await entry.scrollIntoViewIfNeeded();
  await expect(entry).toBeVisible();
  const box = await entry.boundingBox();
  expect(box?.height, 'Studio entry must be a full touch target').toBeGreaterThanOrEqual(44);
  const hit = await entry.evaluate(element => { const rect = element.getBoundingClientRect(); const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return !!target && element.contains(target); });
  expect(hit, 'Studio entry must receive a pointer hit').toBe(true);
  return entry;
}

async function assertReachable(action: Locator) {
  const result = await action.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { within: box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth, hit: !!hit && element.contains(hit), height: box.height };
  });
  expect(result.within, 'control must be fully inside the viewport without clipping').toBe(true);
  expect(result.hit, 'control must receive a pointer hit').toBe(true);
  expect(result.height).toBeGreaterThanOrEqual(44);
}

for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) {
  test(`SYNTHETIC Studio unavailable destination ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const { composer, requests } = await openShell(page);
    await composer.fill('SYNTHETIC unsent draft');
    const entry = await revealEntry(page, width);
    const before = requests.length;

    await entry.click();
    const studio = page.getByRole('region', { name: 'Studio crew' });
    await expect(studio).toBeFocused();
    await expect(studio.getByRole('heading', { level: 1, name: 'Studio crew' })).toBeVisible();
    await expect(studio.getByText('Live team status is not connected in this build. No crew members, tasks or activity are available to show here.')).toBeVisible();
    await expect(studio.getByRole('list')).toHaveCount(0);
    await expect(studio.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message Jarvis', exact: true })).toHaveCount(0);

    const during = requests.slice(before).map(line => line.split(' ').slice(1).join(' ')).filter(url => !url.endsWith('/api/notifications/presence'));
    expect(during.filter(url => /studio|crew/i.test(url)), 'Studio view must issue no Studio request').toEqual([]);
    expect(requests.slice(before).filter(line => !line.startsWith('GET ') && !line.includes('/api/notifications/presence')), 'Studio view must not post or mutate').toEqual([]);

    await assertReachable(studio.getByRole('button', { name: 'Return to chat' }));
    const layout = await studio.evaluate(element => {
      const header = element.querySelector('.studio-header')!.getBoundingClientRect();
      const heading = element.querySelector('h1')!.getBoundingClientRect();
      const note = element.querySelector('.studio-note')!.getBoundingClientRect();
      return { headerBottom: header.bottom, headingTop: heading.top, headingBottom: heading.bottom, noteTop: note.top, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(layout.headingTop, 'heading must not overlap the header').toBeGreaterThanOrEqual(layout.headerBottom - 1);
    expect(layout.noteTop, 'reason text must not overlap the heading').toBeGreaterThanOrEqual(layout.headingBottom - 1);
    expect(layout.overflow, 'no horizontal overflow').toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-studio-${width}x${height}.png`) });

    // Escape returns to the same chat with the draft retained.
    await page.keyboard.press('Escape');
    await expect(studio).toHaveCount(0);
    await expect(composer).toHaveValue('SYNTHETIC unsent draft');
    await expect(composer).toBeEnabled();
    if (width <= 760) await expect(page.getByRole('button', { name: 'Open chat navigation' })).toBeFocused();
    else await expect(entry).toBeFocused();

    // The visible return control is a second, pointer path back to the same chat.
    const again = await revealEntry(page, width);
    await again.click();
    await studio.getByRole('button', { name: 'Return to chat' }).click();
    await expect(studio).toHaveCount(0);
    await expect(composer).toHaveValue('SYNTHETIC unsent draft');
    expect(requests.slice(before).filter(line => !line.startsWith('GET ') && !line.includes('/api/notifications/presence'))).toEqual([]);
  });
}
