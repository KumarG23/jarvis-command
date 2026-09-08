import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const state = '/home/neal/code/jarvis-command-candidate-state';
const auth = JSON.parse(await readFile(state + '/bff/browser-auth.json', 'utf8'));
const probe = JSON.parse(await readFile(state + '/probe.json', 'utf8'));
const guard = state + '/browser-acceptance.json';
// Do not replay uncertain UI admissions on harness restart.
try { await readFile(guard); throw new Error('Existing browser attempt: reconcile it before replay'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const evidence: Record<string, unknown> = { sessionId: probe.session.id, started: true, runs: [] };
await writeFile(guard, JSON.stringify(evidence, null, 2), { mode: 0o600 });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-access-jwt-assertion': auth.assertion } });
try {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const bootstrapResponse = page.waitForResponse(r => r.url().endsWith('/api/bootstrap'));
  await page.goto(auth.origin + '/api/preview/chat-first/');
  const bootstrap = await (await bootstrapResponse).json();
  expect(bootstrap.hermes.state, JSON.stringify(bootstrap.hermes.readinessChecks)).toBe('online');
  const historyResponse = page.waitForResponse(r => r.url().includes('/messages?'));
  await page.getByRole('navigation', { name: 'Recent chats', exact: true }).getByRole('button', { name: probe.session.title, exact: true }).click();
  const initialHistory = await historyResponse;
  expect(initialHistory.status()).toBe(200);
  expect((await initialHistory.json()).pagination.hasMore).toBe(false);
  await expect(page.getByText('Loading messages…', { exact: true })).toHaveCount(0);
  await expect(page.getByText('CANDIDATE_HISTORY_OK', { exact: true })).toHaveCount(1);
  for (let index = 0; index < 2; index++) {
    await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled();
    evidence.pendingIndex = index;
    await writeFile(guard, JSON.stringify(evidence, null, 2));
    await page.getByRole('textbox', { name: 'Message Jarvis' }).fill('Use terminal to execute sleep 12 (harmless synchronization fixture). Then reply exactly CANDIDATE_HISTORY_OK with no other final text.');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    const [admissionResponse] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/live/runs') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Send message', exact: true }).click(),
    ]);
    expect(admissionResponse.ok()).toBe(true);
    const admitted = await admissionResponse.json();
    const entry: Record<string, unknown> = { admitted };
    (evidence.runs as unknown[]).push(entry);
    entry.storage = await page.evaluate(() => ({ ...sessionStorage }));
    await writeFile(guard, JSON.stringify(evidence, null, 2));
    const getStatus = () => page.evaluate(async id => (await fetch('/api/live/runs/' + id, { headers: { 'x-jarvis-history-binding': '1' } })).json(), admitted.publicRunId);
    await expect.poll(async () => (await getStatus()).status, { timeout: 30000 }).toBe('running');
    entry.beforeReload = await getStatus();
    await page.reload();
    await expect.poll(async () => (await getStatus()).status, { timeout: 180000, intervals: [1000] }).toBe('completed');
    const terminal = await getStatus();
    expect(terminal.output).toBe('CANDIDATE_HISTORY_OK');
    expect(terminal.historyBinding).toBeDefined();
    await expect(page.getByText('CANDIDATE_HISTORY_OK', { exact: true })).toHaveCount(index + 2, { timeout: 20000 });
    const history = await page.evaluate(async id => (await fetch('/api/sessions/' + id + '/messages?limit=50&offset=0')).json(), admitted.sessionId);
    const answers = history.messages.filter((m: any) => m.role === 'assistant' && m.content === 'CANDIDATE_HISTORY_OK');
    expect(answers).toHaveLength(index + 2);
    expect(answers.some((m: any) => m.id === '2')).toBe(true);
    expect(answers.at(-1).id).toBe(terminal.historyBinding.assistantMessageId);
    entry.terminal = terminal; entry.answerIds = answers.map((m: any) => m.id); entry.renderedCount = await page.getByText('CANDIDATE_HISTORY_OK', { exact: true }).count();
    await writeFile(guard, JSON.stringify(evidence, null, 2));
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: state + '/history-reload-desktop.png', fullPage: true });
  evidence.passed = true;
  console.log(JSON.stringify(evidence, null, 2));
} catch (e) {
  evidence.error = String(e);
  throw e;
} finally {
  await writeFile(guard, JSON.stringify(evidence, null, 2));
  await context.close(); await browser.close();
}
