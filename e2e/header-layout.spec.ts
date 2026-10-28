import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CommandBootstrapSchema, ContextCompactionStatusSchema, InferenceOptionsResponseSchema,
  ProjectRoomsSchema, SessionContextResponseSchema, SessionControlCapabilitiesSchema,
  SessionMessagesPageSchema, SessionMutationResponseSchema,
} from '@jarvis-command/contracts';
import { emptyInbox } from './empty-inbox';

// Synthetic local APIs only. The IDs identify the existing issue-2 fixture;
// the content below is fabricated test content, never a live history readback.
const BOOTSTRAP_BASE = CommandBootstrapSchema.parse({
  identity: { provider: 'development' },
  command: { version: 'test', environment: 'test', generatedAt: '2026-09-04T12:00:00.000Z', liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 100, maxSteerCharacters: 100 } },
  hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio', 'session_resources'], readinessChecks: {} },
  sessions: [
    { id: 'jc_300d0e2efc094ab38ebc2398d13e5114', title: 'Narrow viewport test session with a long title that would overflow', ownership: 'command', source: 'web', model: null, lastActive: '2026-09-04T12:00:00.000Z', messageCount: 5, toolCallCount: 2, pinned: false },
  ],
});

/**
 * Valid SessionContextResponse per SessionContextResponseSchema:
 * - receipt.context must have { usedTokens, limitTokens, source: 'hermes_effective' }
 * - context is inside receipt, not flat fields
 */
function validContextReceipt(sessionId: string) {
  return SessionContextResponseSchema.parse({
    sessionId,
    state: 'available' as const,
    updatedAt: new Date().toISOString(),
    receipt: {
      inputTokens: 12000,
      outputTokens: 3500,
      totalTokens: 15500,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiCalls: 1,
      providerLatencyMs: 1200,
      endToEndLatencyMs: 1450,
      outputTokensPerSecond: 2.4,
      context: {
        usedTokens: 15500,
        limitTokens: 128000,
        source: 'hermes_effective' as const,
      },
      execution: null,
    },
  });
}

function validHistoryMessages(sessionId: string) {
  return [
    { id: 'msg:1', sessionId, role: 'user' as const, content: 'First question about the project setup', timestamp: '2026-09-04T10:00:00.000Z', toolName: null, displayKind: null },
    { id: 'msg:2', sessionId, role: 'assistant' as const, content: 'Here is the project setup information you requested.', timestamp: '2026-09-04T10:00:05.000Z', toolName: null, displayKind: null },
    { id: 'msg:3', sessionId, role: 'user' as const, content: 'Can you check the build configuration?', timestamp: '2026-09-04T10:05:00.000Z', toolName: null, displayKind: null },
    { id: 'msg:4', sessionId, role: 'assistant' as const, content: 'The build configuration looks correct.', timestamp: '2026-09-04T10:05:10.000Z', toolName: null, displayKind: null },
    { id: 'msg:5', sessionId, role: 'user' as const, content: 'Thanks, that helps', timestamp: '2026-09-04T10:10:00.000Z', toolName: null, displayKind: null },
  ];
}

/**
 * Valid ContextCompactionStatusSchema per production contract:
 * - publicOperationId: PublicRunIdSchema
 * - sessionId: SessionIdSchema
 * - status: LiveRunStateSchema
 * - updatedAt: IsoTimestampSchema
 * - compaction: LiveCompactionSchema.nullable()
 * - result: ContextCompactionResultSchema.nullable()
 * - error: SafeTextSchema(256).nullable()
 */
