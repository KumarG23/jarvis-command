import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const timestamp = '2026-09-22T15:00:00.000Z';
const sessionId = 'jc_' + 'a'.repeat(32);
const versionedId = 'art_' + '1'.repeat(32);
const oversizedId = 'art_' + '2'.repeat(32);
const versionBytes = new Map([
  [`${versionedId}:1`, 'version one exact bytes'],
  [`${versionedId}:2`, 'version two exact bytes\nwith a second line'],
]);
const oversizedBytes = `<html><body>${'x'.repeat(1_200_000)}</body></html>`;

const creator = { subject: 'operator', source: 'upload' as const };
const catalog = [
  {
    id: versionedId,
    title: '.hidden notes',
    type: 'markdown',
    mime: 'text/markdown',
    createdAt: timestamp,
    updatedAt: timestamp,
    creator,
    sessionId,
    projectId: null,
    runId: null,
    sourceRequestId: null,
    size: versionBytes.get(`${versionedId}:2`)!.length,
    sha256: 'b'.repeat(64),
    currentVersion: 2,
    canonical: false,
    privateMode: 'private',
    originalFilename: null,
    versions: [
      { version: 1, parentVersion: null, baseVersion: null, createdAt: timestamp, creator, type: 'markdown', mime: 'text/markdown', size: versionBytes.get(`${versionedId}:1`)!.length, sha256: 'a'.repeat(64), revisionNote: null, feedback: null, originalFilename: null },
      { version: 2, parentVersion: 1, baseVersion: 1, createdAt: timestamp, creator, type: 'markdown', mime: 'text/markdown', size: versionBytes.get(`${versionedId}:2`)!.length, sha256: 'b'.repeat(64), revisionNote: null, feedback: null, originalFilename: null },
    ],
    comments: [],
  },
  {
    id: oversizedId,
    title: 'Oversized page',
    type: 'html',
    mime: 'text/html',
    createdAt: timestamp,
    updatedAt: timestamp,
    creator,
    sessionId,
    projectId: null,
    runId: null,
    sourceRequestId: null,
    size: oversizedBytes.length,
    sha256: 'f'.repeat(64),
    currentVersion: 1,
    canonical: false,
    privateMode: 'private',
    originalFilename: null,
    versions: [
      { version: 1, parentVersion: null, baseVersion: null, createdAt: timestamp, creator, type: 'html', mime: 'text/html', size: oversizedBytes.length, sha256: 'f'.repeat(64), revisionNote: null, feedback: null, originalFilename: null },
    ],
    comments: [],
  },
];

function summary(artifact: typeof catalog[number]) {
  const copy: Record<string, unknown> = { ...artifact };
  delete copy.versions;
  delete copy.comments;
  return copy;
}

test('artifact recovery states stay honest and each version downloads at this viewport', async ({ page }) => {
  await page.route('**/api/bootstrap', route => route.fulfill({ json: {
    identity: { provider: 'development' },
    command: {
      version: 'artifact-recovery-e2e',
      environment: 'test',
      generatedAt: timestamp,
      liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 },
    },
    hermes: { state: 'online', version: '0.21.0', model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio'], readinessChecks: {} },
    sessions: [{ id: sessionId, title: 'Artifact recovery chat', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }],
  } }));
  await page.route('**/api/rooms', route => route.fulfill({ json: { version: 1, rooms: [] } }));
  await page.route(`**/api/live/sessions/${sessionId}/context`, route => route.fulfill({ json: { sessionId, state: 'unavailable', updatedAt: null, receipt: null } }));
  await page.route('**/api/live/model-options', route => route.fulfill({ json: { default: { provider: 'OpenAI', model: 'Astra' }, options: [{ provider: 'openai-codex', model: 'gpt-6-astra', label: 'Astra', reasoningEfforts: ['medium'] }] } }));
  await page.route('**/api/live/session-controls', route => route.fulfill({ json: { sessionForkPreservesSource: false, sessionCompactionRuns: false } }));
  await page.route(`**/api/sessions/${sessionId}/messages?*`, route => route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
  await page.route('**/api/artifacts?*', route => route.fulfill({ json: { artifacts: catalog.map(summary) } }));

  await page.route('**/api/artifacts/art_*/versions/*/download', route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[3]!;
    const version = Number(parts[5]);
    const artifact = catalog.find(item => item.id === id)!;
    const bytes = id === oversizedId ? oversizedBytes : versionBytes.get(`${id}:${version}`)!;
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': artifact.mime,
        'content-disposition': `attachment; filename="${id === oversizedId ? 'large.html' : `hidden notes-v${version}`}"`,
      },
      body: bytes,
    });
  });

  await page.route('**/api/artifacts/art_*/versions/*/source', route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[3]!;
    const version = Number(parts[5]);
    if (id === oversizedId) return route.fulfill({ status: 415, json: { error: 'bad_request' } });
    const artifact = catalog.find(item => item.id === id)!;
    const selected = artifact.versions.find(item => item.version === version)!;
    return route.fulfill({ json: { artifactId: id, version, type: selected.type, mime: selected.mime, size: selected.size, sha256: selected.sha256, content: versionBytes.get(`${id}:${version}`) } });
  });

  await page.route('**/api/artifacts/art_*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    return route.fulfill({ json: catalog.find(item => item.id === id) });
  });

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('415')) errors.push(message.text()); });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open Artifact Studio' }).click();

  await page.getByRole('listitem').filter({ hasText: '.hidden notes' }).click();
  await expect(page.locator('.markdown-preview').getByText('version two exact bytes')).toBeVisible();
  await page.getByRole('tab', { name: /versions/i }).click();
  const checksums = page.locator('.version-row code');
  await expect(checksums).toHaveCount(2);
  await expect(checksums.nth(0)).toHaveText('a'.repeat(12));
  await expect(checksums.nth(1)).toHaveText('b'.repeat(12));
  await expect(page.getByRole('link', { name: 'Download version 1' })).toHaveAttribute('href', `/api/artifacts/${versionedId}/versions/1/download`);
  await expect(page.getByRole('link', { name: 'Download version 2' })).toHaveAttribute('href', `/api/artifacts/${versionedId}/versions/2/download`);

  for (const version of [1, 2]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: `Download version ${version}` }).click()]);
    expect(download.suggestedFilename()).toBe(`hidden notes-v${version}`);
    expect(await readFile((await download.path())!, 'utf8')).toBe(versionBytes.get(`${versionedId}:${version}`));
  }

  await page.getByRole('listitem').filter({ hasText: 'Oversized page' }).click();
  await page.getByRole('tab', { name: /preview/i }).click();
  await expect(page.getByText(/larger than the 1 MiB preview limit/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download version 1' })).toHaveAttribute('href', `/api/artifacts/${oversizedId}/versions/1/download`);
  await expect(page.locator('iframe[title="Oversized page"]')).toHaveCount(0);
  await page.getByRole('tab', { name: /source/i }).click();
  await expect(page.getByLabel('Edit artifact source')).toHaveCount(0);
  await expect(page.getByText('Editing is disabled until the correct source loads.')).toBeVisible();

  const [oversizedDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download version 1' }).click()]);
  expect(oversizedDownload.suggestedFilename()).toBe('large.html');
  expect((await readFile((await oversizedDownload.path())!)).length).toBe(Buffer.byteLength(oversizedBytes));

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
