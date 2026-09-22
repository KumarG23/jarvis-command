"""Fixed-host release ordering; real file snapshots, isolated service fixtures."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('single-user-release.py')


class ReleaseTests(unittest.TestCase):
    def test_app_host_end_to_end_with_isolated_service_state(self):
        for fail_health in [False, True]:
            with self.subTest(fail_health=fail_health), tempfile.TemporaryDirectory() as directory:
                spec = importlib.util.spec_from_file_location('release', SCRIPT)
                release = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(release)
                root = Path(directory)
                release.STAGE = root / 'stage'; release.STAGE.mkdir()
                release.ETC = root / 'etc/jarvis-command'; release.ETC.mkdir(parents=True)
                release.UNITS = root / 'units'; release.UNITS.mkdir()
                release.LIB = root / 'lib'; release.LIB.mkdir()
                release.SOURCE = SCRIPT.parent
                old_image = 'sha256:' + '0' * 64
                new_image = 'sha256:' + '1' * 64
                (release.ETC / 'app.env').write_text('AUTH_MODE=cloudflare\nHOST=127.0.0.1\nPORT=3000\nHERMES_READ_PROXY_KEY=' + 'r' * 64 + '\nCOMMAND_MODE=disabled\n')
                (release.ETC / 'release.env').write_text('JARVIS_COMMAND_APP_IMAGE=' + old_image + '\n')
                (release.STAGE / 'command.key').write_text('c' * 64)
                (release.STAGE / 'app-image.txt').write_text(new_image)
                release.prepare('app')
                mappings = [(source, root / target.relative_to('/') if str(target).startswith('/srv/') else target, mode) for source, target, mode in release.files('app')]
                calls = []
                state = {'image': old_image, 'running': True, 'exists': True, 'fail': fail_health}
                def command(*args):
                    calls.append(args)
                    if args[0] == '/usr/bin/systemctl':
                        if args[1] == 'stop': state['running'] = False
                        if args[1] == 'start':
                            state.update(running=True, exists=True, image=release.environment(release.ETC / 'release.env')['JARVIS_COMMAND_APP_IMAGE'])
                    if args[0] == '/usr/bin/docker':
                        if args[1:3] == ('image', 'inspect'): return new_image
                        if args[1] == 'ps': return 'fixture-container' if state['exists'] else ''
                        if args[1] == 'rm': state['exists'] = False
                        if args[1] == 'inspect': return state['image'] if args[3] == '{{.Image}}' else str(state['running']).lower()
                    return ''
                def http(url, key=None):
                    if url.endswith('/_ready'): return {'ready': True}
                    if state['fail']:
                        state['fail'] = False
                        raise RuntimeError('isolated candidate health failure')
                    return {'status': 'ok', 'readiness': {'artifacts': 'pass'}}
                release.run = command
                release.get_json = http
                host = release.Host('app')
                change = release.FileCutover(root / 'backup', mappings)
                if fail_health:
                    with self.assertRaisesRegex(RuntimeError, 'isolated candidate health failure'):
                        release.cutover(change, host.preflight, host.stop, host.start, host.verify)
                else:
                    release.cutover(change, host.preflight, host.stop, host.start, host.verify)
                self.assertTrue(state['running'])
                self.assertEqual(state['image'], old_image if fail_health else new_image)
                self.assertEqual(release.environment(release.ETC / 'app.env')['COMMAND_MODE'], 'disabled' if fail_health else 'enabled')
                self.assertFalse(any('nftables.service' in call or 'docker.service' in call for call in calls))

    def test_explicit_rollback_checks_snapshot_before_stopping(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            change = release.FileCutover(Path(directory) / 'missing', [])
            calls = []
            with self.assertRaises((OSError, RuntimeError)):
                release.rollback(change, lambda: calls.append('stop'), lambda: calls.append('start'), lambda: None)
            self.assertEqual(calls, [])

    def test_host_uses_only_owned_egress_reload_and_explicit_command_port(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        calls = []
        release.run = lambda *args: calls.append(args) or ''
        release.Host('app').start()
        self.assertIn(('/usr/bin/systemctl', 'reload', 'jarvis-command-egress.service'), calls)
        self.assertIn(('/usr/bin/systemctl', 'start', 'jarvis-command-app.service'), calls)
        self.assertFalse(any('nftables.service' in call or 'docker.service' in call for call in calls))
        with tempfile.TemporaryDirectory() as directory:
            release.STAGE = Path(directory) / 'stage'; release.STAGE.mkdir()
            release.ETC = Path(directory) / 'etc'; release.ETC.mkdir()
            (release.STAGE / 'command.key').write_text('c' * 64)
            (release.STAGE / 'hermes-image.txt').write_text('sha256:' + 'a' * 64)
            (release.ETC / 'read-proxy.env').write_text('HERMES_API_KEY=' + 'h' * 64 + '\nREAD_PROXY_KEY=' + 'r' * 64 + '\n')
            (release.ETC / 'release.env').write_text('JARVIS_COMMAND_READ_PROXY_IMAGE=sha256:' + 'b' * 64 + '\n')
            release.prepare('hermes')
            env = release.environment(release.STAGE / 'command-proxy.env')
            self.assertEqual(env['PORT'], '8647')
            self.assertEqual(env['HERMES_API_KEY'], 'h' * 64)
            self.assertEqual(env['COMMAND_PROXY_KEY'], 'c' * 64)

    def test_fixed_app_plan_keeps_android_and_read_key_and_enables_command_storage(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release.STAGE = root / 'stage'; release.STAGE.mkdir()
            release.ETC = root / 'etc'; release.ETC.mkdir()
            (release.ETC / 'app.env').write_text('AUTH_MODE=cloudflare\nHOST=127.0.0.1\nPORT=3000\nHERMES_READ_PROXY_KEY=' + 'r' * 64 + '\nCOMMAND_MODE=disabled\n')
            (release.ETC / 'release.env').write_text('JARVIS_COMMAND_APP_IMAGE=sha256:' + '0' * 64 + '\n')
            (release.STAGE / 'command.key').write_text('c' * 64)
            (release.STAGE / 'app-image.txt').write_text('sha256:' + '1' * 64)
            release.prepare('app')
            env = release.environment(release.STAGE / 'app.env')
            self.assertEqual(env['HERMES_READ_PROXY_KEY'], 'r' * 64)
            self.assertEqual(env['HERMES_COMMAND_PROXY_KEY'], 'c' * 64)
            self.assertEqual(env['COMMAND_MODE'], 'enabled')
            self.assertEqual(env['COMMAND_AUDIT_LOG_PATH'], '/var/lib/jarvis-command/audit/events.jsonl')
            self.assertEqual(env['ARTIFACTS_MODE'], 'enabled')
            self.assertEqual(env['ARTIFACT_STORAGE_PATH'], '/var/lib/jarvis-command/artifacts')
            targets = [str(target) for _, target, _ in release.files('app')]
            self.assertFalse(any('assetlinks' in target or '.well-known' in target for target in targets))
            self.assertIn('/srv/jarvis-command/app-command-storage.compose.yaml', targets)
            self.assertIn('/usr/local/libexec/jarvis-command-prepare-artifact-storage', targets)
            (release.STAGE / 'command.key').write_text('r' * 64)
            with self.assertRaisesRegex(RuntimeError, 'distinct'):
                release.prepare('app')

    def test_failed_health_restores_bytes_permissions_and_prior_service(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / 'app'; old.write_text('v01'); old.chmod(0o600)
            new = root / 'new'; new.write_text('v02')
            added = root / 'new-dropin'
            calls = []
            def start():
                calls.append(old.read_text())
            def verify():
                if old.read_text() == 'v02':
                    raise RuntimeError('health failed')
            change = release.FileCutover(root / 'backup', [(new, old, 0o644), (new, added, 0o644)])
            with self.assertRaisesRegex(RuntimeError, 'health failed'):
                release.cutover(change, lambda: None, lambda: calls.append('stop'), start, verify)
            self.assertEqual(old.read_text(), 'v01')
            self.assertEqual(old.stat().st_mode & 0o777, 0o600)
            self.assertFalse(added.exists())
            self.assertEqual(calls, ['stop', 'v02', 'stop', 'v01'])

    def test_missing_preflight_performs_no_cutover(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / 'app'; old.write_text('v01')
            calls = []
            change = release.FileCutover(root / 'backup', [])
            def fail():
                raise RuntimeError('required readiness missing')
            with self.assertRaisesRegex(RuntimeError, 'required readiness missing'):
                release.cutover(change, fail, lambda: calls.append('stop'), lambda: calls.append('start'), lambda: None)
            self.assertEqual(old.read_text(), 'v01')
            self.assertFalse((root / 'backup').exists())
            self.assertEqual(calls, [])

    def test_success_installs_exact_bytes_and_preserves_private_baseline(self):
        self.assertTrue(SCRIPT.exists(), 'fixed-host release implementation is missing')
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'; source.mkdir()
            target = root / 'target'; target.mkdir()
            (source / 'compose').write_text('v02 immutable image')
            (target / 'compose').write_text('v01 immutable image')
            (target / 'compose').chmod(0o600)
            calls = []
            change = release.FileCutover(root / 'backup', [(source / 'compose', target / 'compose', 0o644)])
            release.cutover(change, lambda: calls.append('preflight'), lambda: calls.append('stop'), lambda: calls.append('start'), lambda: calls.append('verify'))
            self.assertEqual(calls, ['preflight', 'stop', 'start', 'verify'])
            self.assertEqual((target / 'compose').read_bytes(), (source / 'compose').read_bytes())
            self.assertEqual((root / 'backup/0').read_text(), 'v01 immutable image')
            self.assertEqual((root / 'backup').stat().st_mode & 0o777, 0o700)

    def test_artifact_snapshot_records_checksums_and_refuses_tampering(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifacts = root / 'artifacts'
            (artifacts / 'artifacts' / ('art_' + 'a' * 32) / 'versions').mkdir(parents=True)
            blob = artifacts / 'artifacts' / ('art_' + 'a' * 32) / 'versions' / '1.blob'
            blob.write_bytes(b'exact artifact bytes')
            blob.chmod(0o600)
            snapshot = release.ArtifactTreeSnapshot(root / 'backup' / 'artifact-storage', artifacts)
            snapshot.snapshot()
            records = snapshot.verify_snapshot()
            self.assertIn(hashlib.sha256(b'exact artifact bytes').hexdigest(), json.dumps(records))
            copied = snapshot.tree / 'artifacts' / ('art_' + 'a' * 32) / 'versions' / '1.blob'
            copied.write_bytes(b'tampered')
            with self.assertRaisesRegex(RuntimeError, 'inventory mismatch'):
                snapshot.verify_snapshot()

    def test_artifact_snapshot_refuses_symlinks_before_copy(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifacts = root / 'artifacts'
            artifacts.mkdir()
            outside = root / 'outside'
            outside.write_text('must not be copied or modified')
            (artifacts / 'escape').symlink_to(outside)
            snapshot = release.ArtifactTreeSnapshot(root / 'backup' / 'artifact-storage', artifacts)
            with self.assertRaisesRegex(RuntimeError, 'symlink refused'):
                snapshot.snapshot()
            self.assertEqual(outside.read_text(), 'must not be copied or modified')
            self.assertFalse(snapshot.backup.exists())

    def test_artifact_rollback_restores_exact_tree_after_candidate_cleanup(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifacts = root / 'artifacts'
            versions = artifacts / 'artifacts' / ('art_' + 'b' * 32) / 'versions'
            versions.mkdir(parents=True)
            blob = versions / '1.blob'
            blob.write_bytes(b'original')
            blob.chmod(0o600)
            snapshot = release.ArtifactTreeSnapshot(root / 'backup' / 'artifact-storage', artifacts)
            snapshot.snapshot()
            blob.write_bytes(b'candidate-mutated')
            blob.chmod(0o644)
            (versions / '2.blob').write_bytes(b'candidate orphan')
            snapshot.restore()
            self.assertEqual(blob.read_bytes(), b'original')
            self.assertEqual(blob.stat().st_mode & 0o777, 0o600)
            self.assertFalse((versions / '2.blob').exists())

    def test_app_rollback_restores_artifact_snapshot_before_restart(self):
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / 'app.env'; app.write_text('old'); app.chmod(0o600)
            new = root / 'new.env'; new.write_text('new')
            artifacts = root / 'artifacts'; artifacts.mkdir()
            (artifacts / 'payload').write_text('before')
            change = release.FileCutover(root / 'file-backup', [(new, app, 0o600)])
            recovery = release.ArtifactTreeSnapshot(root / 'backup' / 'artifact-storage', artifacts)
            events = []
            def stop():
                events.append('stop')
            def start():
                events.append('start:' + (artifacts / 'payload').read_text())
            def verify():
                if app.read_text() == 'new':
                    (artifacts / 'payload').write_text('after')
                    raise RuntimeError('candidate failed')
            with self.assertRaisesRegex(RuntimeError, 'candidate failed'):
                release.cutover(change, lambda: None, stop, start, verify, recovery)
            self.assertEqual(app.read_text(), 'old')
            self.assertEqual((artifacts / 'payload').read_text(), 'before')
            self.assertEqual(events, ['stop', 'start:before', 'stop', 'start:before'])


if __name__ == '__main__':
    unittest.main()
