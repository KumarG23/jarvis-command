import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import process from 'node:process';

const image = `sha256:${'a'.repeat(64)}`;
const real = JSON.parse(await readFile('deploy/fixtures/app-supervisor-real.json', 'utf8'));
const audit = '/var/lib/jarvis-command/audit';
const protectedMounts = [
  ['/var/lib/jarvis-command/cloudflare-jwks', '/run/jarvis-command/cloudflare-jwks'],
  ['/srv/jarvis-command/public/.well-known', '/app/apps/web/dist/.well-known'],
];
test('real notification transport and bounded descendant teardown', () => {
  const result = spawnSync('/usr/bin/python3', ['deploy/app_command_supervisor_test.py'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
async function scenario(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jc-app-supervisor-'));
  try {
    // Source-copy seam only. No production path or executable can reach Docker.
    let source = await readFile('deploy/supervised-command-app.py', 'utf8');
    const paths = {
      '/usr/bin/docker': `${root}/docker`, '/usr/bin/systemd-notify': `${root}/notify`,
      '/usr/local/libexec/jarvis-command-prepare-audit-storage': `${root}/helper`,
      '/srv/jarvis-command/compose.yaml': `${root}/base.yaml`,
      '/srv/jarvis-command/app-command-storage.compose.yaml': `${root}/storage.yaml`,
      '/etc/jarvis-command/release.env': `${root}/release.env`,
      '/etc/jarvis-command/app.env': `${root}/app.env`,
      '/var/lib/jarvis-command-supervisor': root,
    };
    for (const [from, to] of Object.entries(paths)) source = source.replaceAll(from, to);
    source = source.replace('TRUST_ROOT = "/"', `TRUST_ROOT = ${JSON.stringify(root)}`)
      .replace('TRUST_UID = 0', `TRUST_UID = ${process.getuid()}`)
      .replace('MONITOR_SECONDS = 5', 'MONITOR_SECONDS = 0');
    await writeFile(join(root, 'runner.py'), source);
    await writeFile(join(root, 'base.yaml'), 'services: {}\n');
    await writeFile(join(root, 'storage.yaml'), options.storage ?? await readFile('deploy/app-command-storage.compose.yaml', 'utf8'));
    const env = { COMMAND_MODE: 'enabled', COMMAND_AUDIT_LOG_PATH: `${audit}/events.jsonl`, SYNTHETIC_KEY: 'never-print-fixture-secret' };
    await writeFile(join(root, 'app.env'), options.env ?? Object.entries(env).map(([k,v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
    await writeFile(join(root, 'release.env'), `JARVIS_COMMAND_APP_IMAGE=${image}\n`, { mode: 0o600 });
    const volumes = [...protectedMounts.map(([s,t]) => ({ type: 'bind', source: s, target: t, read_only: true, bind: { create_host_path: true } })), { type: 'bind', source: audit, target: audit, read_only: false, bind: { create_host_path: false } }];
    const config = { services: { app: { ...real.compose.services.app, image, container_name: 'jarvis-command-app', user: '10001:10001', read_only: true, environment: env, volumes } } };
    options.config?.(config.services.app);
    const state = { ...JSON.parse(JSON.stringify(real.created)), Id: 'c'.repeat(64), Image: image, State: { Status: 'created', Running: true, Health: { Status: 'healthy' } }, Config: { ...real.created.Config, User: '10001:10001', Labels: { 'com.docker.compose.project': 'jarvis-command-supervised', 'com.docker.compose.service': 'app' }, Env: [...real.image.Config.Env, ...Object.entries(env).map(([k,v]) => `${k}=${v}`)] }, HostConfig: { ...real.created.HostConfig, NetworkMode: 'host' }, NetworkSettings: { Ports: {}, Networks: { host: { Aliases: null, Links: null, DriverOpts: null, IPAMConfig: null } } }, Mounts: volumes.map(v => ({ Type: 'bind', Source: v.source, Destination: v.target, RW: !v.read_only, Propagation: 'rprivate' })) };
    options.inspect?.(state);
    const later = JSON.parse(JSON.stringify(state));
    later.State.Health.Status = 'unhealthy';
    options.later?.(later);
    await writeFile(join(root, 'config.json'), JSON.stringify(config));
    await writeFile(join(root, 'image.json'), JSON.stringify([{ ...real.image, Id: image }]));
    await writeFile(join(root, 'inspect.json'), JSON.stringify([state]));
    await writeFile(join(root, 'later.json'), JSON.stringify([later]));
    const executable = (name, body) => writeFile(join(root, name), `#!/usr/bin/python3\nimport os,sys,json,signal\nfrom pathlib import Path\nr=Path(${JSON.stringify(root)})\nwith (r/'calls').open('a') as f: f.write(${JSON.stringify(name)}+' '+ ' '.join(sys.argv[1:])+'\\n')\n${body}\n`, { mode: 0o700 });
    await executable('helper', `assert sys.argv[1:]==['verify','--trusted-root','/var/lib/jarvis-command','--path','${audit}/events.jsonl']\nsys.exit(${options.helperStatus ?? 0})`);
    await executable('notify', `${options.competitor ? `import subprocess\nother=subprocess.run(['/usr/bin/python3',str(r/'runner.py'),'--monitor'],env={'INVOCATION_ID':'2'*32},capture_output=True,timeout=2)\nassert other.returncode==1\nassert b'invocation refused' in other.stderr` : 'pass'}\n${options.monitorSignal ? `os.kill(os.getppid(),signal.SIG${options.monitorSignal})` : 'pass'}\n${options.sourceDrift ? `(r/'base.yaml').write_text('changed')` : 'pass'}\nsys.exit(${options.notifyStatus ?? 0})`);
    await executable('docker', `a=sys.argv[1:]
if a[0]=='image': print('${image}' if '--format' in a else (r/'image.json').read_text())
elif a[0]=='info': print('${JSON.stringify({ OSType: 'linux', CgroupVersion: '2', OomKillDisable: false })}')
elif a[0]=='compose':
 if 'config' in a: print((r/'config.json').read_text())
 else:
  assert 'create' in a
  assert not (r/'created').exists()
  for marker in ['started','stopped','healthy-inspected','cleanup-inspected']:
   (r/marker).unlink(missing_ok=True)
  (r/'project').write_text(a[a.index('--project-name')+1])
  (r/'created').touch()
  ${options.createEmpty ? "(r/'created').unlink()" : 'pass'}
  ${options.createKill ? 'os.kill(os.getppid(),signal.SIGKILL)' : 'pass'}
elif a[0]=='start':
 assert json.loads((r/'ownership.json').read_text())['id']==a[1]
 (r/'started').touch()
 ${options.signal ? `os.kill(os.getppid(),signal.SIG${options.signal})` : 'pass'}
 sys.exit(${options.startStatus ?? 0})
elif a[0]=='ps':
 if ${options.daemonFails ? 'True' : 'False'} and (r/'stopped').exists(): sys.exit(32)
 if ${options.running ? 'True' : 'False'} or (${options.oldStopped ? 'True' : 'False'} and '--all' in a) or (r/'created').exists(): print('${'c'.repeat(64)}')
elif a[0]=='inspect':
 later=(r/'healthy-inspected').exists() and not (r/'cleanup-inspected').exists()
 p=r/('later.json' if later else 'inspect.json')
 s=json.loads(p.read_text())[0]
 s['Config']['Labels']['com.docker.compose.project']=(r/'project').read_text()
 if (r/'started').exists(): (r/'healthy-inspected').touch()
 if (r/'started').exists() and ${options.oomNull ? 'True' : 'False'}: s['HostConfig']['OomKillDisable']=None
 if later: (r/'cleanup-inspected').touch()
 if (r/'stopped').exists(): s['State']['Running']=False
 if (r/'stopped').exists() and ${options.delayedStart ? 'True' : 'False'}: s['State']['Running']=True
 if not (r/'started').exists(): s['State']['Running']=False
 if ${options.starting ? 'True' : 'False'} and (r/'started').exists() and not (r/'starting-sampled').exists():
  (r/'starting-sampled').touch()
  s['State']['Health']['Status']='starting'
  ${options.startingDrift ? "s['HostConfig']['Memory']=0" : 'pass'}
 print(json.dumps([s]))
elif a[0]=='stop':
 assert a[1]=='${'c'.repeat(64)}'
 if ${options.stopFails ? 'True' : 'False'}: sys.exit(31)
 (r/'stopped').touch()
elif a[0]=='rm':
 assert a==['rm','--force','${'c'.repeat(64)}']
 if ${options.removeFails ? 'True' : 'False'}: sys.exit(33)
 (r/'created').unlink()
else: sys.exit(98)`);
    const result = spawnSync('/usr/bin/python3', [join(root, 'runner.py'), ...(options.args ?? ['--monitor'])], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', INVOCATION_ID: '1'.repeat(32), ...(options.ambient ?? {}) } });
    let cleanup;
    if (options.cleanup) {
      if (options.tamper) {
        const record = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'));
        options.tamper(record);
        await writeFile(join(root, 'ownership.json'), JSON.stringify(record));
      }
      cleanup = spawnSync('/usr/bin/python3', [join(root, 'runner.py'), '--cleanup'], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', INVOCATION_ID: options.cleanupInvocation ?? '1'.repeat(32) } });
    }
    let second;
    if (options.repeat) second = spawnSync('/usr/bin/python3', [join(root, 'runner.py'), '--monitor'], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', INVOCATION_ID: '3'.repeat(32) } });
    const record = await readFile(join(root, 'ownership.json'), 'utf8').catch(() => null);
    const calls = await readFile(join(root, 'calls'), 'utf8').catch(() => '');
    return { ...result, calls, cleanup, second, record };
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const options of [{}, { monitorSignal: 'TERM' }, { startStatus: 17 }]) {
  test(`owned cleanup releases name for second invocation ${JSON.stringify(options)}`, async () => {
    const r = await scenario({ ...options, repeat: true });
    assert.equal((r.calls.match(/docker start /g) ?? []).length, 2, r.second.stderr);
    assert.equal((r.calls.match(/docker rm --force [c]{64}/g) ?? []).length, 2);
    assert.equal(r.record, null);
  });
}

test('starting-health hardening drift is refused before READY', async () => {
  const r = await scenario({ starting: true, startingDrift: true, later: s => { s.State.Health.Status = 'healthy'; }, monitorSignal: 'TERM' });
  assert.equal(r.error, undefined);
  assert.doesNotMatch(r.calls, /notify --ready/);
  assert.match(r.calls, /docker rm --force [c]{64}/);
  assert.equal(r.record, null);
});

test('starting-health with intact policy advances to READY', async () => {
  const r = await scenario({ starting: true, later: s => { s.State.Health.Status = 'healthy'; }, monitorSignal: 'TERM' });
  assert.equal(r.error, undefined);
  assert.equal(r.status, 143, r.stderr);
  assert.match(r.calls, /notify --ready/);
  assert.equal(r.record, null);
});

test('cgroup2 CREATE false to START null preserves readiness and repeated monitoring checks', async () => {
  const r = await scenario({ oomNull: true });
  assert.equal(r.error, undefined);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /unhealthy/);
  assert.match(r.calls, /notify --ready/);
  assert.ok((r.calls.match(/docker info --format/g) ?? []).length >= 3);
  assert.match(r.calls, /docker rm --force [c]{64}/);
  assert.equal(r.record, null);
});

test('supervised app opt-in verifies existing ledger before exact compose start and monitors without re-verifying ledger', async () => {
  const r = await scenario();
  assert.equal(r.error, undefined);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /unhealthy/);
  assert.match(r.calls, /helper verify/);
  assert.ok(r.calls.indexOf('helper verify') < r.calls.indexOf(' create '));
  assert.equal((r.calls.match(/helper verify/g) ?? []).length, 1);
  assert.match(r.calls, /notify --ready/);
  assert.match(r.calls, /docker stop [c]{64}/);
  assert.doesNotMatch(r.stdout + r.stderr + r.calls, /never-print-fixture-secret|helper prepare/);
  const compose = r.calls.split('\n').filter(x => x.startsWith('docker compose'));
  assert.equal(compose.length, 2);
  for (const line of compose) assert.match(line, /-f \S+\/base.yaml -f \S+\/storage.yaml/);
});

for (const [name, options, ready] of [
  ['missing ledger', { helperStatus: 19 }, false],
  ['unsafe ledger', { helperStatus: 23 }, false],
  ['already running', { running: true }, false],
  ['absent mode', { env: `COMMAND_AUDIT_LOG_PATH=${audit}/events.jsonl\n` }, false],
  ['disabled mode', { env: 'COMMAND_MODE=disabled\n' }, false],
  ['duplicate mode', { env: 'COMMAND_MODE=enabled\nCOMMAND_MODE=disabled\n' }, false],
  ['shell env', { env: 'COMMAND_MODE=$(touch /NOT-EXECUTED)\n' }, false],
  ['ambient compose', { ambient: { COMPOSE_FILE: '/NOT-USED' } }, false],
  ['arbitrary override CLI', { args: ['--storage', '/NOT-USED'] }, false],
  ['missing override mount', { storage: 'services: {}\n' }, false],
  ['duplicate override input', { storage: (await readFile('deploy/app-command-storage.compose.yaml', 'utf8')) + '        read_only: true\n' }, false],
  ['config UID', { config: s => { s.user = '0:0'; } }, false],
  ['config rootfs', { config: s => { s.read_only = false; } }, false],
  ['config mount', { config: s => { s.volumes[2].source = '/tmp'; } }, false],
  ['config create host', { config: s => { s.volumes[2].bind.create_host_path = true; } }, false],
  ['duplicate effective mount', { config: s => { s.volumes.push(s.volumes[2]); } }, false],
  ['config env contradicts', { config: s => { s.environment.COMMAND_MODE = 'disabled'; } }, false],
  ['inspect UID', { inspect: s => { s.Config.User = '0:0'; } }, false],
  ['inspect rootfs', { inspect: s => { s.HostConfig.ReadonlyRootfs = false; } }, false],
  ['inspect audit RW', { inspect: s => { s.Mounts[2].RW = false; } }, false],
  ['inspect protected RW', { inspect: s => { s.Mounts[0].RW = true; } }, false],
  ['mount drift', { later: s => { s.Mounts[2].Source = '/tmp'; s.State.Health.Status = 'healthy'; } }, true],
  ['notify failure', { notifyStatus: 27 }, true],
  ['compose failure', { startStatus: 17 }, false],
]) {
  test(`supervised app refuses ${name}`, async () => {
    const r = await scenario(options);
    assert.equal(r.error, undefined);
    assert.notEqual(r.status, 0, r.stderr);
    assert.equal(r.calls.includes('notify --ready'), ready, r.calls);
    assert.doesNotMatch(r.stdout + r.stderr, /never-print-fixture-secret/);
    if (options.helperStatus) assert.equal(r.status, options.helperStatus);
    if (options.startStatus) assert.equal(r.status, options.startStatus);
    if (options.notifyStatus) assert.equal(r.status, options.notifyStatus);
    if (r.calls.includes('docker start ')) {
      assert.match(r.calls, /docker stop [c]{64}/);
      assert.match(r.stderr, /owned candidate removed and absence verified/);
    } else if (!r.calls.includes(' create ')) assert.doesNotMatch(r.calls, /docker stop/);
    if (options.running) assert.doesNotMatch(r.calls, /helper verify| create /);
    if (options.helperStatus) assert.doesNotMatch(r.calls, / create /);
  });
}

for (const [signal, code] of [['HUP', 129], ['INT', 130], ['TERM', 143]]) {
  test(`supervised app ${signal} monitor cleanup`, async () => {
    const r = await scenario({ monitorSignal: signal });
    assert.equal(r.status, code, r.stderr);
    assert.match(r.calls, /notify --ready/);
    assert.match(r.stderr, /owned candidate removed and absence verified/);
  });
  test(`supervised app ${signal} startup cleanup`, async () => {
    const r = await scenario({ signal });
    assert.equal(r.status, code, r.stderr);
    assert.match(r.stderr, /owned candidate removed and absence verified/);
    assert.doesNotMatch(r.calls, /notify --ready/);
  });
}

test('supervised app explicit one-shot opt-in succeeds without notification', async () => {
  const r = await scenario({ args: [] });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.calls, /docker stop|notify --ready/);
});

test('old stopped same-label container on failed start is never adopted', async () => {
  const r = await scenario({ startStatus: 17, oldStopped: true });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.calls, /docker stop/);
});

test('supervised source drift stops owned candidate', async () => {
  const r = await scenario({ sourceDrift: true });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /source configuration drift/);
  assert.match(r.stderr, /owned candidate removed and absence verified/);
});

test('competing real launcher refuses before helper or Compose mutation', async () => {
  const r = await scenario({ competitor: true });
  assert.equal(r.status, 1);
  assert.equal((r.calls.match(/helper verify/g) ?? []).length, 1);
  assert.equal((r.calls.match(/docker start /g) ?? []).length, 1);
  assert.equal((r.calls.match(/docker stop /g) ?? []).length, 1);
});

test('SIGKILL after create discovers only fresh stopped candidate and removes it', async () => {
  const r = await scenario({ createKill: true, cleanup: true });
  assert.equal(r.signal, 'SIGKILL');
  assert.equal(r.cleanup.status, 0, r.cleanup.stderr);
  assert.doesNotMatch(r.calls, /docker start|docker stop/);
  assert.match(r.calls, /docker rm --force [c]{64}/);
  assert.equal(r.record, null);
});

test('inflight create with no discoverable ID retains blocking intent', async () => {
  const r = await scenario({ createKill: true, createEmpty: true, cleanup: true });
  assert.equal(r.signal, 'SIGKILL');
  assert.equal(r.cleanup.status, 1);
  assert.notEqual(r.record, null);
  assert.doesNotMatch(r.calls, /docker start|docker stop|docker rm/);
});

test('SIGKILL after actual mock start recovers through a separate cleanup process', async () => {
  const r = await scenario({ signal: 'KILL', cleanup: true });
  assert.equal(r.signal, 'SIGKILL');
  assert.equal(r.cleanup.status, 0, r.cleanup.stderr);
  assert.match(r.calls, /docker stop [c]{64}/);
  assert.doesNotMatch(r.calls, /notify --ready/);
});

for (const [name, options] of [
  ['other invocation', { cleanupInvocation: '2'.repeat(32) }],
  ['token', { tamper: r => { r.token = 'f'.repeat(32); } }],
  ['image', { tamper: r => { r.image = `sha256:${'f'.repeat(64)}`; } }],
  ['ID', { tamper: r => { r.id = 'd'.repeat(64); } }],
  ['schema', { tamper: r => { r.extra = true; } }],
]) {
  test(`crash cleanup refuses ${name} mismatch without a stop`, async () => {
    const r = await scenario({ signal: 'KILL', cleanup: true, ...options });
    assert.equal(r.signal, 'SIGKILL');
    assert.equal(r.cleanup.status, 1);
    assert.doesNotMatch(r.calls, /docker stop/);
  });
}

test('failed cleanup retains failure instead of claiming stopped', async () => {
  const r = await scenario({ monitorSignal: 'TERM', stopFails: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cleanup could not be verified/);
  assert.doesNotMatch(r.stderr, /stopped and verified/);
});

test('daemon start completing after stop cannot defeat exact removal', async () => {
  const r = await scenario({ monitorSignal: 'TERM', delayedStart: true, repeat: true });
  assert.equal(r.record, null);
  assert.equal((r.calls.match(/docker rm --force [c]{64}/g) ?? []).length, 2);
  assert.equal((r.calls.match(/docker start /g) ?? []).length, 2);
});

for (const options of [{ removeFails: true }, { daemonFails: true }]) {
  test(`cleanup ambiguity retains ownership ${JSON.stringify(options)}`, async () => {
    const r = await scenario({ ...options, monitorSignal: 'TERM', cleanup: true });
    assert.equal(r.status, 1);
    assert.notEqual(r.cleanup.status, 0);
    assert.notEqual(r.record, null);
    assert.doesNotMatch(r.stderr, /absence verified/);
  });
}

for (const [name, config, inspect] of [
  ['privilege', s => { s.privileged = true; }, s => { s.HostConfig.Privileged = true; }],
  ['network', s => { s.network_mode = 'bridge'; }, s => { s.HostConfig.NetworkMode = 'bridge'; }],
  ['resource', s => { s.mem_limit = '0'; }, s => { s.HostConfig.Memory = 0; }],
  ['process', s => { s.command = ['sh']; }, s => { s.Config.Cmd = ['sh']; }],
  ['health', s => { s.healthcheck = { disable: true }; }, s => { s.Config.Healthcheck = { Test: ['NONE'] }; }],
]) {
  test(`hardening ${name} refuses before CREATE or START and monitors drift`, async () => {
    const effective = await scenario({ config });
    assert.doesNotMatch(effective.calls, / create |docker start|notify --ready/);
    const created = await scenario({ inspect });
    assert.doesNotMatch(created.calls, /docker start|notify --ready/);
    assert.match(created.calls, /docker rm --force [c]{64}/);
    assert.equal(created.record, null);
    const drift = await scenario({ later: s => { s.State.Health.Status = 'healthy'; inspect(s); } });
    assert.match(drift.calls, /notify --ready/);
    assert.match(drift.calls, /docker rm --force [c]{64}/);
    assert.equal(drift.record, null);
  });
}

test('actual container ID drift never redirects cleanup to replacement', async () => {
  const r = await scenario({ later: s => { s.Id = 'd'.repeat(64); s.State.Health.Status = 'healthy'; } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /immutable identity mismatch/);
  assert.match(r.calls, /docker stop [c]{64}/);
  assert.doesNotMatch(r.calls, /docker stop [d]{64}/);
});
