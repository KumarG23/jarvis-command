import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('audit bind is explicit opt-in and never automatically creates host storage', () => {
  assert.ok(existsSync('deploy/app-command-storage.compose.yaml'), 'command storage override missing');
  const override = readFileSync('deploy/app-command-storage.compose.yaml', 'utf8');
  assert.match(override, /type: bind/);
  assert.match(override, /source: \/var\/lib\/jarvis-command\/audit/);
  assert.match(override, /target: \/var\/lib\/jarvis-command\/audit/);
  assert.match(override, /create_host_path: false/);
  assert.match(override, /read_only: false/);
  assert.doesNotMatch(override, /COMMAND_MODE: enabled|tmpfs|network_mode/);
  assert.doesNotMatch(readFileSync('deploy/app.compose.yaml', 'utf8'), /\/audit/);
  const env = readFileSync('deploy/app.env.example', 'utf8');
  assert.match(env, /^COMMAND_MODE=disabled$/m);
  assert.match(env, /^PUBLIC_ORIGIN=https:\/\/command\.sharma-house\.com$/m);
  assert.match(env, /^HERMES_COMMAND_API_BASE_URL=http:\/\/127\.0\.0\.1:18643$/m);
  assert.match(env, /^COMMAND_AUDIT_LOG_PATH=\/var\/lib\/jarvis-command\/audit\/events\.jsonl$/m);
});

test('audit provisioning refuses unsafe disposable fixtures without repairing them', () => {
  const run = spawnSync('sudo', ['-n', 'python3', 'deploy/audit_storage_test.py'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
