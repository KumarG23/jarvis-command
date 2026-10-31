import { expect, test } from '@playwright/test';
import { emptyInbox } from './empty-inbox';

const timestamp = '2026-10-31T20:00:00.000Z';
const ids = ['a', 'b'].map(letter => `jc_${letter.repeat(32)}`);
const runs = ['a', 'b'].map(letter => `jcr_${letter.repeat(32)}`);
const sessions = ids.map((id, i) => ({ id, title: `SYNTHETIC Thread ${i ? 'B' : 'A'}`, source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));
const pid = `room_${'c'.repeat(32)}`;
const room = { id: pid, name: 'SYNTHETIC concurrent project', goal: 'Two explicit owned fixture sends', instructions: '', archived: false, repository: '', notes: [], sessionIds: ids, lastSessionId: ids[0], threads: sessions.map(session => ({ sessionId: session.id, title: session.title, archived: false, createdAt: timestamp })) };

for (const [width, height] of [[1280, 720], [320, 740], [360, 740], [390, 740], [430, 740], [320, 360]] as const) {
  test(`SYNTHETIC independent threads, navigation and reload ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(id => sessionStorage.setItem('jarvis-command:project-room:v1', id), pid);
    const posts: { sessionId: string; clientRequestId: string; input: string }[] = [];
    const unexpected: string[] = [];
    page.on('pageerror', error => unexpected.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC concurrency', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions });
      if (path === '/api/rooms') return json({ version: 1, rooms: [room] });
      if (path === `/api/rooms/${pid}/sessions`) return json({ room: { ...room, lastSessionId: req.postDataJSON().sessionId }, session: sessions.find(session => session.id === req.postDataJSON().sessionId) });
      if (path === '/api/notifications') return json(emptyInbox);
      if (path.endsWith('/events')) return route.abort(); // Exercise supported status fallback, never real inference.
      if (path === '/api/live/runs' && req.method() === 'POST') {
        const body = req.postDataJSON(); posts.push(body);
        return json({ sessionId: body.sessionId, clientRequestId: body.clientRequestId, publicRunId: runs[ids.indexOf(body.sessionId)], status: 'running', replayed: false });
      }
      const runIndex = runs.indexOf(path.split('/')[4]!);
      if (runIndex >= 0) return json({ publicRunId: runs[runIndex], sessionId: ids[runIndex], status: 'running', updatedAt: timestamp, approval: null, output: `SYNTHETIC output ${runIndex ? 'B' : 'A'}`, error: null, pendingSteer: null, usage: null });
      const found = sessions.find(session => path.includes(session.id));
      if (found && path.endsWith('/messages')) return json({ sessionId: found.id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
      if (found && path.endsWith('/context')) return json({ sessionId: found.id, state: 'unavailable', receipt: null, updatedAt: null });
      if (found && path === `/api/live/sessions/${found.id}`) return json({ session: found });
      if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'synthetic' }, options: [] });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      unexpected.push(`${req.method()} ${path}`); return route.abort();
    });
    await page.goto('/');
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[0]!.title);
    const primary = page.locator('.conversation-panes > main');
    await primary.getByRole('textbox', { name: 'Message Jarvis' }).fill('SYNTHETIC explicit A');
    await primary.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(primary.getByText('SYNTHETIC output A')).toBeVisible();
    if (width > 1000) {
      await page.getByLabel('Second conversation', { exact: true }).selectOption(ids[1]!);
      const second = page.getByRole('region', { name: 'Second conversation pane' });
      await second.getByRole('textbox', { name: 'Message Jarvis' }).fill('SYNTHETIC explicit B');
      await second.getByRole('button', { name: 'Send message' }).click();
      await expect.poll(() => posts.length).toBe(2);
      await expect(second.getByText('SYNTHETIC output B')).toBeVisible();
      await expect(primary.getByText('SYNTHETIC output B')).toHaveCount(0);
      await expect(second.getByText('SYNTHETIC output A')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('desktop-two-panes.png') });
      await page.getByRole('button', { name: 'Close second conversation' }).click();
      expect(posts).toHaveLength(2);
    } else {
      await page.getByRole('button', { name: 'Open chat navigation' }).click();
      await page.locator('.project-chat-list').getByRole('button', { name: sessions[1]!.title, exact: true }).click();
      await expect(page.getByLabel('Selected session')).toHaveText(sessions[1]!.title);
      await primary.getByRole('textbox', { name: 'Message Jarvis' }).fill('SYNTHETIC explicit B');
      await primary.getByRole('button', { name: 'Send message' }).click();
      await expect.poll(() => posts.length).toBe(2);
      await expect(primary.getByText('SYNTHETIC output B')).toBeVisible();
      await expect(primary.getByText('SYNTHETIC output A')).toHaveCount(0);
    }
    await primary.getByRole('textbox', { name: 'Message Jarvis' }).scrollIntoViewIfNeeded();
    await expect(primary.getByRole('textbox', { name: 'Message Jarvis' })).toBeInViewport();
    expect(posts.map(post => post.sessionId)).toEqual(ids);
    expect(new Set(posts.map(post => post.clientRequestId)).size).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`concurrent-${width}-${height}.png`) });
    await page.reload();
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[0]!.title);
    await expect(primary.getByText('Original message unavailable after reload; no message was retransmitted.')).toBeVisible();
    if (width <= 760) await page.getByRole('button', { name: 'Open chat navigation' }).click();
    await expect(page.getByRole('button', { name: `Supervise ${sessions[1]!.title}` })).toContainText('Run running');
    expect(posts).toHaveLength(2);
    expect(unexpected).toEqual([]);
  });
}
