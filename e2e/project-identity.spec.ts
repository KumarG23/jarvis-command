import { expect, test as base } from '@playwright/test';
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

const timestamp = '2026-11-06T12:00:00.000Z';
const session = { id: `jc_${'a'.repeat(32)}`, title: 'SYNTHETIC retained chat', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
const project = { id: `room_${'b'.repeat(32)}`, name: 'SYNTHETIC identity fixture', goal: 'Disposable offline fixture', repository: '', notes: [], sessionIds: [session.id], lastSessionId: session.id };
const before = process.env.IDENTITY_BEFORE === '1';
for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) {
  test(`SYNTHETIC project identity ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(id => sessionStorage.setItem('jarvis-command:project-room:v1', id), project.id);
    let stored = { ...project }, writes = 0;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P11 offline fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session] });
      if (path === '/api/rooms') return json({ version: 1, rooms: [stored] });
      if (path === `/api/rooms/${project.id}` && req.method() === 'POST') { writes++; stored = { ...stored, ...req.postDataJSON() }; return json({ room: stored }); }
      if (path === `/api/live/sessions/${session.id}`) return json({ session });
      if (path.endsWith('/messages')) return json({ sessionId: session.id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
      if (path.endsWith('/context')) return json({ sessionId: session.id, state: 'unavailable', receipt: null, updatedAt: null });
      if (path === '/api/notifications') return json(emptyInbox);
      if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'synthetic' }, options: [] });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      errors.push(`unexpected ${req.method()} ${path}`); return route.abort();
    });
    await page.goto('/');
    await expect(page.getByLabel('Selected session')).toHaveText(session.title);
    const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
    await composer.fill('SYNTHETIC unsent draft');
    await page.getByRole('button', { name: 'Threads', exact: true }).click();
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-${before ? 'before' : 'after'}-details.png`) });
    await page.getByRole('button', { name: 'Edit project', exact: true }).click();
    if (!before) {
      for (const label of ['Project glyph', 'Project accent']) {
        const control = page.getByRole('combobox', { name: label, exact: true });
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await page.getByRole('combobox', { name: 'Project glyph', exact: true }).selectOption('orbit');
      await page.getByRole('combobox', { name: 'Project accent', exact: true }).selectOption('violet');
      await page.screenshot({ path: info.outputPath('SYNTHETIC-after-settings.png') });
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByRole('form', { name: 'Edit project' })).toHaveCount(0);
      await expect(page.locator('.project-title .project-identity')).toHaveAttribute('data-color', 'violet');
      await expect(page.locator('.project-title .project-identity')).toHaveAttribute('data-icon', 'orbit');
      await page.getByRole('button', { name: 'Edit project', exact: true }).click();
    }
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.scrollIntoViewIfNeeded(); await cancel.focus();
    await expect(cancel).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Edit project', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Close project details' }).click();
    await expect(composer).toHaveValue('SYNTHETIC unsent draft');
    await expect(page.getByLabel('Selected project', { exact: true })).toHaveText(project.name);
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-${before ? 'before' : 'after'}-header.png`) });
    if (!before) {
      await expect(page.locator('.room-breadcrumb .project-identity')).toHaveAttribute('data-color', 'violet');
      await page.reload(); await expect(page.getByLabel('Selected session')).toHaveText(session.title);
      await expect(page.locator('.room-breadcrumb .project-identity')).toHaveAttribute('data-icon', 'orbit');
    }
    if (width < 768) await page.getByRole('button', { name: 'Open chat navigation' }).click();
    await expect(page.getByRole('button', { name: project.name, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`SYNTHETIC-${before ? 'before' : 'after'}-list.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes).toBe(before ? 0 : 1); expect(errors).toEqual([]);
  });
}
