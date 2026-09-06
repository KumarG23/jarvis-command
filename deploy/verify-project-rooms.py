"""Bounded synthetic room acceptance. No production hosts, credentials or services.
Run with Node22 and --evidence <new directory>, then optional --containers.
Container mode uses network:none plus container-shared loopback, never host networking.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
NODE = '/home/neal/.local/bin/node'
parser = argparse.ArgumentParser()
parser.add_argument('--evidence', type=Path, required=True)
parser.add_argument('--containers', action='store_true')
args = parser.parse_args()
evidence = args.evidence.resolve()
evidence.mkdir(mode=0o700, parents=True, exist_ok=False)
fixture = evidence / ('fixture-' + secrets.token_hex(6))
resources = []
processes = []
logs = []

def save(name, value):
    (evidence / name).write_text(json.dumps(value, indent=2) + '\n')

def run(command, **kwargs):
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=kwargs.pop('timeout', 30), **kwargs)
    if result.returncode:
        save('command-failure-' + secrets.token_hex(3) + '.json', {'command': command, 'stdout': result.stdout, 'stderr': result.stderr, 'exit': result.returncode})
        result.check_returncode()
    return result.stdout.strip()

def docker(*command):
    return run(['docker', *command])

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

save('planned.json', {'fixture': str(fixture), 'parent_pid': os.getpid(), 'mode': 'containers' if args.containers else 'os-processes', 'resources': resources})
fixture.mkdir(mode=0o700)
config = {key: 'synthetic-' + secrets.token_hex(32) for key in ['upstream', 'read', 'command']}
config.update({key: free_port() for key in ['upstreamPort', 'readPort', 'commandPort', 'appPort']})
(fixture / 'config.json').write_text(json.dumps(config)); (fixture / 'config.json').chmod(0o600)
script = ROOT / 'deploy/project-rooms-fixture.mjs'
run([NODE, str(script), 'prepare', str(fixture)])
(fixture / 'jwks.json').chmod(0o444)
identity = json.loads((fixture / 'identity.json').read_text())
(fixture / 'audit').mkdir(mode=0o700)
(fixture / 'audit/events.jsonl').touch(mode=0o600)
images = {}
manifest = {}
namespace = None

def launch(kind, command, env=None, image=None, mounts=(), user=None):
    if not args.containers:
        log = open(evidence / (kind + '.log'), 'w'); logs.append(log)
        process = subprocess.Popen([NODE, *command], cwd=ROOT, env={'PATH': '/home/neal/.local/bin:/usr/bin:/bin', 'HOME': str(fixture), **(env or {})}, stdout=log, stderr=subprocess.STDOUT)
        processes.append(process)
        resources.append({'kind': kind, 'pid': process.pid, 'starttime': Path(f'/proc/{process.pid}/stat').read_text().split()[21]})
        save('ownership.json', resources)
        return process
    name = 'jc-room-smoke-' + fixture.name.removeprefix('fixture-') + '-' + kind
    assert not docker('ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}')
    record = {'kind': kind, 'name': name, 'id': None}; resources.append(record); save('ownership.json', resources)
    envfile = fixture / (kind + '.env')
    envfile.write_text(''.join(k + '=' + str(v) + '\n' for k, v in (env or {}).items())); envfile.chmod(0o600)
    argv = ['create', '--name', name, '--network', namespace or 'none', '--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=128', '--restart=no', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m', '--env-file', str(envfile)]
    if user: argv += ['--user', user]
    if kind == 'prepare-audit': argv += ['--cap-add=CHOWN']
    for source, target, readonly in mounts:
        argv += ['--mount', f'type=bind,src={source},dst={target}' + (',readonly' if readonly else '')]
    cid = docker(*argv, image, *command); record['id'] = cid; save('ownership.json', resources)
    inspected = json.loads(docker('inspect', cid))[0]
    assert inspected['HostConfig']['NetworkMode'] == (namespace or 'none')
    assert not inspected['HostConfig']['PortBindings'] and inspected['HostConfig']['ReadonlyRootfs']
    assert inspected['Image'] == image
    save(kind + '-created.json', inspected)
    docker('start', cid)
    inspected = json.loads(docker('inspect', cid))[0]
    record['pid'] = inspected['State']['Pid']; save('ownership.json', resources)
    save(kind + '-running.json', inspected)
    assert kind in ['prepare-audit', 'cleanup-audit'] or (inspected['State']['Running'] and record['pid'] > 0)
    return cid

def stop(resource):
    if args.containers:
        record = next(r for r in resources if r['id'] == resource)
        docker('stop', '--time=5', resource)
        state = json.loads(docker('inspect', resource))[0]
        assert not state['State']['Running'] and state['State']['Pid'] == 0
        docker('rm', resource)
        assert not docker('ps', '-a', '--no-trunc', '--filter', 'id=' + resource, '--format', '{{.ID}}')
        assert not Path('/proc', str(record['pid'])).exists()
    else:
        resource.terminate(); resource.wait(timeout=10)
        assert not Path('/proc', str(resource.pid)).exists()

def health(port, path, via=None):
    for _ in range(100):
        try:
            if args.containers:
                docker('exec', via, 'node', '-e', f"fetch('http://127.0.0.1:{port}{path}',{{signal:AbortSignal.timeout(500)}}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))")
            else:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=.5) as response:
                    assert response.status == 200
            return
        except (OSError, AssertionError, subprocess.CalledProcessError):
            time.sleep(.1)
    raise RuntimeError('fixture health failed')

outcome = {'status': 'FAIL'}
try:
    if args.containers:
        # A fresh allowlisted context: never transmit credentials or unrelated WIP to Docker.
        context = fixture / 'build-context'; context.mkdir()
        files = ['package.json', 'package-lock.json', 'tsconfig.base.json', 'Dockerfile', 'Dockerfile.command-proxy', 'Dockerfile.read-proxy']
        for app in ['server', 'web', 'command-proxy', 'read-proxy']:
            for p in (ROOT / 'apps' / app).glob('*.json'): files.append(str(p.relative_to(ROOT)))
            for p in (ROOT / 'apps' / app).glob('*.ts'): files.append(str(p.relative_to(ROOT)))
            files += [str(p.relative_to(ROOT)) for p in (ROOT / 'apps' / app / 'src').rglob('*') if p.is_file()]
        files += ['apps/web/index.html', 'packages/contracts/package.json']
        files += [str(p.relative_to(ROOT)) for folder in ['apps/web/public', 'packages/contracts/src'] for p in (ROOT / folder).rglob('*') if p.is_file()]
        manifest = {name: digest(ROOT / name) for name in sorted(set(files))}
        binding = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
        save('image-source-manifest.json', manifest)
        for name in manifest:
            target = context / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, target)
        for kind, dockerfile in [('app', 'Dockerfile'), ('read-proxy', 'Dockerfile.read-proxy'), ('command-proxy', 'Dockerfile.command-proxy')]:
            iid = evidence / (kind + '-image-id.txt')
            result = subprocess.run(['docker', 'build', '--label', 'org.jarvis-command.source-sha256=' + binding, '--iidfile', str(iid), '-f', str(context / dockerfile), str(context)], cwd=ROOT, text=True, stdout=open(evidence / (kind + '-build.log'), 'w'), stderr=subprocess.STDOUT, timeout=240)
            assert result.returncode == 0, kind + ' build failed'
            images[kind] = iid.read_text().strip()
            save(kind + '-image.json', json.loads(docker('image', 'inspect', images[kind]))[0])
        save('images.json', {'binding': binding, 'images': images})
        upstream = launch('upstream', ['node', '/fixture-script.mjs', 'upstream', '/fixture'], image=images['app'], user=f'{os.getuid()}:{os.getgid()}', mounts=[(fixture, '/fixture', False), (script, '/fixture-script.mjs', True)])
        assert isinstance(upstream, str)
        namespace = 'container:' + upstream
        # Use an owned root-only helper within network:none, solely to provision the isolated audit leaf.
        helper = launch('prepare-audit', ['node', '-e', "const f=require('fs');f.chownSync('/audit',0,0);f.chownSync('/audit/events.jsonl',10001,10001);f.chownSync('/audit',10001,10001)"], image=images['app'], user='0:0', mounts=[(fixture / 'audit', '/audit', False)])
        docker('wait', helper)
        assert json.loads(docker('inspect', helper))[0]['State']['ExitCode'] == 0
    else:
        upstream = launch('upstream', [str(script), 'upstream', str(fixture)])
    health(config['upstreamPort'], '/fixture-counts', upstream)
    for kind, key, port in [('read-proxy', 'read', 'readPort'), ('command-proxy', 'command', 'commandPort')]:
        env = {'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(config[port]), 'HERMES_API_BASE_URL': f"http://127.0.0.1:{config['upstreamPort']}", 'HERMES_API_KEY': config['upstream'], 'READ_PROXY_KEY' if key == 'read' else 'COMMAND_PROXY_KEY': config[key]}
        command = [f'apps/{kind}/dist/index.js']
        launch(kind, (['node'] if args.containers else []) + command, env, images.get(kind))
        health(config[port], '/_health', upstream)
    env = {'NODE_ENV': 'production', 'AUTH_MODE': 'cloudflare', 'HOST': '127.0.0.1', 'PORT': str(config['appPort']), 'COMMAND_MODE': 'enabled', 'CF_ACCESS_TEAM_DOMAIN': 'synthetic.cloudflareaccess.com', 'CF_ACCESS_AUD': 'a'*64, 'CF_ACCESS_EMAIL_SHA256': identity['hash'], 'CF_ACCESS_JWKS_FILE': '/jwks.json' if args.containers else str(fixture / 'jwks.json'), 'HERMES_API_BASE_URL': f"http://127.0.0.1:{config['readPort']}", 'HERMES_READ_PROXY_KEY': config['read'], 'HERMES_COMMAND_API_BASE_URL': f"http://127.0.0.1:{config['commandPort']}", 'HERMES_COMMAND_PROXY_KEY': config['command'], 'PUBLIC_ORIGIN': 'https://rooms.example.test', 'COMMAND_AUDIT_LOG_PATH': '/audit/events.jsonl' if args.containers else str(fixture / 'audit/events.jsonl'), 'WEB_DIST_DIR': '/app/apps/web/dist' if args.containers else str(ROOT / 'apps/web/dist')}
    mounts = [(fixture / 'audit', '/audit', False), (fixture / 'jwks.json', '/jwks.json', True)]
    command = (['node'] if args.containers else []) + ['apps/server/dist/index.js']
    app = launch('app', command, env, images.get('app'), mounts)
    health(config['appPort'], '/api/health', upstream)
    for phase in ['create', 'replaced']:
        if phase == 'replaced':
            old = resources[-1].copy(); stop(app)
            app = launch('app-replacement', command, env, images.get('app'), mounts)
            assert old['pid'] != resources[-1]['pid']
            save('replacement.json', {'old': old, 'new': resources[-1], 'old_process_absent': True})
            health(config['appPort'], '/api/health', upstream)
        output = docker('exec', upstream, 'node', '/fixture-script.mjs', 'probe', '/fixture', phase) if args.containers else run([NODE, str(script), 'probe', str(fixture), phase])
        save(phase + '-probe.json', json.loads(output))
    if args.containers:
        assert all(digest(ROOT / name) == value for name, value in manifest.items())
    outcome = {'status': 'PASS', 'images': images, 'replacement': True, 'two_clients': True}
finally:
    cleanup = {'fixture': str(fixture), 'resources': resources, 'verified': False}
    try:
        if args.containers:
            # Remove only exact owned IDs; helper may already have exited.
            for resource in reversed(resources):
                if resource.get('id') and docker('ps', '-a', '--no-trunc', '--filter', 'id=' + resource['id'], '--format', '{{.ID}}'):
                    output = subprocess.run(['docker', 'logs', resource['id']], text=True, capture_output=True, timeout=10)
                    (evidence / (resource['kind'] + '-container.log')).write_text(output.stdout + output.stderr)
                    docker('rm', '--force', resource['id'])
                assert not docker('ps', '-a', '--filter', 'name=^/' + resource['name'] + '$', '--format', '{{.ID}}')
            # The app-owned audit leaf is removed by a fixed isolated helper. No host sudo.
            if (fixture / 'audit').stat().st_uid != os.getuid():
                namespace = None
                helper = launch('cleanup-audit', ['node', '-e', "const f=require('fs');for(const p of f.readdirSync('/audit'))f.unlinkSync('/audit/'+p);f.chmodSync('/audit',0o777)"], image=images['app'], user='10001:10001', mounts=[(fixture / 'audit', '/audit', False)])
                docker('wait', helper)
                assert json.loads(docker('inspect', helper))[0]['State']['ExitCode'] == 0
                docker('rm', helper)
                assert not docker('ps', '-a', '--no-trunc', '--filter', 'id=' + helper, '--format', '{{.ID}}')
        else:
            for process in reversed(processes):
                if process.poll() is None: stop(process)
            for log in logs: log.close()
        assert all(not Path('/proc', str(r['pid'])).exists() for r in resources if r.get('pid'))
        shutil.rmtree(fixture)
        assert not fixture.exists()
        cleanup['verified'] = True
    finally:
        save('cleanup.json', cleanup); outcome['cleanup_verified'] = cleanup['verified']; save('result.json', outcome)
print(json.dumps(outcome))
