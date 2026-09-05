"""Real subprocess/socket regressions; never invokes Docker."""
import importlib.util
import os
import copy
import json
from pathlib import Path

import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('supervised-command-app.py')
spec = importlib.util.spec_from_file_location('supervisor', SOURCE)
assert spec is not None and spec.loader is not None
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


FIXTURE = json.loads(SOURCE.with_name('fixtures').joinpath('app-supervisor-real.json').read_text())


class HardeningTests(unittest.TestCase):
    def test_started_oom_null_requires_explicit_linux_cgroup2_no_disable_support(self):
        state = copy.deepcopy(FIXTURE['created'])
        metadata = FIXTURE['image']['Config']
        env = FIXTURE['compose']['services']['app']['environment']
        record = dict(invocation='1'*32, token='2'*32, image=state['Image'], id=state['Id'])
        state['Config']['Labels'].update({'com.docker.compose.project': app.PROJECT+'-'+record['token'], 'com.docker.compose.service': 'app'})
        protected = {m['Destination']: m['Source'] for m in state['Mounts'][:2]}
        for mount in state['Mounts']:
            if mount['Destination'] == app.AUDIT:
                mount['Source'] = app.AUDIT
        platform = {'OSType': 'linux', 'CgroupVersion': '2', 'OomKillDisable': False}
        with patch.object(app, 'ownership', record), patch.object(app, 'PROTECTED', protected), patch.dict(app.HOST_POLICY, {'NetworkMode': 'none'}), patch.object(app, 'run') as run:
            run.return_value = (json.dumps(platform), 0)
            def verify():
                app.verify_state(state, state['Image'], env, state['Id'], metadata, starting=True)
            state['State'] = {'Running': True, 'Status': 'running', 'Health': {'Status': 'starting'}}
            state['HostConfig']['OomKillDisable'] = None
            try:
                verify()
            except app.Refused as error:
                self.fail(f'authoritative cgroup2 START null refused: {error}')
            run.assert_called_with([app.DOCKER, 'info', '--format', '{{json .}}'], timeout=10)
            state['State']['Health']['Status'] = 'healthy'
            verify()
            state['HostConfig']['OomKillDisable'] = False
            run.return_value = (json.dumps({'OSType': 'linux', 'CgroupVersion': '1', 'OomKillDisable': True}), 0)
            verify()
            run.return_value = (json.dumps(platform), 0)
            for value in (True, 0, 1, 'false', 'null', [], {}):
                state['HostConfig']['OomKillDisable'] = value
                with self.subTest(value=value), self.assertRaises(app.Refused): verify()
            del state['HostConfig']['OomKillDisable']
            with self.assertRaises(app.Refused): verify()
            state['HostConfig']['OomKillDisable'] = None
            for key, value in [('OSType', 'windows'), ('OSType', None), ('CgroupVersion', '1'), ('CgroupVersion', 2), ('OomKillDisable', True), ('OomKillDisable', 0), ('OomKillDisable', None)]:
                run.return_value = (json.dumps({**platform, key: value}), 0)
                with self.subTest(platform=(key, value)), self.assertRaises(app.Refused): verify()
            for key in platform:
                run.return_value = (json.dumps({k: v for k, v in platform.items() if k != key}), 0)
                with self.subTest(missing=key), self.assertRaises(app.Refused): verify()
            for value in (None, [], 'bad', True):
                run.return_value = (json.dumps(value), 0)
                with self.assertRaises(app.Refused): verify()
            run.return_value = ('{', 0)
            with self.assertRaises(ValueError): verify()
            run.side_effect = app.Refused('daemon unavailable')
            with self.assertRaises(app.Refused): verify()
            run.side_effect = None
            run.return_value = (json.dumps(platform), 0)
            state['State'] = {'Running': False, 'Status': 'created'}
            with self.assertRaises(app.Refused):
                app.verify_state(state, state['Image'], env, state['Id'], metadata, running=False)
            state['HostConfig']['OomKillDisable'] = False
            app.verify_state(state, state['Image'], env, state['Id'], metadata, running=False)

    def test_mount_options_and_false_safety_values(self):
        volumes = FIXTURE['compose']['services']['app']['volumes']
        for key, value in [('read_only', 0), ('read_only', 'false'), ('consistency', 'cached'), ('bind', {'propagation': 'shared'})]:
            bad = copy.deepcopy(volumes); bad[2][key] = value
            with self.subTest(key=key), self.assertRaises(app.Refused):
                app.check_mounts(bad)
        actual = [{'Type': 'bind', 'Source': v['source'], 'Destination': v['target'], 'RW': not v.get('read_only', False), 'Propagation': 'rprivate'} for v in volumes]
        app.check_mounts(actual, actual=True)
        bad = copy.deepcopy(actual); bad[0]['Propagation'] = 'shared'
        with self.assertRaises(app.Refused): app.check_mounts(bad, actual=True)
        bad = copy.deepcopy(actual); bad.append({'Type': 'tmpfs', 'Destination': '/tmp', 'RW': False})
        with self.assertRaises(app.Refused): app.check_mounts(bad, actual=True)

    def test_created_static_matrix_with_explicit_private_fixture_policy(self):
        state = copy.deepcopy(FIXTURE['created'])
        metadata = FIXTURE['image']['Config']
        env = FIXTURE['compose']['services']['app']['environment']
        record = dict(invocation='1'*32, token='2'*32, image=state['Image'], id=state['Id'])
        state['Config']['Labels'].update({'com.docker.compose.project': app.PROJECT+'-'+record['token'], 'com.docker.compose.service': 'app'})
        protected = {m['Destination']: m['Source'] for m in state['Mounts'][:2]}
        # Map private sources, never broaden production source acceptance.
        for mount in state['Mounts']:
            if mount['Destination'] == app.AUDIT:
                mount['Source'] = app.AUDIT
        with patch.object(app, 'ownership', record), patch.object(app, 'PROTECTED', protected), patch.dict(app.HOST_POLICY, {'NetworkMode': 'none'}):
            def verify(s):
                app.verify_state(s, state['Image'], env, state['Id'], metadata, running=False)
            verify(state)
            changes = {'Privileged': True, 'ReadonlyRootfs': 'true', 'Init': 1, 'CapAdd': ['SYS_ADMIN'],
                       'CapDrop': [], 'SecurityOpt': ['no-new-privileges:false'], 'PidsLimit': True,
                       'Memory': 0, 'NanoCpus': float('nan'), 'MemorySwap': -1, 'Ulimits': [],
                       'Tmpfs': {'/tmp': 'rw'}, 'NetworkMode': 'host', 'PortBindings': {'3000/tcp': []},
                       'PublishAllPorts': 'false', 'ExtraHosts': ['escape:127.0.0.1'], 'Devices': [{}],
                       'PidMode': 'host', 'IpcMode': 'host', 'UsernsMode': 'host', 'GroupAdd': ['0'],
                       'RestartPolicy': {'Name': 'always', 'MaximumRetryCount': 0}, 'OomKillDisable': True}
            for key, value in changes.items():
                with self.subTest(host=key):
                    bad = copy.deepcopy(state); bad['HostConfig'][key] = value
                    with self.assertRaises(app.Refused): verify(bad)
            for key in app.HOST_POLICY:
                with self.subTest(absent=key):
                    bad = copy.deepcopy(state); del bad['HostConfig'][key]
                    with self.assertRaises(app.Refused): verify(bad)
            for key, value in [('Entrypoint', ['sh']), ('Cmd', []), ('WorkingDir', '/tmp'),
                               ('Healthcheck', {'Test': ['NONE']}), ('Env', state['Config']['Env']+['EXTRA=unsafe'])]:
                with self.subTest(process=key):
                    bad = copy.deepcopy(state); bad['Config'][key] = value
                    with self.assertRaises(app.Refused): verify(bad)
            for key, value in [('Networks', {}), ('Ports', {'3000/tcp': [{}]})]:
                bad = copy.deepcopy(state); bad['NetworkSettings'][key] = value
                with self.assertRaises(app.Refused): verify(bad)
            for section in ('HostConfig', 'NetworkSettings', 'Config', 'State'):
                for value in (None, [], True, 'false'):
                    bad = copy.deepcopy(state); bad[section] = value
                    with self.subTest(section=section, value=value), self.assertRaises(app.Refused): verify(bad)
            for key in ('Aliases', 'Links', 'DriverOpts', 'IPAMConfig'):
                bad = copy.deepcopy(state); del bad['NetworkSettings']['Networks']['none'][key]
                with self.subTest(network_absent=key), self.assertRaises(app.Refused): verify(bad)

    def test_real_normalized_compose_contract_and_escape_matrix(self):
        config = FIXTURE['compose']
        image = FIXTURE['image']['Id']
        env = config['services']['app']['environment']
        app.compose_config(config, image, env)
        changes = {
            'privileged': True, 'ports': ['8080:3000'], 'networks': {'host': {'aliases': ['escape']}},
            'extra_hosts': ['escape:127.0.0.1'], 'devices': ['/dev/null'], 'cap_add': ['SYS_ADMIN'],
            'pid': 'host', 'ipc': 'host', 'userns_mode': 'host', 'network_mode': 'bridge',
            'cap_drop': [], 'security_opt': [], 'pids_limit': 0, 'mem_limit': '0',
            'cpus': float('nan'), 'ulimits': {}, 'tmpfs': ['/tmp'], 'restart': 'always',
            'init': 'true', 'build': '.', 'extends': {'file': 'other'}, 'x-escape': {},
            'command': ['sh'], 'entrypoint': [], 'working_dir': '/tmp', 'healthcheck': {'disable': True},
        }
        for key, value in changes.items():
            with self.subTest(key=key):
                bad = copy.deepcopy(config)
                bad['services']['app'][key] = value
                with self.assertRaises(app.Refused):
                    app.compose_config(bad, image, env)
        for key in ('init', 'read_only', 'pids_limit', 'mem_limit', 'cpus', 'ulimits', 'tmpfs', 'network_mode'):
            with self.subTest(absent=key):
                bad = copy.deepcopy(config)
                del bad['services']['app'][key]
                with self.assertRaises(app.Refused):
                    app.compose_config(bad, image, env)
        for key, value in [('cpus', True), ('pids_limit', True), ('read_only', 'true')]:
            bad = copy.deepcopy(config)
            bad['services']['app'][key] = value
            with self.assertRaises(app.Refused):
                app.compose_config(bad, image, env)


