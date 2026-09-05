#!/usr/bin/python3
"""Opt-in immutable browser/dual-proxy tracer; ONLY synthetic upstream, no host ports.

Run as root with --execute --ack SYNTHETIC_ONLY --parent-app PATH
--parent-command PATH --evidence NEW_DIRECTORY. Default changes no resources.
Uses a shared network-none namespace, not SSH/host UID-egress acceptance.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PATH = '/home/neal/.local/bin:/usr/local/bin:/usr/bin:/bin'
NODE = '/home/neal/.local/bin/node'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--ack')
    parser.add_argument('--parent-app', type=Path)
    parser.add_argument('--parent-command', type=Path)
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    if not args.execute:
        print('Read-only default: no resources changed. See --help for explicit synthetic execution.')
        return
    assert args.ack == 'SYNTHETIC_ONLY' and os.geteuid() == 0
    assert args.parent_app and args.parent_command and args.evidence
    os.umask(0o077)
    evidence = args.evidence.resolve()
    evidence.mkdir(exist_ok=False, parents=True)
    records, owned, pids, bindings = [], [], [], {}
    fixture = None
    outcome = {'passed': False}

    def save(name, value):
        (evidence / name).write_text(json.dumps(value, indent=2) + '\n')

    def run(argv, check=True, timeout=30):
        result = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                                env={'PATH': PATH, 'HOME': '/home/neal', 'PLAYWRIGHT_BROWSERS_PATH': '/home/neal/.cache/ms-playwright'})
        records.append({'argv': argv, 'exit': result.returncode})
        save('commands.json', records)
        if check and result.returncode:
            raise RuntimeError(f'{argv[:4]} exit {result.returncode}: {result.stderr[:1000]}')
        return result

    def docker(*argv, **kw):
        return run(['/usr/bin/docker', *argv], **kw)

    def inspect(cid):
        return json.loads(docker('inspect', cid).stdout)[0]

    def policy(state, image, uid, memory, cpus, pids_limit, network):
        host = state['HostConfig']
        assert state['Image'] == image and state['Config']['User'] == f'{uid}:{uid}'
        assert host['ReadonlyRootfs'] and host['CapDrop'] == ['ALL']
        assert host['SecurityOpt'] == ['no-new-privileges:true']
        assert host['Memory'] == host['MemorySwap'] == memory * 1024 * 1024
        assert host['NanoCpus'] == cpus and host['PidsLimit'] == pids_limit
        assert host['NetworkMode'] == network and not host['PortBindings']
        assert host['Init'] and host['RestartPolicy']['Name'] == 'no'
        snapshot = dict(state); snapshot['Config'] = dict(state['Config']); snapshot['Config'].pop('Env', None)
        save(state['Name'].strip('/') + '-' + state['State']['Status'] + '.json', snapshot)

    def launch(kind, image, uid, env, network, mounts=(), command=()):
        name = fixture.name + '-' + kind
        assert not docker('ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}').stdout.strip()
        owned.append({'name': name, 'id': None})
        save('ownership.json', owned)
        envfile = fixture / (kind + '.env')
        envfile.write_text(''.join(k + '=' + v + '\n' for k, v in env.items()))
        memory, cpus, limit = (512, 1000000000, 128) if kind == 'app' else (256, 500000000, 64)
        argv = ['create', '--name', name, '--network', network, '--user', f'{uid}:{uid}', '--init', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', str(memory) + 'm', '--memory-swap', str(memory) + 'm', '--cpus', str(cpus / 1e9), '--pids-limit', str(limit), '--restart', 'no', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=8m', '--ulimit', 'nofile=512:1024', '--env-file', str(envfile)]
        for mount in mounts:
            argv += ['--mount', mount]
        argv += [image, *command]
        cid = docker(*argv).stdout.strip(); owned[-1]['id'] = cid; save('ownership.json', owned)
        policy(inspect(cid), image, uid, memory, cpus, limit, network)
        docker('start', cid)
        state = inspect(cid); policy(state, image, uid, memory, cpus, limit, network)
        assert state['State']['Running']; pids.append(state['State']['Pid'])
        return cid

    try:
        assert run([NODE, '--version']).stdout.strip() == 'v22.22.3'
        receipt = json.loads((args.parent_app / 'SUCCESS.json').read_text())
        assert receipt['status'] == 'PASS'
        for kind in ['app', 'read-proxy', 'command-proxy']:
            parent = args.parent_command if kind == 'command-proxy' else args.parent_app
            manifestpath = parent / ('image-source-sha256.json' if kind == 'command-proxy' else kind + '-source-sha256.json')
            manifest = json.loads(manifestpath.read_text())
            assert all(digest(ROOT / path) == value for path, value in manifest.items()), kind + ' source drift; rebuild required'
            image = (parent / 'image-id.txt').read_text().strip() if kind == 'command-proxy' else receipt['images'][kind]['image_id']
            assert len(image) == 71 and image.startswith('sha256:')
            info = json.loads(docker('image', 'inspect', image).stdout)[0]
            assert info['Id'] == image
            if kind != 'command-proxy':
                assert info['Config']['Labels']['org.jarvis-command.source-sha256'] == hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
            else:
                checks = json.loads((parent / 'container-checks.json').read_text())
                assert all(c['exit'] == 0 for c in checks)
                assert json.loads((parent / 'image-inspect.log').read_text())[0]['Id'] == image
            bindings[kind] = {'image': image, 'parent': str(parent), 'manifest': manifest, 'manifest_file_sha256': digest(manifestpath), 'image_inspection': info}
        save('image-bindings.json', bindings)
        fixture = Path(tempfile.mkdtemp(prefix='jc-container-chain-', dir='/var/lib'))
        fixture.chmod(0o700)
        config = {key: 'synthetic-' + secrets.token_hex(32) for key in ['upstream', 'read', 'command']}
        (fixture / 'synthetic.json').write_text(json.dumps(config))
        run([NODE, str(ROOT / 'deploy/container-chain-upstream.mjs'), str(fixture), '--prepare'])
        (fixture / 'jwks.json').chmod(0o444)
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(fixture / 'tls.key'), '-out', str(fixture / 'tls.crt'), '-days', '1', '-subj', '/CN=synthetic.local', '-addext', 'subjectAltName=IP:127.0.0.1'])
        # The fixture container is nonroot too; only it receives TLS/upstream material.
        synthetic_dir = fixture / 'synthetic'; synthetic_dir.mkdir(mode=0o700)
        for name in ['synthetic.json', 'tls.key', 'tls.crt']:
            shutil.copyfile(fixture / name, synthetic_dir / name); os.chown(synthetic_dir / name, 10004, 10004)
        os.chown(synthetic_dir, 10004, 10004)
        synthetic = launch('synthetic', bindings['app']['image'], 10004, {}, 'none', [f'type=bind,src={synthetic_dir},dst=/fixture', f'type=bind,src={ROOT / "deploy/container-chain-upstream.mjs"},dst=/upstream.mjs,readonly'], ['node', '/upstream.mjs', '/fixture'])
        namespace = 'container:' + synthetic
        for kind, uid, port, key in [('read-proxy', 10002, '18642', 'read'), ('command-proxy', 10003, '18643', 'command')]:
            launch(kind, bindings[kind]['image'], uid, {'PORT': port, 'HERMES_API_BASE_URL': 'http://127.0.0.1:18640', 'HERMES_API_KEY': config['upstream'], 'READ_PROXY_KEY' if key == 'read' else 'COMMAND_PROXY_KEY': config[key]}, namespace)
        storage = fixture / 'storage'; storage.mkdir(mode=0o700)
        ledger = storage / 'audit/events.jsonl'
        prepared = json.loads(run(['/usr/bin/python3', str(ROOT / 'deploy/prepare-audit-storage.py'), 'prepare', '--trusted-root', str(storage), '--path', str(ledger)]).stdout)
        appenv = {'PORT': '3000', 'AUTH_MODE': 'cloudflare', 'COMMAND_MODE': 'enabled', 'CF_ACCESS_TEAM_DOMAIN': 'synthetic.cloudflareaccess.com', 'CF_ACCESS_AUD': 'a'*64, 'CF_ACCESS_EMAIL_SHA256': hashlib.sha256(b'synthetic-approved@example.test').hexdigest(), 'CF_ACCESS_JWKS_FILE': '/run/fixture-jwks.json', 'HERMES_API_BASE_URL': 'http://127.0.0.1:18642', 'HERMES_READ_PROXY_KEY': config['read'], 'HERMES_COMMAND_API_BASE_URL': 'http://127.0.0.1:18643', 'HERMES_COMMAND_PROXY_KEY': config['command'], 'PUBLIC_ORIGIN': 'https://127.0.0.1:8443', 'COMMAND_AUDIT_LOG_PATH': '/audit/events.jsonl'}
        app = launch('app', bindings['app']['image'], 10001, appenv, namespace, [f'type=bind,src={fixture / "jwks.json"},dst=/run/fixture-jwks.json,readonly', f'type=bind,src={storage / "audit"},dst=/audit'])
        deadline = time.monotonic() + 15
        while docker('exec', app, 'node', '-e', "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))", check=False).returncode:
            assert time.monotonic() < deadline
            time.sleep(.1)
        pid = inspect(synthetic)['State']['Pid']
        netns = os.readlink(f'/proc/{pid}/ns/net')
        assert netns != os.readlink('/proc/self/ns/net')
        save('substitutions.json', {'fixture': str(fixture), 'network': namespace, 'netns': netns, 'published_ports': [], 'loopback_ports': {'upstream': 18640, 'read': 18642, 'command': 18643, 'app': 3000, 'tls_transport': 8443}, 'mounts': 'See exact created/running container metadata', 'audit': {'host': str(ledger), 'container': '/audit/events.jsonl'}, 'public_origin': appenv['PUBLIC_ORIGIN'], 'jwks': '/run/fixture-jwks.json', 'tls': 'ephemeral self-signed; browser ignoreHTTPSErrors; no Access bypass', 'browser': 'host-installed Chromium executed as root inside owned network-none namespace; not browser sandbox acceptance', 'production_logic_modified': False})
        result = run(['nsenter', '--net=' + f'/proc/{pid}/ns/net', '--', 'env', 'PATH=' + PATH, 'JC_CHAIN_PRIVATE=' + str(fixture), 'JC_CHAIN_EVIDENCE=' + str(evidence), NODE, '--test', str(ROOT / 'deploy/container-chain-browser.mjs')], check=False, timeout=110)
        (evidence / 'browser.log').write_text(result.stdout + result.stderr)
        assert result.returncode == 0, 'Browser path failed; see browser.log'
        audit = ledger.read_text()
        assert 'run.started' in audit and ledger.stat().st_ino == prepared['inode']
        entries = [json.loads(line) for line in audit.splitlines()]
        started = [entry for entry in entries if entry['action'] == 'run.started']
        assert len(started) == 2 and len({entry['upstreamRunId'] for entry in started}) == 2
        for mode in ['desktop', 'phone']:
            browser = json.loads((evidence / (mode + '.json')).read_text())
            admission = browser['admission']
            matching = [entry for entry in started if entry['publicRunId'] == admission['publicRunId']]
            assert len(matching) == 1
            assert all(matching[0][key] == admission[key] for key in ['clientRequestId', 'sessionId'])
            assert matching[0]['upstreamRunId'] == browser['after']['runs'][-1]['run_id']
            assert len(browser['denied']) == 24 and browser['proxyCredentialDenials'] == 8
            assert browser['after']['violations'] == []
        browser_config = json.loads((fixture / 'browser.json').read_text())
        assert all(value not in audit for value in [*config.values(), browser_config['assertion'], 'Synthetic private container prompt', 'Synthetic streamed answer', 'synthetic-approved@example.test'])
        save('audit.json', {'content': audit, 'sha256': digest(ledger), 'inode': ledger.stat().st_ino, 'mode': oct(ledger.stat().st_mode & 0o777), 'uid': ledger.stat().st_uid})
        assert all(digest(ROOT / path) == value for binding in bindings.values() for path, value in binding['manifest'].items())
        outcome['passed'] = True
    except BaseException as error:
        outcome['error'] = repr(error)
        raise
    finally:
        cleanup = {'owned': owned, 'pids': pids, 'fixture': str(fixture), 'unit': None, 'created_named_networks': [], 'verified': False}
        try:
            for resource in reversed(owned):
                remaining = docker('ps', '-a', '--no-trunc', '--filter', 'name=^/' + resource['name'] + '$', '--format', '{{.ID}}').stdout.split()
                for cid in remaining:
                    assert resource['id'] is None or resource['id'] == cid
                    docker('rm', '--force', cid)
                assert not docker('ps', '-a', '--filter', 'name=^/' + resource['name'] + '$', '--format', '{{.ID}}').stdout.strip()
            assert all(not Path('/proc', str(pid)).exists() for pid in pids)
            if fixture:
                shutil.rmtree(fixture); assert not fixture.exists()
            cleanup['verified'] = True
        finally:
            save('cleanup.json', cleanup); outcome['cleanup_verified'] = cleanup['verified']; save('runtime-result.json', outcome)
    print('PASS containerized desktop/phone tracer; exact cleanup verified')


if __name__ == '__main__':
    main()
