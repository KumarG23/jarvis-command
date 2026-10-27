import { expect, test } from '@playwright/test';
import { CommandBootstrapSchema, SessionMessagesPageSchema } from '@jarvis-command/contracts';

// Clearly labeled synthetic data. Real owned browser/backend evidence is recorded separately.
const sessionId = 'jc_issue14_synthetic';
const publicRunId = 'jcr_' + 'a'.repeat(32);
const session = { id: sessionId, title: 'SYNTHETIC issue 14 recovery test', ownership: 'command', source: 'web', model: null, lastActive: '2026-10-27T13:00:00.000Z', messageCount: 0, toolCallCount: 0, pinned: false };
const bootstrap = CommandBootstrapSchema.parse({
  identity: { provider: 'development' },
  command: { version: 'synthetic-issue14', environment: 'test', generatedAt: '2026-10-27T13:00:00.000Z', liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 1000, maxSteerCharacters: 100 } },
  hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions: [session],
});

test('lost ACK and mid-run reload recover by GET, with one canonical answer and truthful missing activity', async ({ page }) => {
  let posts = 0;
  let lookups = 0;
  let statusChecks = 0;
  let clientRequestId = '';
  let completed = false;
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/live/runs' && request.method() === 'POST') {
      posts++;
      const intent = request.postDataJSON();
      expect(intent.sessionId).toBe(sessionId);
      clientRequestId = intent.clientRequestId;
      // The synthetic backend admitted it; only the acknowledgment is lost.
      return route.abort('connectionfailed');
    }
    if (request.method() !== 'GET') { unexpected.push(request.method() + ' ' + path); return route.abort(); }
    if (path.endsWith('/run-requests/' + clientRequestId) && clientRequestId) {
      lookups++;
      return route.fulfill({ json: { sessionId, clientRequestId, publicRunId } });
    }
    if (path === `/api/live/runs/${publicRunId}`) {
      statusChecks++;
      return route.fulfill({ json: { publicRunId, sessionId, status: completed ? 'completed' : 'running', updatedAt: '2026-10-27T13:00:01.000Z', approval: null, output: completed ? 'SYNTHETIC answer 391' : null, error: null, pendingSteer: null, usage: null } });
    }
    if (path === `/api/sessions/${sessionId}/messages`) {
      const message = (id: string, role: string, content: string, toolName: string | null = null) => ({ id, sessionId, role, content, toolName, timestamp: null, displayKind: null });
      const messages = !posts ? [] : [message('user-1', 'user', 'SYNTHETIC calculate 17 * 23'), ...(completed ? [message('tool-1', 'tool', '391', 'synthetic_calculator'), message('answer-1', 'assistant', 'SYNTHETIC answer 391')] : [])];
      return route.fulfill({ json: SessionMessagesPageSchema.parse({ sessionId, messages, pagination: { offset: 0, limit: 50, returned: messages.length, hasMore: false } }) });
    }
    const responses: Record<string, unknown> = {
      '/api/bootstrap': bootstrap, '/api/rooms': { version: 1, rooms: [] },
      '/api/live/model-options': { default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'Synthetic Sol', reasoningEfforts: ['medium'] }] },
      '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false },
      [`/api/live/sessions/${sessionId}/context`]: { sessionId, state: 'unavailable', receipt: null, updatedAt: null },
    };
    if (!(path in responses)) { unexpected.push('GET ' + path); return route.abort(); }
    return route.fulfill({ json: responses[path] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: session.title, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Jarvis', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Message Jarvis', exact: true }).fill('SYNTHETIC calculate 17 * 23');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry same intent', exact: true })).toBeVisible();
  expect(posts).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
  expect(lookups).toBe(1);
  await expect.poll(() => statusChecks).toBeGreaterThan(0);
  await expect(page.getByRole('textbox', { name: 'Message Jarvis', exact: true })).toBeDisabled();
  // Reload again while the same synthetic run remains active; never re-admit.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
  completed = true;
  await expect(page.locator('[data-message-id="answer-1"]')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Jarvis response', exact: true })).toHaveCount(1);
  await expect(page.locator('[data-message-id="tool-1"]')).toContainText('synthetic_calculator');
  await expect(page.getByText('Recovered run output — canonical message link unavailable', { exact: true })).toBeVisible();
  await page.getByText('Run details', { exact: true }).click();
  await expect(page.getByText(/Some live activity was unavailable/)).toBeVisible();
  expect(posts).toBe(1);
  expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('jarvis-command:live-turn'))).toBeNull();
  await expect(page.getByRole('textbox', { name: 'Message Jarvis', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/turn-recovery/desktop-synthetic.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Message Jarvis', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/turn-recovery/narrow-synthetic.png' });
});
