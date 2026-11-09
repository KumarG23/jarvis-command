import { handleDefaultRead } from './routing-defaults-route';
import type { RoutingDefaultTarget } from '@jarvis-command/contracts';
import { expect, test as base, type Locator } from '@playwright/test';
import { CommandBootstrapSchema } from '@jarvis-command/contracts';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';
import { handleThreadState } from './thread-state-route';

// SYNTHETIC candidate fixture in task-owned contexts of Studio's already configured browser. No login, no
// authenticated read, no real API or provider request. Original tabs, storage and Chrome are left untouched.
const test = base.extend({
  browser: async ({ playwright }, use) => {
    const endpoint = process.env.STUDIO_BROWSER_CDP_ENDPOINT;
    if (!endpoint || process.env.STUDIO_QA_TASK_ID !== 'command#issue-115') throw Error('Use the existing Studio browser QA wrapper for command#issue-115');
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    await use(browser);
    // The shared browser stays running; the runner disconnects on exit.
  },
});

const origin = 'http://127.0.0.1:3197';
const phone = { isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (Linux; Android 14; SYNTHETIC) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' };
const sizes = [
  { name: 'desktop', width: 1280, height: 720, mobile: false },
  { name: 'phone360x740', width: 360, height: 740, mobile: true },
  { name: 'short360x360', width: 360, height: 360, mobile: true },
] as const;

// Full-rectangle reach: the control's whole box must be inside the viewport and every clipping ancestor, and its centre must
// hit the control (no overlay). `extent` measures the current state without scrolling; `reachable` first performs the user's
// own scroll (scrollIntoViewIfNeeded) and then requires the complete control to be in view.
const extent = (control: Locator) => control.evaluate(element => {
  const box = element.getBoundingClientRect();
  let top = 0, bottom = innerHeight, left = 0, right = innerWidth;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top + parent.clientTop); bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left + parent.clientLeft); right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth); }
  }
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return { sized: box.width > 0 && box.height > 0, fullyVisible: box.top >= top - 0.5 && box.bottom <= bottom + 0.5 && box.left >= left - 0.5 && box.right <= right + 0.5, receivesHit: !!hit && element.contains(hit), box: [box.left, box.top, box.right, box.bottom].map(Math.round), clip: [left, top, right, bottom].map(Math.round) };
});
async function reachable(control: Locator, label: string) {
  await control.scrollIntoViewIfNeeded();
  expect(await extent(control), `${label} fully reachable (full rectangle, clipping ancestors, hit)`).toMatchObject({ sized: true, fullyVisible: true, receivesHit: true });
}

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, serviceWorkers: 'block', ...(size.mobile ? phone : {}) });
    test(`SYNTHETIC OpenRouter free selector retry and send at ${size.name}`, async ({ page, context }, info) => {
      test.setTimeout(90_000);
      const press = (control: Locator) => (size.mobile ? control.tap() : control.click());
      const diagnostics: unknown[] = [];
      const requests: string[] = [];
      const errors: string[] = [];
      const unexpected: string[] = [], defaultReads: RoutingDefaultTarget[] = [];
      const escaped: string[] = [];
      const posts: Record<string, unknown>[] = [];
      let presence = 0;
      let inventoryReads = 0;
      const sessionId = `jc_${'9'.repeat(32)}`;
      const runId = `jcr_${'8'.repeat(32)}`;
      const timestamp = '2026-11-06T18:00:00.000Z';
      const session = { id: sessionId, title: 'SYNTHETIC OpenRouter free fixture', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
      const bootstrap = CommandBootstrapSchema.parse({
        identity: { provider: 'development' },
        command: { version: 'SYNTHETIC issue-96 fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } },
        hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} },
        sessions: [session],
      });
      const free = { provider: 'openrouter', model: 'z-ai/glm-4.5-air:free', label: 'Free · z-ai/glm-4.5-air:free', reasoningEfforts: [] };
      const paid = { provider: 'openrouter', model: 'vendor/paid-model', advertised: true, authenticated: true, eligible: false, selectable: false, unavailableReason: 'not_approved_allowlist' };
      const freeEntry = { provider: free.provider, model: free.model, advertised: true, authenticated: true, eligible: true, selectable: true, unavailableReason: null };
      const catalog = { entries: [freeEntry, paid], advertisedCount: 2, returned: 2, truncated: false };

      // Egress guard, installed on the owned context BEFORE any navigation and kept through teardown: every
      // request (including keepalive beacons) either is the loopback preview origin or is aborted and counted;
      // /api is served only by the synthetic handler below, never forwarded. WebSockets are refused and counted.
      await context.routeWebSocket(/.*/, socket => { escaped.push('websocket'); void socket.close(); });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
        if (url.origin !== origin) { escaped.push(`${url.protocol}//<other-origin>`); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const path = url.pathname;
        requests.push(`${request.method()} ${path}`);
        if (path === '/api/notifications/presence') { presence++; handlePresence(route); return; }
        if (handleThreadState(route, [sessionId]) || handleDefaultRead(route, [{ scope: 'thread', sessionId, projectId: null }], defaultReads)) return;
        const json = (body: unknown) => route.fulfill({ json: body });
        if (path === '/api/live/runs' && request.method() === 'POST') {
          const payload = request.postDataJSON() as Record<string, unknown>;
          posts.push(payload);
          expect(Object.keys(payload).sort()).toEqual(['clientRequestId', 'inference', 'input', 'sessionId']);
          expect(payload.sessionId).toBe(sessionId);
          expect(payload.input).toBe('SYNTHETIC issue-96 draft');
          expect(payload.inference).toEqual({ provider: free.provider, model: free.model });
          expect(Object.keys(payload.inference as object).sort()).toEqual(['model', 'provider']);
          return route.fulfill({ status: 202, json: { publicRunId: runId, sessionId, clientRequestId: payload.clientRequestId, status: 'completed', replayed: false } });
        }
        if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${path}`); return route.abort(); }
        if (path.endsWith('/messages')) return json({ sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
        if (path.endsWith('/context')) return json({ sessionId, state: 'unavailable', receipt: null, updatedAt: null });
        if (path === `/api/live/runs/${runId}`) return json({ publicRunId: runId, sessionId, status: 'completed', updatedAt: timestamp, approval: null, output: 'SYNTHETIC reply', error: null, pendingSteer: null, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, apiCalls: 0 } });
        if (path === '/api/live/model-options') {
          inventoryReads++;
          if (inventoryReads === 2) return route.fulfill({ status: 429, json: { error: 'SYNTHETIC inventory unavailable' } });
          return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [free], catalog });
        }
        const responses: Record<string, unknown> = {
          '/api/bootstrap': bootstrap,
          '/api/rooms': { version: 1, rooms: [] },
          '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false },
          '/api/notifications': emptyInbox,
        };
        if (!(path in responses)) { unexpected.push(path); return route.abort(); }
        return json(responses[path]);
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') diagnostics.push({ console: message.text() }); });
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (path.startsWith('/api/')) diagnostics.push({ path, status: response.status() });
      });
      const runAdmissions = () => posts.length;
      try {
        const bootstrapResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap');
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
        const response = await bootstrapResponse;
        expect(response.status()).toBe(200);
        expect(CommandBootstrapSchema.safeParse(await response.json()).success).toBe(true);
        await expect(page.getByText('Development preview · SYNTHETIC issue-96 fixture', { exact: true })).toBeVisible();
        const chat = page.getByRole('button', { name: session.title, exact: true });
        if (!(await chat.isVisible())) await press(page.getByRole('button', { name: 'Open chat navigation' }));
        await reachable(chat, 'session row');
        await press(chat);
        await expect.poll(() => inventoryReads).toBeGreaterThanOrEqual(1);

        const picker = page.locator('.header-inference > summary');
        await reachable(picker, 'model picker');
        await press(picker);
        const catalogRegion = page.getByRole('region', { name: 'Advertised model catalog' });
        const group = catalogRegion.getByRole('region', { name: 'OpenRouter advertised models' });
        await expect(group).toContainText(`Free · ${free.model}`);
        const use = group.getByRole('button', { name: `Use OpenRouter ${free.model}` });
        await expect(use).toBeVisible();
        await expect(group.getByText('vendor/paid-model')).toBeVisible();
        await expect(group.getByText('Not on the approved Command list')).toBeVisible();
        const search = catalogRegion.getByRole('searchbox', { name: 'Search advertised models' });
        await reachable(search, 'catalog search');
        await search.fill('glm');
        await reachable(use, 'Use selection');
        await page.screenshot({ path: info.outputPath(`issue-96-${size.name}-1-catalog.png`) });
        await press(use);
        await expect(page.getByRole('combobox', { name: 'Model for this prompt' })).toHaveValue(`openrouter:${free.model}`);
        await expect(page.getByRole('combobox', { name: 'Reasoning for this prompt' })).toBeDisabled();
        await expect(page.getByRole('option', { name: 'Provider default' })).toBeAttached();
        await expect(picker).toContainText('provider default');

        // Close the picker with the keyboard so the composer is reachable, then enter and send the draft.
        await page.keyboard.press('Escape');
        await expect(catalogRegion).toBeHidden();
        const draft = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
        const send = page.getByRole('button', { name: 'Send message', exact: true });
        await reachable(draft, 'draft input');
        await draft.focus();
        await expect(draft).toBeFocused();
        await page.keyboard.type('SYNTHETIC issue-96 draft');
        await expect(draft).toHaveValue('SYNTHETIC issue-96 draft');
        await reachable(send, 'Send');
        await press(send);
        await expect(page.getByText('Model choices unavailable. Retry choices before sending this request, or explicitly choose Inherit.')).toBeVisible();
        await expect(draft).toHaveValue('SYNTHETIC issue-96 draft');
        expect(runAdmissions(), 'zero run admissions after the inventory 429').toBe(0);
        // Natural state (nothing scrolled), then the user's own scroll must bring the WHOLE input and Send into view after the 429.
        const natural = { draft: await extent(draft), send: await extent(send) };
        diagnostics.push({ naturalAfter429: natural });
        await page.screenshot({ path: info.outputPath(`issue-96-${size.name}-2a-error-natural.png`) });
        await reachable(draft, 'draft input after 429');
        await expect(draft).toHaveValue('SYNTHETIC issue-96 draft');
        await page.screenshot({ path: info.outputPath(`issue-96-${size.name}-2b-error-draft-scrolled.png`) });
        await reachable(send, 'Send after 429');
        await page.screenshot({ path: info.outputPath(`issue-96-${size.name}-2c-error-send-scrolled.png`) });
        // Scroll the composer footer to its end: Send stays fully reachable and the composer's own bottom edge is no longer clipped.
        await page.locator('.composer-wrap').evaluate(footer => { footer.scrollTop = footer.scrollHeight; });
        await reachable(send, 'Send at composer end after 429');
        const composerEnd = await extent(page.locator('.turn-composer'));
        expect(composerEnd.box[3], 'composer bottom edge within its clipping bounds after scrolling to the end').toBeLessThanOrEqual(composerEnd.clip[3] + 0.5);
        await page.screenshot({ path: info.outputPath(`issue-96-${size.name}-2d-error-composer-end.png`) });
        expect(runAdmissions(), 'scrolling admits no run').toBe(0);

        // Send is outside the picker and dismisses it; Retry is inside the picker, so reopen it explicitly.
        await reachable(picker, 'model picker (reopen)');
        await press(picker);
        const retry = page.getByRole('button', { name: 'Retry model choices', exact: true });
        await reachable(retry, 'Retry model choices');
        await page.screenshot({ path: info.outputPath(`issue-96-${size.name}-3-retry.png`) });
        await press(retry);
        await expect.poll(() => inventoryReads).toBeGreaterThanOrEqual(3);
        expect(runAdmissions(), 'retry alone admits no run').toBe(0);
        await page.keyboard.press('Escape');
        await expect(catalogRegion).toBeHidden();
        await expect(draft).toHaveValue('SYNTHETIC issue-96 draft');
        await reachable(send, 'Send (after retry)');
        await press(send);
        await expect.poll(runAdmissions).toBe(1);
        await expect(draft).toHaveValue('');
        await expect(page.locator('strong', { hasText: session.title }).first(), 'same session header after send').toBeVisible();
        await page.screenshot({ path: info.outputPath(`issue-96-${size.name}-4-sent.png`) });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${size.name} horizontal overflow`).toBe(true);

        // Exercise the teardown path under the guard: unload fires the presence beacon, which must be intercepted.
        await page.goto('about:blank');
        await expect.poll(() => presence).toBeGreaterThanOrEqual(1);
        expect(runAdmissions()).toBe(1);
        expect(defaultReads.length).toBeGreaterThan(0);
        expect(unexpected).toEqual([]);
        expect(escaped, 'requests/websockets attempting to leave the loopback preview').toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        const summary = { diagnostics, requests, errors, runAdmissions: runAdmissions(), defaultReads, presenceRequests: presence, escaped, unexpected };
        await info.attach('synthetic-network-diagnostic', { body: JSON.stringify(summary), contentType: 'application/json' });
        console.log('SYNTHETIC network diagnostic', JSON.stringify(summary));
        await context.close();
        expect(context.pages()).toHaveLength(0);
        console.log('SYNTHETIC owned context closed');
      }
    });
  });
}
