import { expect, test, type Page } from '@playwright/test';

// Synthetic browser fixtures only: no production sessions or project mutations.
test.use({ serviceWorkers: 'block' });

const timestamp = '2026-09-22T12:00:00.000Z';
const room = { id: 'room_' + 'a'.repeat(32), name: 'GainLog', goal: 'Track health', repository: '', notes: [], sessionIds: [] as string[], lastSessionId: null as string | null };
const other = { ...room, id: 'room_' + 'b'.repeat(32), name: 'Garden' };
const recent = { id: 'jc_' + 'c'.repeat(32), title: 'Existing recent chat', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
const globalChat = { ...recent, id: 'jc_' + 'd'.repeat(32), title: 'Standalone chat' };
const projectChat = { ...recent, id: 'jc_' + 'e'.repeat(32), title: 'GainLog chat' };

async function mockShell(page: Page, failFirstLink = false) {
  let linkAttempts = 0;
  await page.route('**/api/bootstrap', route => route.fulfill({ json: {
    identity: { provider: 'development' },
    command: { version: 'fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } },
    hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} },
    sessions: [recent],
  } }));
  await page.route('**/api/rooms', route => route.fulfill({ json: { version: 1, rooms: [room, other] } }));
  await page.route('**/api/live/session-controls', route => route.fulfill({ json: { sessionForkPreservesSource: true, sessionCompactionRuns: true } }));
  await page.route('**/api/live/model-options', route => route.fulfill({ json: { default: null, options: [] } }));
  await page.route('**/api/live/sessions', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { session: body.title === room.name ? projectChat : globalChat } });
  });
  await page.route(`**/api/rooms/${room.id}/sessions`, async route => {
    linkAttempts++;
    if (failFirstLink && linkAttempts === 1) return route.fulfill({ status: 503, json: { error: 'uncertain' } });
    return route.fulfill({ json: { room: { ...room, sessionIds: [projectChat.id], lastSessionId: projectChat.id }, session: projectChat } });
  });
  await page.route('**/api/sessions/*/messages?*', route => {
    const sessionId = new URL(route.request().url()).pathname.split('/')[3]!;
    return route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } });
  });
  await page.route('**/api/live/sessions/*/context', route => {
    const sessionId = new URL(route.request().url()).pathname.split('/')[4]!;
    return route.fulfill({ json: { sessionId, state: 'unavailable', updatedAt: null, receipt: null } });
  });
}

async function openNavigation(page: Page) {
  const opener = page.getByRole('button', { name: 'Open chat navigation' });
  const globalCreate = page.getByRole('button', { name: 'New chat', exact: true });
  await expect(opener.or(globalCreate)).toBeVisible();
  if (await opener.isVisible()) await opener.click();
  await expect(globalCreate).toBeVisible();
}

test('keeps standalone New chat global and exposes project-scoped plus controls', async ({ page }, testInfo) => {
  await mockShell(page);
  await page.goto('/');
  await openNavigation(page);
  await page.getByRole('button', { name: room.name, exact: true }).click();
  await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeEnabled();
  const projectCreate = page.getByRole('button', { name: `New chat in ${room.name}` });
  await expect(projectCreate).toBeEnabled();
  if (testInfo.project.name === 'mobile-chromium') {
    const target = await projectCreate.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByLabel('Selected session')).toHaveText(globalChat.title);

  await openNavigation(page);
  await projectCreate.click();
  await expect(page.getByLabel('Selected session')).toHaveText(projectChat.title);
  await openNavigation(page);
  await expect(page.getByRole('button', { name: room.name, exact: true })).toHaveAttribute('aria-current', 'page');
});

test('keeps navigation usable when project linking needs confirmation', async ({ page }) => {
  await mockShell(page, true);
  await page.goto('/');
  await openNavigation(page);
  await page.getByRole('button', { name: `New chat in ${room.name}` }).click();
  await expect(page.getByRole('button', { name: `Finish adding chat to ${room.name}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: other.name, exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: recent.title, exact: true })).toBeEnabled();

  await page.getByRole('button', { name: `Finish adding chat to ${room.name}` }).click();
  await expect(page.getByRole('button', { name: `Finish adding chat to ${room.name}` })).toHaveCount(0);
  await expect(page.getByLabel('Selected session')).toHaveText(projectChat.title);
});
