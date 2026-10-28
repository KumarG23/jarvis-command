import { expect, test } from '@playwright/test';
import { emptyInbox } from './empty-inbox';

const timestamp = '2026-10-28T12:00:00.000Z';
const sid = 'jc_' + 'a'.repeat(32), pid = 'room_' + 'b'.repeat(32), aid = 'art_' + 'c'.repeat(32);
const session = { id: sid, title: 'SYNTHETIC project chat', source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 0, toolCallCount: 0, pinned: false };

for (const width of [1280, 320, 360, 390, 430]) test(`SYNTHETIC project workspace ${width}px: metadata, chats, P4 references and composed send`, async ({ page }, info) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width, height: width === 1280 ? 720 : 740 });
  const errors: string[] = [], unexpected: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let room: Record<string, unknown> | null = null;
  let artifact: Record<string, unknown> | null = null;
  const admissions: Record<string, unknown>[] = [];
  const runId = 'jcr_' + 'e'.repeat(32);
  let creates = 0;
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC P4.5 fixture', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio'], readinessChecks: {} }, sessions: [] });
    if (path === '/api/notifications') return route.fulfill({ json: emptyInbox });
    if (path === '/api/rooms') {
      if (req.method() === 'POST') { room = { ...req.postDataJSON(), id: pid, sessionIds: [], lastSessionId: null }; return json({ room }); }
      return json({ version: 1, rooms: room ? [room] : [] });
    }
    if (path === `/api/rooms/${pid}`) { room = { ...room, ...req.postDataJSON() }; return json({ room }); }
    if (path === `/api/rooms/${pid}/sessions`) { expect(req.postDataJSON()).toEqual({ sessionId: sid }); room = { ...room, sessionIds: [sid], lastSessionId: sid }; return json({ room, session }); }
    if (path === '/api/live/sessions') { creates++; return json({ session }); }
    if (path === `/api/live/sessions/${sid}`) return json({ session });
    if (path.endsWith('/context')) return json({ sessionId: sid, state: 'unavailable', receipt: null, updatedAt: null });
    if (path.endsWith('/messages')) return json({ sessionId: sid, messages: [{ id: 'synthetic-answer', sessionId: sid, role: 'assistant', content: 'SYNTHETIC saved response', timestamp, toolName: null, displayKind: null }], pagination: { limit: 50, offset: 0, returned: 1, hasMore: false } });
    if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'SYNTHETIC Sol', reasoningEfforts: ['medium'] }] });
    if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
    if (path === '/api/artifacts') {
      if (url.searchParams.has('projectId')) expect(url.searchParams.get('projectId')).toBe(pid);
      const summary = artifact ? { ...artifact } : null; if (summary) { delete summary.versions; delete summary.comments; }
      return json({ artifacts: summary ? [summary] : [] });
    }
    if (path === '/api/artifacts/text' || path === '/api/artifacts/upload') {
      let title = 'SYNTHETIC reference.txt', type = 'file', mime = 'application/octet-stream', source = 'upload';
      if (path.endsWith('/text')) { const body = req.postDataJSON(); expect(body.projectId).toBe(pid); expect(body.sessionId).toBe(sid); title = body.title; type = body.type; mime = 'text/plain'; source = 'assistant-response'; }
      else { const body = req.postData()!; expect(body).toContain(pid); expect(body).toContain('SYNTHETIC reference bytes'); }
      const creator = { subject: 'synthetic-operator', source };
      artifact = { id: aid, title, type, mime, createdAt: timestamp, updatedAt: timestamp, creator, sessionId: sid, projectId: pid, runId: null, sourceRequestId: path.endsWith('/text') ? req.postDataJSON().sourceRequestId : null, size: 25, sha256: 'd'.repeat(64), currentVersion: 1, canonical: false, privateMode: 'private', originalFilename: null, versions: [{ version: 1, parentVersion: null, baseVersion: null, createdAt: timestamp, creator, type, mime, size: 25, sha256: 'd'.repeat(64), revisionNote: null, feedback: null, originalFilename: null }], comments: [] };
      return json({ artifact });
    }
    if (path === `/api/artifacts/${aid}`) return json(artifact);
    if (path.endsWith('/source')) return json({ artifactId: aid, version: 1, type: artifact!.type, mime: artifact!.mime, size: 25, sha256: 'd'.repeat(64), content: 'SYNTHETIC saved response' });
    if (path.endsWith('/download')) return route.fulfill({ body: 'SYNTHETIC reference bytes', headers: { 'content-disposition': 'attachment; filename="synthetic.txt"' } });
    if (path.includes('/run-requests/')) { expect(path.split('/').at(-1)).toBe(admissions[0]!.clientRequestId); return json({ sessionId: sid, clientRequestId: admissions[0]!.clientRequestId, publicRunId: runId }); }
    if (path === `/api/live/runs/${runId}`) return json({ publicRunId: runId, sessionId: sid, status: 'running', updatedAt: timestamp, approval: null, output: null, error: null, pendingSteer: null, usage: null });
    if (path === `/api/live/runs/${runId}/events`) return route.fulfill({ contentType: 'text/event-stream', body: ': SYNTHETIC quiet run\n\n' });
    if (path === '/api/live/runs') { admissions.push(req.postDataJSON()); return route.abort('failed'); }
    unexpected.push(`${req.method()} ${path}`); return route.abort();
  });
  await page.goto('/');
  if (width < 760) await page.getByRole('button', { name: 'Open chat navigation' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('SYNTHETIC workspace');
  await page.getByLabel('Project goal').fill('Verify project context and references');
  await page.getByLabel('Standing instructions').fill('Use only SYNTHETIC data.');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByText('Use only SYNTHETIC data.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit project' }).click();
  await page.getByLabel('Project name', { exact: true }).fill('SYNTHETIC renamed workspace');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Archive project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start project chat' })).toBeDisabled();
  await page.getByRole('button', { name: 'Restore project', exact: true }).click();
  await page.getByRole('button', { name: 'Start project chat' }).click();
  await page.getByRole('button', { name: 'Open project details' }).click();
  await expect(page.getByText('In-run delegation detail is not available from this Hermes installation')).toBeVisible();
  await page.getByRole('button', { name: 'Open project files / upload' }).click();
  await expect(page.getByLabel('Artifact scope')).toHaveValue('current-project');
  await page.getByLabel('Upload artifact file').setInputFiles({ name: 'SYNTHETIC reference.txt', mimeType: 'text/plain', buffer: Buffer.from('SYNTHETIC reference bytes') });
  await expect(page.getByText('Upload saved.')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download artifact v1' }).click(); await download;
  await page.getByRole('button', { name: 'Close artifacts' }).click();
  await page.getByRole('button', { name: 'Open project details' }).click();
  await expect(page.getByRole('link', { name: 'Download SYNTHETIC reference.txt' })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`synthetic-project-${width}.png`) });
  await page.getByRole('button', { name: 'Close project details' }).click();
  await page.getByRole('button', { name: 'Save response as artifact' }).click();
  await expect(page.getByText('Response saved as artifact.')).toBeVisible();
  await page.getByRole('button', { name: 'Close artifacts' }).click();
  await page.reload();
  await expect(page.getByLabel('Selected project')).toHaveText('SYNTHETIC renamed workspace');
  await expect(page.getByLabel('Selected session')).toHaveText(session.title);
  const composer = page.getByRole('textbox', { name: 'Message Jarvis', exact: true });
  await composer.fill('SYNTHETIC message');
  await page.locator('.project-input-preview summary').click();
  await expect(page.locator('.project-input-preview pre')).toContainText('Use only SYNTHETIC data.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.project-input-preview summary').click();
  await page.setViewportSize({ width, height: 360 });
  await composer.focus(); await expect(composer).toBeInViewport();
  const sendButton = page.getByRole('button', { name: 'Send message' });
  await sendButton.scrollIntoViewIfNeeded();
  const sendBox = await sendButton.boundingBox();
  expect(sendBox!.y).toBeGreaterThanOrEqual(0); expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`synthetic-project-short-${width}.png`) });
  if (width === 430) {
    await page.getByRole('button', { name: 'Open Artifact Studio' }).click();
    await page.getByText('Create with Jarvis', { exact: true }).first().click();
    const form = page.getByRole('form', { name: 'Create with Jarvis' });
    await form.getByLabel('Title').fill('SYNTHETIC generated note');
    await form.getByLabel('Instructions', { exact: true }).fill('SYNTHETIC artifact request');
    await form.getByRole('button', { name: 'Create with Jarvis' }).click();
    await expect.poll(() => admissions.length).toBe(1);
    await page.getByRole('button', { name: 'Close artifacts' }).click();
  } else await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Retry same intent' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry same intent' }).click();
  await expect.poll(() => admissions.length).toBe(2);
  expect(admissions[1]).toEqual(admissions[0]);
  expect(admissions[0]!.input).toContain('Standing instructions:\nUse only SYNTHETIC data.');
  if (width === 430) expect(String(admissions[0]!.input)).toContain('SYNTHETIC artifact request');
  else expect(String(admissions[0]!.input)).toMatch(/\[Message\]\nSYNTHETIC message$/);
  expect(admissions[0]).not.toHaveProperty('projectId');
  room = { ...room, instructions: 'SYNTHETIC changed after admission' };
  await page.reload();
  await expect(page.getByText(/Original project: room_/)).toContainText(pid);
  await expect(page.getByText('Original message unavailable after reload; no message was retransmitted.')).toBeVisible();
  expect(admissions).toHaveLength(2);
  expect(creates).toBe(1); expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

