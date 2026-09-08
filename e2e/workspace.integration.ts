import { expect, test } from '@playwright/test';
import { startRealChain } from './real-chain.fixture';

test('edits, filters and resumes rooms with readable non-overlapping navigation', async ({ browser }, info) => {
  const chain = await startRealChain();
  const context = await browser.newContext({ ...info.project.use, serviceWorkers: 'block', extraHTTPHeaders: { 'cf-access-jwt-assertion': chain.assertion } });
  const page = await context.newPage();
  const errors: string[] = [], failedRequests: string[] = [], httpErrors: string[] = [];
  const responses: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
  page.on('response', response => { responses.push(`${response.status()} ${new URL(response.url()).pathname}`); if (response.status() >= 400) httpErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const headers = { origin: chain.origin, 'x-jarvis-command': '1' };
  const name = 'SYNTHETIC project with a deliberately long label for narrow workspace navigation';
  const title = 'Synthetic conversation with a long readable title — exact selection remains intact while editing room metadata';
  const metadata = { name, goal: 'Synthetic metadata only', repository: '/never-read/repo', notes: ['vault/Never fetched.md'] };
  try {
    const created = await context.request.post(chain.origin + '/api/rooms', { headers, data: metadata }); expect(created.status()).toBe(200);
    const room = (await created.json()).room;
    const other = await context.request.post(chain.origin + '/api/rooms', { headers, data: { ...metadata, name: 'Synthetic Garden', goal: 'Worm care' } }); expect(other.status()).toBe(200);
    const conversation = await context.request.post(chain.origin + '/api/live/sessions', { headers, data: { title } }); expect(conversation.status()).toBe(200);
    const session = (await conversation.json()).session;
    const attached = await context.request.post(`${chain.origin}/api/rooms/${room.id}/sessions`, { headers, data: { sessionId: session.id } }); expect(attached.status()).toBe(200);
    await page.goto(chain.origin);
    await page.getByRole('button', { name: 'Project rooms', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Close project rooms' }).click();
    await expect(page.getByLabel('Selected session', { exact: true })).toHaveText(title);
    await expect(page.getByText('No saved messages in session history yet.', { exact: true })).toBeVisible();
    const label = page.getByLabel('Selected project room', { exact: true });
    await expect(label).toHaveText(name);
    expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Project details' }).click();
    if (info.project.name.startsWith('phone')) {
      const drawer = await page.locator('.project-room-drawer').boundingBox();
      const history = await page.locator('.timeline').boundingBox();
      expect(drawer!.y + drawer!.height).toBeLessThanOrEqual(history!.y);
    }
    const search = page.getByRole('searchbox', { name: 'Filter project rooms' });
    await search.fill('WORM'); await expect(page.getByRole('button', { name: 'Synthetic Garden', exact: true })).toBeVisible();
    await search.fill('missing'); await expect(page.getByText('No matching project rooms.')).toBeVisible();
    await expect(label).toHaveText(name);
    await page.screenshot({ path: info.outputPath('filter-no-match.png') });
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await page.getByRole('button', { name: 'Edit project room', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Edit project room' });
    await editor.getByLabel('Room name', { exact: true }).fill('Discard this draft');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(label).toHaveText(name);
    await page.getByRole('button', { name: 'Edit project room', exact: true }).click();
    const updated = { name: 'SYNTHETIC renamed workspace', goal: 'Updated goal — metadata, not execution', repository: '/still-not-read', notes: ['vault/Changed.md', 'https://example.invalid/not-fetched'] };
    await editor.getByLabel('Room name', { exact: true }).fill(updated.name);
    await editor.getByLabel('Room goal').fill(updated.goal);
    await editor.getByLabel('Repository / workdir reference').fill(updated.repository);
    await editor.getByLabel('Pinned note references (one per line)').fill(updated.notes.join('\n'));
    // Exercise the actual route's denied write in the real browser, not fake success.
    await context.setExtraHTTPHeaders({ 'cf-access-jwt-assertion': chain.unapprovedAssertion });
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(editor.getByLabel('Room name', { exact: true })).toHaveValue(updated.name);
    await page.screenshot({ path: info.outputPath('edit-denied-draft.png') });
    await context.setExtraHTTPHeaders({ 'cf-access-jwt-assertion': chain.assertion });
    const before = await context.request.get(chain.origin + '/api/rooms');
    expect((await before.json()).rooms.find((value: { id: string }) => value.id === room.id)).toEqual({ ...room, sessionIds: [session.id], lastSessionId: session.id });
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(editor).toHaveCount(0); await expect(label).toHaveText(updated.name);
    await page.getByRole('button', { name: 'Close project rooms' }).click();
    await expect(page.getByRole('button', { name: 'Project details' })).toBeFocused();
    await expect(page.getByLabel('Selected session', { exact: true })).toHaveText(title);
    const readback = await context.request.get(chain.origin + '/api/rooms');
    expect((await readback.json()).rooms.find((value: { id: string }) => value.id === room.id)).toEqual({ ...room, ...updated, sessionIds: [session.id], lastSessionId: session.id });
    await expect(page.getByText('No saved messages in session history yet.', { exact: true })).toBeVisible();
    expect((await chain.restart()).previousStopped).toBe(true);
    await page.reload();
    await expect(label).toHaveText(updated.name); await expect(page.getByLabel('Selected session', { exact: true })).toHaveText(title);
    await expect(page.getByText('No saved messages in session history yet.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Project details' }).click();
    await page.getByRole('button', { name: 'Synthetic Garden', exact: true }).click();
    await page.getByRole('button', { name: updated.name, exact: true }).click();
    await page.getByRole('button', { name: 'Close project rooms' }).press('Escape');
    await expect(page.getByLabel('Selected session', { exact: true })).toHaveText(title);
    await expect(page.getByText('No saved messages in session history yet.', { exact: true })).toBeVisible();
    const timeline = await page.locator('.timeline').boundingBox(), composer = await page.locator('.composer-wrap').boundingBox();
    expect(timeline!.height).toBeGreaterThan(100); expect(timeline!.y + timeline!.height).toBeLessThanOrEqual(composer!.y + 1);
    await page.locator('.composer-wrap').scrollIntoViewIfNeeded();
    if (info.project.name.startsWith('phone')) {
      const nav = await page.locator('.mobile-navigation').boundingBox();
      const visibleComposer = await page.locator('.composer-wrap').boundingBox();
      expect(visibleComposer!.y + visibleComposer!.height).toBeLessThanOrEqual(nav!.y + 1);
    } else { await expect(page.getByRole('complementary', { name: 'Operations deck' })).toBeVisible(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('workspace-reloaded.png') });
    expect(chain.count('POST', '/v1/runs')).toBe(0); expect(chain.upstreamViolations).toEqual([]);
    expect(httpErrors).toEqual([`401 /api/rooms/${room.id}`]);
    // Chromium may report bounded JSON-reader disposal as aborted even after a
    // successful render. Accept only this exact history read, with HTTP 200,
    // actual BFF serialized payload and the loaded-empty-history UI above.
    const historyPath = `/api/sessions/${session.id}/messages`;
    for (const failure of failedRequests) {
      expect(failure).toBe(`GET ${historyPath} net::ERR_ABORTED`);
      expect(responses).toContain(`200 ${historyPath}`);
      expect(chain.payloads.some(payload => payload.path.startsWith(historyPath + '?') && JSON.parse(payload.text).sessionId === session.id && JSON.parse(payload.text).pagination.returned === 0)).toBe(true);
    }
    expect(failedRequests.length).toBeLessThanOrEqual(1);
    expect(errors).toHaveLength(1); expect(errors[0]).toContain('401');
  } finally {
    await info.attach('browser-diagnostics', { body: JSON.stringify({ errors, failedRequests, httpErrors, responses, historyPayloads: chain.payloads.filter(payload => payload.path.includes('/messages?')), modelAdmissions: chain.count('POST', '/v1/runs') }), contentType: 'application/json' });
    await context.close(); await chain.close();
  }
});
