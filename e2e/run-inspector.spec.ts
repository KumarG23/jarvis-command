import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('inspects and copies a synthetic run receipt at this viewport', async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  const timestamp = '2026-09-21T13:00:00.000Z';
  const sessionId = 'jc_' + 'a'.repeat(32);
  const publicRunId = 'jcr_' + 'b'.repeat(32);
  const session = { id: sessionId, title: 'Run inspector fixture', ownership: 'command', source: 'web', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
  const usage = {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    apiCalls: 1,
    context: { usedTokens: 9000, limitTokens: 100000, source: 'hermes_effective' },
    execution: {
      requested: { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      executed: { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high', reasoningEffortSource: 'wire' },
      routeSource: 'request_override',
      exact: true,
      fallbackUsed: false,
    },
  };

  await page.route('**/api/bootstrap', route => route.fulfill({ json: {
    identity: { provider: 'development' },
    command: { version: 'fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } },
    hermes: { state: 'online', version: null, model: 'gpt-5.6-sol', provider: 'openai-codex', gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} },
    sessions: [session],
  } }));
  await page.route('**/api/rooms', route => route.fulfill({ json: { version: 1, rooms: [] } }));
  await page.route('**/api/live/model-options', route => route.fulfill({ json: {
    default: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
    options: [{ provider: 'openai-codex', model: 'gpt-5.6-sol', label: 'Sol', reasoningEfforts: ['high'] }],
  } }));
  await page.route(`**/api/live/sessions/${sessionId}/context`, route => route.fulfill({ json: { sessionId, state: 'unavailable', updatedAt: null, receipt: null } }));
  await page.route('**/api/live/session-controls', route => route.fulfill({ json: { sessionForkPreservesSource: true, sessionCompactionRuns: true } }));
  await page.route('**/api/sessions/*/messages?*', route => route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
  await page.route('**/api/live/runs', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { sessionId, publicRunId, clientRequestId: body.clientRequestId, status: 'running', replayed: false } });
  });
  await page.route(`**/api/live/runs/${publicRunId}/events`, route => route.fulfill({ contentType: 'text/event-stream', body: [
    { type: 'message.delta', delta: 'Inspector ready.' },
    { type: 'tool.started', tool: 'synthetic', preview: 'Check fixture state' },
    { type: 'tool.completed', tool: 'synthetic', durationSeconds: 0.2, error: false },
    { type: 'run.completed', output: 'Inspector ready.', pendingSteer: null, usage },
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, publicRunId, timestamp })}\n\n`).join('') }));
  await page.route(`**/api/live/runs/${publicRunId}`, route => route.fulfill({ json: { publicRunId, sessionId, status: 'completed', updatedAt: timestamp, approval: null, output: 'Inspector ready.', error: null, pendingSteer: null, usage } }));

  await page.goto('/');
  if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Open chat navigation' }).click();
  await page.getByRole('button', { name: session.title, exact: true }).click();
  await expect(page.getByLabel('Selected session')).toHaveText(session.title);
  await page.getByRole('textbox', { name: 'Message Jarvis' }).fill('Inspect this run');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Run completed', { exact: true })).toBeVisible();
  await page.getByText('Run details', { exact: true }).click();

  const inspector = page.getByRole('region', { name: 'Run inspector' });
  await expect(inspector).toContainText('Admission attempts');
  await expect(inspector).toContainText('Exact route · request_override');
  await expect(inspector.getByRole('list', { name: 'Run activity' })).toContainText('Tool completed: synthetic');

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await inspector.getByRole('button', { name: 'Copy receipt' }).click();
  await expect(inspector.getByText('Run receipt copied')).toBeVisible();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied).toMatchObject({ version: 1, run: { publicRunId, sessionId }, recovery: { admissionAttempts: 1 }, route: { exact: true } });
  expect(copied.run).not.toHaveProperty('input');
  expect(copied).not.toHaveProperty('output');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('run-inspector.png'), fullPage: true });
});
