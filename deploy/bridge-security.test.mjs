import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { URL } from 'node:url';

const source = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('bridge key validation precedes every installer mutation in private mocks', () => {
  const result = spawnSync('python3', [new URL('bridge_key_test.py', import.meta.url).pathname], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('bridge requests exactly the two restricted loopback paths with isolated identity', () => {
  const unit = source('jarvis-command-bridge.service');
  assert.deepEqual([...unit.matchAll(/-R ([^\s]+)/g)].map((match) => match[1]), [
    '127.0.0.1:18642:127.0.0.1:8643', '127.0.0.1:18643:127.0.0.1:8647',
  ]);
  for (const option of ['IdentitiesOnly=yes', 'BatchMode=yes', 'ExitOnForwardFailure=yes',
    'ServerAliveInterval=30', 'ServerAliveCountMax=3', 'StrictHostKeyChecking=yes',
    'UserKnownHostsFile=/etc/jarvis-command/app_known_hosts', 'GlobalKnownHostsFile=/dev/null']) {
    assert.ok(unit.includes(`-o ${option}`), option);
  }
  assert.match(unit, /ssh -F \/dev\/null -NT/);
  assert.doesNotMatch(unit, /\s-[LDW]\s/);
  const config = source('sshd-jarvis-bridge.conf');
  assert.deepEqual(config.match(/^Match .*$/gm), ['Match User jarvis-bridge']);
  assert.match(config, /^ {4}PermitListen 127\.0\.0\.1:18642 127\.0\.0\.1:18643$/m);
  for (const line of ['AuthenticationMethods publickey', 'PasswordAuthentication no',
    'KbdInteractiveAuthentication no', 'PermitTTY no', 'X11Forwarding no',
    'AllowAgentForwarding no', 'AllowTcpForwarding remote', 'AllowStreamLocalForwarding no', 'GatewayPorts no',
    'PermitOpen none', 'PermitUserRC no', 'MaxSessions 0']) assert.ok(config.includes(`    ${line}\n`), line);
});
