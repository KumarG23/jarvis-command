import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './candidate-test';
import { CommandBootstrapSchema, ProjectRoomsSchema } from '@jarvis-command/contracts';
import { emptyInbox } from './empty-inbox';
import { handlePresence } from './presence-route';
import { handleThreadState } from './thread-state-route';

// Synthetic fixture: many projects and many chats, so both lists overflow.
const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');
const sessions = Array.from({ length: 40 }, (_, i) => ({
  id: `jc_${hex(i + 1, 32)}`, title: `Synthetic chat ${i + 1} with a fairly long title for wrapping checks`, ownership: 'command' as const, source: 'web',
  model: null, lastActive: new Date(Date.UTC(2026, 10, 13, 12, 0) - i * 60_000).toISOString(), messageCount: 2, toolCallCount: 0, pinned: false,
}));
const bootstrap = CommandBootstrapSchema.parse({
  identity: { provider: 'development' },
  command: { version: 'test', environment: 'test', generatedAt: '2026-11-13T12:00:00.000Z', liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } },
  hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'session_resources'], readinessChecks: {} },
  sessions,
});
const rooms = ProjectRoomsSchema.parse({ version: 1, rooms: Array.from({ length: 14 }, (_, i) => ({
  id: `room_${hex(i + 1, 32)}`, name: `Synthetic project ${i + 1}`, goal: 'Layout fixture', repository: '', notes: [], sessionIds: [], lastSessionId: null,
})) });

async function mockApis(page: Page) {
  const responses: Record<string, unknown> = { '/api/bootstrap': bootstrap, '/api/rooms': rooms, '/api/notifications': emptyInbox, '/api/artifacts': { artifacts: [] } };
  await page.route('**/api/**', async route => {
    if (handlePresence(route) || handleThreadState(route, sessions.map(s => s.id))) return;
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET' && path in responses) await route.fulfill({ json: responses[path] });
    else await route.fulfill({ status: 503, json: { error: 'fixture' } });
  });
}
const top = async (locator: Locator) => (await locator.boundingBox())!.y;

test('Projects and Recent chats scroll independently with pinned headings', async ({ page }, info) => {
  await mockApis(page);
  await page.goto('/');
  await expect(page.locator('.command-header')).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open chat navigation' });
  if ((page.viewportSize()?.width ?? 1000) <= 760) { await expect(menu).toBeVisible(); await menu.click(); }
  const projects = page.getByRole('navigation', { name: 'Projects', exact: true });
  const chats = page.getByRole('navigation', { name: 'Recent chats', exact: true });
  await expect(projects.getByRole('button', { name: 'Synthetic project 14', exact: true })).toBeAttached();
  await expect(chats.getByRole('button', { name: sessions[39]!.title, exact: true })).toBeAttached();
  await page.screenshot({ path: info.outputPath('before.png') });

  for (const section of [projects, chats]) {
    const { scroll, client, overflow } = await section.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY }));
    expect(overflow).toBe('auto');
    expect(scroll).toBeGreaterThan(client);
    expect(client).toBeGreaterThan(100);
  }
  const projectsHeading = projects.getByRole('heading', { name: 'Projects' });
  const chatsHeading = chats.getByRole('heading', { name: 'Recent chats' });
  const projectsTop = await top(projectsHeading), chatsTop = await top(chatsHeading);

  // Scrolling chats leaves the project list where it is, and its heading stays visible.
  await chats.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await top(projectsHeading)).toBe(projectsTop);
  expect(await top(chatsHeading)).toBe(chatsTop);
  await expect(chatsHeading).toBeInViewport();
  await expect(chats.getByRole('button', { name: sessions[39]!.title, exact: true })).toBeInViewport();
  expect(await projects.evaluate(el => el.scrollTop)).toBe(0);

  // Scrolling projects leaves chats alone.
  await projects.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(projectsHeading).toBeInViewport();
  await expect(projects.getByRole('button', { name: 'Synthetic project 14', exact: true })).toBeInViewport();
  expect(await chats.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('scrolled.png') });

  // Chat titles and their status stay on one line each (no "Unknown" broken across lines).
  const row = chats.getByRole('button', { name: sessions[0]!.title, exact: true });
  const state = row.locator('.thread-state');
  await expect(state).toBeVisible();
  const lines = await state.evaluate(el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBe(1);
  const title = row.locator('.chat-item-title');
  expect(await title.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
});

test('a short desktop window keeps Projects visible instead of squeezing it away', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) <= 760, 'desktop layout only');
  await page.setViewportSize({ width: 1280, height: 640 });
  await mockApis(page);
  await page.goto('/');
  const projects = page.getByRole('navigation', { name: 'Projects', exact: true });
  const chats = page.getByRole('navigation', { name: 'Recent chats', exact: true });
  await expect(projects.getByRole('button', { name: 'Synthetic project 1', exact: true })).toBeVisible();
  for (const section of [projects, chats]) expect(await section.evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(100);
});