function validCompactionStatusRunning(publicOperationId: string, sessionId: string) {
  return ContextCompactionStatusSchema.parse({
    publicOperationId,
    sessionId,
    status: 'running' as const,
    updatedAt: new Date().toISOString(),
    compaction: {
      state: 'running' as const,
      startedAt: new Date(Date.now() - 5000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    result: null,
    error: null,
  });
}

function validCompactionStatusFailed(publicOperationId: string, sessionId: string) {
  return ContextCompactionStatusSchema.parse({
    publicOperationId,
    sessionId,
    status: 'failed' as const,
    updatedAt: new Date().toISOString(),
    compaction: {
      state: 'aborted' as const,
      startedAt: new Date(Date.now() - 10000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    result: null,
    error: 'Context compaction could not be completed.',
  });
}
const session = BOOTSTRAP_BASE.sessions[0]!;
const projectName = 'Jarvis Command project with a long name for breadcrumb testing';
const rooms = ProjectRoomsSchema.parse({ version: 1, rooms: [{
  id: 'room_' + '1'.repeat(32), name: projectName, goal: 'Synthetic layout fixture',
  repository: '', notes: [], sessionIds: [session.id], lastSessionId: session.id,
}] });
const history = SessionMessagesPageSchema.parse({
  sessionId: session.id, messages: validHistoryMessages(session.id),
  pagination: { limit: 50, offset: 0, returned: 5, hasMore: false },
});

async function mockApis(page: Page, lifecycle?: 'running' | 'failed') {
  const operationId = 'jcr_' + 'a'.repeat(32);
  const responses: Record<string, unknown> = {
    '/api/bootstrap': BOOTSTRAP_BASE,
    '/api/rooms': rooms,
    [`/api/live/sessions/${session.id}`]: SessionMutationResponseSchema.parse({ session }),
    [`/api/sessions/${session.id}/messages`]: history,
    [`/api/live/sessions/${session.id}/context`]: validContextReceipt(session.id),
    '/api/live/session-controls': SessionControlCapabilitiesSchema.parse({ sessionForkPreservesSource: true, sessionCompactionRuns: true }),
    '/api/live/model-options': InferenceOptionsResponseSchema.parse({ default: { provider: 'openai-codex', model: 'gpt-5.6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-5.6-sol', label: 'Sol', reasoningEfforts: ['medium'] }] }),
    '/api/artifacts': { artifacts: [] },
    '/api/notifications': emptyInbox,
  };
  if (lifecycle) {
    responses[`/api/live/context-compactions/${operationId}`] = lifecycle === 'running'
      ? validCompactionStatusRunning(operationId, session.id)
      : validCompactionStatusFailed(operationId, session.id);
    await page.addInitScript(({ sessionId, publicOperationId }) => {
      localStorage.setItem('jarvis-command:context-compaction:v1', JSON.stringify({ sessionId, publicOperationId }));
    }, { sessionId: session.id, publicOperationId: operationId });
  }
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' || !(path in responses)) {
      unexpected.push(`${request.method()} ${path}`);
      await route.abort();
      return;
    }
    await route.fulfill({ json: responses[path] });
  });
  return unexpected;
}

async function openProject(page: Page) {
  await page.goto('/');
  await expect(page.locator('.command-header')).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open chat navigation' });
  if (await menu.isVisible()) await menu.click();
  // Selecting the project resolves its real lastSessionId using the existing GET
  // path. Clicking its chat would POST membership, which this fixture forbids.
  await page.getByRole('navigation', { name: 'Projects', exact: true }).getByRole('button', { name: projectName, exact: true }).click();
  await expect(page.getByLabel('Selected session', { exact: true })).toHaveText(session.title);
  const close = page.getByRole('button', { name: 'Close chat navigation' });
  if (await close.isVisible()) await close.click();
}

async function box(locator: Locator) {
  await expect(locator).toBeAttached();
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}

