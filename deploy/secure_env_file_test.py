#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("secure-env-file.py")
SPEC = importlib.util.spec_from_file_location("secure_env_file", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SCRIPT}")
secure_env_file = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(secure_env_file)


class SecureEnvFileTests(unittest.TestCase):
    def test_uses_fixed_system_python_interpreter(self) -> None:
        self.assertEqual(SCRIPT.read_text(encoding="utf-8").splitlines()[0], "#!/usr/bin/python3")

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="jarvis-secure-env-test-")
        self.root = Path(self.temp.name)
        self.private = self.root / "private"
        self.private.mkdir(mode=0o700)
        self.source = self.root / "source.env"
        self.source.write_bytes(b"SYNTHETIC=original-test-value\n")
        self.source.chmod(0o600)
        self.expected_uid = os.geteuid()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_stage_copies_a_validated_regular_file_at_mode_0600(self) -> None:
        destination = self.private / "staged.env"

        secure_env_file.stage_file(self.source, destination, self.expected_uid)

        self.assertEqual(destination.read_bytes(), b"SYNTHETIC=original-test-value\n")
        metadata = destination.stat()
        self.assertTrue(stat.S_ISREG(metadata.st_mode))
        self.assertEqual(stat.S_IMODE(metadata.st_mode), 0o600)
        self.assertEqual(metadata.st_uid, self.expected_uid)

    def test_stage_rejects_a_symlink_source(self) -> None:
        symlink = self.root / "source-link.env"
        symlink.symlink_to(self.source)

        with self.assertRaises(secure_env_file.SecureEnvError):
            secure_env_file.stage_file(symlink, self.private / "staged.env", self.expected_uid)

    def test_stage_rejects_a_symlink_in_the_source_parent_path(self) -> None:
        real_parent = self.root / "real-source-parent"
        real_parent.mkdir(mode=0o700)
        source = real_parent / "source.env"
        source.write_bytes(b"SYNTHETIC=original-test-value\n")
        source.chmod(0o600)
        linked_parent = self.root / "linked-source-parent"
        linked_parent.symlink_to(real_parent, target_is_directory=True)

        with self.assertRaises(secure_env_file.SecureEnvError):
            secure_env_file.stage_file(
                linked_parent / "source.env",
                self.private / "staged.env",
                self.expected_uid,
            )

    def test_stage_rejects_a_symlink_in_the_destination_parent_path(self) -> None:
        linked_parent = self.root / "linked-destination-parent"
        linked_parent.symlink_to(self.private, target_is_directory=True)

        with self.assertRaises(secure_env_file.SecureEnvError):
            secure_env_file.stage_file(
                self.source,
                linked_parent / "staged.env",
                self.expected_uid,
            )

    def test_stage_rejects_a_fifo_without_blocking(self) -> None:
        fifo = self.root / "source.fifo"
        os.mkfifo(fifo, 0o600)

        with self.assertRaises(secure_env_file.SecureEnvError):
            secure_env_file.stage_file(fifo, self.private / "staged.env", self.expected_uid)

    def test_stage_rejects_a_permissive_source(self) -> None:
        self.source.chmod(0o640)

        with self.assertRaises(secure_env_file.SecureEnvError):
            secure_env_file.stage_file(self.source, self.private / "staged.env", self.expected_uid)

    def test_stage_rejects_a_non_private_destination_directory(self) -> None:
        self.private.chmod(0o750)

        with self.assertRaises(secure_env_file.SecureEnvError):
            secure_env_file.stage_file(self.source, self.private / "staged.env", self.expected_uid)

    def test_stage_consumes_the_validated_descriptor_after_path_substitution(self) -> None:
        replacement = self.root / "replacement.env"
        replacement.write_bytes(b"SYNTHETIC=replacement-test-value\n")
        replacement.chmod(0o600)
        destination = self.private / "staged.env"
        real_copy = secure_env_file._copy_fd

        def substitute_then_copy(source_fd: int, destination_fd: int) -> None:
            os.replace(replacement, self.source)
            real_copy(source_fd, destination_fd)

        with patch.object(secure_env_file, "_copy_fd", substitute_then_copy):
            secure_env_file.stage_file(self.source, destination, self.expected_uid)

        self.assertEqual(destination.read_bytes(), b"SYNTHETIC=original-test-value\n")
        self.assertEqual(self.source.read_bytes(), b"SYNTHETIC=replacement-test-value\n")

    def test_install_refuses_to_run_without_root_privilege(self) -> None:
        if os.geteuid() == 0:
            self.skipTest("non-root guard is not applicable when tests run as root")

        with self.assertRaises(secure_env_file.SecureEnvError):
            secure_env_file.install_file(
                self.source,
                self.root / "installed.env",
                self.expected_uid,
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
