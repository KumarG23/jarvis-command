// PREPARED ONLY: no browser execution is admitted in the source assignment.
import { expect, test as base, devices, type Locator } from '@playwright/test';
import { RoutingDefaultTargetSchema, RoutingDefaultSetSchema, RoutingDefaultResponseSchema, LiveRunSubmissionRequestSchema } from '@jarvis-command/contracts';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';
import { handleThreadState } from './thread-state-route';
const test = base.extend({ browser: async ({ playwright }, use) => {
  if (!process.env.STUDIO_BROWSER_CDP_ENDPOINT || process.env.STUDIO_QA_TASK_ID !== 'command#issue-111') throw Error('Use the existing Studio SOURCE wrapper for command#issue-111 after separate browser admission');
  const browser = await playwright.chromium.connectOverCDP(process.env.STUDIO_BROWSER_CDP_ENDPOINT);
  await use(browser); // Leave Chrome/original tabs/storage intact; base fixtures close only owned contexts.
} });
const session = { id: 'jc_' + 'a'.repeat(32), title: 'SYNTHETIC saved-default selector', source: 'jarvis-command', ownership: 'command', model: null, lastActive: '2026-11-09T15:00:00Z', messageCount: 0, toolCallCount: 0, pinned: false };
const selection = { provider: 'openai-codex' as const, model: 'gpt-6-luna' as const, reasoningEffort: 'low' as const };
async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const geometry = await control.evaluate(element => {
    const r = element.getBoundingClientRect(); let top = 0, left = 0, bottom = innerHeight, right = innerWidth;
    for (let p = element.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p), b = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) { top = Math.max(top, b.top + p.clientTop); bottom = Math.min(bottom, b.top + p.clientTop + p.clientHeight); }
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { left = Math.max(left, b.left + p.clientLeft); right = Math.min(right, b.left + p.clientLeft + p.clientWidth); }
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { full: r.top >= top && r.bottom <= bottom && r.left >= left && r.right <= right, hit: !!hit && element.contains(hit) };
  });
  expect(geometry).toEqual({ full: true, hit: true });
}
for (const [width, height] of [[1280, 720], [360, 740], [360, 360]]) test.describe(`${width}x${height}`, () => {
  const device = devices[width === 1280 ? 'Desktop Chrome' : 'Pixel 7'];
  test.use({ isMobile: device.isMobile, hasTouch: device.hasTouch, userAgent: device.userAgent });
  test('SYNTHETIC guarded saved defaults and immutable send retry', async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const blocked: string[] = [], unexpected: string[] = [], errors: string[] = [], requests: string[] = [];
    const bodies: ReturnType<typeof LiveRunSubmissionRequestSchema.parse>[] = [], mutations: ReturnType<typeof RoutingDefaultSetSchema.parse>[] = [];
    let writesAvailable = false, revision = 0, configured: typeof selection | null = null;
    const origin = 'http://127.0.0.1:3127';
    // Isolated context guard BEFORE navigation, including sockets. No live fallback.
    await page.context().route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.fallback();
      blocked.push('external origin'); return route.abort();
    });
    await page.context().routeWebSocket('**/*', socket => { blocked.push('websocket'); socket.close(); });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (url.origin !== origin) { blocked.push('external API'); return route.abort(); }
      requests.push(`${request.method()} ${path}`);
      const json = (body: unknown) => route.fulfill({ json: body });
      if (path === '/api/notifications/presence') expect(request.postDataJSON().sessionId).toBe(session.id);
      if (handlePresence(route) || handleThreadState(route, [session.id])) return;
      if (path === '/api/live/routing-defaults/read' && request.method() === 'POST') {
        const target = RoutingDefaultTargetSchema.parse(request.postDataJSON()); expect(target).toEqual({ scope: 'thread', sessionId: session.id, projectId: null });
        return json(RoutingDefaultResponseSchema.parse({ target, revision, selection: configured, replayed: false, writesAvailable }));
      }
      if (path === '/api/live/routing-defaults/set' && request.method() === 'POST') {
        expect(writesAvailable).toBe(true);
        const body = RoutingDefaultSetSchema.parse(request.postDataJSON()); mutations.push(body);
        expect(body.target).toEqual({ scope: 'thread', sessionId: session.id, projectId: null }); expect(body.expectedRevision).toBe(revision);
        revision++; configured = body.selection as typeof selection | null;
        return json({ target: body.target, selection: configured, revision, replayed: false, writesAvailable });
      }
      if (path === '/api/live/runs' && request.method() === 'POST') {
        const body = LiveRunSubmissionRequestSchema.parse(request.postDataJSON()); bodies.push(body);
        // Simulate changed defaults after uncertain admission. The UI must not reconstruct the envelope.
        configured = null;
        return route.fulfill({ status: 503, json: { error: 'SYNTHETIC admission uncertain' } });
      }
      if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${path}`); return route.abort(); }
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC defaults only', environment: 'test', generatedAt: new Date().toISOString(), liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session] });
      if (path === '/api/rooms') return json({ version: 1, rooms: [] });
      if (path === '/api/notifications') return json(emptyInbox);
      if (path === `/api/sessions/${session.id}/messages`) return json({ sessionId: session.id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
      if (path === `/api/live/sessions/${session.id}/context`) return json({ sessionId: session.id, state: 'unavailable', receipt: null, updatedAt: null });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      if (path === '/api/live/model-options') return json({ default: { provider: selection.provider, model: selection.model }, options: [{ provider: selection.provider, model: selection.model, label: 'SYNTHETIC Luna', reasoningEfforts: ['low'] }] });
      unexpected.push(`unhandled GET ${path}`); return route.abort();
    });
    await page.addInitScript(id => sessionStorage.setItem('jarvis-command:selected-session:v1', id), session.id);
    await page.goto('/');
    const draft = page.getByRole('textbox', { name: 'Message Jarvis', exact: true }); await expect(draft).toBeEnabled(); await draft.fill('SYNTHETIC retained selector draft');
    await page.locator('details.inference-control > summary').click();
    const mode = page.getByRole('checkbox', { name: 'Use saved defaults for the next message' });
    await expect(page.getByText('Saved-default changes and new saved-default sends are unavailable on this server. Existing prompt selection and legacy sends still work.')).toBeVisible();
    await expect(mode).toBeDisabled(); expect(mutations).toHaveLength(0); expect(bodies).toHaveLength(0);
    // Fixture-only availability transition; never changes the actual source guard.
    writesAvailable = true; const refresh = page.getByRole('button', { name: 'Refresh saved defaults' }); await reachable(refresh); await refresh.click(); await expect(mode).toBeEnabled();
    await page.getByRole('combobox', { name: 'Model for this prompt' }).selectOption('openai-codex:gpt-6-luna');
    const save = page.getByRole('button', { name: 'Save prompt choice for thread' }); await reachable(save); await save.click(); await expect(page.getByText('Thread: gpt-6-luna · low (revision 1)')).toBeVisible();
    const clear = page.getByRole('button', { name: 'Clear thread default' }); await reachable(clear); await clear.click(); await expect(page.getByText('Thread: Not set (revision 2)')).toBeVisible();
    await reachable(save); await save.click(); await expect(page.getByText('Thread: gpt-6-luna · low (revision 3)')).toBeVisible();
    expect(new Set(mutations.map(mutation => mutation.clientRequestId)).size).toBe(3); expect(bodies).toHaveLength(0);
    await reachable(mode); await mode.check(); await page.getByRole('combobox', { name: 'Model for this prompt' }).selectOption('inherit');
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-default-selector-picker-${width}x${height}.png`) });
    await page.locator('details.inference-control > summary').click(); await expect(draft).toHaveValue('SYNTHETIC retained selector draft');
    const send = page.getByRole('button', { name: 'Send message', exact: true }); await reachable(draft); await reachable(send); await send.click();
    const retry = page.getByRole('button', { name: 'Retry same intent', exact: true }); await expect(retry).toBeVisible();
    expect(bodies).toHaveLength(1); expect(bodies[0]).toMatchObject({ sessionId: session.id, routing: { mode: 'defaults', projectId: null } }); expect(bodies[0]).not.toHaveProperty('inference');
    await reachable(retry); await retry.click(); await expect.poll(() => bodies.length).toBe(2); expect(bodies[1]).toEqual(bodies[0]);
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-default-selector-uncertain-${width}x${height}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(blocked).toEqual([]); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
    await info.attach('synthetic-request-categories', { body: JSON.stringify({ requests, preferenceChanges: mutations.length, explicitRunPosts: bodies.length, uniqueRunUUIDs: new Set(bodies.map(body => body.clientRequestId)).size, blocked, unexpected }), contentType: 'application/json' });
  });
});
