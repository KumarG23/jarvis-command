import { expect, test } from '@playwright/test';
import { CommandBootstrapSchema } from '@jarvis-command/contracts';

// Synthetic local fixture only: never reaches Hermes or production.
const first = 'jc_issue22_one', second = 'jc_issue22_two';
const timestamp = '2026-10-28T14:00:00.000Z';
const runId = 'jcr_' + '2'.repeat(32);
const sessions = [first, second].map((id, index) => ({ id, title: `SYNTHETIC issue 22 chat ${index + 1}`, ownership: 'command', source: 'web', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }));
const bootstrap = CommandBootstrapSchema.parse({
  identity: { provider: 'development' }, command: { version: 'synthetic-issue22', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 1000, maxSteerCharacters: 100 } },
  hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions,
});
const sol = { provider: 'openai-codex', model: 'gpt-6-sol', label: 'Synthetic Sol', reasoningEfforts: ['medium', 'xhigh'] };
const luna = { provider: 'openai-codex', model: 'gpt-6-luna', label: 'Synthetic Luna', reasoningEfforts: ['minimal', 'low', 'medium'] };

test('requested choices survive two chats and reload; stale inventory preserves draft; one explicit send shows usage without route metadata', async ({ page }, info) => {
  let options = [sol, luna], posts = 0, inventories = 0;
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === '/api/live/runs' && req.method() === 'POST') {
      posts++;
      expect(req.postDataJSON()).toMatchObject({ sessionId: first, input: 'SYNTHETIC draft retained', inference: { provider: luna.provider, model: luna.model, reasoningEffort: 'medium' } });
      return route.fulfill({ json: { publicRunId: runId, sessionId: first, clientRequestId: req.postDataJSON().clientRequestId, status: 'completed', replayed: false } });
    }
    if (req.method() !== 'GET') { unexpected.push(req.method() + ' ' + path); return route.abort(); }
    if (path === `/api/live/runs/${runId}`) return route.fulfill({ json: { publicRunId: runId, sessionId: first, status: 'completed', updatedAt: timestamp, approval: null, output: 'SYNTHETIC done', error: null, pendingSteer: null, usage: { inputTokens: 0, outputTokens: 2, totalTokens: 2, apiCalls: 0 } } });
    if (path.endsWith('/messages')) {
      const sessionId = path.includes(first) ? first : second;
      return route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } });
    }
    if (path.endsWith('/context')) return route.fulfill({ json: { sessionId: path.includes(first) ? first : second, state: 'unavailable', receipt: null, updatedAt: null } });
    if (path === '/api/live/model-options') { inventories++; return route.fulfill({ json: { default: { provider: sol.provider, model: sol.model }, options } }); }
    const responses: Record<string, unknown> = { '/api/bootstrap': bootstrap, '/api/rooms': { version: 1, rooms: [] }, '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false } };
    if (!(path in responses)) { unexpected.push(path); return route.abort(); }
    return route.fulfill({ json: responses[path] });
  });
  const model = page.getByRole('combobox', { name: 'Model for this prompt' });
  const effort = page.getByRole('combobox', { name: 'Reasoning for this prompt' });
  const draft = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
  const expand = async () => { await page.locator('.inference-control').evaluate(el => { (el as HTMLDetailsElement).open = true; }); };
  await page.goto('/'); await page.getByRole('button', { name: sessions[0]!.title, exact: true }).click(); await expand();
  await model.selectOption(`${sol.provider}:${sol.model}`); await effort.selectOption('xhigh');
  await page.getByRole('button', { name: sessions[1]!.title, exact: true }).click(); await expect(model).toHaveValue('inherit');
  await model.selectOption(`${luna.provider}:${luna.model}`); await effort.selectOption('low');
  await page.getByRole('button', { name: sessions[0]!.title, exact: true }).click(); await expect(effort).toHaveValue('xhigh');
  await page.reload(); await expand(); await expect(effort).toHaveValue('xhigh');
  await page.getByRole('button', { name: sessions[1]!.title, exact: true }).click(); await expect(effort).toHaveValue('low');
  await page.reload(); await expand(); await expect(model).toHaveValue(`${luna.provider}:${luna.model}`); await expect(effort).toHaveValue('low');
  await page.getByRole('button', { name: sessions[0]!.title, exact: true }).click();
  await model.selectOption(`${luna.provider}:${luna.model}`); await expect(effort).toHaveValue('medium');
  options = [sol]; await draft.fill('SYNTHETIC draft retained'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Requested model unavailable. Choose another model or explicitly choose Inherit.', { exact: true })).toBeVisible();
  expect(posts).toBe(0); await expect(draft).toHaveValue('SYNTHETIC draft retained');
  options = [sol, luna]; await page.getByRole('button', { name: 'Retry model choices' }).click();
  await expect(model.locator('option')).toHaveCount(3);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    await expect(model).toBeInViewport(); await expect(effort).toBeInViewport(); await expect(draft).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`synthetic-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const receipt = page.getByRole('region', { name: 'Execution receipt' });
  await expect(receipt).toContainText('Executed route unavailable'); await expect(receipt).toContainText('2 tokens · 0 in / 2 out');
  expect(posts).toBe(1); expect(inventories).toBeGreaterThanOrEqual(5); expect(unexpected).toEqual([]);
});
