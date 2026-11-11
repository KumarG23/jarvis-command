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

it('refuses agy when it would spend paid AI credits, and allows it otherwise', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agy-credits-'));
  const bin = join(home, 'bin'); mkdirSync(bin);
  const fake = (config: Record<string, unknown>) => writeFileSync(join(bin, 'agy'), `#!/bin/sh\necho '${JSON.stringify({ status: 'SUCCESS', command: { data: { config } } })}'\n`, { mode: 0o755 });
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
  try {
    fake({ useG1Credits: false });
    expect(await ADAPTERS.agy.preflight!(home, env)).toBeNull();
    fake({ useG1Credits: true });
    expect(await ADAPTERS.agy.preflight!(home, env)).toContain('paid AI credits');
    writeFileSync(join(bin, 'agy'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(await ADAPTERS.agy.preflight!(home, env)).toBeNull();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
