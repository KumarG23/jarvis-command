import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const state = '/home/neal/code/jarvis-command-candidate-state';
const auth = JSON.parse(await readFile(state + '/bff/browser-auth.json', 'utf8'));
const probe = JSON.parse(await readFile(state + '/probe.json', 'utf8'));
const guard = state + '/metadata-acceptance.json';
const verifyOnly = process.argv.includes('--verify-only');
const resume = process.argv.includes('--resume');
const expected = { name: 'FIXTURE ONLY edited history project', goal: 'Exact edited metadata persists without changing chat identity.', repository: '/fixtures/reference-only', notes: ['fixture/history-note.md', 'fixture/second-note.md'] };
const evidence: Record<string, any> = (verifyOnly || resume) ? JSON.parse(await readFile(guard, 'utf8')) : { expected, sessionId: probe.session.id };
if (!verifyOnly && !resume) {
  try { await readFile(guard); throw Error('Reconcile existing metadata attempt before replay'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  await writeFile(guard, JSON.stringify(evidence, null, 2), { mode: 0o600 });
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-access-jwt-assertion': auth.assertion } });
try {
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(auth.origin + '/api/preview/chat-first/');
  const getRoom = () => page.evaluate(async id => {
    const r = await fetch('/api/rooms'); if (!r.ok) throw Error('room read failed ' + r.status);
    return (await r.json()).rooms.find((room: any) => room.id === id);
  }, evidence.roomId);
  if (!verifyOnly) {
    if (!resume) {
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('FIXTURE ONLY initial history project');
    await page.getByLabel('Project goal').fill('Fixture metadata acceptance');
    const [created] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/rooms') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Create project', exact: true }).click()]);
    expect(created.ok()).toBe(true); evidence.roomId = (await created.json()).room.id;
    await writeFile(guard, JSON.stringify(evidence, null, 2));
    } else {
      const existing = await getRoom();
      expect(existing.name).toBe('FIXTURE ONLY initial history project');
      expect(existing.sessionIds.every((id: string) => id === probe.session.id)).toBe(true);
      await page.getByRole('button', { name: existing.name, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Project details', exact: true }).click();
    if (!(await getRoom()).sessionIds.includes(probe.session.id)) {
    await page.getByRole('combobox').selectOption(probe.session.id);
    const [attached] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/sessions') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Add to project', exact: true }).click()]);
    expect(attached.ok()).toBe(true);
    }
    evidence.before = await getRoom();
    await page.getByRole('button', { name: 'Edit project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill(expected.name);
    await page.getByLabel('Project goal').fill(expected.goal);
    await page.getByLabel('Repository reference', { exact: true }).fill(expected.repository);
    await page.getByLabel('Note references (one per line)').fill(expected.notes.join('\n'));
    const [saved] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/rooms/' + evidence.roomId) && r.request().method() === 'POST'), page.getByRole('button', { name: 'Save changes', exact: true }).click()]);
    expect(saved.status()).toBe(200);
    evidence.saved = (await saved.json()).room;
    expect(await getRoom()).toEqual(evidence.saved);
    await page.reload();
  }
  const room = await getRoom();
  expect(room).toEqual({ ...evidence.before, ...expected });
  await page.getByRole('navigation', { name: 'Projects', exact: true }).getByRole('button', { name: expected.name, exact: true }).click();
  // A same-tab reload restores project selection; re-expand if the click collapsed it.
  const details = page.getByRole('button', { name: 'Project details', exact: true });
  if (!await details.isVisible()) await page.getByRole('button', { name: expected.name, exact: true }).click();
  await details.click();
  await expect(page.getByText(expected.goal, { exact: true })).toBeVisible();
  await expect(page.getByText(expected.repository, { exact: true })).toBeVisible();
  for (const note of expected.notes) await expect(page.getByText(note, { exact: true })).toBeVisible();
  expect(room.sessionIds).toEqual([probe.session.id]); expect(room.lastSessionId).toBe(probe.session.id);
  expect(errors).toEqual([]);
  evidence[verifyOnly ? 'afterBffRestart' : 'afterBrowserReload'] = room;
  evidence[verifyOnly ? 'restartPassed' : 'passed'] = true;
  await page.screenshot({ path: state + '/metadata-' + (verifyOnly ? 'restart' : 'reload') + '.png', fullPage: true });
  console.log(JSON.stringify(evidence, null, 2));
} catch (e) { evidence.error = String(e); const page = context.pages()[0]; if (page) { evidence.failureBody = await page.locator('body').innerText(); await page.screenshot({ path: state + '/metadata-failure.png', fullPage: true }); } throw e; }
finally { await writeFile(guard, JSON.stringify(evidence, null, 2)); await context.close(); await browser.close(); }
