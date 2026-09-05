import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

it('gracefully closes the composed BFF on SIGTERM instead of default signal termination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jc-lifecycle-'));
  const allocator = createServer();
  allocator.listen(0, '127.0.0.1');
  await once(allocator, 'listening');
  const address = allocator.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback address');
  await new Promise<void>((resolve) => allocator.close(() => resolve()));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test', AUTH_MODE: 'development', HOST: '127.0.0.1', PORT: String(address.port),
      APP_VERSION: '0.2.0-lifecycle-test', HERMES_READ_PROXY_KEY: 'r'.repeat(40),
      COMMAND_MODE: 'enabled', PUBLIC_ORIGIN: 'https://command.example',
      HERMES_COMMAND_PROXY_KEY: 'c'.repeat(40), HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:1',
      COMMAND_AUDIT_LOG_PATH: join(directory, 'audit.jsonl'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const exited = once(child, 'exit');
  try {
    const deadline = Date.now() + 8_000;
    while (true) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('BFF failed to start: ' + output);
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
        expect(await response.json()).toMatchObject({ version: '0.2.0-lifecycle-test' });
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
