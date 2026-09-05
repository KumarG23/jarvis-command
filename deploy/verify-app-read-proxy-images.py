#!/usr/bin/env python3
"""Build allowlisted app/read images; production-auth denial smoke, not full integration."""
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


def reject_paths(label, paths):
    if paths:
        raise RuntimeError(label + ': ' + ', '.join(sorted(paths)))


def finish(evidence, cleanup, result):
    cleanup()
    (evidence / 'SUCCESS.json').write_text(json.dumps(result, indent=2) + '\n')
    print('PASS: exact app/read-proxy images; cleanup verified')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    run_id = 'jc-app-read-' + secrets.token_hex(8)
    records, owned, images = [], [], {}
    temporary = Path(tempfile.mkdtemp(prefix=run_id + '-'))

    def command(label, argv, timeout=30):
        result = subprocess.run(argv, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=timeout, check=False)
        (evidence / (label + '.log')).write_text(result.stdout)
        records.append({'check': label, 'exit': result.returncode})
        (evidence / 'checks.json').write_text(json.dumps(records, indent=2) + '\n')
        if result.returncode:
            raise RuntimeError(f'{label} exit {result.returncode}; see evidence')
        return result.stdout

    def cleanup():
        for name in owned:
            command(name + '-remove', ['docker', 'rm', '-f', name])
            remaining = command(name + '-cleanup', ['docker', 'ps', '-a', '--filter',
                                'name=^/' + name + '$', '--format', '{{.Names}}'])
            reject_paths('Owned containers remain', remaining.split())
        shutil.rmtree(temporary)
        assert not temporary.exists(), str(temporary)
        (evidence / 'cleanup.json').write_text(json.dumps({
            'owned_containers': owned, 'temporary_path': str(temporary),
            'created_networks': [], 'cleanup_verified': True,
        }, indent=2) + '\n')

    try:
        for kind, dockerfile, workspace, uid in [
            ('app', 'Dockerfile', 'server', 10001),
            ('read-proxy', 'Dockerfile.read-proxy', 'read-proxy', 10002),
        ]:
            context = temporary / kind
            paths = {dockerfile, 'package.json', 'package-lock.json', 'tsconfig.base.json'}
            lock = json.loads((ROOT / 'package-lock.json').read_text())
            for path in lock['packages']:
                if len(Path(path).parts) == 2 and path.startswith(('apps/', 'packages/')):
                    paths.add(path + '/package.json')
            directories = [f'apps/{workspace}/src']
            paths.add(f'apps/{workspace}/tsconfig.json')
            if kind == 'app':
                directories += ['apps/web/src', 'packages/contracts/src']
                paths.update('apps/web/' + p for p in ['index.html', 'vite.config.ts', 'tsconfig.json',
                    'public/pwa-192.png', 'public/pwa-512.png', 'public/jarvis-command.svg',
                    'public/.well-known/assetlinks.json'])
            for directory in directories:
                paths.update(str(p.relative_to(ROOT)) for p in (ROOT / directory).rglob('*')
                             if p.is_file() and p.suffix in {'.ts', '.tsx', '.css'}
                             and not p.name.endswith(('.test.ts', '.test.tsx')) and p.name != 'test-setup.ts')
            reject_paths('Symlink context inputs', [p for p in paths if (ROOT / p).is_symlink()])
            hashes = {}
            for path in sorted(paths):
                source = ROOT / path
                data = source.read_bytes()
                hashes[path] = hashlib.sha256(data).hexdigest()
                target = context / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            source_digest = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
            (evidence / (kind + '-source-sha256.json')).write_text(json.dumps(hashes, indent=2) + '\n')
            iid = evidence / (kind + '-image-id.txt')
            command(kind + '-build', ['docker', 'build', '--progress=plain', '-f', str(context / dockerfile),
                    '--label', 'org.jarvis-command.source-sha256=' + source_digest,
                    '-t', run_id + '-' + kind + ':local', '--iidfile', str(iid), str(context)], timeout=240)
            image = iid.read_text().strip()
            assert image.startswith('sha256:') and len(image) == 71
            inspection = json.loads(command(kind + '-image-inspect', ['docker', 'image', 'inspect', image]))[0]
            assert inspection['Id'] == image and inspection['Config']['User'] == f'{uid}:{uid}'
            assert inspection['Config']['Labels']['org.jarvis-command.source-sha256'] == source_digest
            assert inspection['Config']['Cmd'] == ['node', f'apps/{workspace}/dist/index.js']
            env = inspection['Config']['Env']
            assert 'NODE_ENV=production' in env and 'HOST=127.0.0.1' in env
            reject_paths('Image credential environment', [p for p in env if any(s in p.split('=')[0] for s in ['KEY', 'TOKEN', 'SECRET', 'AUTH_MODE'])])
            port = str(49152 + secrets.randbelow(16000))
            name = run_id + '-' + kind
            owned.append(name)
            launch = ['docker', 'run', '-d', '--name', name, '--network', 'none', '--read-only',
                      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '192m',
                      '--memory-swap', '192m', '--cpus', '0.5', '--pids-limit', '64',
                      '--health-interval', '1s', '--health-start-period', '1s', '-e', 'PORT=' + port,
                      '-e', 'HERMES_API_BASE_URL=http://127.0.0.1:1']
            jwks = temporary / 'jwks.json'
            if kind == 'app':
                public = command('synthetic-jwks', ['node', '-e', "const {generateKeyPairSync}=require('node:crypto');const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});console.log(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'synthetic',alg:'RS256',use:'sig'}]}))"])
                jwks.write_text(public)
                jwks.chmod(0o444)
                # Parent traversal is private on the host; the file alone is mounted read-only.
                launch += ['--mount', f'type=bind,src={jwks},dst=/run/fixture-jwks.json,readonly']
                config = {'AUTH_MODE': 'cloudflare', 'COMMAND_MODE': 'disabled',
                          'CF_ACCESS_TEAM_DOMAIN': 'fixture.cloudflareaccess.com',
                          'CF_ACCESS_AUD': 'a' * 64, 'CF_ACCESS_EMAIL_SHA256': 'b' * 64,
                          'CF_ACCESS_JWKS_FILE': '/run/fixture-jwks.json',
                          'HERMES_READ_PROXY_KEY': 'synthetic-read-key-' * 3}
            else:
                config = {'READ_PROXY_KEY': 'synthetic-read-key-' * 3,
                          'HERMES_API_KEY': 'synthetic-upstream-key-' * 3}
            for key, value in config.items():
                launch += ['-e', key + '=' + value]
            command(kind + '-start', launch + [image])
            deadline = time.monotonic() + 20
            while True:
                state = json.loads(command(kind + '-container-inspect', ['docker', 'inspect', name]))[0]
                if state['State'].get('Health', {}).get('Status') == 'healthy':
                    break
                if not state['State']['Running'] or time.monotonic() > deadline:
                    command(kind + '-failure-logs', ['docker', 'logs', name])
                    raise RuntimeError(kind + ' failed health')
                time.sleep(0.25)
            host = state['HostConfig']
            assert state['Image'] == image and host['ReadonlyRootfs'] and host['NetworkMode'] == 'none'
            assert host['CapDrop'] == ['ALL'] and host['SecurityOpt'] == ['no-new-privileges:true']
            assert host['Memory'] == host['MemorySwap'] == 192 * 1024 * 1024
            assert host['NanoCpus'] == 500000000 and host['PidsLimit'] == 64 and not host['PortBindings']
            assert len(state['Mounts']) == (1 if kind == 'app' else 0)
            if kind == 'app':
                mount = state['Mounts'][0]
                assert not mount['RW'] and mount['Source'] == str(jwks) and mount['Destination'] == '/run/fixture-jwks.json'
            probe = r"""
const assert = require('node:assert/strict'), fs = require('node:fs'), crypto = require('node:crypto');
(async () => {
  const uid = EXPECTED_UID;
  assert.equal(process.getuid(), uid); assert.equal(process.getgid(), uid);
  assert.equal(process.version, 'v22.22.3'); assert.equal(process.env.NODE_ENV, 'production');
  assert.equal(process.env.HOST, '127.0.0.1');
  if (uid === 10001) { assert.equal(process.env.AUTH_MODE, 'cloudflare'); assert.equal(JSON.parse(fs.readFileSync('/run/fixture-jwks.json')).keys[0].kty, 'RSA'); }
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  assert.match(status, /NoNewPrivs:\s+1/); assert.match(status, /CapEff:\s+0+\n/);
  assert.throws(() => fs.writeFileSync('/app/forbidden', 'x'), /EROFS|EACCES/);
  const files = fs.readdirSync('/app', {recursive:true}).sort();
  const app = files.filter(p => !p.startsWith('node_modules/'));
  const bad = files.filter(p => p.includes('.env') || (!p.startsWith('node_modules/') && p.endsWith('.map')));
  assert.deepEqual(bad, [], 'Forbidden files: ' + bad.join(', '));
  const ownership = files.filter(p => { const s=fs.lstatSync('/app/'+p);return s.uid!==0||s.gid!==0; });
  assert.deepEqual(ownership, [], 'Non-root-owned paths: ' + ownership.join(', '));
  const packages = files.filter(p => p.endsWith('/package.json')).map(p => JSON.parse(fs.readFileSync('/app/'+p))).map(p => p.name+'@'+p.version).sort();
  const denied = ['typescript','vitest','tsup','esbuild','eslint','react','vite','@jarvis-command/contracts'];
  const leaked = packages.filter(p => denied.some(n => p.startsWith(n+'@')));
  assert.deepEqual(leaked, [], 'Build dependencies: ' + leaked.join(', '));
  assert.ok(packages.includes('fastify@5.12.1')); assert.ok(packages.includes('zod@4.5.4'));
  const tools = ['/usr/local/bin/npm','/usr/local/bin/npx','/usr/local/bin/yarn','/usr/local/bin/yarnpkg','/usr/local/bin/corepack','/usr/local/lib/node_modules/npm','/usr/local/lib/node_modules/corepack','/usr/bin/gcc','/usr/bin/make'];
  assert.deepEqual(tools.filter(p=>fs.existsSync(p)), [], 'Toolchain present');
  const artifacts = Object.fromEntries(app.filter(p=>fs.lstatSync('/app/'+p).isFile()).map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync('/app/'+p)).digest('hex')]));
  assert.ok(artifacts['apps/'+(uid===10001?'server':'read-proxy')+'/dist/index.js']);
  assert.deepEqual(app.filter(p=>fs.lstatSync('/app/'+p).isFile() && !p.startsWith('apps/web/dist/') && !p.endsWith('/dist/index.js')), []);
  const listeners = fs.readFileSync('/proc/net/tcp','utf8').trim().split('\n').slice(1).map(l=>l.trim().split(/\s+/)).filter(r=>r[3]==='0A');
  assert.equal(listeners.length,1); assert.equal(listeners[0][1],'0100007F:'+Number(process.env.PORT).toString(16).toUpperCase().padStart(4,'0'));
  const ipv6 = fs.readFileSync('/proc/net/tcp6','utf8').trim().split('\n').slice(1).filter(l=>l.trim().split(/\s+/)[3]==='0A');
  assert.deepEqual(ipv6, []);
  const routes = uid===10001 ? [['/api/health',200],['/',200],['/api/bootstrap',401]] : [['/_health',200],['/health/detailed',401],['/v1/capabilities',401],['/api/sessions',401]];
  const results=[];
  for (const [path,expected] of routes) {
    const r=await fetch('http://127.0.0.1:'+process.env.PORT+path,{signal:AbortSignal.timeout(2000)});
    const body=await r.text(); assert.equal(r.status,expected,path);
    if(path==='/') assert.match(body, /<div id="root"><\/div>/);
    results.push({path,status:r.status,body});
  }
  console.log(JSON.stringify({uid,gid:process.getgid(),packages,files,artifacts,listeners,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
""".replace('EXPECTED_UID', str(uid))
            command(kind + '-runtime', ['docker', 'exec', name, 'node', '-e', probe])
            health = inspection['Config']['Healthcheck']['Test']
            assert health[0] == 'CMD' and 'AbortSignal.timeout(4000)' in health[-1]
            command(kind + '-immutable-health', ['docker', 'exec', name] + health[1:])
            command(kind + '-logs', ['docker', 'logs', name])
            reject_paths('Source changed during verification', [p for p, digest in hashes.items()
                         if hashlib.sha256((ROOT / p).read_bytes()).hexdigest() != digest])
            images[kind] = {'image_id': image, 'source_sha256': source_digest,
                            'retained_tag': run_id + '-' + kind + ':local'}
    except BaseException:
        cleanup()
        raise
    finish(evidence, cleanup, {'status': 'PASS', 'images': images,
           'scope': 'production-auth unauthenticated denial and artifact smoke only; no upstream chain'})


if __name__ == '__main__':
    main()
