"""Root-only disposable fixtures; never touches deployment paths."""
import importlib.util

from pathlib import Path
import stat
import tempfile
import unittest

HELPER = Path(__file__).with_name('prepare-audit-storage.py')


class StorageTests(unittest.TestCase):
    def test_prepare_verify_preserves_identity_and_content(self):
        self.assertTrue(HELPER.exists(), 'safe storage helper is missing')
        spec = importlib.util.spec_from_file_location('audit_storage', HELPER)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='jc-audit-test-', dir='/run') as tmp:
            root = Path(tmp)
            path = root / 'audit' / 'events.jsonl'
            result = module.storage(root, path, prepare=True)
            self.assertEqual(result['size'], 0)
            path.write_bytes(b'preserve existing bytes\n')
            before = path.stat()
            result = module.storage(root, path, prepare=True)
            self.assertEqual(result['inode'], before.st_ino)
            self.assertEqual(path.read_bytes(), b'preserve existing bytes\n')
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.stat().st_uid, 10001)
            self.assertEqual(module.storage(root, path, prepare=False), result)

    def test_rejections_do_not_repair_or_follow_existing_storage(self):
        import os
        spec = importlib.util.spec_from_file_location('audit_storage', HELPER)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for fault in ['parent-mode', 'parent-owner', 'leaf-mode', 'leaf-owner', 'file-mode', 'file-owner', 'file-group', 'hardlink', 'symlink', 'directory', 'fifo', 'oversize', 'leaf-symlink', 'ancestor-symlink', 'missing']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='jc-audit-test-', dir='/run') as tmp:
                root = Path(tmp)
                path = root / 'audit/events.jsonl'
                module.storage(root, path, prepare=True)
                path.write_bytes(b'untouched\n')
                if fault == 'parent-mode': root.chmod(0o777)
                elif fault == 'parent-owner': os.chown(root, 10001, 10001)
                elif fault == 'leaf-mode': path.parent.chmod(0o770)
                elif fault == 'leaf-owner': os.chown(path.parent, 0, 0)
                elif fault == 'file-mode': path.chmod(0o644)
                elif fault == 'file-owner': os.chown(path, 0, 0)
                elif fault == 'file-group': os.chown(path, 10001, 0)
                elif fault == 'hardlink': os.link(path, root / 'other')
                elif fault == 'oversize':
                    with path.open('ab') as f: f.truncate(module.MAX_BYTES + 1)
                elif fault == 'leaf-symlink':
                    path.parent.rename(root / 'elsewhere')
                    path.parent.symlink_to(root / 'elsewhere')
                elif fault == 'ancestor-symlink':
                    (root / 'alias').symlink_to(root)
                    root = root / 'alias'
                    path = root / 'audit/events.jsonl'
                elif fault in ['symlink', 'directory', 'fifo', 'missing']:
                    path.unlink()
                    if fault == 'symlink': path.symlink_to(root / 'victim')
                    elif fault == 'directory': path.mkdir()
                    elif fault == 'fifo': os.mkfifo(path)
                before = path.lstat() if path.exists() or path.is_symlink() else None
                with self.assertRaises((ValueError, OSError)):
                    module.storage(root, path, prepare=fault != 'missing')
                after = path.lstat() if before else None
                if before:
                    self.assertEqual(module.identity(before), module.identity(after))
                self.assertFalse((root / 'victim').exists())


if __name__ == '__main__':
    unittest.main()
