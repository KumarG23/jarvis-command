import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('command compose retains read proxy hardening with an explicit immutable identity', async () => {
  const [read, command] = await Promise.all([source('./read-proxy.compose.yaml'), source('./command-proxy.compose.yaml')]);
  assert.equal(command, read.replaceAll('READ_PROXY', 'COMMAND_PROXY').replaceAll('read-proxy', 'command-proxy').replaceAll('10002', '10003'));
});

test('command systemd lifecycle is equivalent to the read proxy monitor and egress dependency', async () => {
  const [read, command] = await Promise.all([source('./jarvis-command-read-proxy.service'), source('./jarvis-command-command-proxy.service')]);
  assert.equal(command, read.replace('read-only Hermes', 'command Hermes').replaceAll('read-proxy', 'command-proxy'));
  assert.doesNotMatch(command, /systemctl/);
});

test('command deployment explicitly selects loopback 8647 without changing defaults or enabling command mode', async () => {
  const env = await source('./command-proxy.env.example');
  for (const line of ['HOST=127.0.0.1', 'PORT=8647', 'HERMES_API_BASE_URL=http://127.0.0.1:8642', 'MAX_STREAM_SECONDS=1800']) assert.ok(env.split('\n').includes(line));
  assert.match(env, /^COMMAND_PROXY_KEY=GENERATE_/m);
  assert.match(env, /^HERMES_API_KEY=THE_EXISTING_/m);
  assert.match(await source('./release.env.example'), /^JARVIS_COMMAND_COMMAND_PROXY_IMAGE=sha256:REPLACE_WITH_VERIFIED_COMMAND_PROXY_IMAGE_ID$/m);
  assert.match(await source('../apps/command-proxy/src/config.ts'), /default\(8644\)/);
  assert.doesNotMatch(await source('./app.env.example'), /^COMMAND_MODE=enabled$/m);
});

test('egress source adds only the local command path and preserves atomic replacement', async () => {
  const rules = await source('./jarvis-command-egress.nft');
  assert.match(rules, /^delete table inet jarvis_command_egress\n/);
  assert.match(rules, /meta skuid 10001 ip daddr 127\.0\.0\.1 tcp dport \{ 3000, 18642, 18643 \} accept\n {4}meta skuid 10001 reject/);
  assert.match(rules, /meta skuid 10002 ip daddr 127\.0\.0\.1 tcp dport \{ 8642, 8643 \} accept\n {4}meta skuid 10002 reject/);
  assert.match(rules, /meta skuid 10003 ip daddr 127\.0\.0\.1 tcp dport \{ 8642, 8647 \} accept\n {4}meta skuid 10003 reject/);
  assert.doesNotMatch(rules, /flush ruleset/);
});
