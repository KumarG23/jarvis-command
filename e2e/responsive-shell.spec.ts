import { expect, test } from '@playwright/test';

// Owned local fixtures only. Every API is intercepted; no Hermes or inference.
const sessionId = 'jc_' + 'e'.repeat(32);
const timestamp = '2026-10-28T16:00:00.000Z';
const session = { id: sessionId, title: 'SYNTHETIC · responsive shell', source: 'web', ownership: 'command', model: null, lastActive: timestamp, messageCount: 250, toolCallCount: 0, pinned: false };
const markdown = '**SYNTHETIC shell proof**\n\nA calm workspace keeps the conversation readable. These messages are local fixtures, not a live Hermes response.\n\n```text\n' + 'long_code_'.repeat(120) + '\n```\n\n| ' + Array.from({ length: 30 }, (_, i) => `Column ${i}`).join(' | ') + ' |\n| ' + Array(30).fill('---').join(' | ') + ' |\n| ' + Array(30).fill('Synthetic').join(' | ') + ' |';

test('requested picker, unavailable panels, drawer Back and readable responsive history', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const unexpected: string[] = [];
  await page.route('**/api/**', route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (req.method() !== 'GET') { unexpected.push(req.method() + ' ' + path); return route.abort(); }
    if (path.endsWith('/messages')) {
      const offset = Number(url.searchParams.get('offset'));
      const messages = Array.from({ length: Math.min(50, 250 - offset) }, (_, i) => ({ id: `shell:${offset + i}`, sessionId, role: 'assistant', content: offset + i === 249 ? markdown : `SYNTHETIC saved message ${offset + i + 1}`, timestamp, toolName: null, displayKind: null }));
      return route.fulfill({ json: { sessionId, messages, pagination: { limit: 50, offset, returned: messages.length, hasMore: offset + messages.length < 250 } } });
    }
    if (path.endsWith('/context')) return route.fulfill({ json: { sessionId, state: 'unavailable', receipt: null, updatedAt: null } });
    const responses: Record<string, unknown> = {
      '/api/bootstrap': { identity: { provider: 'development' }, command: { version: 'SYNTHETIC P3', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio'], readinessChecks: {} }, sessions: [session] },
      '/api/rooms': { version: 1, rooms: [] },
      '/api/live/model-options': { default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'Synthetic Sol', reasoningEfforts: ['medium', 'high'] }] },
      '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false },
      '/api/artifacts': { artifacts: [] },
    };
    if (!(path in responses)) { unexpected.push(path); return route.abort(); }
    return route.fulfill({ json: responses[path] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: session.title, exact: true }).click();
  for (let count = 50; count < 250; count += 50) {
    await expect(page.locator('[data-message-id]')).toHaveCount(count);
    await page.getByRole('button', { name: 'Load more messages' }).click();
  }
  await expect(page.locator('[data-message-id]')).toHaveCount(250);
  const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
  await expect(composer).toBeEnabled(); await composer.fill('SYNTHETIC unsent draft');
  await expect(page.getByRole('complementary', { name: 'Context workspace' })).toBeHidden();
  const chip = page.locator('.header-inference > summary');
  await chip.focus(); await page.keyboard.press('Enter');
  const model = page.getByRole('combobox', { name: 'Model for this prompt' });
  await expect(model).toBeVisible();
  await model.selectOption('openai-codex:gpt-6-sol');
  await page.getByRole('combobox', { name: 'Reasoning for this prompt' }).selectOption('high');
  await expect(chip).toHaveText('Requested · Synthetic Sol · high');
  await expect(page.getByText(/Executed route is reported only/)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(model).toBeHidden(); await expect(chip).toBeFocused();
  await chip.click(); await composer.click(); await expect(model).toBeHidden();
  for (const [name, reason] of [['Agents', /Agent profiles and direct delegation/], ['Collaboration rooms', /A native writable room driver has not been proven/], ['Notifications', /unavailable until the notifications milestone/]] as const) {
    const entry = page.getByRole('button', { name: `${name} Unavailable`, exact: true });
    await entry.click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close context' })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(entry).toBeFocused();
  }
  for (const width of [1280, 320, 360, 390, 430]) {
    for (const height of [width === 1280 ? 720 : 740, 360]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await composer.focus(); await expect(composer).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const selector of ['.menu-button', '.header-inference > summary', '.health-button', '.attach-image', '.turn-composer .primary-button']) {
        const control = page.locator(selector);
        if (await control.isVisible()) { const box = await control.boundingBox(); expect(box!.height, selector).toBeGreaterThanOrEqual(44); expect(box!.width, selector).toBeGreaterThanOrEqual(44); }
      }
      const headerControls = await page.locator('.command-header button, .header-inference > summary').all();
      const boxes = [];
      for (const control of headerControls) if (await control.isVisible()) boxes.push((await control.boundingBox())!);
      for (let i = 0; i < boxes.length; i++) for (const other of boxes.slice(i + 1)) {
        const box = boxes[i]!;
        expect(box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y, 'Header controls must not overlap').toBe(false);
      }
      await chip.click(); await expect(model).toBeVisible();
      const box = await model.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await model.focus(); await page.keyboard.press('Escape'); await expect(chip).toBeFocused();
      const nav = page.getByRole('button', { name: 'Open chat navigation' });
      if (width < 760) {
        await nav.click();
        const close = page.getByRole('button', { name: 'Close chat navigation' });
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
        await page.keyboard.press('Tab'); await expect(close).toBeFocused();
        await page.goBack(); await expect(nav).toHaveAttribute('aria-expanded', 'false'); await expect(nav).toBeFocused();
        await nav.click(); await page.keyboard.press('Escape'); await expect(nav).toBeFocused();
        // Wait for the asynchronous history pop before opening a new overlay.
        await expect.poll(() => page.evaluate(() => !!history.state?.commandNavigation)).toBe(false);
      }
      if (width === 390 && height === 740) {
        await nav.click();
        await page.getByRole('button', { name: 'Collaboration rooms Unavailable', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Collaboration rooms', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Close context' })).toBeFocused();
        await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Close context' })).toBeFocused();
        await page.keyboard.press('Escape'); await expect(nav).toBeFocused();
      }
      const code = page.getByLabel('Code block').last(); await code.scrollIntoViewIfNeeded(); await code.focus();
      expect(await code.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      const table = page.getByLabel('Message table').last();
      await expect(table).toBeVisible(); expect(await table.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      if ((height === 740 && width === 390) || (height === 720 && width === 1280)) {
        const path = testInfo.outputPath(`p3-${width}.png`); await page.screenshot({ path }); await testInfo.attach(`SYNTHETIC P3 ${width}`, { path, contentType: 'image/png' });
      }
    }
  }
  // Simulate enlarged browser text without changing viewport or hiding overflow.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addStyleTag({ content: '.event-body .message-content p { font-size: 24px !important; } .header-inference .requested-choice { font-size: 20px !important; } .header-inference .requested-label { font-size: 18px !important; } .inference-fields select { font-size: 24px !important; }' });
  await composer.focus(); await expect(composer).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await chip.click(); await expect(model).toBeVisible();
  const largePicker = await model.boundingBox(); expect(largePicker!.x).toBeGreaterThanOrEqual(0); expect(largePicker!.x + largePicker!.width).toBeLessThanOrEqual(320);
  await model.press('Escape'); await expect(chip).toBeFocused();
  await expect(composer).toHaveValue('SYNTHETIC unsent draft');
  expect(unexpected).toEqual([]);
});
