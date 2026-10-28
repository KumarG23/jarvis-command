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
  await page.getByText('Activity / Usage', { exact: true }).click();
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

// P4 Save reload proof: entirely local, visibly synthetic, no run admissions.
test('SYNTHETIC uncertain artifact save survives reload with one exact artifact', async ({ page }) => {
  const timestamp = '2026-10-28T16:00:00.000Z';
  const original = { ...session, title: 'SYNTHETIC P4 save recovery', messageCount: 1 };
  const content = 'SYNTHETIC exact λ artifact\n\nlast line';
  const artifacts = new Map<string, Record<string, unknown>>();
  const bodies: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path === '/api/artifacts/text' && req.method() === 'POST') {
      const body = req.postDataJSON(); bodies.push(body);
      if (!artifacts.has(body.sourceRequestId)) {
        const version = { version: 1, parentVersion: null, baseVersion: null, createdAt: timestamp, creator: { subject: 'synthetic', source: 'assistant-response' }, mime: 'text/markdown', size: Buffer.byteLength(body.content), sha256: 'c'.repeat(64), revisionNote: null, feedback: null, originalFilename: null };
        artifacts.set(body.sourceRequestId, { id: 'art_' + '8'.repeat(32), title: body.title, type: body.type, mime: 'text/markdown', createdAt: timestamp, updatedAt: timestamp, creator: version.creator, sessionId: body.sessionId, projectId: body.projectId, runId: body.runId, sourceRequestId: body.sourceRequestId, size: version.size, sha256: version.sha256, currentVersion: 1, canonical: false, privateMode: 'private', originalFilename: null, versions: [version], comments: [] });
      }
      // Simulate a committed write whose ACK never reaches the browser.
      if (bodies.length === 1) return route.abort('failed');
      return route.fulfill({ json: { artifact: artifacts.get(body.sourceRequestId) } });
    }
    if (req.method() !== 'GET') { unexpected.push(req.method() + ' ' + path); return route.abort(); }
    if (path.endsWith('/messages')) return route.fulfill({ json: { sessionId, messages: [{ id: 'synthetic-answer', sessionId, role: 'assistant', content, timestamp, toolName: null, displayKind: null }], pagination: { offset: 0, limit: 50, returned: 1, hasMore: false } } });
    if (path === '/api/artifacts') return route.fulfill({ json: { artifacts: [] } });
    const artifact = [...artifacts.values()][0];
    if (artifact && path === `/api/artifacts/${artifact.id}`) return route.fulfill({ json: artifact });
    if (artifact && path.endsWith('/versions/1/source')) return route.fulfill({ json: { artifactId: artifact.id, version: 1, type: artifact.type, mime: artifact.mime, size: artifact.size, sha256: artifact.sha256, content } });
    if (path.endsWith('/context')) return route.fulfill({ json: { sessionId, state: 'unavailable', receipt: null, updatedAt: null } });
    const responses: Record<string, unknown> = {
      '/api/bootstrap': { ...bootstrap, command: { ...bootstrap.command, version: 'SYNTHETIC P4 recovery' }, hermes: { ...bootstrap.hermes, capabilities: ['run_events_sse', 'artifact_studio'] }, sessions: [original] },
      '/api/rooms': { version: 1, rooms: [] },
      '/api/live/model-options': { default: { provider: 'openai-codex', model: 'synthetic' }, options: [] },
      '/api/live/session-controls': { sessionForkPreservesSource: false, sessionCompactionRuns: false },
    };
    if (!(path in responses)) { unexpected.push(path); return route.abort(); }
    return route.fulfill({ json: responses[path] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: original.title, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save response as artifact', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save response as artifact', exact: true }).click();
  await expect(page.getByText(/Artifact operation could not be confirmed/)).toBeVisible();
  expect(bodies).toHaveLength(1);
  const stored = await page.evaluate(() => sessionStorage.getItem('jarvis-command:artifact-save:v1'));
  expect(JSON.parse(stored!).pending.content).toBe(content);
  await page.getByRole('button', { name: 'Close artifacts', exact: true }).click();
  await page.getByRole('button', { name: 'Save response as artifact', exact: true }).click();
  expect(bodies).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save response as artifact', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Artifact Studio', exact: true }).click();
  const recover = page.getByRole('button', { name: 'Recover response save', exact: true });
  await expect(recover).toBeEnabled();
  expect(bodies).toHaveLength(1);
  for (const width of [1280, 320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 740 });
    await expect(recover).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Close artifacts', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1280 || width === 390) await page.screenshot({ path: `test-results/turn-recovery/synthetic-artifact-recovery-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 740 });
  await recover.click();
  await expect(page.getByText('Response saved as artifact.', { exact: true })).toBeVisible();
  expect(bodies).toEqual([bodies[0], bodies[0]]);
  expect(bodies[1]).toMatchObject({ content, sessionId, projectId: null, runId: null });
  expect(artifacts.size).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('jarvis-command:artifact-save:v1'))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(unexpected).toEqual([]);
});
