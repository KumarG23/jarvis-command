"""Small verifier safety tests; no Docker or external services."""
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest

path = Path(__file__).with_name('verify-app-read-proxy-images.py')
if path.exists():
    spec = importlib.util.spec_from_file_location('verifier', path)
    assert spec is not None and spec.loader is not None
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
else:
    verifier = types.SimpleNamespace()


class VerifierTests(unittest.TestCase):
    def test_cleanup_failure_prevents_success_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            def fail_cleanup():
                raise RuntimeError('owned fixture remains')
            with self.assertRaisesRegex(RuntimeError, 'owned fixture remains'):
                getattr(verifier, 'finish', lambda *args: None)(evidence, fail_cleanup, {'status': 'PASS'})
            self.assertFalse((evidence / 'SUCCESS.json').exists())

    def test_success_receipt_follows_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            calls = []
            def cleanup():
                self.assertFalse((evidence / 'SUCCESS.json').exists())
                calls.append('cleaned')
            getattr(verifier, 'finish', lambda *args: None)(evidence, cleanup, {'status': 'PASS'})
            self.assertEqual(calls, ['cleaned'])
            self.assertEqual(json.loads((evidence / 'SUCCESS.json').read_text())['status'], 'PASS')

    def test_inventory_failure_enumerates_all_paths(self):
        with self.assertRaisesRegex(RuntimeError, r'a\.env.*b\.map'):
            getattr(verifier, 'reject_paths', lambda *args: None)('forbidden', ['a.env', 'b.map'])


if __name__ == '__main__':
    unittest.main()
