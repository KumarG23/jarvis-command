"""Root-only disposable artifact storage fixtures; never touches deployment paths."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest

HELPER = Path(__file__).with_name('prepare-artifact-storage.py')


class ArtifactStorageTests(unittest.TestCase):
    def test_prepare_verify_preserves_existing_directory_identity(self):
        spec = importlib.util.spec_from_file_location('artifact_storage', HELPER)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='jc-artifact-test-', dir='/run') as tmp:
            root = Path(tmp)
            path = root / 'artifacts'
            result = module.storage(root, path, prepare=True)
            self.assertTrue(result['created'])
            marker = path / 'marker'
            marker.write_text('preserve\n')
            before = path.stat()
            result = module.storage(root, path, prepare=True)
            self.assertFalse(result['created'])
            self.assertEqual(result['inode'], before.st_ino)
            self.assertEqual(marker.read_text(), 'preserve\n')
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
            self.assertEqual(path.stat().st_uid, 10001)
            self.assertEqual(module.storage(root, path, prepare=False)['inode'], before.st_ino)

    def test_rejections_do_not_repair_or_follow_existing_storage(self):
        spec = importlib.util.spec_from_file_location('artifact_storage', HELPER)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for fault in ['parent-mode', 'parent-owner', 'leaf-mode', 'leaf-owner', 'leaf-group', 'file', 'symlink', 'ancestor-symlink', 'missing']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='jc-artifact-test-', dir='/run') as tmp:
                root = Path(tmp)
                path = root / 'artifacts'
                module.storage(root, path, prepare=True)
                if fault == 'parent-mode':
                    root.chmod(0o777)
                elif fault == 'parent-owner':
                    os.chown(root, 10001, 10001)
                elif fault == 'leaf-mode':
                    path.chmod(0o770)
                elif fault == 'leaf-owner':
                    os.chown(path, 0, 0)
                elif fault == 'leaf-group':
                    os.chown(path, 10001, 0)
                elif fault == 'file':
                    path.rmdir()
                    path.write_text('not a directory')
                elif fault == 'symlink':
                    path.rmdir()
                    path.symlink_to(root)
                elif fault == 'ancestor-symlink':
                    (root / 'alias').symlink_to(root)
                    root = root / 'alias'
                    path = root / 'artifacts'
                elif fault == 'missing':
                    path.rmdir()
                before = path.lstat() if path.exists() or path.is_symlink() else None
                with self.assertRaises((ValueError, OSError)):
                    module.storage(root, path, prepare=fault != 'missing')
                after = path.lstat() if before else None
                if before:
                    self.assertEqual(module.identity(before), module.identity(after))


if __name__ == '__main__':
    unittest.main()
