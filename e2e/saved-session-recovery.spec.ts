import { expect, test as base, devices, type Locator } from '@playwright/test';
import { CommandBootstrapSchema, SessionMessagesPageSchema, SessionSummarySchema } from '@jarvis-command/contracts';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';
import { handleThreadState } from './thread-state-route';
const test = base.extend({ browser: async ({ playwright }, use) => {
  if (!process.env.STUDIO_BROWSER_CDP_ENDPOINT || process.env.STUDIO_QA_TASK_ID !== 'command#issue-111') throw Error('Use the Studio source browser QA wrapper for command#issue-111');
  const browser = await playwright.chromium.connectOverCDP(process.env.STUDIO_BROWSER_CDP_ENDPOINT);
  await use(browser); // Only task-owned contexts close. Preserve Chrome and original tabs/storage.
} });
const sessions = SessionSummarySchema.array().parse(['a', 'b'].map(letter => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC recovery ${letter}`, source: 'jarvis-command', ownership: 'command', model: null, lastActive: new Date().toISOString(), messageCount: 1, toolCallCount: 0, pinned: false })));
const [a, b] = sessions;
async function reachable(locator: Locator) {
  await expect.poll(() => locator.evaluate(element => {
    const r = element.getBoundingClientRect(); let top = 0, bottom = innerHeight, left = 0, right = innerWidth;
    for (let p = element.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p), b = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) { top = Math.max(top, b.top + p.clientTop); bottom = Math.min(bottom, b.top + p.clientTop + p.clientHeight); }
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { left = Math.max(left, b.left + p.clientLeft); right = Math.min(right, b.left + p.clientLeft + p.clientWidth); }
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.top >= top && r.bottom <= bottom && r.left >= left && r.right <= right && !!hit && element.contains(hit);
  })).toBe(true);
}
for (const [width, height] of [[1280, 720], [360, 740], [360, 360]]) test.describe(`${width}x${height}`, () => {
  const device = devices[width === 1280 ? 'Desktop Chrome' : 'Pixel 7'];
  test.use({ isMobile: device.isMobile, hasTouch: device.hasTouch, userAgent: device.userAgent });
  test(`SYNTHETIC saved recovery ${width}x${height}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height });
  const blocked: string[] = [], unexpected: string[] = [], requests: string[] = [], errors: string[] = [];
  let release!: () => void, verified = false;
  const metadata = new Promise<void>(resolve => { release = resolve; });
  // Guard before navigation, on an isolated task-owned context. Preview itself has no API proxy.
  await page.context().route('**/*', route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:3111') return route.fallback();
    blocked.push('external origin'); return route.abort();
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin !== 'http://127.0.0.1:3111') { blocked.push('external API origin'); return route.abort(); }
    requests.push(`${request.method()} ${path}`);
    if (path === '/api/notifications/presence') expect(sessions.some(s => s.id === request.postDataJSON().sessionId)).toBe(true);
    if (handlePresence(route)) return;
    if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${path}`); return route.abort(); }
    if (handleThreadState(route, sessions.map(s => s.id))) return;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/api/bootstrap') return json(CommandBootstrapSchema.parse({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC recovery only', environment: 'test', generatedAt: new Date().toISOString(), liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [b] }));
    if (path === '/api/rooms') return json({ version: 1, rooms: [] });
    if (path === `/api/live/sessions/${a!.id}`) { await metadata; verified = true; return json({ session: a }); }
    if (path === '/api/notifications') return json(emptyInbox);
    const session = sessions.find(s => path === `/api/sessions/${s.id}/messages`);
    if (session) {
      if (session.id === a!.id && !verified) unexpected.push('history before identity');
      return json(SessionMessagesPageSchema.parse({ sessionId: session.id, messages: [{ id: 'synthetic:question', sessionId: session.id, role: 'user', content: 'SYNTHETIC recovered history', timestamp: null, toolName: null, displayKind: null }], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } }));
    }
    if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'synthetic' }, options: [] });
    if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
    if (sessions.some(s => path === `/api/live/sessions/${s.id}/context`)) return json({ sessionId: path.split('/')[4], state: 'unavailable', receipt: null, updatedAt: null });
    unexpected.push(`unhandled GET ${path}`); return route.abort();
  });
  await page.addInitScript(({ a, b }) => {
    // Seed once per isolated context; reload must use the application's own persisted selection/draft.
    if (sessionStorage.getItem('synthetic:seeded')) return;
    sessionStorage.setItem('synthetic:seeded', 'yes');
    sessionStorage.setItem('jarvis-command:selected-session:v1', a);
    sessionStorage.setItem('jarvis-command:text-drafts:v1', JSON.stringify({ [a]: 'SYNTHETIC draft A', [b]: 'SYNTHETIC draft B' }));
  }, { a: a!.id, b: b!.id });
  await page.goto('/');
  await expect.poll(() => requests.filter(r => r === `GET /api/live/sessions/${a!.id}`).length).toBe(1);
  expect(requests.some(r => r.includes(`/api/sessions/${a!.id}/messages`))).toBe(false);
  expect(await page.evaluate(() => sessionStorage.getItem('jarvis-command:selected-session:v1'))).toBe(a!.id);
  release();
  const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
  await expect(page.getByLabel('Selected session')).toHaveText(a!.title);
  await expect(page.getByText('SYNTHETIC recovered history', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('SYNTHETIC draft A'); await expect(composer).toBeEnabled();
  await composer.fill('SYNTHETIC retained recovered draft');
  await reachable(composer); await reachable(page.getByRole('button', { name: 'Send message', exact: true }));
  await expect(page.getByRole('img', { name: 'Unknown', exact: true }).first()).toBeVisible();
  const history = page.getByText('SYNTHETIC recovered history', { exact: true });
  await history.scrollIntoViewIfNeeded(); await reachable(history);
  await reachable(composer); await reachable(page.getByRole('button', { name: 'Send message', exact: true }));
  await page.screenshot({ path: info.outputPath(`SYNTHETIC-recovered-${width}x${height}.png`) });
  await page.reload();
  await expect(composer).toHaveValue('SYNTHETIC retained recovered draft');
  await expect(page.getByLabel('Selected session')).toHaveText(a!.title);
  if (width <= 760) await page.getByRole('button', { name: 'Open chat navigation' }).click();
  await page.getByRole('button', { name: /Studio crew/ }).click();
  const studio = page.getByRole('region', { name: 'Studio crew' });
  await expect(studio).toBeFocused();
  await expect(studio.getByText('Live team status is not connected in this build. No crew members, tasks or activity are available to show here.')).toBeVisible();
  await reachable(studio.getByRole('button', { name: 'Return to chat' }));
  await page.screenshot({ path: info.outputPath(`SYNTHETIC-recovery-Studio-${width}x${height}.png`) });
  await page.goBack(); await expect(composer).toHaveValue('SYNTHETIC retained recovered draft');
  if (width <= 760) await expect(page.getByRole('button', { name: 'Open chat navigation' })).toBeFocused();
  if (width <= 760) await page.getByRole('button', { name: 'Open chat navigation' }).click();
  await page.getByRole('button', { name: /Studio crew/ }).click();
  await expect(studio).toBeFocused(); await page.keyboard.press('Escape');
  await expect(composer).toHaveValue('SYNTHETIC retained recovered draft');
  if (width <= 760) await page.getByRole('button', { name: 'Open chat navigation' }).click();
  await page.getByRole('button', { name: b!.title, exact: true }).first().click();
  await expect(composer).toHaveValue('SYNTHETIC draft B');
  expect(await page.evaluate(() => sessionStorage.getItem('jarvis-command:selected-session:v1'))).toBe(b!.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(blocked).toEqual([]); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  await info.attach('synthetic-request-categories', { body: JSON.stringify({ metadataGets: requests.filter(r => r === `GET /api/live/sessions/${a!.id}`).length, historyGets: requests.filter(r => r.includes('/messages')).length, presencePosts: requests.filter(r => r === 'POST /api/notifications/presence').length, nonPresenceMutations: requests.filter(r => !r.startsWith('GET ') && r !== 'POST /api/notifications/presence').length, blocked, unexpected }), contentType: 'application/json' });
});

});
