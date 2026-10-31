import { expect, test } from '@playwright/test';
import { emptyInbox } from './empty-inbox';
import type { ProjectRoom } from '../packages/contracts/src/project-rooms';

const timestamp = '2026-10-31T18:00:00.000Z';
const ids = ['a', 'b', 'c', 'd', 'e', 'f', '1', '2'].map(letter => `jc_${letter.repeat(32)}`);
const sessions = ids.map((id, index) => ({ id, title: index === 0 ? 'SYNTHETIC lead chat' : `SYNTHETIC thread ${index + 1}`, source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));
const projectId = 'room_' + 'd'.repeat(32);
const targetId = ids[7]!;
const foreignId = 'jc_' + '8'.repeat(32);

for (const [width, height] of [[1280, 720], [320, 740], [360, 740], [390, 740], [430, 740], [320, 360]] as const) {
  test(`SYNTHETIC validated thread link navigation ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const room: ProjectRoom = { id: projectId, name: 'SYNTHETIC validated thread project', goal: 'Open only verified linked chats', instructions: '', archived: false, repository: '', notes: [], sessionIds: ids, lastSessionId: ids[0]!, threads: [{ sessionId: targetId, title: 'SYNTHETIC eighth thread', archived: false, createdAt: timestamp }] };
    const unexpected: string[] = [], mutations: string[] = [];
    let selectedReadCount = 0;
    page.on('pageerror', error => unexpected.push(error.message));
    await page.addInitScript(id => sessionStorage.setItem('jarvis-command:project-room:v1', id), projectId);
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = (body: unknown) => route.fulfill({ json: body });
      if (req.method() !== 'GET') mutations.push(`${req.method()} ${path}`);
      if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P9.3 fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [sessions[0]] });
      if (path === '/api/notifications') return json(emptyInbox);
      if (path === '/api/rooms') return json({ version: 1, rooms: [room] });
      const sessionMatch = path.match(/^\/api\/live\/sessions\/(jc_[a-f0-9]{32})$/);
      if (sessionMatch) {
        const found = sessions.find(session => session.id === sessionMatch[1]);
        if (sessionMatch[1] === ids[0]) selectedReadCount++;
        return found ? json({ session: found }) : route.fulfill({ status: 404, json: { error: 'SYNTHETIC foreign session' } });
      }
      if (path.endsWith('/messages')) {
        const sessionId = path.split('/')[3]!;
        const content = sessionId === ids[0]
          ? `[Open verified thread](thread:${targetId})\n\n[Foreign](thread:${foreignId})\n\n\`[Code](thread:${targetId})\`\n\n> [Quoted roster data](thread:${targetId})\n\n[External](https://example.com)`
          : 'SYNTHETIC eighth thread history';
        const messages = sessionId === ids[0]
          ? [{ id: 'user:link', sessionId, role: 'user', content: `[User token](thread:${targetId})`, timestamp, toolName: null, displayKind: null }, { id: 'assistant:link', sessionId, role: 'assistant', content, timestamp, toolName: null, displayKind: null }, { id: 'tool:link', sessionId, role: 'tool', content: `[Tool token](thread:${targetId})`, timestamp, toolName: 'SYNTHETIC tool', displayKind: null }]
          : [{ id: 'assistant:target', sessionId, role: 'assistant', content, timestamp, toolName: null, displayKind: null }];
        return json({ sessionId, messages, pagination: { limit: 50, offset: 0, returned: messages.length, hasMore: false } });
      }
      if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'SYNTHETIC model' }, options: [] });
      if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
      if (path.endsWith('/context')) return json({ sessionId: ids[0], state: 'unavailable', receipt: null, updatedAt: null });
      unexpected.push(`${req.method()} ${path}`); return route.abort();
    });

    await page.goto('/');
    await expect(page.getByLabel('Selected session')).toHaveText('SYNTHETIC lead chat');
    const valid = page.getByRole('button', { name: 'Open verified thread' });
    await expect(valid).toBeVisible();
    await expect(page.getByRole('button', { name: 'Foreign' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Quoted roster data' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Code' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'User token' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tool token' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'External' })).toHaveAttribute('rel', 'noopener noreferrer');
    if (info.project.name.includes('mobile')) await valid.tap();
    else { await valid.focus(); await page.keyboard.press('Enter'); }
    await expect(page.getByLabel('Selected session')).toHaveText('SYNTHETIC thread 8');
    await expect(page.getByText('SYNTHETIC eighth thread history')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(mutations).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(selectedReadCount).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(`thread-link-${width}-${height}.png`) });
  });
}
