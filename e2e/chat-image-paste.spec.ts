import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('pastes an image into chat and submits the persisted artifact version', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  const timestamp = '2026-09-22T18:00:00.000Z';
  const sessionId = `jc_${'a'.repeat(32)}`;
  const artifactId = `art_${'b'.repeat(32)}`;
  const publicRunId = `jcr_${'c'.repeat(32)}`;
  const session = { id: sessionId, title: 'Image paste fixture', ownership: 'command', source: 'web', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };
  const artifact = {
    id: artifactId, title: 'clipboard.png', type: 'image', mime: 'image/png', createdAt: timestamp, updatedAt: timestamp,
    creator: { subject: 'operator', source: 'upload' }, sessionId, projectId: null, runId: null, sourceRequestId: null,
    size: 12, sha256: 'd'.repeat(64), currentVersion: 1, canonical: false, privateMode: 'private', originalFilename: 'clipboard.png',
    versions: [{ version: 1, parentVersion: null, baseVersion: null, createdAt: timestamp, creator: { subject: 'operator', source: 'upload' }, type: 'image', mime: 'image/png', size: 12, sha256: 'd'.repeat(64), revisionNote: null, feedback: null, originalFilename: 'clipboard.png' }], comments: [],
  };

  await page.route('**/api/bootstrap', route => route.fulfill({ json: {
    identity: { provider: 'development' },
    command: { version: 'fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } },
    hermes: { state: 'online', version: null, model: 'gpt-5.6-sol', provider: 'openai-codex', gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio'], readinessChecks: {} },
    sessions: [session],
  } }));
  await page.route('**/api/rooms', route => route.fulfill({ json: { version: 1, rooms: [] } }));
  await page.route('**/api/live/model-options', route => route.fulfill({ json: { default: { provider: 'openai-codex', model: 'gpt-5.6-sol' }, options: [] } }));
  await page.route(`**/api/live/sessions/${sessionId}/context`, route => route.fulfill({ json: { sessionId, state: 'unavailable', updatedAt: null, receipt: null } }));
  await page.route('**/api/live/session-controls', route => route.fulfill({ json: { sessionForkPreservesSource: true, sessionCompactionRuns: true } }));
  await page.route('**/api/sessions/*/messages?*', route => route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
  let uploaded = false;
  await page.route('**/api/artifacts/upload', route => {
    uploaded = true;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-jarvis-command']).toBe('1');
    return route.fulfill({ json: { artifact } });
  });
  await page.route('**/api/live/runs', route => {
    const body = route.request().postDataJSON();
    expect(body.input).toBe('Make a brighter variation.');
    expect(body.images).toEqual([{ artifactId, version: 1 }]);
    return route.fulfill({ json: { sessionId, publicRunId, clientRequestId: body.clientRequestId, status: 'running', replayed: false } });
  });
  await page.route(`**/api/live/runs/${publicRunId}/events`, route => route.fulfill({ contentType: 'text/event-stream', body: `event: run.completed\ndata: ${JSON.stringify({ type: 'run.completed', publicRunId, timestamp, output: 'Image received.', pendingSteer: null, usage: null })}\n\n` }));
  await page.route(`**/api/live/runs/${publicRunId}`, route => route.fulfill({ json: { publicRunId, sessionId, status: 'completed', updatedAt: timestamp, approval: null, output: 'Image received.', error: null, pendingSteer: null, usage: null } }));

  await page.goto('/');
  if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Open chat navigation' }).click();
  await page.getByRole('button', { name: session.title, exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message Jarvis' });
  await composer.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'clipboard.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText('clipboard.png')).toBeVisible();
  expect(uploaded).toBe(true);
  await composer.fill('Make a brighter variation.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Run completed', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
