import { devices, expect, test as base } from '@playwright/test';
import { emptyInbox } from './empty-inbox';

// Attach only through Studio's configured wrapper; the runner creates and closes
// isolated contexts, leaving all original browser pages/storage untouched.
const test = base.extend({
  browser: async ({ playwright }, use) => {
    const endpoint = process.env.STUDIO_BROWSER_CDP_ENDPOINT;
    if (!endpoint) throw Error('Run through the Studio browser QA wrapper');
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    await use(browser);
    // Do not close the shared browser. The worker connection ends on process exit.
  },
});

const timestamp = '2026-10-31T20:00:00.000Z';
const sessions = ['a', 'b', 'c'].map((letter, i) => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC Pane ${i}`, source: 'api_server', ownership: i === 2 ? 'external' : 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));
const project = { id: `room_${'d'.repeat(32)}`, name: 'SYNTHETIC pane link', goal: 'SYNTHETIC read-only link proof', instructions: '', repository: '', notes: [], archived: false, sessionIds: sessions.map(session => session.id), lastSessionId: sessions[0]!.id, leadSessionId: sessions[0]!.id, threads: sessions.map((session, i) => ({ sessionId: session.id, title: session.title, archived: i === 1, createdAt: timestamp })) };

for (const [width, height] of [[1280, 720], [1280, 360], [320, 740], [360, 740], [390, 740], [430, 740], [320, 360], [430, 360]] as const) {
  test.describe(`${width}x${height}`, () => {
  const device = devices[width === 1280 ? 'Desktop Chrome' : 'Pixel 7'];
  test.use({ isMobile: device.isMobile, hasTouch: device.hasTouch, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor });
  test(`SYNTHETIC project Threads entry ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(id => sessionStorage.setItem('jarvis-command:project-room:v1', id), project.id);
    const mutations: string[] = [], errors: string[] = [];
    let selectedId = sessions[0]!.id;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (req.method() !== 'GET') mutations.push(`${req.method()} ${path}`);
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P9.5 offline fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions });
      if (path === '/api/rooms') return json({ version: 1, rooms: [{ ...project, lastSessionId: selectedId }] });
      if (path === `/api/rooms/${project.id}/sessions`) {
        selectedId = req.postDataJSON().sessionId;
        return json({ room: { ...project, lastSessionId: selectedId }, session: sessions.find(session => session.id === selectedId) });
      }
      if (path.endsWith('/roster')) return json({ project, observedAt: timestamp, limit: 4, total: sessions.length, omitted: 0, partial: false, items: sessions.map(session => ({ sessionId: session.id, title: session.title, archived: session.id === sessions[1]!.id, lead: session.id === sessions[0]!.id, status: 'unknown', statusObservedAt: timestamp, runUpdatedAt: null, messagesObservedAt: timestamp, messages: [], messagesTruncated: false, messagesUnavailable: false })) });
      if (path === '/api/notifications') return json(emptyInbox);
      const session = sessions.find(session => path.includes(session.id));
      if (session && path === `/api/live/sessions/${session.id}`) return json({ session });
      if (session && path.endsWith('/messages')) return json({ sessionId: session.id, messages: [{ id: `${session.id}:synthetic`, sessionId: session.id, role: 'assistant', content: session.id === sessions[0]!.id ? `[Open delegated thread](thread:${sessions[2]!.id})` : 'SYNTHETIC external history', timestamp, toolName: null, displayKind: null }], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } });
      if (session && path.endsWith('/context')) return json({ sessionId: session.id, state: 'unavailable', receipt: null, updatedAt: null });
      if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'synthetic' }, options: [] });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      errors.push(`unexpected ${path}`); return route.abort();
    });
    await page.goto('/');
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[0]!.title);
    const entry = page.getByRole('button', { name: 'Threads', exact: true });
    const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
    await composer.fill('SYNTHETIC retained keyboard draft');
    await composer.focus();
    await expect(composer).toBeInViewport();
    const box = await entry.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(entry).toBeInViewport();
    for (const control of [entry, composer, page.getByRole('button', { name: 'Send message', exact: true })]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    }
    expect(await page.locator('.command-header').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await entry.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el; })).toBe(true);
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-header-${width}-${height}.png`) });
    await entry.focus(); await page.keyboard.press('Enter');
    const roster = page.getByRole('region', { name: 'Project threads' });
    await expect(roster).toBeFocused();
    await expect(roster.getByRole('heading', { name: 'Lead and threads' })).toBeInViewport();
    await expect(roster.getByRole('heading', { name: 'Archived threads' })).toBeVisible();
    await expect(roster.getByText(/Unknown — no verified Command run/)).toHaveCount(3);
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-roster-${width}-${height}.png`) });
    await page.keyboard.press('Escape'); await expect(entry).toBeFocused();
    await entry.click();
    await roster.getByRole('button', { name: sessions[2]!.title, exact: true }).click();
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[2]!.title);
    await expect(composer).toHaveCount(0);
    await entry.click();
    await roster.getByRole('button', { name: `Open lead: ${sessions[0]!.title}` }).click();
    await expect(composer).toHaveValue('SYNTHETIC retained keyboard draft');
    await page.getByRole('button', { name: 'Open delegated thread' }).click();
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[2]!.title);
    await entry.click();
    await roster.getByRole('button', { name: `Open lead: ${sessions[0]!.title}` }).click();
    await page.reload();
    await expect(entry).toBeVisible();
    await expect(composer).toHaveValue('SYNTHETIC retained keyboard draft');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(mutations.every(value => value === `POST /api/rooms/${project.id}/sessions`)).toBe(true);
    expect(errors).toEqual([]);
  });
  });
}
