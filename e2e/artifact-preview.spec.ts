import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const timestamp = '2026-09-22T15:00:00.000Z';
const sessionId = 'jc_' + 'a'.repeat(32);
const imageId = 'art_' + '1'.repeat(32);
const pdfId = 'art_' + '2'.repeat(32);
const htmlId = 'art_' + '3'.repeat(32);
const svgId = 'art_' + '4'.repeat(32);
const largeTextId = 'art_' + '5'.repeat(32);

// Valid 2x2 opaque PNG generated from a known zlib stream, not the bad-CRC
// 1px fixture used by an earlier smoke attempt.
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4RBCAwBRcwH+conGc8AAAAASUVORK5CYII=', 'base64');
const pdfBytes = Buffer.from('%PDF-1.7\n% synthetic fixture\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'ascii');
const htmlBytes = '<h1>Synthetic HTML fixture</h1>';
const svgBytes = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="teal"/></svg>';
const largeTextBytes = 'x'.repeat(1_200_000);

const creator = { subject: 'operator', source: 'upload' as const };
const version = (type: string, mime: string, size: number, sha256: string) => ({
  version: 1, parentVersion: null, baseVersion: null, createdAt: timestamp, creator,
  type, mime, size, sha256, revisionNote: null, feedback: null, originalFilename: type === 'pdf' ? 'synthetic.pdf' : null,
});
const summary = (id: string, title: string, type: string, mime: string, size: number, sha256: string) => ({
  id, title, type, mime, createdAt: timestamp, updatedAt: timestamp, creator, sessionId,
  projectId: null, runId: null, sourceRequestId: null, size, sha256, currentVersion: 1,
  canonical: false, privateMode: 'private', originalFilename: type === 'pdf' ? 'synthetic.pdf' : null,
});
const artifacts = [
  summary(imageId, 'Synthetic image', 'image', 'image/png', imageBytes.length, '1'.repeat(64)),
  summary(pdfId, 'Synthetic PDF', 'pdf', 'application/pdf', pdfBytes.length, '2'.repeat(64)),
  summary(htmlId, 'Synthetic HTML', 'html', 'text/html', htmlBytes.length, '3'.repeat(64)),
  summary(svgId, 'Synthetic SVG', 'svg', 'image/svg+xml', svgBytes.length, '4'.repeat(64)),
  summary(largeTextId, 'Large text', 'text', 'text/plain', largeTextBytes.length, '5'.repeat(64)),
];
const metadata = new Map<string, Record<string, unknown>>([
  [imageId, { ...artifacts[0], versions: [version('image', 'image/png', imageBytes.length, '1'.repeat(64))], comments: [] }],
  [pdfId, { ...artifacts[1], versions: [version('pdf', 'application/pdf', pdfBytes.length, '2'.repeat(64))], comments: [] }],
  [htmlId, { ...artifacts[2], versions: [version('html', 'text/html', htmlBytes.length, '3'.repeat(64))], comments: [] }],
  [svgId, { ...artifacts[3], versions: [version('svg', 'image/svg+xml', svgBytes.length, '4'.repeat(64))], comments: [] }],
  [largeTextId, { ...artifacts[4], versions: [version('text', 'text/plain', largeTextBytes.length, '5'.repeat(64))], comments: [] }],
]);

test('image and binary previews stay honest under the production document CSP at this viewport', async ({ page }) => {
  await page.route('**/api/bootstrap', route => route.fulfill({ json: {
    identity: { provider: 'development' },
    command: {
      version: 'artifact-preview-e2e',
      environment: 'test',
      generatedAt: timestamp,
      liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 },
    },
    hermes: { state: 'online', version: '0.21.0', model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio'], readinessChecks: {} },
    sessions: [{ id: sessionId, title: 'Artifact preview chat', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false }],
  } }));
  await page.route('**/api/rooms', route => route.fulfill({ json: { version: 1, rooms: [] } }));
  await page.route(`**/api/live/sessions/${sessionId}/context`, route => route.fulfill({ json: { sessionId, state: 'unavailable', updatedAt: null, receipt: null } }));
  await page.route('**/api/live/model-options', route => route.fulfill({ json: { default: { provider: 'OpenAI', model: 'Astra' }, options: [{ provider: 'openai-codex', model: 'gpt-6-astra', label: 'Astra', reasoningEfforts: ['medium'] }] } }));
  await page.route('**/api/live/session-controls', route => route.fulfill({ json: { sessionForkPreservesSource: false, sessionCompactionRuns: false } }));
  await page.route(`**/api/sessions/${sessionId}/messages?*`, route => route.fulfill({ json: { sessionId, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } } }));
  await page.route('**/api/artifacts?*', route => route.fulfill({ json: { artifacts } }));

  await page.route('**/api/artifacts/art_*/versions/*/blob', route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    if (parts[3] !== imageId) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-disposition': 'inline; filename="synthetic.png"',
        'content-security-policy': "default-src 'none'; img-src 'self' blob: data:; media-src 'none'; object-src 'none'; script-src 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
      },
      body: imageBytes,
    });
  });

  await page.route('**/api/artifacts/art_*/versions/*/download', route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[3]!;
    const bytes = id === imageId ? imageBytes : id === pdfId ? pdfBytes : id === htmlId ? Buffer.from(htmlBytes) : id === svgId ? Buffer.from(svgBytes) : Buffer.from(largeTextBytes);
    const mime = id === imageId ? 'image/png' : id === pdfId ? 'application/pdf' : id === svgId ? 'image/svg+xml' : id === largeTextId ? 'text/plain' : 'text/html';
    return route.fulfill({ status: 200, headers: { 'content-type': mime, 'content-disposition': 'attachment' }, body: bytes });
  });

  await page.route('**/api/artifacts/art_*/versions/*/source', route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[3]!;
    if (id === largeTextId) return route.fulfill({ status: 415, json: { error: 'bad_request' } });
    const content = id === htmlId ? htmlBytes : id === svgId ? svgBytes : '';
    const artifact = metadata.get(id)!;
    const selected = (artifact.versions as Array<Record<string, unknown>>)[0]!;
    return route.fulfill({ json: { artifactId: id, version: 1, type: selected.type, mime: selected.mime, size: selected.size, sha256: selected.sha256, content } });
  });

  await page.route('**/api/artifacts/art_*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    return route.fulfill({ json: metadata.get(id) });
  });

  const errors: string[] = [];
  page.on('pageerror', error => {
    if (error.message.includes('context is sandboxed')) return;
    errors.push(error.message);
  });
  // The service-worker read comes from Playwright's blocking harness inside the
  // intentionally opaque HTML/SVG sandbox, not from the app or preview request.
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text().includes('415') || message.text().includes('context is sandboxed')) return;
    errors.push(message.text());
  });

  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("img-src 'self' data:");
  expect(csp).not.toMatch(/img-src[^;]*blob:/);

  const expectNoOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  };

  await page.getByRole('button', { name: 'Open Artifact Studio' }).click();

  await page.getByRole('listitem').filter({ hasText: 'Synthetic image' }).click();
  const image = page.getByRole('img', { name: 'Synthetic image' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(2);
  expect(await image.getAttribute('src')).toBe(`/api/artifacts/${imageId}/versions/1/blob`);
  expect(await image.getAttribute('src')).not.toMatch(/^blob:/);
  await expectNoOverflow();

  await page.getByRole('listitem').filter({ hasText: 'Synthetic PDF' }).click();
  await expect(page.getByText(/PDF files are download-only/)).toBeVisible();
  await expect(page.locator('iframe[title="Synthetic PDF"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download version 1' })).toHaveAttribute('href', `/api/artifacts/${pdfId}/versions/1/download`);
  await expectNoOverflow();

  await page.getByRole('listitem').filter({ hasText: 'Synthetic HTML' }).click();
  const htmlFrame = page.locator('iframe[title="Synthetic HTML"]');
  await expect(htmlFrame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(htmlFrame).toHaveAttribute('srcdoc', /connect-src 'none'/);
  await expectNoOverflow();

  await page.getByRole('listitem').filter({ hasText: 'Synthetic SVG' }).click();
  const svgFrame = page.locator('iframe[title="Synthetic SVG"]');
  await expect(svgFrame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(svgFrame).toHaveAttribute('srcdoc', /<svg/);
  await expectNoOverflow();

  await page.getByRole('listitem').filter({ hasText: 'Large text' }).click();
  await expect(page.getByText(/larger than the 1 MiB preview limit/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download version 1' })).toHaveAttribute('href', `/api/artifacts/${largeTextId}/versions/1/download`);
  await expect(page.locator('iframe[title="Large text"]')).toHaveCount(0);
  await expectNoOverflow();

  expect(errors).toEqual([]);
});
