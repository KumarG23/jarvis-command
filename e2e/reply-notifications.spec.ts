import { expect, test, type Page } from '@playwright/test';

// Offline candidate proof: every API is intercepted with synthetic data; no push, permission prompt,
// provider or Hermes call. This is layout/behavior evidence only, not authenticated live readback.
const timestamp = '2026-11-06T16:00:00.000Z';
const chat = { id: 'jc_' + 'a'.repeat(32), title: 'SYNTHETIC chat A', source: 'web', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
const reply = { id: `ntf_${'1'.repeat(32)}`, category: 'assistant-reply', observedAt: timestamp, sessionId: chat.id, publicRunId: 'jcr_' + 'a'.repeat(32), readAt: null as string | null, title: 'Reply from synthetic-model', body: 'SYNTHETIC preview of the final reply, bounded to one plain line.', reply: { messageId: 'assistant:1', label: 'synthetic-model' } };

async function fixture(page: Page, replies: 'disabled' | 'unsupported' | 'available') {
  let preferences: Record<string, unknown> = { categories: { 'run-completed': true, 'run-failed': true, approval: true } };
  const forbidden: string[] = [];
  const inbox = () => ({ version: 1, items: [reply], unreadCount: 1, preferences, push: { capability: { state: 'unavailable', reason: 'disabled' }, devices: [] }, delivery: { inApp: 'incomplete', push: 'unavailable', externalSurfaces: 'unavailable', replies } });
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    if (path === '/api/bootstrap') return route.fulfill({ json: { identity: { provider: 'development' }, command: { version: 'SYNTHETIC P6.1', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [chat] } });
    if (path === '/api/rooms') return route.fulfill({ json: { version: 1, rooms: [] } });
    if (path === '/api/live/model-options') return route.fulfill({ json: { default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'Synthetic Sol', reasoningEfforts: ['medium'] }] } });
    if (path === '/api/live/session-controls') return route.fulfill({ json: { sessionForkPreservesSource: false, sessionCompactionRuns: false } });
    if (path.endsWith('/messages')) return route.fulfill({ json: { sessionId: chat.id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } });
    if (path.endsWith('/context')) return route.fulfill({ json: { sessionId: chat.id, state: 'unavailable', receipt: null, updatedAt: null } });
    if (path === '/api/notifications' && method === 'GET') return route.fulfill({ json: inbox() });
    if (path === '/api/notifications/reconcile') return route.fulfill({ json: { inbox: inbox(), checked: 0, unavailable: 0 } });
    if (path === '/api/notifications/preferences') { preferences = body; return route.fulfill({ json: inbox() }); }
    forbidden.push(`${method} ${path}`);
    return route.abort();
  });
  return { forbidden };
}

for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) {
  test(`reply notification state and single setting at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => { (window as unknown as { Notification: unknown }).Notification = { requestPermission: () => { (window as unknown as { __prompted: boolean }).__prompted = true; return Promise.resolve('denied'); } }; });
    const { forbidden } = await fixture(page, 'unsupported');
    await page.goto('/');
    if (width < 760) await page.getByRole('button', { name: 'Open chat navigation' }).click();
    await page.getByRole('button', { name: /^Notifications 1 unread$/ }).click();
    await expect(page.getByText(/does not yet provide the exact final-message binding/)).toBeVisible();
    await page.getByRole('button', { name: 'Replies' }).click();
    await expect(page.getByText('Reply from synthetic-model')).toBeVisible();
    const box = page.getByRole('checkbox', { name: 'Show reply text in notifications' });
    await box.scrollIntoViewIfNeeded();
    await expect(box).toBeChecked();
    const target = await box.evaluate(element => { const r = element.closest('label')!.getBoundingClientRect(); return r.height; });
    expect(target).toBeGreaterThanOrEqual(24);
    await box.uncheck();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Preferences saved and confirmed.')).toBeVisible();
    await expect(box).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted ?? false)).toBe(false);
    await page.screenshot({ path: info.outputPath(`reply-${width}x${height}.png`), fullPage: false });
    expect(forbidden).toEqual([]);
  });
}
