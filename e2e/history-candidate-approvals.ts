import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const state = '/home/neal/code/jarvis-command-candidate-state';
const auth = JSON.parse(await readFile(state + '/bff/browser-auth.json', 'utf8'));
const probe = JSON.parse(await readFile(state + '/probe.json', 'utf8'));
const guard = state + '/approval-acceptance.json';
try { await readFile(guard); throw new Error('Existing approval attempt: reconcile before replay'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const evidence: any = { sessionId: probe.session.id, runs: [], started: true };
const save = () => writeFile(guard, JSON.stringify(evidence, null, 2), { mode: 0o600 });
await save();
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-access-jwt-assertion': auth.assertion } });
try {
  const page = await context.newPage();
  const boot = page.waitForResponse(r => r.url().endsWith('/api/bootstrap'));
  await page.goto(auth.origin + '/api/preview/chat-first/');
  evidence.bootstrap = await (await boot).json();
  expect(evidence.bootstrap.hermes.state).toBe('online');
  await page.getByRole('navigation', { name: 'Recent chats', exact: true }).getByRole('button', { name: probe.session.title, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Jarvis' })).toBeEnabled({ timeout: 20000 });
  for (const choice of ['once', 'deny']) {
    const name = 'approval-' + choice + '-' + crypto.randomUUID();
    const fixture = state + '/fixtures/' + name;
    await mkdir(fixture, { recursive: false });
    await writeFile(fixture + '/owned.txt', 'Owned disposable approval acceptance fixture.\n');
    const command = 'rm -rf /fixtures/' + name;
    const entry: any = { choice, fixture, command, fileBefore: await readFile(fixture + '/owned.txt', 'utf8') };
    evidence.runs.push(entry); await save();
    await page.getByRole('textbox', { name: 'Message Jarvis' }).fill(`This is an authorized isolated approval UI acceptance using my owned disposable fixture only. Use terminal to execute exactly this one command: ${command} . Preserve manual approval; do not change the command or use another tool. If denied, stop without retry or alternate deletion. Report the actual result briefly.`);
    const [admission] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/live/runs') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Send message', exact: true }).click()]);
    expect(admission.ok()).toBe(true);
    entry.admitted = await admission.json(); await save();
    expect(entry.admitted.sessionId).toBe(probe.session.id);
    const status = () => page.evaluate(async id => (await fetch('/api/live/runs/' + id, { headers: { 'x-jarvis-history-binding': '1' } })).json(), entry.admitted.publicRunId);
    await expect(page.getByRole('region', { name: 'Awaiting approval', exact: true })).toBeVisible({ timeout: 120000 });
    entry.pending = await status(); await save();
    expect(entry.pending.publicRunId).toBe(entry.admitted.publicRunId);
    expect(entry.pending.sessionId).toBe(entry.admitted.sessionId);
    expect(entry.pending.approval.command).toContain(command);
    const region = page.getByRole('region', { name: 'Awaiting approval', exact: true });
    await expect(region).toContainText('Request: ' + entry.pending.approval.requestId);
    await expect(region).toContainText('Run: ' + entry.admitted.publicRunId + ' · Session: ' + entry.admitted.sessionId);
    expect(await exists(fixture + '/owned.txt')).toBe(true);
    await page.screenshot({ path: state + '/approval-' + choice + '-pending.png', fullPage: true });
    const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/' + entry.admitted.publicRunId + '/approval') && r.request().method() === 'POST'), region.getByRole('button', { name: choice === 'once' ? 'Approve once' : 'Deny', exact: true }).click()]);
    entry.requestPayload = response.request().postDataJSON();
    entry.ack = await response.json(); await save();
    expect(response.ok()).toBe(true);
    expect(entry.ack).toMatchObject({ publicRunId: entry.admitted.publicRunId, requestId: entry.pending.approval.requestId, choice, resolved: 1 });
    await expect.poll(async () => (await status()).status, { timeout: 180000, intervals: [1000] }).toBe('completed');
    entry.terminal = await status();
    entry.fileExistsAfter = await exists(fixture + '/owned.txt');
    if (choice === 'deny') entry.retainedContent = await readFile(fixture + '/owned.txt', 'utf8');
    await save();
    expect(entry.terminal.publicRunId).toBe(entry.admitted.publicRunId);
    expect(entry.terminal.sessionId).toBe(entry.admitted.sessionId);
    expect(entry.terminal.approval).toBeNull();
    expect(entry.fileExistsAfter).toBe(choice === 'deny');
    await page.screenshot({ path: state + '/approval-' + choice + '-completed.png', fullPage: true });
  }
  evidence.passed = true;
  console.log(JSON.stringify({ passed: true, runs: evidence.runs }, null, 2));
} catch (e) { evidence.error = String(e); throw e; }
finally { await save(); await context.close(); await browser.close(); }