async function assertLayout(page: Page, testInfo: TestInfo, phase: string, lifecycle?: 'running' | 'failed') {
  await expect(page.getByLabel('Selected project', { exact: true })).toHaveText(projectName);
  await expect(page.getByLabel('Selected session', { exact: true })).toHaveText(session.title);
  await expect(page.locator('.history-message')).toHaveCount(5);
  await expect(page.getByText('The build configuration looks correct.', { exact: true })).toHaveCount(1);
  await expect(page.locator('.session-context:not(.unavailable)')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Jarvis', exact: true })).toBeEnabled();
  const compact = page.getByRole('button', { name: 'Compact context', exact: true });
  if (lifecycle === 'running') await expect(compact).toBeDisabled();
  else await expect(compact).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Fork chat', exact: true })).toBeVisible();
  if (lifecycle) await expect(page.locator('.session-lifecycle-feedback')).toHaveText(lifecycle === 'running' ? 'Compacting…' : 'Context compaction could not be completed.');
  await page.evaluate(() => document.fonts.ready);
  const selectors = {
    header: '.command-header', title: '[aria-label="Selected session"]', project: '[aria-label="Selected project"]',
    actions: '.header-actions', composer: '.composer-wrap', input: 'textarea[aria-label="Message Jarvis"]',
    ...(lifecycle ? { feedback: '.session-lifecycle-feedback' } : {}),
  };
  const geometry: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const [name, selector] of Object.entries(selectors)) geometry[name] = await box(page.locator(selector));
  const controls = page.locator('.command-header button');
  for (const control of await controls.all()) {
    if (await control.isVisible()) geometry[`control:${await control.getAttribute('aria-label')}`] = await box(control);
  }
  const viewport = page.viewportSize()!;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const evidence = { phase, variant: testInfo.config.metadata.cssVariant, viewport, geometry, overflow };
  await testInfo.attach(`${phase}-geometry`, { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  // Always capture before assertions, including genuine baseline failures.
  await page.screenshot({ path: testInfo.outputPath(`${phase}.png`), fullPage: true });
  console.log(JSON.stringify(evidence));
  for (const [name, rect] of Object.entries(geometry)) {
    expect(rect.x, `${name} left`).toBeGreaterThanOrEqual(0);
    expect(rect.y, `${name} top`).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width, `${name} right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(rect.y + rect.height, `${name} bottom`).toBeLessThanOrEqual(viewport.height + 1);
  }
  expect(geometry.header.height, 'compact header').toBeLessThanOrEqual(viewport.width < 761 ? 120 : 100);
  for (const name of ['title', 'project']) {
    expect(geometry[name].width, `${name} readable width`).toBeGreaterThanOrEqual(80);
    for (const [control, rect] of Object.entries(geometry).filter(([key]) => key === 'actions' || key.startsWith('control:'))) {
      const identity = geometry[name];
      const intersects = identity.x < rect.x + rect.width && identity.x + identity.width > rect.x
        && identity.y < rect.y + rect.height && identity.y + identity.height > rect.y;
      expect(intersects, `${name} intersects ${control}`).toBe(false);
    }
  }
  // Feedback must wrap visibly rather than being clipped or reduced to a hidden status.
  if (lifecycle) {
    const feedback = page.locator('.session-lifecycle-feedback');
    expect(await feedback.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
  // Trial clicks validate hit targets without invoking consequential operations.
  const reachable = ['Open project details', 'Open Artifact Studio'];
  if (lifecycle !== 'running') reachable.push('Compact context', 'Fork chat');
  for (const name of reachable) await page.getByRole('button', { name, exact: true }).click({ trial: true });
  await page.locator('.health-button').click({ trial: true });
}

for (const viewport of [{ width: 320, height: 640 }, { width: 360, height: 360 }, { width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 740 }, { width: 1280, height: 720 }]) {
  for (const lifecycle of [undefined, 'running', 'failed'] as const) {
    test(`selected project/history and reload ${viewport.width}x${viewport.height} ${lifecycle ?? 'idle'}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const unexpected = await mockApis(page, lifecycle);
      const releaseCssPath = process.env.HEADER_RELEASE_CSS;
      let stylesheets = 0;
      await page.route('**/assets/*.css', async route => {
        stylesheets++;
        if (releaseCssPath) {
          const body = readFileSync(releaseCssPath);
          expect(createHash('sha256').update(body).digest('hex')).toBe(testInfo.config.metadata.cssSha256);
          await route.fulfill({ body, contentType: 'text/css' });
        } else await route.continue();
      });
      await openProject(page);
      await assertLayout(page, testInfo, 'selected', lifecycle);
      await page.reload();
      await assertLayout(page, testInfo, 'reloaded', lifecycle);
      expect(stylesheets).toBe(2); // One complete stylesheet per load, never an overlay.
      expect(await page.locator('style').count()).toBe(0);
      expect(unexpected).toEqual([]);
    });
  }
}
