import { expect, test, type Page } from '@playwright/test';

// SYNTHETIC offline candidate proof. Every API is intercepted; no push, permission prompt, provider,
// inference or Hermes call. Layout/behavior evidence only, not authenticated live readback.
const timestamp = '2026-11-06T16:00:00.000Z';
const chat = (letter: string) => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC chat ${letter.toUpperCase()}`, source: 'web', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false });
const [chatA, chatB] = [chat('a'), chat('b')] as const;
const nid = `ntf_${'1'.repeat(32)}`;
const msg = (c: typeof chatA, id: string) => ({ id, sessionId: c.id, role: 'assistant', content: 'SYNTHETIC identical answer text', timestamp: null, toolName: null, displayKind: null });

async function fixture(page: Page, messageId: string) {
  const forbidden: string[] = []; let presence = 0;
  const inbox = { version: 1, items: [], unreadCount: 0, preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } }, push: { capability: { state: 'unavailable', reason: 'disabled' }, devices: [] }, delivery: { inApp: 'incomplete', push: 'unavailable', externalSurfaces: 'unavailable', replies: 'unsupported' } };
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (path === '/api/bootstrap') return route.fulfill({ json: { identity: { provider: 'development' }, command: { version: 'SYNTHETIC P6.1', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [chatA, chatB] } });
    if (path === '/api/rooms') return route.fulfill({ json: { version: 1, rooms: [] } });
    if (path === '/api/live/model-options') return route.fulfill({ json: { default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'Synthetic Sol', reasoningEfforts: ['medium'] }] } });
    if (path === '/api/live/session-controls') return route.fulfill({ json: { sessionForkPreservesSource: false, sessionCompactionRuns: false } });
    if (path.endsWith('/context')) return route.fulfill({ json: { sessionId: chatA.id, state: 'unavailable', receipt: null, updatedAt: null } });
    const messages = path.match(/^\/api\/sessions\/jc_([ab])\1{31}\/messages$/);
    if (messages) { const c = messages[1] === 'a' ? chatA : chatB; const k = messages[1]!.repeat(2); const rows = Array.from({ length: 12 }, (_, i) => msg(c, `${k}:${i}`)); return route.fulfill({ json: { sessionId: c.id, messages: rows, pagination: { limit: 50, offset: 0, returned: rows.length, hasMore: false } } }); }
    const live = path.match(/^\/api\/live\/sessions\/(jc_[ab]{32})$/);
    if (live) return route.fulfill({ json: { session: live[1] === chatA.id ? chatA : chatB } });
    if (path === '/api/notifications' && method === 'GET') return route.fulfill({ json: inbox });
    if (path === '/api/notifications/presence' && method === 'POST') { presence++; return route.fulfill({ status: 204, body: '' }); }
    if (path === `/api/notifications/${nid}/open` && method === 'POST') return route.fulfill({ json: { state: 'available', sessionId: chatA.id, publicRunId: 'jcr_' + 'c'.repeat(32), messageId, clientRequestId: '00000000-0000-4000-8000-000000000001', runStatus: 'completed', approvalPending: false, session: chatA, inbox } });
    forbidden.push(`${method} ${path}`);
    return route.abort();
  });
  return { forbidden, presence: () => presence };
}

for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) {
  test(`exact reply focus and unavailable state at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const { forbidden, presence } = await fixture(page, 'aa:7');
    await page.goto(`/?notification=${nid}`);
    await page.getByRole('button', { name: 'Open notification' }).click();
    const target = page.locator('[data-message-id="aa:7"]');
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute('data-reply-focus', 'true');
    await expect(page.locator('[data-reply-focus="true"]')).toHaveCount(1);
    expect(await target.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(presence).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(`focus-${width}x${height}.png`) });
    expect(forbidden).toEqual([]);
  });

  test(`missing exact reply is reported honestly at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { forbidden } = await fixture(page, 'bb:7'); // belongs to the other chat
    await page.goto(`/?notification=${nid}`);
    await page.getByRole('button', { name: 'Open notification' }).click();
    await expect(page.getByText(/Exact reply unavailable/)).toBeVisible();
    await expect(page.locator('[data-reply-focus]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(forbidden).toEqual([]);
  });
}
