import { expect, test as base, type Locator } from '@playwright/test';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';
import { ThreadReadRequestSchema, type ThreadState } from '@jarvis-command/contracts';
const test = base.extend({ browser: async ({ playwright }, use) => {
  if (!process.env.STUDIO_BROWSER_CDP_ENDPOINT || process.env.STUDIO_QA_TASK_ID !== 'command#issue-111') throw Error('Use Studio browser QA wrapper for command#issue-111');
  const browser = await playwright.chromium.connectOverCDP(process.env.STUDIO_BROWSER_CDP_ENDPOINT);
  await use(browser); // Leave shared Chrome and original tabs/storage running.
} });
const sessions = ['a', 'b', 'c', 'd', 'e'].map((letter, i) => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC ${['Viewed', 'Needs attention', 'Working', 'Unread', 'Unknown'][i]}`, source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-11-07T12:00:00.000Z', messageCount: 2, toolCallCount: 0, pinned: false }));
const project = { id: 'room_' + 'f'.repeat(32), name: 'SYNTHETIC P13', goal: 'Offline status proof', instructions: '', repository: '', notes: [], sessionIds: sessions.map(s => s.id), lastSessionId: sessions[0]!.id, leadSessionId: null, threads: sessions.map(session => ({ sessionId: session.id, title: session.title, archived: false, createdAt: '2026-11-07T12:00:00.000Z' })) };
for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) test(`SYNTHETIC status/read ${width}x${height}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: height === 360 ? 'reduce' : 'no-preference' });
  await page.addInitScript(id => sessionStorage.setItem('jarvis-command:project-room:v1', id), project.id);
  const errors: string[] = [], reads: unknown[] = [];
  let cleared = false;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (handlePresence(route)) return;
    const session = sessions.find(s => path.includes(s.id));
    const index = session ? sessions.indexOf(session) : -1;
    const state = (): ThreadState => ({ sessionId: session!.id, observedAt: new Date().toISOString(), runObservedAt: index === 4 ? null : new Date().toISOString(), recentAt: null, runStatus: (['completed', 'waiting-approval', 'running', 'completed', 'unknown'] as const)[index]!, historyComplete: true, latest: { messageId: 'm:1', position: 1 }, lastRead: (index === 0 ? cleared : index !== 3) ? { messageId: 'm:1', position: 1 } : null, unread: index === 0 ? !cleared : index === 3 });
    if (session && path.endsWith('/read') && request.method() === 'POST') {
      expect(session.id).toBe(sessions[0]!.id);
      const target = ThreadReadRequestSchema.parse(request.postDataJSON()); expect(target).toEqual({ messageId: 'm:1', position: 1 });
      reads.push(target); cleared = true; return json(state());
    }
    if (request.method() !== 'GET') { errors.push(`unexpected write ${path}`); return route.abort(); }
    if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P13 offline fixture', environment: 'test', generatedAt: new Date().toISOString(), liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions });
    if (path === '/api/rooms') return json({ version: 1, rooms: [project] });
    if (session && path.endsWith('/thread-state')) return json(state());
    if (session && path === `/api/live/sessions/${session.id}`) return json({ session });
    if (session && path.endsWith('/messages')) {
      const offset = Number(url.searchParams.get('offset'));
      return json({ sessionId: session.id, messages: [{ id: `m:${offset}`, sessionId: session.id, role: 'assistant', content: offset ? 'SYNTHETIC actual latest message' : 'SYNTHETIC first page; latest not loaded yet', timestamp: null, toolName: null, displayKind: null }], pagination: { offset, limit: 50, returned: 1, hasMore: offset === 0 } });
    }
    if (session && path.endsWith('/context')) return json({ sessionId: session.id, state: 'unavailable', receipt: null, updatedAt: null });
    if (path === '/api/notifications') return json(emptyInbox);
    if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [] });
    if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
    errors.push(`unexpected ${path}`); return route.abort();
  });
  await page.goto('/'); await page.bringToFront();
  await expect(page.getByLabel('Selected session')).toHaveText(sessions[0]!.title);
  const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
  const load = page.getByRole('button', { name: 'Load more messages', exact: true });
  await expect(load).toBeVisible(); expect(reads).toHaveLength(0);
  await load.click();
  await expect(composer).toBeEnabled();
  await composer.fill('SYNTHETIC retained draft');
  await page.locator('.latest-message-view').scrollIntoViewIfNeeded();
  await expect.poll(() => reads.length).toBe(1);
  await expect(page.locator('.header-thread-states').getByLabel('Idle', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('SYNTHETIC retained draft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`SYNTHETIC-header-${width}x${height}.png`) });
  const threads = page.getByRole('button', { name: 'Threads', exact: true });
  const reachable = async (locator: Locator) => {
    expect(await locator.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && !!hit && el.contains(hit); })).toBe(true);
  };
  await reachable(threads); await threads.click();
  const roster = page.getByRole('region', { name: 'Project threads' });
  await expect(roster).toBeFocused();
  const groups = roster.locator('.project-thread');
  await expect(groups).toHaveCount(5);
  expect(await groups.evaluateAll(elements => elements.map(e => e.getAttribute('aria-label')))).toEqual([1, 2, 3, 0, 4].map(i => `Thread: ${sessions[i]!.title}`));
  await page.screenshot({ path: info.outputPath(`SYNTHETIC-roster-${width}x${height}.png`) });
  for (const label of ['Needs you', 'Working', 'Unread', 'Idle', 'Unknown']) {
    const icon = roster.getByLabel(label, { exact: true });
    await icon.scrollIntoViewIfNeeded(); await reachable(icon);
    await expect(icon).toHaveText(label);
  }
  if (height === 360) expect(await roster.locator('.thread-state-working svg').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Escape'); await expect(threads).toBeFocused();
  await expect(composer).toHaveValue('SYNTHETIC retained draft');
  expect(errors).toEqual([]); expect(reads).toHaveLength(1);
});
