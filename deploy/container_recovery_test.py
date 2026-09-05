import importlib.util
from pathlib import Path
import tempfile
import unittest


class RecoveryTest(unittest.TestCase):
    def module(self):
        path = Path(__file__).with_name('container_recovery.py')
        self.assertTrue(path.is_file(), 'Missing fixed parent-owned app replacement lifecycle')
        spec = importlib.util.spec_from_file_location('recovery', path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        return module

    def test_fixed_handshake_refuses_ids_replays_and_malformed_files(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'request'
            for value in ['{}', '{"mode":"desktop","id":"host"}', '{"mode":"phone"}', 'x' * 257]:
                path.write_text(value); path.chmod(0o600)
                with self.assertRaises((ValueError, RuntimeError)):
                    m.request(path, 'desktop', path.stat().st_uid)
            path.write_text('{"mode":"desktop"}')
            self.assertEqual(m.request(path, 'desktop', path.stat().st_uid), 'desktop')
            path.chmod(0o644)
            with self.assertRaises(RuntimeError): m.request(path, 'desktop', path.stat().st_uid)
            path.unlink(); path.symlink_to('/nonexistent')
            with self.assertRaises(RuntimeError): m.request(path, 'desktop', 0)

    def test_actual_replacement_mount_guard_ignores_order_but_no_metadata(self):
        import ast
        import copy
        m = self.module()
        tree = ast.parse(Path(__file__).with_name('verify-container-chain.py').read_text())
        guard = next(node.test for node in ast.walk(tree) if isinstance(node, ast.Assert)
                     and "new['Mounts']" in ast.unparse(node.test))
        predicate = compile(ast.Expression(guard), '<replacement mount guard>', 'eval')
        mounts = [dict(Type='bind', Source='/fixture/audit', Destination='/audit', Mode='', RW=True, Propagation='rprivate'),
                  dict(Type='bind', Source='/fixture/jwks.json', Destination='/run/jwks.json', Mode='', RW=False, Propagation='rprivate')]
        def accepted(value):
            return eval(predicate, {'new': {'Mounts': value}, 'old_state': {'Mounts': mounts},
                                    'same_mounts': getattr(m, 'same_mounts', None)})
        self.assertTrue(accepted(list(reversed(mounts))), 'Docker mount order is not mount identity')
        for key in mounts[0]:
            changed = copy.deepcopy(mounts)
            changed[0][key] = not changed[0][key] if key == 'RW' else 'changed'
            self.assertFalse(accepted(changed), key)
        for changed in [mounts[:1], mounts + [mounts[0]], [mounts[0], mounts[0]], None, {}, ['bad']]:
            self.assertFalse(accepted(changed))

    def test_replacement_order_and_failure_never_forgets_owned_resources(self):
        m = self.module()
        for fail in [None, 'validate', 'kill', 'absent', 'launch', 'ready', 'unchanged']:
            calls = []; owned = ['old']
            def step(name):
                def call():
                    calls.append(name)
                    if name == 'launch': owned.append('replacement')
                    if name == fail: raise RuntimeError(name)
                    return {'stage': name}
                return call
            actions = {name: step(name) for name in ['validate', 'snapshot', 'kill', 'absent', 'launch', 'ready', 'unchanged']}
            if fail:
                with self.assertRaises(RuntimeError): m.replace_app(**actions)
                self.assertEqual(calls[-1], fail)
            else:
                self.assertEqual(m.replace_app(**actions)['before'], {'stage': 'snapshot'})
                self.assertEqual(calls, list(actions))
            self.assertIn('old', owned)
            if 'launch' in calls: self.assertIn('replacement', owned)

if __name__ == '__main__': unittest.main()