for (const change of ['archived', 'removed', 'stale', 'unavailable', 'unchanged']) test(`SYNTHETIC failed-generation Retry checks ${change} project context before a new admission`, async ({ page }) => {
  const originalRoom = { id: pid, name: 'SYNTHETIC retry project', goal: 'Retry isolation', instructions: 'Original SYNTHETIC instructions', repository: '', notes: [], sessionIds: [sid], lastSessionId: sid };
  const originalPrompt = '[Project context — saved in Command]\nProject: SYNTHETIC retry project\nGoal: Retry isolation\nStanding instructions:\nOriginal SYNTHETIC instructions\nReference files remain in Command; file bytes are not included in this message.\n[/Project context]\n\n[Message]\nSYNTHETIC artifact generation request';
  const pending = { version: 1, sourceRequestId: 'gen_' + 'a'.repeat(32), sessionId: sid, projectId: pid, title: 'SYNTHETIC failed artifact', artifactType: 'markdown', prompt: originalPrompt, clientRequestId: '11111111-1111-4111-8111-111111111111', publicRunId: null, createdAt: new Date().toISOString(), state: 'failed', message: 'SYNTHETIC failed generation' };
  await page.addInitScript(({ pending, pid }) => {
    sessionStorage.setItem('jarvis-command:artifact-generation:v1', JSON.stringify(pending));
    sessionStorage.setItem('jarvis-command:project-room:v1', pid);
  }, { pending, pid });
  let reads = 0;
  const admissions: Record<string, unknown>[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'SYNTHETIC generation Retry', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'artifact_studio'], readinessChecks: {} }, sessions: [session] });
    if (path === '/api/notifications') return route.fulfill({ json: emptyInbox });
    if (path === '/api/rooms') {
      reads++;
      if (reads > 1 && change === 'unavailable') return route.fulfill({ status: 503, json: {} });
      const room = reads === 1 ? originalRoom : change === 'archived' ? { ...originalRoom, archived: true } : change === 'removed' ? { ...originalRoom, sessionIds: [], lastSessionId: null } : change === 'stale' ? { ...originalRoom, instructions: 'Changed SYNTHETIC instructions' } : originalRoom;
      return json({ version: 1, rooms: [room] });
    }
    if (path === `/api/live/sessions/${sid}`) return json({ session });
    if (path.endsWith('/messages')) return json({ sessionId: sid, messages: [], pagination: { limit: 50, offset: 0, returned: 0, hasMore: false } });
    if (path.endsWith('/context')) return json({ sessionId: sid, state: 'unavailable', receipt: null, updatedAt: null });
    if (path === '/api/live/model-options') return json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'SYNTHETIC Sol', reasoningEfforts: ['medium'] }] });
    if (path === '/api/live/session-controls') return json({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
    if (path === '/api/artifacts') return json({ artifacts: [] });
    if (path === '/api/live/runs') { admissions.push(route.request().postDataJSON()); return route.abort(); }
    throw Error(`Unexpected synthetic request: ${path}`);
  });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled();
  await page.getByRole('button', { name: 'Open Artifact Studio' }).click();
  await page.getByText('Create with Jarvis', { exact: true }).first().click();
  const form = page.getByRole('form', { name: 'Create with Jarvis' });
  await form.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  if (change === 'unchanged') {
    await expect.poll(() => admissions.length).toBe(1);
    expect(admissions[0]!.input).toBe(originalPrompt);
    expect(admissions[0]!.clientRequestId).not.toBe(pending.clientRequestId);
    expect(String(admissions[0]!.input).match(/\[Project context/g)).toHaveLength(1);
  } else {
    await expect(page.getByRole('alert', { name: 'Artifact request refused' })).toBeVisible();
    expect(admissions).toHaveLength(0);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('jarvis-command:artifact-generation:v1')!))).toEqual(pending);
    if (change === 'stale') {
      await form.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect.poll(() => reads).toBe(3);
      await expect(page.getByRole('alert', { name: 'Artifact request refused' })).toContainText('Saved context differs from this failed request');
      expect(admissions).toHaveLength(0);
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('jarvis-command:artifact-generation:v1')!))).toEqual(pending);
    }
  }
});
