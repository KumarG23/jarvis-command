import { expect, test as base } from '@playwright/test';
import { ReactionMutationSchema, ReactionTargetSchema } from '@jarvis-command/contracts';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';

// Only Studio's already configured browser, in task-owned contexts. No browser launch/login.
const test = base.extend({
  browser: async ({ playwright }, use) => {
    const endpoint = process.env.STUDIO_BROWSER_CDP_ENDPOINT;
    if (!endpoint || process.env.STUDIO_QA_TASK_ID !== 'command#issue-98') throw Error('Use the existing Studio browser QA wrapper for command#issue-98');
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    await use(browser); // The connection ends on process exit; leave Chrome and discovery tabs running.
  },
});
const timestamp = '2026-11-06T12:00:00Z';
const session = { id: `jc_${'a'.repeat(32)}`, title: 'SYNTHETIC reaction chat', source: 'jarvis-command', ownership: 'command', model: null, lastActive: timestamp, messageCount: 2, toolCallCount: 0, pinned: false };
for (const [width, height] of [[1280, 720], [360, 740], [360, 360]] as const) for (const enabled of [true, false]) {
  test(`SYNTHETIC reactions ${enabled ? 'enabled' : 'unavailable'} ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(id => sessionStorage.setItem('jarvis-command:selected-session:v1', id), session.id);
    const errors: string[] = [], writes: ReturnType<typeof ReactionMutationSchema.parse>[] = [];
    const receipts = new Map<string, object>();
    let emojis: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (handlePresence(route)) return;
      if (req.method() === 'POST' && path === '/api/live/reactions/read') {
        const target = ReactionTargetSchema.parse(req.postDataJSON());
        expect(target).toEqual({ sessionId: session.id, messageId: 'stored:A', offset: 0 });
        return json({ sessionId: session.id, messageId: target.messageId, emojis });
      }
      if (req.method() === 'POST' && path === '/api/live/reactions/mutate') {
        const mutation = ReactionMutationSchema.parse(req.postDataJSON()); writes.push(mutation);
        expect(mutation).toMatchObject({ sessionId: session.id, messageId: 'stored:A', offset: 0, emoji: '❤️' });
        const existing = receipts.get(mutation.clientRequestId);
        if (existing) return json({ ...existing, replayed: true });
        emojis = mutation.action === 'add' ? ['❤️'] : [];
        const receipt = { sessionId: session.id, messageId: mutation.messageId, emojis, active: mutation.action === 'add', changed: true, replayed: false, clientRequestId: mutation.clientRequestId };
        receipts.set(mutation.clientRequestId, receipt);
        if (writes.length === 1) return route.abort(); // Synthetic committed write + unknown ACK.
        return json(receipt);
      }
      if (req.method() !== 'GET') { errors.push(`unexpected ${req.method()} ${path}`); return route.abort(); }
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P12 offline fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', ...(enabled ? ['message_reactions'] : [])], readinessChecks: {} }, sessions: [session] });
      if (path === '/api/rooms') return json({ version: 1, rooms: [] });
      if (path === `/api/live/sessions/${session.id}`) return json({ session });
      if (path.endsWith('/messages')) return json({ sessionId: session.id, messages: ['A', 'B'].map(id => ({ id: `stored:${id}`, sessionId: session.id, role: 'assistant', content: 'SYNTHETIC repeated reply', timestamp: null, toolName: null, displayKind: null })), pagination: { limit: 50, offset: 0, returned: 2, hasMore: false } });
      if (path.endsWith('/context')) return json({ sessionId: session.id, state: 'unavailable', receipt: null, updatedAt: null });
      if (path === '/api/notifications') return json(emptyInbox);
      if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [] });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      errors.push(`unexpected ${req.method()} ${path}`); return route.abort();
    });
    await page.goto('/');
    const a = page.locator('[data-message-id="stored:A"]'), b = page.locator('[data-message-id="stored:B"]');
    await expect(a).toBeVisible();
    const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
    await composer.fill('SYNTHETIC unsent draft');
    if (enabled) {
      const trigger = a.getByRole('button', { name: 'Reactions', exact: true });
      await trigger.click();
      const picker = a.getByRole('group', { name: 'Choose reaction' });
      await expect(picker.getByRole('button', { name: 'Heart', exact: true })).toBeEnabled();
      for (const action of await picker.getByRole('button').all()) {
        const box = await action.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: info.outputPath(`SYNTHETIC-picker-${width}x${height}.png`) });
      await picker.getByRole('button', { name: 'Heart', exact: true }).click();
      await expect(picker.getByRole('alert')).toContainText('Save unconfirmed');
      expect(writes).toHaveLength(1);
      await expect(picker.getByRole('button', { name: 'Thumbs up', exact: true })).toBeDisabled();
      await picker.getByRole('button', { name: 'Check saved reactions' }).click();
      await picker.getByRole('button', { name: 'Retry same reaction intent' }).click();
      await expect(picker.getByRole('button', { name: 'Heart', exact: true })).toBeEnabled();
      expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
      await expect(b.getByRole('button', { name: 'Remove Heart reaction' })).toHaveCount(0);
      await expect(picker.getByRole('button', { name: 'Close reactions' })).toBeFocused();
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
      await expect(picker).toHaveCount(0); await expect(composer).toHaveValue('SYNTHETIC unsent draft');
      await trigger.click(); await expect(picker.getByRole('button', { name: 'Heart', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await picker.getByRole('button', { name: 'Heart', exact: true }).click();
      await expect(picker.getByRole('button', { name: 'Heart', exact: true })).toHaveAttribute('aria-pressed', 'false');
      expect(writes).toHaveLength(3); expect(writes[2]!.action).toBe('remove'); expect(writes[2]!.clientRequestId).not.toBe(writes[0]!.clientRequestId);
    } else {
      await expect(page.getByText('Reactions unavailable on this server.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reactions', exact: true })).toHaveCount(0);
      expect(writes).toHaveLength(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(composer).toBeVisible(); expect(errors).toEqual([]);
  });
}
