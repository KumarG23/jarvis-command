import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADAPTERS } from './adapters';

it('launches agy with its official prompt and resume flags', () => {
  expect(ADAPTERS.agy.argv({ shell: '/bin/bash', prompt: 'fix the tests' })).toEqual(['agy', '--prompt-interactive', 'fix the tests']);
  expect(ADAPTERS.agy.argv({ shell: '/bin/bash', resume: 'conv-1' })).toEqual(['agy', '--conversation', 'conv-1']);
  expect(ADAPTERS.agy.argv({ shell: '/bin/bash' })).toEqual(['agy']);
});

it('refuses agy when its settings hold a Google API key', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agy-'));
  try {
    expect(await ADAPTERS.agy.preflight!(home, { HOME: home })).toBeNull();
    mkdirSync(join(home, '.gemini', 'antigravity-cli'), { recursive: true });
    const settings = join(home, '.gemini', 'antigravity-cli', 'settings.json');
    writeFileSync(settings, JSON.stringify({ theme: 'dark' }));
    expect(await ADAPTERS.agy.preflight!(home, { HOME: home })).toBeNull();
    writeFileSync(settings, JSON.stringify({ modelProvider: 'gemini', apiKey: `AIza${'x'.repeat(35)}` }));
    expect(await ADAPTERS.agy.preflight!(home, { HOME: home })).toContain('bills the Gemini API');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
