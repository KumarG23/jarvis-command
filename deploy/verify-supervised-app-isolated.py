#!/usr/bin/python3
"""Opt-in real supervised app acceptance; no production installation or networking.

Usage (root): --execute --parent-image-evidence PATH --evidence NEW_DIRECTORY
Default is read-only. A private root-owned /var/lib/jc-supervised-* source copy
maps only fixed fixture paths, name/project and host network to none. Real Docker,
Compose, helper, process/health/hardening checks and systemd-notify stay unchanged.
The bridge is synthetic, exec'd after health inside each isolated app namespace.
No published ports, real Hermes, proxy/browser acceptance or release claim.
"""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
NODE = '/home/neal/.local/bin/node'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    spec = importlib.util.spec_from_file_location('fixture_module', path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--parent-image-evidence', type=Path)
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    if not args.execute:
        print('Read-only default: use --execute --parent-image-evidence PATH --evidence NEW_DIRECTORY as root. No resources changed.')
        return
    assert os.geteuid() == 0 and args.parent_image_evidence and args.evidence
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    records, ids, pids, assertions = [], [], [], {}
    fixture = None
    unit = None
    unitfile = None
    outcome = {'passed': False, 'scope': __doc__}

    def save(name, value):
        (evidence / name).write_text(json.dumps(value, indent=2) + '\n')

    def run(argv, check=True, timeout=40):
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout,
                                env={'PATH': '/home/neal/.local/bin:/usr/bin:/bin', 'HOME': '/root', 'COMPOSE_DISABLE_ENV_FILE': '1'})
        # Synthetic JWT and environment must not enter command evidence.
        safe = argv[:4] + ['<fixture JS omitted>'] if 'node' in argv and '-e' in argv else argv
        records.append({'argv': safe, 'exit': result.returncode})
        save('commands.json', records)
        if check and result.returncode:
            raise RuntimeError(f'{safe}: exit {result.returncode}: {result.stderr[:1000]}')
        return result

    def docker(*argv, **kw):
        return run(['/usr/bin/docker', *argv], **kw)

    def absent(cid):
        return not docker('ps', '-a', '--no-trunc', '--filter', 'id=' + cid, '--format', '{{.ID}}').stdout.strip()

    def props():
        keys = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID', 'Result', 'ExecMainStatus', 'StatusText', 'ActiveEnterTimestampMonotonic']
        text = run(['systemctl', 'show', unit, *['--property=' + k for k in keys]]).stdout
        return dict(line.split('=', 1) for line in text.splitlines() if '=' in line)

    def wait_stopped():
        deadline = time.monotonic() + 60
        while True:
            state = props()
            if state['MainPID'] == '0' and state['ActiveState'] in ('failed', 'inactive'):
                return state
            assert time.monotonic() < deadline, state
            time.sleep(.2)

    def start(label, healthy=True):
        prior_ready = props()['ActiveEnterTimestampMonotonic']
        run(['systemctl', 'start', '--no-block', unit])
        deadline = time.monotonic() + 100
        while True:
            observed = docker('inspect', name, check=False)
            if observed.returncode == 0:
                snapshot = json.loads(observed.stdout)[0]
                if snapshot['Id'] not in ids:
                    ids.append(snapshot['Id'])
                save(label + '-observed-host.json', snapshot['HostConfig'])
                save(label + '-observed-state.json', snapshot['State'])
            state = props()
            if state['ActiveState'] in ('active', 'failed', 'inactive'):
                break
            assert time.monotonic() < deadline
            time.sleep(.05)
        save(label + '-unit.json', state)
        save(label + '-journal.json', {'text': run(['journalctl', '-u', unit, '--no-pager', '-n', '80', '-o', 'cat']).stdout})
        if not healthy:
            assert state['ActiveState'] == 'failed' and state['MainPID'] == '0'
            assert state['ActiveEnterTimestampMonotonic'] == prior_ready, state
            assert not state['StatusText'], state
            return
        assert state['ActiveState'] == 'active' and 'liveness' in state['StatusText'], state
        pids.append(int(state['MainPID']))
        metadata = json.loads(docker('inspect', name).stdout)[0]
        cid = metadata['Id']
        if cid not in ids:
            ids.append(cid)
        mapped.ownership = json.loads((fixture / 'state/ownership.json').read_text())
        mapped.verify_state(metadata, image, env, cid, image_config)
        assert metadata['HostConfig']['NetworkMode'] == 'none' and not metadata['HostConfig']['PortBindings']
        # Synthetic-only environment; omit it rather than teach logging credentials.
        metadata['Config'].pop('Env', None)
        save(label + '-container.json', metadata)
        docker('exec', '-d', cid, 'node', '-e', bridge)
        deadline = time.monotonic() + 10
        while docker('exec', cid, 'node', '-e', "fetch('http://127.0.0.1:18643/counts',{signal:AbortSignal.timeout(1000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))", check=False).returncode:
            assert time.monotonic() < deadline
            time.sleep(.1)
        return cid

    def request(cid, expected, auth='valid'):
        code = """
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const headers={'content-type':'application/json',origin:'https://command.example.test','x-jarvis-command':'1'};
AUTH
const r=await fetch('http://127.0.0.1:3000/api/live/runs',{method:'POST',headers,body:JSON.stringify({sessionId:'jc_'+'a'.repeat(32),clientRequestId:'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e',input:'Synthetic storage test'}),signal:AbortSignal.timeout(4000)});const body=await r.json();assert.equal(r.status,EXPECTED,JSON.stringify(body));console.log(JSON.stringify(body));})().catch(e=>{console.error(e);process.exit(1)});
"""
        authcode = "headers['cf-access-jwt-assertion']=fs.readFileSync('/run/jarvis-command/cloudflare-jwks/jwt','utf8');" if auth == 'valid' else ("headers['cf-access-jwt-assertion']='invalid.jwt.value';" if auth == 'invalid' else '')
        return json.loads(docker('exec', cid, 'node', '-e', code.replace('AUTH', authcode).replace('EXPECTED', str(expected))).stdout)

    def count(cid):
        return json.loads(docker('exec', cid, 'node', '-e', "fetch('http://127.0.0.1:18643/counts',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).then(x=>console.log(JSON.stringify(x)))").stdout)['mutations']

    try:
        manifest = json.loads((args.parent_image_evidence / 'app-source-sha256.json').read_text())
        assert all(digest(ROOT / p) == h for p, h in manifest.items()), 'rebuild required: input drift'
        image = json.loads((args.parent_image_evidence / 'SUCCESS.json').read_text())['images']['app']['image_id']
        image_info = json.loads(docker('image', 'inspect', image).stdout)[0]
        source_hash = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
        assert image_info['Id'] == image and image_info['Config']['Labels']['org.jarvis-command.source-sha256'] == source_hash
        image_config = image_info['Config']
        save('image-binding.json', {'image': image, 'source_hash': source_hash, 'inputs': manifest})
        fixture = Path(tempfile.mkdtemp(prefix='jc-supervised-', dir='/var/lib'))
        fixture.chmod(0o700)
        name = fixture.name
        unit = name + '.service'
        unitfile = Path('/run/systemd/system') / unit
        assert not unitfile.exists()
        for directory in ('storage', 'state', 'jwks', 'public'):
            (fixture / directory).mkdir(mode=0o700 if directory in ('storage', 'state') else 0o755)
        ledger = fixture / 'storage/audit/events.jsonl'
        helper = fixture / 'helper'
        shutil.copyfile(ROOT / 'deploy/prepare-audit-storage.py', helper); helper.chmod(0o700)
        initial = json.loads(run([str(helper), 'prepare', '--trusted-root', str(fixture / 'storage'), '--path', str(ledger)]).stdout)
        source = (ROOT / 'deploy/supervised-command-app.py').read_text()
        substitutions = {
            '/usr/local/libexec/jarvis-command-prepare-audit-storage': str(helper),
            '/srv/jarvis-command/app-command-storage.compose.yaml': str(fixture / 'storage.yaml'),
            '/srv/jarvis-command/compose.yaml': str(fixture / 'base.yaml'),
            '/etc/jarvis-command/release.env': str(fixture / 'release.env'),
            '/etc/jarvis-command/app.env': str(fixture / 'app.env'),
            '/var/lib/jarvis-command-supervisor': str(fixture / 'state'),
            '/var/lib/jarvis-command/cloudflare-jwks': str(fixture / 'jwks'),
            '/var/lib/jarvis-command': str(fixture / 'storage'),
            '/srv/jarvis-command/public/.well-known': str(fixture / 'public'),
            '"jarvis-command-app"': json.dumps(name),
            '"jarvis-command-supervised"': json.dumps(name),
            "'network_mode': 'host'": "'network_mode': 'none'",
            "'NetworkMode': 'host'": "'NetworkMode': 'none'",
        }
        mapped_source = source
        for before, after in substitutions.items():
            assert before in mapped_source
            mapped_source = mapped_source.replace(before, after)
        runner = fixture / 'supervisor.py'
        runner.write_text(mapped_source); runner.chmod(0o700)
        # No code instrumentation or guard replacement. Retain the mapped copy as evidence.
        (evidence / 'mapped-supervisor.py').write_text(mapped_source)
        save('mapping.json', {'substitutions': substitutions, 'source_sha256': digest(ROOT / 'deploy/supervised-command-app.py'), 'mapped_sha256': digest(runner), 'helper_sha256': digest(helper)})
        mapped = load(runner)
        # Reuse the exact ephemeral JWT and authoritative status protocol, not a mock BFF.
        tree = ast.parse((ROOT / 'deploy/verify-audit-storage-image.py').read_text())
        constants = {n.targets[0].id: n.value.value for n in ast.walk(tree) if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)}
        bridge = constants['upstream']
        run([NODE, '-e', constants['script'], str(fixture / 'jwks')])
        env = {'AUTH_MODE': 'cloudflare', 'COMMAND_MODE': 'enabled', 'CF_ACCESS_TEAM_DOMAIN': 'fixture.cloudflareaccess.com', 'CF_ACCESS_AUD': 'a'*64, 'CF_ACCESS_EMAIL_SHA256': hashlib.sha256(b'operator@example.test').hexdigest(), 'CF_ACCESS_JWKS_FILE': '/run/jarvis-command/cloudflare-jwks/jwks.json', 'HERMES_READ_PROXY_KEY': 'synthetic-read-'*3, 'HERMES_API_BASE_URL': 'http://127.0.0.1:18642', 'PUBLIC_ORIGIN': 'https://command.example.test', 'HERMES_COMMAND_API_BASE_URL': 'http://127.0.0.1:18643', 'HERMES_COMMAND_PROXY_KEY': 'synthetic-command-'*3, 'COMMAND_AUDIT_LOG_PATH': str(ledger), 'PORT': '3000'}
        (fixture / 'app.env').write_text(''.join(k+'='+v+'\n' for k,v in env.items())); (fixture / 'app.env').chmod(0o600)
        (fixture / 'release.env').write_text('JARVIS_COMMAND_APP_IMAGE='+image+'\n'); (fixture / 'release.env').chmod(0o600)
        base = (ROOT / 'deploy/app.compose.yaml').read_text()
        storage = (ROOT / 'deploy/app-command-storage.compose.yaml').read_text()
        for before, after in substitutions.items():
            if before.startswith('/'):
                base = base.replace(before, after); storage = storage.replace(before, after)
        base = base.replace('container_name: jarvis-command-app', 'container_name: '+name).replace('network_mode: host', 'network_mode: none')
        (fixture / 'base.yaml').write_text(base); (fixture / 'storage.yaml').write_text(storage)
        # Inherit relevant sandbox literally; deliberately omit production dependency graph.
        service = (ROOT / 'deploy/jarvis-command-app.service').read_text()
        sandbox = service[service.index('NoNewPrivileges=yes'):service.index('[Install]')].strip()
        unittext = f'[Unit]\nDescription=Disposable supervised app acceptance\n[Service]\nType=notify\nNotifyAccess=all\nExecStart={runner} --monitor\nExecStopPost={runner} --cleanup\nRestart=no\nTimeoutStartSec=90\nTimeoutStopSec=150\nKillMode=control-group\n{sandbox}\n'
        unitfile.write_text(unittext)
        (evidence / 'fixture.service').write_text(unittext)
        run(['systemctl', 'daemon-reload'])
        # Live CREATED mismatch probe: change only a stopped disposable candidate's
        # resource limit; feed exact daemon metadata to the unchanged validator.
        # This is validator-level live evidence, not a supervisor crash-window test.
        project = name + '-' + 'a'*32
        compose = ['/usr/bin/docker', 'compose', '--project-name', project, '--env-file', str(fixture / 'release.env'), '-f', str(fixture / 'base.yaml'), '-f', str(fixture / 'storage.yaml')]
        run(compose + ['create', '--no-build', 'app'])
        created = json.loads(docker('inspect', name).stdout)[0]
        ids.append(created['Id'])
        save('created-host-policy.json', {'actual': created['HostConfig'], 'expected': mapped.HOST_POLICY})
        mapped.ownership = {'invocation': 'b'*32, 'token': 'a'*32, 'image': image, 'id': created['Id']}
        mapped.verify_state(created, image, env, created['Id'], image_config, running=False)
        docker('update', '--memory', '256m', created['Id'])
        mismatch = json.loads(docker('inspect', created['Id']).stdout)[0]
        assert mismatch['State']['Status'] == 'created' and not mismatch['State']['Running']
        try:
            mapped.verify_state(mismatch, image, env, created['Id'], image_config, running=False)
        except mapped.Refused as error:
            assert str(error) == 'actual container hardening mismatch'
        else:
            raise AssertionError('unsafe created container accepted')
        save('created-mismatch.json', {'id': created['Id'], 'host': mismatch['HostConfig'], 'state': mismatch['State'], 'classification': 'live validator-level rejection; no START issued'})
        assertions['live_created_resource_mismatch_denied_without_start'] = True
        docker('rm', '--force', created['Id'])
        (fixture / 'base.yaml').write_text(base.replace('read_only: true', 'read_only: false'))
        start('unsafe-effective', healthy=False)
        assert not docker('ps', '-a', '--filter', 'name=^/'+name+'$', '--format', '{{.ID}}').stdout.strip()
        assert not (fixture / 'state/ownership.json').exists()
        assertions['unsafe_effective_denied'] = True
        (fixture / 'base.yaml').write_text(base)
        run(['systemctl', 'reset-failed', unit], check=False)
        ledger.rename(ledger.with_suffix('.saved'))
        start('missing-initial', healthy=False)
        assert not ledger.exists() and not (fixture / 'state/ownership.json').exists()
        assertions['missing_startup_no_creation'] = True
        ledger.with_suffix('.saved').rename(ledger)
        run(['systemctl', 'reset-failed', unit], check=False)
        first = start('first')
        request(first, 401, 'missing'); request(first, 401, 'invalid'); assert count(first) == 0
        assertions['missing_invalid_jwt_zero_upstream'] = True
        admitted = request(first, 200); assert not admitted['replayed'] and count(first) == 1
        persisted = ledger.read_bytes(); assert b'run.started' in persisted and b'Synthetic storage test' not in persisted
        save('admission.json', admitted)
        assertions['durable_authenticated_admission'] = {'inode': ledger.stat().st_ino, 'ledger_sha256': digest(ledger), 'upstream_count': count(first)}
        run(['systemctl', 'kill', '--kill-whom=main', '--signal=SIGKILL', unit])
        save('sigkill-unit.json', wait_stopped()); assert absent(first) and not (fixture / 'state/ownership.json').exists()
        assert ledger.stat().st_ino == initial['inode']
        run(['systemctl', 'reset-failed', unit], check=False)
        second = start('second')
        replay = request(second, 200)
        assert replay['publicRunId'] == admitted['publicRunId'] and replay['replayed'] and count(second) == 0
        assert ledger.stat().st_ino == initial['inode']
        save('replay.json', replay)
        assertions['sigkill_replay'] = {'first_count': 1, 'second_count': 0, 'same_inode': True, 'same_public_run_id': True}
        ledger.chmod(0o644); request(second, 503); assert count(second) == 0
        assertions['damaged_ledger_admission_denied'] = True
        run(['systemctl', 'stop', unit], timeout=90)
        save('normal-stop-unit.json', wait_stopped()); assert absent(second)
        assertions['normal_stop_exact_second_removed'] = second
        ledger.chmod(0o600); ledger.write_bytes(b'corrupt\n')
        corrupt_inode = ledger.stat().st_ino
        # Fresh unit identity resets READY timestamps; same mapped supervisor/state.
        run(['systemctl', 'reset-failed', unit], check=False)
        run(['systemctl', 'daemon-reload'])
        start('corrupt', healthy=False)
        assert ledger.read_bytes() == b'corrupt\n' and ledger.stat().st_ino == corrupt_inode
        assertions['corrupt_startup_no_reinitialization'] = True
        ledger.rename(ledger.with_suffix('.saved'))
        run(['systemctl', 'reset-failed', unit], check=False)
        start('missing', healthy=False)
        assert not ledger.exists()
        assertions['missing_startup_no_creation'] = True
        (fixture / 'base.yaml').write_text(base.replace('read_only: true', 'read_only: false'))
        run(['systemctl', 'reset-failed', unit], check=False)
        start('unsafe-effective', healthy=False)
        assertions['unsafe_effective_denied'] = True
        assert not docker('ps', '-a', '--filter', 'name=^/'+name+'$', '--format', '{{.ID}}').stdout.strip()
        assert all(digest(ROOT / p) == h for p, h in manifest.items())
        outcome.update(passed=True, assertions=assertions, image=image, initial_storage=initial,
                       limitations=['Synthetic bridge only; no actual proxies/browser/Hermes or production cutover.', 'Created mismatch is live validator-level evidence; supervisor no-START/READY and early ambiguous CREATE are separately covered by focused hostile tests.'])
    except BaseException as error:
        outcome.update(error=repr(error), assertions=assertions)
        raise
    finally:
        cleanup = {'ids': ids, 'unit': unit, 'fixture': str(fixture), 'pids': pids, 'verified': False}
        try:
            if unitfile and unitfile.exists():
                run(['systemctl', 'stop', unit], check=False, timeout=170)
                save('final-journal.json', {'text': run(['journalctl', '-u', unit, '--no-pager', '-n', '150', '-o', 'cat']).stdout})
                state = props(); assert state['MainPID'] == '0'
            if fixture:
                ownership_path = fixture / 'state/ownership.json'
                if ownership_path.exists():
                    save('unresolved-ownership.json', json.loads(ownership_path.read_text()))
                    cleanup['explicit_reconciliation_required'] = True
                # Exact name discovery is fixture-owned; never use project-wide/broad removal.
                remaining = docker('ps', '-a', '--no-trunc', '--filter', 'name=^/'+fixture.name+'$', '--format', '{{.ID}}').stdout.split()
                for cid in remaining:
                    if cid not in ids: ids.append(cid)
                    docker('rm', '--force', cid)
                assert all(absent(cid) for cid in ids)
            if unitfile and unitfile.exists():
                unitfile.unlink()
                run(['systemctl', 'reset-failed', unit], check=False)
                run(['systemctl', 'daemon-reload'])
                final = props(); assert final['LoadState'] == 'not-found' and final['MainPID'] == '0'
                cleanup['unit_readback'] = final
            assert all(not Path('/proc', str(pid)).exists() for pid in pids)
            if fixture:
                shutil.rmtree(fixture); assert not fixture.exists()
            cleanup['verified'] = True
        finally:
            save('cleanup.json', cleanup)
            outcome['cleanup_verified'] = cleanup['verified']
            save('runtime-result.json', outcome)
    print('PASS real supervised application acceptance; exact fixture cleanup verified')


if __name__ == '__main__':
    main()
