import { expect, test, type Page } from '@playwright/test';

// Owned local fixtures only. Every API is intercepted; no Hermes, inference, push or permission prompt.
test.use({ serviceWorkers: 'block' });

const timestamp = '2026-10-28T16:00:00.000Z';
const sessionFor = (letter: string) => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC chat ${letter.toUpperCase()}`, source: 'web', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false });
const chatA = sessionFor('a');
const chatB = sessionFor('b');
const runB = 'jcr_' + 'b'.repeat(32);
const runA = 'jcr_' + 'a'.repeat(32);
const itemId = (n: number) => `ntf_${n.toString(16).padStart(32, '0')}`;
const base = (n: number, category: string, session: typeof chatA, publicRunId: string) => ({
  id: itemId(n), category, observedAt: timestamp, sessionId: session.id, publicRunId, readAt: null as string | null,
  title: category === 'approval' ? 'Approval needed' : category === 'run-failed' ? 'Run failed' : 'Run finished',
  body: 'Generic body.',
});
const delivery = { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' };

async function fixture(page: Page) {
  let items = [base(3, 'approval', chatB, runB), base(2, 'run-completed', chatA, runA), base(1, 'run-failed', chatA, runA)];
  let categories = { 'run-completed': true, 'run-failed': true, approval: true };
  let openState: 'available' | 'missing' = 'available';
  const forbidden: string[] = [];
  const inbox = () => ({ version: 1, items, unreadCount: items.filter(i => i.readAt === null).length, preferences: { categories }, delivery });
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    if (path === '/api/bootstrap') return route.fulfill({ json: { identity: { provider: 'development' }, command: { version: 'SYNTHETIC P6', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [chatA, chatB] } });
    if (path === '/api/rooms') return route.fulfill({ json: { version: 1, rooms: [] } });
    if (path === '/api/live/model-options') return route.fulfill({ json: { default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'Synthetic Sol', reasoningEfforts: ['medium'] }] } });
    if (path === '/api/live/session-controls') return route.fulfill({ json: { sessionForkPreservesSource: false, sessionCompactionRuns: false } });
    const messages = path.match(/^\/api\/sessions\/(jc_[ab]{32})\/messages$/);
    if (messages) return route.fulfill({ json: { sessionId: messages[1], messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } });
    if (path.endsWith('/context')) return route.fulfill({ json: { sessionId: chatA.id, state: 'unavailable', receipt: null, updatedAt: null } });
    if (path === `/api/live/runs/${runB}` && method === 'GET') return route.fulfill({ json: { publicRunId: runB, sessionId: chatB.id, status: 'waiting_for_approval', updatedAt: timestamp, approval: { requestId: 'req-1', command: 'SYNTHETIC command', description: 'SYNTHETIC approval', tool: 'terminal' }, output: null, error: null, pendingSteer: null, usage: null } });
    if (path === '/api/notifications' && method === 'GET') return route.fulfill({ json: inbox() });
    if (path === '/api/notifications/reconcile') return route.fulfill({ json: { inbox: inbox(), checked: 0, unavailable: 0 } });
    if (path === '/api/notifications/read') { items = items.map(i => body.all || body.ids?.includes(i.id) ? { ...i, readAt: timestamp } : i); return route.fulfill({ json: inbox() }); }
    if (path === '/api/notifications/preferences') { categories = body.categories; return route.fulfill({ json: inbox() }); }
    const open = path.match(/^\/api\/notifications\/(ntf_[a-f0-9]{32})\/open$/);
    if (open) {
      if (openState === 'missing') return route.fulfill({ json: { state: 'missing' } });
      items = items.map(i => i.id === open[1] ? { ...i, readAt: timestamp } : i);
      return route.fulfill({ json: { state: 'available', sessionId: chatB.id, publicRunId: runB, clientRequestId: '00000000-0000-4000-8000-000000000002', runStatus: 'waiting_for_approval', approvalPending: true, session: chatB, inbox: inbox() } });
    }
    forbidden.push(`${method} ${path}`);
    return route.abort();
  });
  return { forbidden, setOpenState: (state: typeof openState) => { openState = state; } };
}

for (const [width, height] of [[1280, 720], [320, 740], [360, 740], [390, 740], [430, 740], [360, 360], [430, 360]] as const) {
  test(`inbox read, filter, open and draft retention at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => { (window as unknown as { Notification: unknown }).Notification = { requestPermission: () => { (window as unknown as { __prompted: boolean }).__prompted = true; return Promise.resolve('denied'); } }; });
    const { forbidden, setOpenState } = await fixture(page);
    await page.goto('/');
    const nav = page.getByRole('button', { name: 'Open chat navigation' });
    const openSidebar = async () => { if (width < 760) await nav.click(); };
    await openSidebar();
    await page.getByRole('button', { name: chatA.title, exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
    await expect(composer).toBeEnabled();
    await composer.fill('SYNTHETIC unsent draft');

    await openSidebar();
    const entry = page.getByRole('button', { name: /^Notifications 3 unread$/ });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page.getByRole('heading', { name: '3 unread' })).toBeVisible();
    await expect(page.getByText(/closed-app push alerts are not available yet/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of await page.locator('.notifications-pane button:visible').all()) {
      const box = (await control.boundingBox())!;
      expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }

    const list = page.getByRole('list', { name: 'Notifications' });
    await page.getByRole('button', { name: 'Approvals' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await page.getByRole('button', { name: 'Mark Run failed read' }).click();
    await expect(page.getByRole('heading', { name: '2 unread' })).toBeVisible();

    // Preferences: authoritative save/readback, existing items unchanged.
    const failed = page.getByRole('checkbox', { name: 'Run failed' });
    await failed.uncheck();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Preferences saved and confirmed.')).toBeVisible();
    await expect(failed).not.toBeChecked();
    await expect(list.getByRole('listitem')).toHaveCount(3);

    // A missing target is reported and nothing changes.
    setOpenState('missing');
    await page.getByRole('button', { name: 'Open chat for Approval needed' }).click();
    await expect(page.getByText(/no longer exists/)).toBeVisible();
    await expect(page.getByLabel('Selected session')).toHaveText(chatA.title);

    setOpenState('available');
    await page.getByRole('button', { name: 'Open chat for Approval needed' }).click();
    await expect(page.getByLabel('Selected session')).toHaveText(chatB.title);
    await expect(page.getByRole('region', { name: 'Awaiting approval' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Context workspace' })).toBeHidden();

    await openSidebar();
    await page.getByRole('button', { name: chatA.title, exact: true }).click();
    await expect(page.getByLabel('Selected session')).toHaveText(chatA.title);
    await expect(composer).toHaveValue('SYNTHETIC unsent draft');
    await openSidebar();
    await expect(page.getByRole('button', { name: /^Notifications 1 unread$/ })).toBeVisible();

    expect(forbidden, 'no unexpected API traffic (admission, approval, steer, stop)').toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted ?? false)).toBe(false);
  });
}
