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

const timestamp = '2026-11-06T12:00:00.000Z';
const session = { id: `jc_${'a'.repeat(32)}`, title: 'SYNTHETIC retained chat', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
const project = { id: `room_${'b'.repeat(32)}`, name: 'SYNTHETIC deletion fixture', goal: 'Disposable offline fixture', repository: '', notes: [], sessionIds: [session.id], lastSessionId: session.id };
for (const [width, height] of [[1280, 720], [1280, 360], [360, 740], [360, 360]] as const) {
  test.describe(`${width}x${height}`, () => {
    const device = devices[width === 1280 ? 'Desktop Chrome' : 'Pixel 7'];
    test.use({ isMobile: device.isMobile, hasTouch: device.hasTouch, userAgent: device.userAgent });
    test('SYNTHETIC cancel, unavailable contents, lost ACK, selected/pending cleanup, repeated deletion and reload', async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(({ project, session }) => {
        sessionStorage.setItem('jarvis-command:project-room:v1', project.id);
        sessionStorage.setItem('jarvis-command:pending-project-attachments:v1', JSON.stringify({ [project.id]: session.id }));
      }, { project, session });
      let deleted = false, secondDeleted = false, enabled = true, writes = 0;
      const second = { ...project, id: `room_${'c'.repeat(32)}`, name: 'SYNTHETIC second fixture', sessionIds: [], lastSessionId: null };
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        const json = (body: unknown) => route.fulfill({ json: body });
        if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P9.6 offline fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session] });
        if (path === '/api/rooms') return json({ version: 1, rooms: [...(deleted ? [] : [project]), ...(secondDeleted ? [] : [second])] });
        if (path.endsWith('/deletion')) { const room = path.includes(second.id) ? second : project; return json({ roomId: room.id, name: room.name, chats: room.sessionIds.length, artifacts: 2, token: 'a'.repeat(64), enabled, contentsAvailable: false, reason: 'Contents deletion unavailable: retained artifact restore and public Hermes session recovery unsupported.' }); }
        if (path.endsWith('/delete')) { writes++; if (path.includes(second.id)) { secondDeleted = true; return json({ deleted: true, roomId: second.id }); } deleted = true; return route.abort(); }
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
      await page.getByRole('textbox', { name: 'Message Jarvis', exact: true }).fill('SYNTHETIC unsent draft');
      await page.getByRole('button', { name: 'Threads', exact: true }).click();
      const drawerDelete = page.getByRole('button', { name: 'Delete project', exact: true });
      const drawerBox = await drawerDelete.boundingBox();
      expect(drawerBox!.width).toBeGreaterThanOrEqual(44); expect(drawerBox!.height).toBeGreaterThanOrEqual(44);
      await drawerDelete.click();
      const dialog = page.getByRole('dialog', { name: 'Delete project?' });
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await expect(dialog).toContainText('1 linked chats · 2 project-scoped artifacts');
      await expect(dialog.getByRole('button', { name: 'Delete project and its chats/artifacts' })).toBeDisabled();
      for (const control of [cancel, dialog.getByRole('button', { name: 'Delete project only', exact: true })]) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(height);
        await control.click({ trial: true });
      }
      await cancel.focus(); await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Delete project only', exact: true })).toBeFocused();
      await page.keyboard.press('Tab'); await expect(cancel).toBeFocused();
      await page.screenshot({ path: info.outputPath(`SYNTHETIC-delete-${width}-${height}.png`) });
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(drawerDelete).toBeFocused(); expect(writes).toBe(0);
      await drawerDelete.click(); await dialog.getByRole('button', { name: 'Delete project only', exact: true }).click();
      await expect(dialog).toHaveCount(0); expect(writes).toBe(1);
      await expect(page.getByLabel('Selected session')).toHaveText(session.title);
      await expect(page.getByRole('textbox', { name: 'Message Jarvis', exact: true })).toHaveValue('SYNTHETIC unsent draft');
      await expect(page.getByRole('button', { name: 'Threads', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Finish adding chat/ })).toHaveCount(0);
      // Open the sidebar on mobile and repeat without reloading.
      if (width < 768) await page.getByRole('button', { name: 'Open chat navigation' }).click();
      const secondControl = page.getByRole('button', { name: `Delete project ${second.name}`, exact: true });
      await expect(secondControl).toBeVisible();
      const listBox = await secondControl.boundingBox();
      expect(listBox!.width).toBeGreaterThanOrEqual(44); expect(listBox!.height).toBeGreaterThanOrEqual(44);
      await secondControl.click({ trial: true });
      enabled = false; await secondControl.click(); await expect(dialog).toContainText('disabled on this server');
      await expect(dialog.getByRole('button', { name: 'Delete project only', exact: true })).toBeDisabled();
      await cancel.click(); enabled = true; await secondControl.click();
      await dialog.getByRole('button', { name: 'Delete project only', exact: true }).click();
      await expect(dialog).toHaveCount(0); expect(writes).toBe(2);
      await page.reload();
      if (width < 768) await page.getByRole('button', { name: 'Open chat navigation' }).click();
      await expect(page.getByRole('button', { name: /^Delete project / })).toHaveCount(0);
      await expect(page.getByRole('button', { name: session.title, exact: true })).toBeVisible();
      expect(errors).toEqual([]); expect(writes).toBe(2);
    });
  });
}
