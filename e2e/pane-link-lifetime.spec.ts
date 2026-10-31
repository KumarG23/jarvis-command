import { expect, test } from '@playwright/test';
import { emptyInbox } from './empty-inbox';

test.use({ serviceWorkers: 'block' });

const timestamp = '2026-10-31T20:00:00.000Z';
const sessions = ['a', 'b', 'c'].map((letter, i) => ({ id: `jc_${letter.repeat(32)}`, title: `SYNTHETIC Pane ${i}`, source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));
const project = { id: `room_${'d'.repeat(32)}`, name: 'SYNTHETIC pane link', goal: 'SYNTHETIC read-only link proof', instructions: '', repository: '', notes: [], archived: false, sessionIds: sessions.map(session => session.id), lastSessionId: sessions[0]!.id };
for (const close of [true, false]) {
  test(`SYNTHETIC pending second-pane link ${close ? 'closed source refuses' : 'current source opens'}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(id => sessionStorage.setItem('jarvis-command:project-room:v1', id), project.id);
    let armed = false, pending = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const mutations: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (req.method() !== 'GET') mutations.push(`${req.method()} ${path}`);
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC pane link', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions });
      if (path === '/api/rooms') return json({ version: 1, rooms: [project] });
      if (path === '/api/notifications') return json(emptyInbox);
      const session = sessions.find(session => path.includes(session.id));
      if (session && path === `/api/live/sessions/${session.id}`) {
        if (session.id === sessions[2]!.id && armed) { pending = true; await gate; }
        return json({ session });
      }
      if (session && path.endsWith('/messages')) return json({ sessionId: session.id, messages: [{ id: `${session.id}:synthetic`, sessionId: session.id, role: 'assistant', content: session.id === sessions[1]!.id ? `[Open C](thread:${sessions[2]!.id})` : 'SYNTHETIC history', timestamp, toolName: null, displayKind: null }], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } });
      if (session && path.endsWith('/context')) return json({ sessionId: session.id, state: 'unavailable', receipt: null, updatedAt: null });
      if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'synthetic' }, options: [] });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      errors.push(`unexpected ${path}`); return route.abort();
    });
    await page.goto('/');
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[0]!.title);
    await page.getByLabel('Second conversation', { exact: true }).selectOption(sessions[1]!.id);
    const pane = page.getByRole('region', { name: 'Second conversation pane' });
    await expect(pane.getByRole('button', { name: 'Open C' })).toBeVisible();
    await page.locator('main').getByRole('textbox', { name: 'Message Jarvis' }).fill('SYNTHETIC retained primary draft');
    armed = true;
    await pane.getByRole('button', { name: 'Open C' }).click();
    await expect.poll(() => pending).toBe(true);
    if (close) await page.getByRole('button', { name: 'Close second conversation' }).click();
    release();
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[close ? 0 : 2]!.title);
    if (close) {
      await expect(page.getByText(/source conversation changed/)).toBeVisible();
      await expect(page.locator('main').getByRole('textbox', { name: 'Message Jarvis' })).toHaveValue('SYNTHETIC retained primary draft');
    }
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
