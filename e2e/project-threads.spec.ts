import { expect, test } from '@playwright/test';
import { emptyInbox } from './empty-inbox';
import type { ProjectRoom } from '../packages/contracts/src/project-rooms';

const timestamp = '2026-10-31T18:00:00.000Z';
const sessions = ['a', 'b', 'c'].map(letter => ({ id: 'jc_' + letter.repeat(32), title: `SYNTHETIC chat ${letter}`, source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));

for (const [width, height] of [[1280, 720], [320, 740], [360, 740], [390, 740], [430, 740], [360, 360]] as const) {
  test(`SYNTHETIC independent project threads ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width: width, height: height });
    let room: ProjectRoom = { id: 'room_' + 'd'.repeat(32), name: 'SYNTHETIC thread workspace', goal: 'Verify independent threads', instructions: 'Preserve project instructions', repository: '', notes: ['fixture reference'], sessionIds: sessions.slice(0, 2).map(s => s.id), lastSessionId: null };
    const errors: string[] = [], unexpected: string[] = [], sends: string[] = [];
    let creates = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P9.1 fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: sessions.slice(0, 2) });
      if (path === '/api/notifications') return json(emptyInbox);
      if (path === '/api/rooms') return json({ version: 1, rooms: [room] });
      const thread = path.match(/\/threads\/(jc_[a-c]{32})$/);
      if (thread) {
        const id = thread[1]!, body = req.postDataJSON();
        const old = room.threads?.find(t => t.sessionId === id) ?? { sessionId: id, title: sessions.find(s => s.id === id)!.title, archived: false, createdAt: timestamp };
        room = { ...room, leadSessionId: body.designateLead ? id : room.leadSessionId, threads: [...(room.threads ?? []).filter(t => t.sessionId !== id), { ...old, ...(body.title !== undefined ? { title: body.title } : {}), ...(body.archived !== undefined ? { archived: body.archived } : {}) }] };
        return json({ room });
      }
      if (path === `/api/rooms/${room.id}/sessions`) {
        const id = req.postDataJSON().sessionId;
        room = { ...room, sessionIds: [...new Set([...room.sessionIds, id])], lastSessionId: id };
        return json({ room, session: sessions.find(s => s.id === id) });
      }
      if (path === '/api/live/sessions') { creates++; return json({ session: sessions[2] }); }
      if (/^\/api\/live\/sessions\/jc_[a-c]{32}$/.test(path)) return json({ session: sessions.find(s => path.endsWith(s.id)) });
      if (path.endsWith('/messages')) { const id = path.split('/')[3]; return json({ sessionId: id, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } }); }
      if (path.endsWith('/context')) return json({ sessionId: path.split('/')[4], state: 'unavailable', receipt: null, updatedAt: null });
      if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'SYNTHETIC Sol', reasoningEfforts: ['medium'] }] });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      if (path === '/api/live/runs') sends.push(path);
      unexpected.push(`${req.method()} ${path}`); return route.abort();
    });
    await page.goto('/');
    if (width < 760) await page.getByRole('button', { name: 'Open chat navigation' }).click();
    await page.getByRole('button', { name: room.name, exact: true }).click();
    await page.getByRole('button', { name: 'Project details', exact: true }).click();
    await expect(page.getByText(/No lead designated/)).toBeVisible();
    const first = page.getByRole('group', { name: `Thread: ${sessions[0]!.title}` });
    await first.getByRole('button', { name: 'Designate lead' }).click();
    await expect(page.getByRole('button', { name: `Open lead: ${sessions[0]!.title}` })).toBeVisible();
    await expect(first.getByRole('button', { name: 'Archive thread' })).toBeDisabled();
    await page.getByRole('group', { name: `Thread: ${sessions[1]!.title}` }).getByRole('button', { name: 'Rename thread' }).click();
    const title = 'SYNTHETIC research ' + 'long-title-'.repeat(9);
    await page.getByLabel('Thread title', { exact: true }).fill(title);
    await page.getByLabel('Thread title', { exact: true }).focus();
    await expect(page.getByLabel('Thread title', { exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Save thread title' }).click();
    await page.getByRole('group', { name: `Thread: ${title}` }).getByRole('button', { name: 'Archive thread' }).click();
    await expect(page.getByRole('heading', { name: 'Archived threads', exact: true })).toBeVisible();
    await page.getByRole('group', { name: `Thread: ${title}` }).getByRole('button', { name: 'Restore thread' }).click();
    await expect(page.getByRole('heading', { name: 'Archived threads', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const detail = page.locator('.project-details');
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`threads-${width}-${height}.png`) });
    await page.getByRole('button', { name: `Open lead: ${sessions[0]!.title}` }).click();
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[0]!.title);
    const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
    await composer.fill('SYNTHETIC unsent draft');
    await page.getByRole('button', { name: 'Open project details' }).click();
    await page.getByRole('button', { name: 'Start project chat' }).click();
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[2]!.title);
    await page.getByRole('button', { name: 'Open project details' }).click();
    await page.getByRole('button', { name: `Open lead: ${sessions[0]!.title}` }).click();
    await expect(composer).toHaveValue('SYNTHETIC unsent draft');
    await page.reload();
    await expect(page.getByLabel('Selected session')).toHaveText(sessions[0]!.title);
    expect(room.leadSessionId).toBe(sessions[0]!.id);
    expect(room.sessionIds).toHaveLength(3);
    expect(creates).toBe(1); expect(sends).toEqual([]); expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  });
}
