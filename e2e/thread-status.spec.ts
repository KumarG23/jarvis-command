import { expect, test as base, devices, type Locator } from '@playwright/test';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';
import { CommandBootstrapSchema, ProjectRoomSchema, SessionSummarySchema, SessionMessagesPageSchema, ThreadStateSchema, ThreadReadRequestSchema, type ThreadState } from '@jarvis-command/contracts';
const test = base.extend({ browser: async ({ playwright }, use) => {
  if (!process.env.STUDIO_BROWSER_CDP_ENDPOINT || process.env.STUDIO_QA_TASK_ID !== 'command#issue-144') throw Error('Use Studio browser QA wrapper for command#issue-144');
  const browser = await playwright.chromium.connectOverCDP(process.env.STUDIO_BROWSER_CDP_ENDPOINT);
  await use(browser); // Leave shared Chrome and original tabs/storage running.
} });
const sessions = SessionSummarySchema.array().parse(['a', 'b', 'c', 'd', 'e'].map((letter, i) => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC ${['Viewed', 'Needs attention', 'Working', 'Unread', 'Unknown'][i]}`, source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-11-07T12:00:00.000Z', messageCount: 2, toolCallCount: 0, pinned: false })));
const project = ProjectRoomSchema.parse({ id: 'room_' + 'f'.repeat(32), name: 'SYNTHETIC P13', goal: 'Offline status proof', instructions: '', repository: '', notes: [], sessionIds: sessions.map(s => s.id), lastSessionId: sessions[0]!.id, leadSessionId: null, threads: sessions.map(session => ({ sessionId: session.id, title: session.title, archived: false, createdAt: '2026-11-07T12:00:00.000Z' })) });
for (const [width, height] of [[1280, 720], [1280, 360], ...[320, 360, 390, 430].flatMap(width => [[width, 740], [width, 360]])]) test.describe(`${width}x${height}`, () => {
  const device = devices[width === 1280 ? 'Desktop Chrome' : 'Pixel 7'];
  test.use({ isMobile: device.isMobile, hasTouch: device.hasTouch, userAgent: device.userAgent });
  test(`SYNTHETIC status/read ${width}x${height}`, async ({ page }, info) => {
  const reachable = async (locator: Locator) => {
    await expect.poll(() => locator.evaluate(element => {
      const r = element.getBoundingClientRect();
      let top = 0, bottom = innerHeight, left = 0, right = innerWidth;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top + parent.clientTop); bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left + parent.clientLeft); right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth); }
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { clippedVisible: r.top >= top && r.bottom <= bottom && r.left >= left && r.right <= right, receivesHit: !!hit && element.contains(hit) };
    }), 'full clipped bounds and actual pointer hit, without implicit scrolling').toEqual({ clippedVisible: true, receivesHit: true });
  };
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: height === 360 ? 'reduce' : 'no-preference' });
  await page.addInitScript(id => sessionStorage.setItem('jarvis-command:project-room:v1', id), project.id);
  const errors: string[] = [], reads: unknown[] = [];
  let cleared = false, finalRequested = false;
  let releaseFinal!: () => void;
  const finalHistory = new Promise<void>(resolve => { releaseFinal = resolve; });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (handlePresence(route)) return;
    const session = sessions.find(s => path.includes(s.id));
    const index = session ? sessions.indexOf(session) : -1;
    const latest = index === 0 ? { messageId: 'assistant:49', position: 49 } : { messageId: 'm:1', position: 1 };
    const state = (): ThreadState => ({ sessionId: session!.id, observedAt: new Date().toISOString(), runObservedAt: index === 4 ? null : new Date().toISOString(), recentAt: null, runStatus: (['completed', 'waiting-approval', 'running', 'completed', 'unknown'] as const)[index]!, historyComplete: true, latest, lastRead: (index === 0 ? cleared : index !== 3) ? latest : null, unread: index === 0 ? !cleared : index === 3 });
    if (session && path.endsWith('/read') && request.method() === 'POST') {
      expect(session.id).toBe(sessions[0]!.id);
      const target = ThreadReadRequestSchema.parse(request.postDataJSON()); expect(target).toEqual(latest);
      reads.push(target); cleared = true; return json(ThreadStateSchema.parse(state()));
    }
    if (request.method() !== 'GET') { errors.push(`unexpected write ${path}`); return route.abort(); }
    if (path === '/api/bootstrap') return json(CommandBootstrapSchema.parse({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P13 offline fixture', environment: 'test', generatedAt: new Date().toISOString(), liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions }));
    if (path === '/api/rooms') return json({ version: 1, rooms: [project] });
    if (session && path.endsWith('/thread-state')) return json(ThreadStateSchema.parse(state()));
    if (session && path === `/api/live/sessions/${session.id}`) return json({ session });
    if (session && path.endsWith('/messages')) {
      const offset = Number(url.searchParams.get('offset'));
      if (index === 0) {
        if (offset === 50) { finalRequested = true; await finalHistory; }
        const messages = offset === 0
          ? Array.from({ length: 50 }, (_, i) => ({ id: i === 49 ? 'assistant:49' : `assistant:${i}`, sessionId: session.id, role: 'assistant' as const, content: i === 49 ? 'SYNTHETIC eligible assistant answer' : `SYNTHETIC earlier canonical answer ${i}`, timestamp: null, toolName: null, displayKind: null }))
          : Array.from({ length: 50 }, (_, i) => {
            const records = [
              { role: 'system' as const, content: 'SYNTHETIC setup metadata', toolName: null, displayKind: null },
              { role: 'user' as const, content: 'SYNTHETIC internal notification', toolName: null, displayKind: 'internal_notification' },
              { role: 'tool' as const, content: 'SYNTHETIC tool output', toolName: 'fixture-tool', displayKind: null },
              { role: 'assistant' as const, content: '', toolName: null, displayKind: null },
              { role: 'assistant' as const, content: 'SYNTHETIC display-only activity', toolName: null, displayKind: 'display_only' },
            ];
            return { id: `metadata:${i}`, sessionId: session.id, timestamp: null, ...records[i % records.length]! };
          });
        return json(SessionMessagesPageSchema.parse({ sessionId: session.id, messages, pagination: { offset, limit: 50, returned: messages.length, hasMore: offset === 0 } }));
      }
      if (offset === 1) { finalRequested = true; await finalHistory; }
      return json(SessionMessagesPageSchema.parse({ sessionId: session.id, messages: [{ id: `m:${offset}`, sessionId: session.id, role: 'assistant', content: offset ? 'SYNTHETIC actual latest message' : 'SYNTHETIC first page; latest not loaded yet\n'.repeat(35), timestamp: null, toolName: null, displayKind: null }], pagination: { offset, limit: 50, returned: 1, hasMore: offset === 0 } }));
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
  await expect.poll(() => finalRequested).toBe(true);
  // Playwright's per-target focus emulation keeps background pages visible.
  // Exercise the negative lifecycle guards explicitly in this isolated fixture;
  // restore native getters before proving real marker intersection/read behavior.
  const lifecycle = await page.evaluateHandle(() => {
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const focus = Object.getOwnPropertyDescriptor(document, 'hasFocus');
    return (state: 'hidden' | 'unfocused' | 'native') => {
      if (state === 'native') {
        if (visibility) Object.defineProperty(document, 'visibilityState', visibility); else Reflect.deleteProperty(document, 'visibilityState');
        if (focus) Object.defineProperty(document, 'hasFocus', focus); else Reflect.deleteProperty(document, 'hasFocus');
      } else {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state === 'hidden' ? 'hidden' : 'visible' });
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
      }
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(state === 'native' ? 'focus' : 'blur'));
    };
  });
  await lifecycle.evaluate(set => set('hidden'));
  releaseFinal();
  await expect(composer).toBeEnabled();
  const marker = page.locator('.latest-message-view');
  const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const metadataTail = page.locator('[data-message-id="metadata:49"]');
  await metadataTail.scrollIntoViewIfNeeded(); await expect(metadataTail).toBeInViewport();
  await frame(); expect(reads).toHaveLength(0);
  expect(await metadataTail.locator('.latest-message-view').count()).toBe(0);
  await marker.scrollIntoViewIfNeeded();
  await expect(marker).toBeInViewport();
  // Let the real IntersectionObserver deliver while visibility/focus deny a read.
  await frame(); expect(reads).toHaveLength(0);
  await lifecycle.evaluate(set => set('unfocused'));
  await frame(); expect(reads).toHaveLength(0);
  await page.locator('.timeline[aria-label="Conversation"]').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await frame();
  await lifecycle.evaluate(set => set('native'));
  await expect.poll(() => page.evaluate(() => document.hasFocus() && document.visibilityState === 'visible')).toBe(true);
  await expect(marker).not.toBeInViewport();
  await frame(); expect(reads).toHaveLength(0);
  await composer.fill('SYNTHETIC retained draft');
  await page.locator('.latest-message-view').scrollIntoViewIfNeeded();
  await expect.poll(() => reads.length).toBe(1);
  await expect(page.locator('.header-thread-states').getByLabel('Idle', { exact: true })).toBeVisible();
  await expect(page.locator('.header-thread-states').getByLabel('Needs you', { exact: true })).toBeVisible();
  for (const label of ['Idle', 'Needs you']) await reachable(page.locator('.header-thread-states').getByLabel(label, { exact: true }));
  expect((await page.locator('.command-header').boundingBox())!.height, 'compact status header').toBeLessThanOrEqual(width < 761 ? 120 : 100);
  await expect(composer).toHaveValue('SYNTHETIC retained draft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  // The keyboard-height footer scrolls internally; reveal the input/send row.
  await send.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await reachable(composer); await reachable(send);
  expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath(`SYNTHETIC-header-${width}x${height}.png`) });
  const threads = page.getByRole('button', { name: 'Threads', exact: true });
  await reachable(threads); await threads.click();
  const roster = page.getByRole('region', { name: 'Project threads' });
  await expect(roster).toBeFocused();
  const groups = roster.locator('.project-thread');
  await expect(groups).toHaveCount(5);
  expect(await groups.evaluateAll(elements => elements.map(e => e.getAttribute('aria-label')))).toEqual([1, 2, 3, 0, 4].map(i => `Thread: ${sessions[i]!.title}`));
  await page.screenshot({ path: info.outputPath(`SYNTHETIC-roster-${width}x${height}.png`) });
  for (const label of ['Needs you', 'Working', 'Unread', 'Idle', 'Unknown']) {
    const icon = roster.getByLabel(label, { exact: true });
    await icon.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })); await reachable(icon);
    await expect(icon).toHaveText(label);
  }
  await page.screenshot({ path: info.outputPath(`SYNTHETIC-roster-tail-${width}x${height}.png`) });
  expect(await roster.locator('.thread-state-working svg').evaluate(el => getComputedStyle(el).animationName)).toBe(height === 360 ? 'none' : 'thread-working');
  await page.keyboard.press('Escape'); await expect(threads).toBeFocused();
  await expect(composer).toHaveValue('SYNTHETIC retained draft');
  if (width < 760) await page.getByRole('button', { name: 'Open chat navigation', exact: true }).click();
  const recent = page.getByRole('navigation', { name: 'Recent chats', exact: true });
  const attentionChat = recent.getByRole('button', { name: sessions[1]!.title, exact: true });
  const attentionIcon = attentionChat.getByRole('img', { name: 'Needs you', exact: true });
  await attentionIcon.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await reachable(attentionIcon); await reachable(attentionIcon.locator('span'));
  expect(await attentionIcon.locator('span').evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const text = range.getBoundingClientRect(), box = el.getBoundingClientRect();
    return { textFits: text.left >= box.left && text.right <= box.right, contentFits: el.scrollWidth <= el.clientWidth };
  }), 'the full status text must fit its own box').toEqual({ textFits: true, contentFits: true });
  const unreadChat = recent.getByRole('button', { name: sessions[3]!.title, exact: true });
  await unreadChat.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await reachable(unreadChat);
  await expect(unreadChat.getByRole('img', { name: 'Unread', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`SYNTHETIC-chat-list-${width}x${height}.png`) });
  if (width < 760) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open chat navigation', exact: true })).toBeFocused();
  }
  await expect(composer).toHaveValue('SYNTHETIC retained draft');
  if (width === 1280 && height === 720) {
    const fallback = await page.request.get('/api/__synthetic_unhandled');
    expect(fallback.status()).toBe(503); expect(await fallback.json()).toEqual({ error: 'synthetic_fixture_api_not_intercepted' });
  }
  expect(errors).toEqual([]); expect(reads).toEqual([{ messageId: 'assistant:49', position: 49 }]);
  await lifecycle.dispose();
});
});