class SupervisorTransportTests(unittest.TestCase):
    def test_partial_next_does_not_strand_committed_same_invocation(self):
        with tempfile.TemporaryDirectory(prefix='jc-owner-') as root:
            record = dict(invocation='1'*32, token='2'*32, image='sha256:'+'a'*64, id='c'*64)
            with patch.object(app, 'STATE', root), patch.object(app, 'TRUST_ROOT', root), patch.object(app, 'TRUST_UID', os.getuid()):
                with app.invocation_lock() as directory:
                    app.save_ownership(directory, record)
                    pending = Path(root) / 'ownership.next'
                    pending.write_bytes(b'{')
                    pending.chmod(0o600)
                    with patch.object(app, 'run', return_value=('', 0)):
                        with self.assertRaises(app.Refused):
                            app.cleanup(directory, '9'*32)
                        self.assertTrue(pending.exists())
                        app.cleanup(directory, record['invocation'])
                    self.assertFalse(pending.exists())
                    app.save_ownership(directory, record)
                    pending.symlink_to(Path(root) / 'ownership.json')
                    with self.assertRaises((OSError, app.Refused)):
                        app.cleanup(directory, record['invocation'])
                    self.assertEqual(app.read_ownership(), record)

    def test_deleted_id_cleanup_retry_proves_absence_not_inspect_failure(self):
        with tempfile.TemporaryDirectory(prefix='jc-owner-') as root:
            record = dict(invocation='1'*32, token='2'*32, image='sha256:'+'a'*64, id='c'*64)
            with patch.object(app, 'STATE', root), patch.object(app, 'TRUST_ROOT', root), patch.object(app, 'TRUST_UID', os.getuid()):
                with app.invocation_lock() as directory:
                    app.save_ownership(directory, record)
                    with patch.object(app, 'run', return_value=('', 0)) as run, patch.object(app, 'inspect', side_effect=app.Refused('daemon unavailable')):
                        app.cleanup(directory, record['invocation'])
                        self.assertIsNone(app.read_ownership())
                        self.assertIn('--no-trunc', run.call_args.args[0])
                        app.cleanup(directory, record['invocation'])
                    app.save_ownership(directory, record)
                    with patch.object(app, 'run', side_effect=app.Refused('daemon unavailable')):
                        with self.assertRaises(app.Refused):
                            app.cleanup(directory, record['invocation'])
                    self.assertEqual(app.read_ownership(), record)

    def test_invocation_lock_refuses_competitor_and_is_not_inherited(self):
        with tempfile.TemporaryDirectory(prefix='jc-owner-') as root:
            with patch.object(app, 'STATE', root, create=True), patch.object(app, 'TRUST_ROOT', root), patch.object(app, 'TRUST_UID', os.getuid()):
                with app.invocation_lock():
                    with self.assertRaises(app.Refused):
                        with app.invocation_lock():
                            self.fail('competitor admitted')
                    out, _ = app.run([sys.executable, '-c', 'import os; print([os.readlink("/proc/self/fd/"+f) for f in os.listdir("/proc/self/fd") if os.path.exists("/proc/self/fd/"+f)])'])
                    self.assertNotIn(root + '/lock', out)

    def test_record_metadata_rejects_symlink_hardlink_and_wrong_mode(self):
        with tempfile.TemporaryDirectory(prefix='jc-record-') as root:
            with patch.object(app, 'STATE', root), patch.object(app, 'TRUST_ROOT', root), patch.object(app, 'TRUST_UID', os.getuid()):
                record = Path(root) / 'ownership.json'
                target = Path(root) / 'other'
                target.write_text('{}')
                target.chmod(0o600)
                record.symlink_to(target)
                with self.assertRaises(OSError):
                    app.read_ownership()
                record.unlink()
                os.link(target, record)
                with self.assertRaises(app.Refused):
                    app.read_ownership()
                record.unlink()
                record.write_text('{}')
                record.chmod(0o644)
                with self.assertRaises(app.Refused):
                    app.read_ownership()

    def test_signal_does_not_target_reaped_child(self):
        from types import SimpleNamespace
        with patch.object(app, 'child', SimpleNamespace(pid=123, returncode=0)):
            with patch.object(app.os, 'killpg') as kill:
                app.on_signal(15, None)
                app.requested_signal = 0
                kill.assert_not_called()

    def test_real_notify_socket_and_scrubbed_docker_environment(self):
        with tempfile.TemporaryDirectory(prefix='jc-notify-') as root:
            with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as receiver:
                address = root + '/notify'
                receiver.bind(address)
                receiver.settimeout(1)
                with patch.dict(os.environ, {'NOTIFY_SOCKET': address,
                                            'COMPOSE_FILE': '/never-used',
                                            'SYNTHETIC_SECRET': 'never-forward'}):
                    _, status = app.run([app.NOTIFY, '--no-block', '--ready'], check=False)
                    self.assertEqual(status, 0)
                    self.assertIn(b'READY=1', receiver.recv(4096))
                    out, _ = app.run([sys.executable, '-c',
                                     'import os; print(sorted(os.environ))'])
                    self.assertNotIn('NOTIFY_SOCKET', out)
                    self.assertNotIn('SYNTHETIC_SECRET', out)
                    self.assertNotIn('COMPOSE_FILE', out)

    def test_timeout_kills_pipe_holding_descendant_with_bound(self):
        # Outer harness bounds the regression even on the old unbounded communicate.
        script = '''
import importlib.util,sys,time
s=importlib.util.spec_from_file_location('s',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
try:
 m.run([sys.executable,'-c','import subprocess,time,sys; subprocess.Popen([sys.executable,"-c","import time; time.sleep(3)"]); time.sleep(3)'],timeout=.1)
except m.Refused as e:
 assert e.status == 124
else: raise AssertionError('timeout accepted')
'''
        before = time.monotonic()
        result = subprocess.run([sys.executable, '-c', script, str(SOURCE)],
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(time.monotonic() - before, 2)


if __name__ == '__main__':
    unittest.main()
