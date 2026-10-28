import { expect, test } from '@playwright/test';

// Configured, isolated synthetic contract proof. No production API or inference.
const timestamp = '2026-10-28T15:00:00.000Z';
const sessionId = 'jc_' + 'c'.repeat(32);
const newId = 'jc_' + 'd'.repeat(32);
const session = { id: sessionId, title: 'SYNTHETIC P2 long history', ownership: 'command', source: 'web', model: null, lastActive: timestamp, messageCount: 250, toolCallCount: 0, pinned: false };
const newSession = { ...session, id: newId, title: 'SYNTHETIC new chat', messageCount: 0 };
const markdown = '**Readable answer**\n\n| A | B |\n| - | - |\n| one | two |\n\n```text\n' + 'x'.repeat(1000) + '\n```\n\n![remote](https://example.invalid/pixel) [unsafe](javascript:alert%281%29)\n\n<script>window.p2Unsafe=true</script>';
test('draft recovery, 250 canonical IDs, narrow code/table scrolling and ten one-admission turns', async ({ page, context }) => {
  test.setTimeout(90000);
  const messages = Array.from({ length: 250 }, (_, i) => ({ id: `canonical:${i}`, sessionId, role: 'assistant', content: markdown, toolName: null, displayKind: null, timestamp }));
  const newMessages: typeof messages = [];
  const intents = new Set<string>();
  let posts = 0, creates = 0, denied = false;
  let latestInput = '';
  let latestRun = '';
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    if (path === '/api/live/sessions' && req.method() === 'POST') { creates++; return route.fulfill({ json: { session: newSession } }); }
    if (path === '/api/live/runs' && req.method() === 'POST') {
      const body = req.postDataJSON();
      expect(body.sessionId).toBe(newId);
      expect(intents.has(body.clientRequestId)).toBe(false);
      intents.add(body.clientRequestId); posts++; latestInput = body.input;
      latestRun = 'jcr_' + posts.toString(16).padStart(32, '0');
      newMessages.push({ id: `new-user:${posts}`, sessionId: newId, role: 'user', content: latestInput, toolName: null, displayKind: null, timestamp }, { id: `new-answer:${posts}`, sessionId: newId, role: 'assistant', content: 'SYNTHETIC identical answer', toolName: null, displayKind: null, timestamp });
      return route.fulfill({ json: { sessionId: newId, clientRequestId: body.clientRequestId, publicRunId: latestRun, status: 'running', replayed: false } });
    }
    if (req.method() !== 'GET') { unexpected.push(req.method() + ' ' + path); return route.abort(); }
    if (path.endsWith('/messages')) {
      const id = path.split('/')[3];
      if (denied) return route.fulfill({ status: 403, json: { error: 'denied' } });
      const all = id === sessionId ? messages : newMessages; const offset = Number(url.searchParams.get('offset'));
      const chunk = all.slice(offset, offset + 50);
      return route.fulfill({ json: { sessionId: id, messages: chunk, pagination: { offset, limit: 50, returned: chunk.length, hasMore: offset + chunk.length < all.length } } });
    }
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: `event: run.completed\ndata: ${JSON.stringify({ type: 'run.completed', publicRunId: latestRun, timestamp, output: 'SYNTHETIC identical answer', pendingSteer: null, usage: null })}\n\n` });
    if (path === '/api/live/runs/' + latestRun) return route.fulfill({ json: { publicRunId: latestRun, sessionId: newId, status: 'completed', updatedAt: timestamp, approval: null, output: 'SYNTHETIC identical answer', pendingSteer: null, error: null, usage: null } });
    if (path.endsWith('/context')) return route.fulfill({ json: { sessionId: path.split('/')[4], state: 'unavailable', receipt: null, updatedAt: null } });
    const responses: Record<string, unknown> = {
      '/api/bootstrap': { identity: { provider: 'development' }, command: { version: 'synthetic-p2', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session, ...(creates ? [newSession] : [])] },
      '/api/rooms': { version: 1, rooms: [] },
      '/api/live/model-options': { default: { provider: 'openai-codex', model: 'synthetic' }, options: [] },
      '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false },
    };
    if (!(path in responses)) { unexpected.push(path); return route.abort(); }
    return route.fulfill({ json: responses[path] });
  });
  const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
  const loadAll = async (start = 50) => { for (let count = start; count <= 250; count += 50) { await expect(page.getByRole('article', { name: 'Jarvis response', exact: true })).toHaveCount(count); if (count < 250) await page.getByRole('button', { name: 'Load more messages' }).click(); } await expect(composer).toBeEnabled(); };
  await page.goto('/');
  await page.getByRole('button', { name: session.title, exact: true }).click();
  await loadAll();
  await expect(page.getByRole('article', { name: 'Jarvis response', exact: true })).toHaveCount(250);
  await expect(page.getByRole('button', { name: 'Copy response', exact: true })).toHaveCount(250);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy response', exact: true }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(markdown);
  await composer.fill('SYNTHETIC draft\n  exact whitespace');
  await page.reload(); await loadAll();
  await expect(composer).toHaveValue('SYNTHETIC draft\n  exact whitespace');
  expect(posts).toBe(0);
  denied = true; await page.reload();
  await expect(page.getByRole('button', { name: 'Retry history' })).toBeVisible();
  await expect(composer).toHaveValue('');
  denied = false; await page.getByRole('button', { name: 'Retry history' }).click(); await loadAll();
  await expect(composer).toHaveValue('SYNTHETIC draft\n  exact whitespace');
  // Existing copy node and focus survive loading a later history page.
  await page.reload();
  const firstCopy = page.getByRole('button', { name: 'Copy response', exact: true }).first();
  await expect(firstCopy).toBeVisible(); await firstCopy.focus();
  const timeline = page.getByRole('region', { name: 'Conversation', exact: true });
  await timeline.evaluate(el => { el.scrollTop = 500; el.dispatchEvent(new Event('scroll')); });
  const scrollBefore = await timeline.evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: 'Load more messages' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('article', { name: 'Jarvis response', exact: true })).toHaveCount(100);
  await expect(firstCopy).toBeFocused();
  expect(await timeline.evaluate(el => el.scrollTop)).toBe(scrollBefore);
  await loadAll(100);
  for (const width of [1280, 320, 360, 390, 430]) {
    for (const height of [width === 1280 ? 720 : 740, 360]) {
      await page.setViewportSize({ width, height });
      await composer.focus(); await expect(composer).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const code = page.getByLabel('Code block').first();
      await code.scrollIntoViewIfNeeded(); await code.focus();
      expect(await code.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      await code.press('End');
      if ((width === 1280 && height === 720) || (width === 320 && height === 740)) await page.screenshot({ path: `test-results/turn-recovery/p2-${width}.png` });
      await expect(page.getByRole('table').first()).toContainText('one');
      const nav = page.getByRole('button', { name: 'Open chat navigation' });
      if (await nav.isVisible()) {
        await nav.click();
        await expect(page.getByRole('button', { name: 'Close chat navigation' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(nav).toBeFocused();
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByLabel('Selected session')).toHaveText(newSession.title);
  for (let i = 0; i < 10; i++) {
    await expect(composer).toBeEnabled();
    await composer.fill(i < 5 ? `SYNTHETIC distinct ${i}` : 'SYNTHETIC repeated');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator(`[data-message-id="new-answer:${i + 1}"]`)).toBeVisible();
  }
  await page.reload(); await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
  await expect(page.getByRole('article', { name: 'Jarvis response', exact: true })).toHaveCount(10);
  expect(await page.evaluate(() => 'p2Unsafe' in window)).toBe(false);
  expect(posts).toBe(10); expect(creates).toBe(1); expect(unexpected).toEqual([]);
});
