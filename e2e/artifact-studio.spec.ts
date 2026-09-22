import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

type SyntheticArtifact = Record<string, string | number | boolean | null | object[]>;

test('Artifact Studio saves responses and persists after reload at this viewport', async ({ page }, testInfo) => {
  const timestamp = '2026-09-22T15:00:00.000Z';
  const session = { id: 'jc_' + 'a'.repeat(32), title: 'Artifact chat', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 2, toolCallCount: 0, pinned: false };
  const message = { id: 'msg_' + 'b'.repeat(32), sessionId: session.id, role: 'assistant', content: '# Artifact response\nactual response body', timestamp, toolName: null, displayKind: null };
  let artifacts: SyntheticArtifact[] = [];
  const contents = new Map<string, string>();

  await page.route('**/api/bootstrap', route => route.fulfill({ json: {
    identity: { provider: 'development' },
    command: {
      version: 'artifact-e2e',
      environment: 'test',
      generatedAt: timestamp,
      liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 },

    },
    hermes: { state: 'online', version: '0.21.0', model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio'], readinessChecks: {} },
    sessions: [session],
  } }));
  await page.route('**/api/rooms', route => route.fulfill({ json: { version: 1, rooms: [] } }));
  await page.route(`**/api/live/sessions/${session.id}/context`, route => route.fulfill({ json: { sessionId: session.id, state: 'unavailable', updatedAt: null, receipt: null } }));
  await page.route('**/api/live/model-options', route => route.fulfill({ json: { default: { provider: 'OpenAI', model: 'Astra' }, options: [{ provider: 'openai-codex', model: 'gpt-6-astra', label: 'Astra', reasoningEfforts: ['medium'] }] } }));
  await page.route('**/api/live/session-controls', route => route.fulfill({ json: { sessionForkPreservesSource: false, sessionCompactionRuns: false } }));
  await page.route(`**/api/sessions/${session.id}/messages?*`, route => route.fulfill({ json: { sessionId: session.id, messages: [message], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } } }));
  await page.route('**/api/artifacts?*', route => route.fulfill({ json: { artifacts: artifacts.map((artifact) => {
    const summary = { ...artifact };
    delete summary.versions;
    delete summary.comments;
    return summary;
  }) } }));
  await page.route('**/api/artifacts/text', async route => {
    const body = route.request().postDataJSON();
    const id = `art_${String(artifacts.length + 1).padStart(32, '0')}`;
    const artifact = {
      id,
      title: body.title,
      type: body.type,
      mime: body.type === 'markdown' ? 'text/markdown' : 'text/plain',
      createdAt: timestamp,
      updatedAt: timestamp,
      creator: { subject: 'operator', source: body.source },
      sessionId: body.sessionId,
      projectId: body.projectId,
      runId: body.runId,
      size: body.content.length,
      sha256: 'c'.repeat(64),
      currentVersion: 1,
      canonical: false,
      privateMode: 'private',
      originalFilename: null,
      versions: [{ version: 1, parentVersion: null, baseVersion: null, createdAt: timestamp, creator: { subject: 'operator', source: body.source }, mime: 'text/markdown', size: body.content.length, sha256: 'c'.repeat(64), revisionNote: null, feedback: null, originalFilename: null }],
      comments: [],
    };
    artifacts = [artifact, ...artifacts];
    contents.set(id, body.content);
    return route.fulfill({ json: { artifact } });
  });
  await page.route('**/api/artifacts/art_*/versions/1/source', route => {
    const id = new URL(route.request().url()).pathname.split('/')[3]!;
    const artifact = artifacts.find(item => item.id === id);
    return route.fulfill({ json: { artifactId: id, version: 1, type: artifact?.type, mime: artifact?.mime, size: artifact?.size, sha256: artifact?.sha256, content: contents.get(id) } });
  });
  await page.route('**/api/artifacts/art_*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    return route.fulfill({ json: artifacts.find(item => item.id === id) });
  });

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/');
  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: 'Open chat navigation' }).click();
  }
  const chatRow = page.locator('button.chat-item').filter({ hasText: 'Artifact chat' }).first();
  await expect(chatRow).toBeEnabled();
  await chatRow.click();
  await expect(page.getByText('actual response body')).toBeVisible();
  await page.getByRole('button', { name: 'Save response as artifact' }).click();
  await expect(page.getByText('Response saved as artifact.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Artifact response' })).toBeVisible();

  const paneBox = await page.locator('.context-pane').boundingBox();
  const viewport = page.viewportSize()!;
  if (testInfo.project.name.startsWith('mobile')) {
    expect(Math.round(paneBox!.width)).toBe(viewport.width);
  } else {
    expect(paneBox!.width).toBeLessThan(viewport.width);
    await expect(page.getByRole('separator', { name: 'Resize context pane' })).toBeVisible();
  }

  await page.reload();
  await page.getByRole('button', { name: 'Open Artifact Studio' }).click();
  await expect(page.getByRole('heading', { name: 'Artifact response' })).toBeVisible();
  await expect(page.locator('iframe[title^="Artifact"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
