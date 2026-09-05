#!/usr/bin/env python3
"""Local-only, synthetic command-proxy image acceptance; never touches live services."""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--evidence', type=Path, required=True)
args = parser.parse_args()
args.evidence.mkdir(parents=True, exist_ok=True)
run_id = 'jc-proxy-fixture-' + secrets.token_hex(8)
records = []
owned = []


def command(label, argv, timeout=30, check=True):
    result = subprocess.run(argv, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout, check=False)
    (args.evidence / (label + '.log')).write_text(result.stdout)
    records.append({'check': label, 'exit': result.returncode, 'log': label + '.log'})
    (args.evidence / 'container-checks.json').write_text(json.dumps(records, indent=2) + '\n')
    if check and result.returncode:
        raise RuntimeError(f'{label} failed ({result.returncode}); see evidence log')
    return result


try:
    # Send an allowlisted context, not the working tree (nor any credentials).
    paths = {'Dockerfile.command-proxy', 'package.json', 'package-lock.json', 'tsconfig.base.json'}
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    for path in lock['packages']:
        if len(Path(path).parts) == 2 and path.startswith(('apps/', 'packages/')):
            paths.add(path + '/package.json')
    for directory in ['apps/command-proxy/src', 'packages/contracts/src']:
        paths.update(str(path.relative_to(ROOT)) for path in (ROOT / directory).rglob('*.ts'))
    paths.update('apps/command-proxy/' + name for name in
                 ['tsup.config.ts', 'tsconfig.json', 'tsconfig.build.json'])
    hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in sorted(paths)}
    (args.evidence / 'image-source-sha256.json').write_text(json.dumps(hashes, indent=2) + '\n')
    with tempfile.TemporaryDirectory(prefix=run_id + '-') as temporary:
        context = Path(temporary)
        for path in paths:
            target = context / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / path, target)
        command('image-build', ['docker', 'build', '--progress=plain', '-f',
                str(context / 'Dockerfile.command-proxy'), '-t', run_id + ':local',
                '--iidfile', str(args.evidence.resolve() / 'image-id.txt'), str(context)], timeout=180)
    image = (args.evidence / 'image-id.txt').read_text().strip()
    assert image.startswith('sha256:') and len(image) == 71
    inspection = json.loads(command('image-inspect', ['docker', 'image', 'inspect', image]).stdout)[0]
    assert inspection['Id'] == image
    assert inspection['Config']['User'] == '10003:10003'
    assert inspection['Config']['Cmd'] == ['node', 'apps/command-proxy/dist/index.js']
    assert not any(value.startswith(('COMMAND_PROXY_KEY=', 'HERMES_API_KEY='))
                   for value in inspection['Config']['Env'])
    # A fresh --network none namespace has only loopback and no existing listener.
    port = str(49152 + secrets.randbelow(16000))
    key = 'synthetic-command-container-key-' * 2
    name = run_id
    owned.append(name)
    command('container-start', ['docker', 'run', '-d', '--name', name,
            '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--memory', '192m',
            '--memory-swap', '192m', '--cpus', '0.5', '--pids-limit', '64',
            '--health-interval', '1s', '--health-start-period', '1s',
            '-e', 'PORT=' + port, '-e', 'COMMAND_PROXY_KEY=' + key,
            '-e', 'HERMES_API_KEY=' + 'synthetic-upstream-container-key-' * 2,
            '-e', 'HERMES_API_BASE_URL=http://127.0.0.1:1', image])
    deadline = time.monotonic() + 20
    while True:
        state = json.loads(command('container-inspect', ['docker', 'inspect', name]).stdout)[0]
        if state['State'].get('Health', {}).get('Status') == 'healthy':
            break
        assert state['State']['Running'], 'Container exited before health'
        assert time.monotonic() < deadline, 'Health deadline exceeded'
        time.sleep(0.25)
    host = state['HostConfig']
    assert state['Image'] == image
    assert host['ReadonlyRootfs'] and host['NetworkMode'] == 'none'
    assert host['CapDrop'] == ['ALL'] and host['SecurityOpt'] == ['no-new-privileges:true']
    assert host['Memory'] == host['MemorySwap'] == 192 * 1024 * 1024
    assert host['NanoCpus'] == 500000000 and host['PidsLimit'] == 64
    assert not host['PortBindings'] and not state['Mounts']
    probe = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  assert.equal(process.getuid(), 10003); assert.equal(process.getgid(), 10003);
  assert.equal(process.env.NODE_ENV, 'production'); assert.equal(process.env.HOST, '127.0.0.1');
  assert.equal(process.version, 'v22.22.3');
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  assert.match(status, /NoNewPrivs:\s+1/); assert.match(status, /CapEff:\s+0+\n/);
  assert.throws(() => fs.writeFileSync('/app/forbidden', 'x'), /EROFS|EACCES/);
  const files = fs.readdirSync('/app', { recursive: true }).sort();
  const applicationFiles = files.filter(p => !p.startsWith('node_modules/'));
  assert.deepEqual(applicationFiles, ['apps', 'apps/command-proxy', 'apps/command-proxy/dist', 'apps/command-proxy/dist/index.js', 'node_modules']);
  const packages = files.filter(p => p.endsWith('/package.json')).map(p => {
    const pkg = JSON.parse(fs.readFileSync('/app/' + p)); return pkg.name + '@' + pkg.version;
  });
  for (const name of ['typescript', 'vitest', 'tsup', 'esbuild', 'eslint', 'react', 'vite', '@jarvis-command/contracts']) {
    assert.ok(!packages.some(pkg => pkg.startsWith(name + '@')), name + ' leaked into runtime');
  }
  for (const path of ['/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/yarn', '/usr/local/bin/corepack', '/usr/bin/gcc', '/usr/bin/make']) {
    assert.equal(fs.existsSync(path), false, path + ' toolchain present');
  }
  assert.ok(packages.includes('fastify@5.12.1')); assert.ok(packages.includes('zod@4.5.4'));
  // Dependency tarballs contain upstream source maps; only our bundled artifact
  // must be map-free. Environment-file exclusion still covers the whole payload.
  assert.deepEqual(files.filter(p => p.includes('.env')), [], 'Environment file in runtime');
  assert.deepEqual(applicationFiles.filter(p => p.endsWith('.map')), [], 'Application source map in runtime');
  const tcp = fs.readFileSync('/proc/net/tcp', 'utf8');
  const listeners = tcp.trim().split('\n').slice(1).map(line => line.trim().split(/\s+/)).filter(row => row[3] === '0A');
  assert.equal(listeners.length, 1); assert.equal(listeners[0][1], '0100007F:' + Number(process.env.PORT).toString(16).toUpperCase().padStart(4, '0'));
  const origin = 'http://127.0.0.1:' + process.env.PORT;
  const results = [];
  for (const [method, path] of [['GET','/_health'], ['GET','/_ready'], ['POST','/api/sessions'], ['GET','/v1/runs/run_1234567890abcdef1234567890abcdef/events']]) {
    const response = await fetch(origin + path, {method, signal: AbortSignal.timeout(2000)});
    const body = await response.text();
    assert.equal(response.status, path === '/_health' ? 200 : 401);
    results.push({method, path, status: response.status, body});
  }
  const denied = await fetch(origin + '/_ready', {headers: {authorization: 'Bearer wrong-synthetic-key'}, signal: AbortSignal.timeout(2000)});
  assert.equal(denied.status, 401); await denied.text();
  console.log(JSON.stringify({uid: process.getuid(), gid: process.getgid(), version: process.version, applicationFiles, packages, listeners, results}, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
    command('container-runtime', ['docker', 'exec', name, 'node', '-e', probe])
    command('container-term', ['docker', 'kill', '--signal=SIGTERM', name])
    assert command('container-wait', ['docker', 'wait', name], timeout=10).stdout.strip() == '0'
    command('container-final-inspect', ['docker', 'inspect', name])
    command('container-logs', ['docker', 'logs', name])
    print('PASS: exact command-proxy image ' + image)
finally:
    for name in owned:
        command('cleanup-remove', ['docker', 'rm', '-f', name], check=False)
        remaining = command('cleanup-verify', ['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'])
        assert remaining.stdout.strip() == '', 'Owned container leaked'
    (args.evidence / 'fixture-ownership.json').write_text(json.dumps({
        'run_id': run_id, 'owned_containers': owned, 'created_networks': [],
        'retained_image_tag': run_id + ':local', 'cleanup_verified': True,
    }, indent=2) + '\n')
