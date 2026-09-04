#!/usr/bin/python3
from __future__ import annotations

import os
import secrets
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

DEPLOY_DIR = Path(__file__).resolve().parent
ALLOCATOR = DEPLOY_DIR / "allocate-release-stage.sh"
INSTALLER = DEPLOY_DIR / "install-app-release.sh"
EXPECTED_IMAGE = f"sha256:{'a' * 64}"


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


class ReleaseStageAllocatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="jarvis-command-release-test-"))
        self.fake_bin = self.root / "bin"
        self.fake_bin.mkdir(mode=0o700)
        self.marker = self.root / "stage-path"
        self.ready = self.root / "ready"

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def environment(self) -> dict[str, str]:
        return {
            **os.environ,
            "PATH": f"{self.fake_bin}:/usr/bin:/bin",
            "STAGE_MARKER": str(self.marker),
            "READY_MARKER": str(self.ready),
        }

    def run_allocator(self, *, timeout: float = 10) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/usr/bin/bash", str(ALLOCATOR)],
            text=True,
            capture_output=True,
            env=self.environment(),
            timeout=timeout,
            check=False,
        )

    def marked_stage(self) -> Path:
        return Path(self.marker.read_text(encoding="utf-8"))

    def test_success_hands_off_one_private_stage_record(self) -> None:
        result = self.run_allocator()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(
            result.stdout,
            rf"^{os.getuid()}:/tmp/jarvis-command-release\.[A-Za-z0-9]{{10}}\n$",
        )
        stage = Path(result.stdout.strip().split(":", 1)[1])
        try:
            metadata = stage.stat()
            self.assertTrue(stat.S_ISDIR(metadata.st_mode))
            self.assertEqual(stat.S_IMODE(metadata.st_mode), 0o700)
            self.assertEqual(metadata.st_uid, os.getuid())
        finally:
            shutil.rmtree(stage, ignore_errors=True)

    def test_chmod_failure_emits_no_record_and_removes_stage(self) -> None:
        write_executable(
            self.fake_bin / "chmod",
            "#!/usr/bin/bash\nprintf '%s' \"$2\" > \"$STAGE_MARKER\"\nexit 42\n",
        )

        result = self.run_allocator()

        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.marked_stage().exists())

    def test_stat_failure_emits_no_record_and_removes_stage(self) -> None:
        write_executable(
            self.fake_bin / "stat",
            "#!/usr/bin/bash\nprintf '%s' \"${@: -1}\" > \"$STAGE_MARKER\"\nexit 43\n",
        )

        result = self.run_allocator()

        self.assertEqual(result.returncode, 43, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.marked_stage().exists())

    def test_cleanup_failure_does_not_overwrite_original_error(self) -> None:
        write_executable(
            self.fake_bin / "chmod",
            "#!/usr/bin/bash\nprintf '%s' \"$2\" > \"$STAGE_MARKER\"\nexit 42\n",
        )
        write_executable(self.fake_bin / "rm", "#!/usr/bin/bash\nexit 99\n")

        result = self.run_allocator()

        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("cleanup failed", result.stderr)
        stage = self.marked_stage()
        self.assertTrue(stage.exists())
        shutil.rmtree(stage)

    def _assert_signal_cleanup(self, sent_signal: signal.Signals, expected_status: int) -> None:
        write_executable(
            self.fake_bin / "chmod",
            """#!/usr/bin/bash
printf '%s' "$2" > "$STAGE_MARKER"
: > "$READY_MARKER"
while :; do /usr/bin/sleep 1; done
""",
        )
        process = subprocess.Popen(
            ["/usr/bin/bash", str(ALLOCATOR)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=self.environment(),
            start_new_session=True,
        )
        deadline = time.monotonic() + 5
        while not self.ready.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(self.ready.exists(), "allocator did not reach the blocking fixture")
        os.killpg(process.pid, sent_signal)
        stdout, stderr = process.communicate(timeout=5)

        self.assertEqual(process.returncode, expected_status, stderr)
        self.assertEqual(stdout, "")
        self.assertFalse(self.marked_stage().exists())

    def test_hup_removes_stage_and_returns_129(self) -> None:
        self._assert_signal_cleanup(signal.SIGHUP, 129)

    def test_int_removes_stage_and_returns_130(self) -> None:
        self._assert_signal_cleanup(signal.SIGINT, 130)

    def test_term_removes_stage_and_returns_143(self) -> None:
        self._assert_signal_cleanup(signal.SIGTERM, 143)


class RemoteReleaseInstallerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="jarvis-command-installer-test-"))
        self.fake_bin = self.root / "bin"
        self.fake_bin.mkdir(mode=0o700)
        self.ready = self.root / "ready"
        self.stage = Path(f"/tmp/jarvis-command-release.{secrets.token_hex(5)}")
        self.stage.mkdir(mode=0o700)
        self._populate_stage()

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.stage, ignore_errors=True)

    def _populate_stage(self) -> None:
        files = {
            "app-image.tar.gz": (b"image archive\n", 0o600),
            "app.env": (b"SYNTHETIC=value\n", 0o600),
            "release.env": (
                (
                    f"JARVIS_COMMAND_APP_IMAGE={EXPECTED_IMAGE}\n"
                    f"JARVIS_COMMAND_READ_PROXY_IMAGE=sha256:{'b' * 64}\n"
                ).encode(),
                0o600,
            ),
            "app.compose.yaml": (b"services: {}\n", 0o644),
            "app.service": (b"[Unit]\nDescription=test\n", 0o644),
            "cutover-app.sh": (b"#!/usr/bin/bash\nexit 0\n", 0o755),
            "secure-env-file.py": (b"#!/usr/bin/python3\n", 0o755),
        }
        for name, (content, mode) in files.items():
            path = self.stage / name
            path.write_bytes(content)
            path.chmod(mode)
        manifest = subprocess.run(
            [
                "/usr/bin/sha256sum",
                "app-image.tar.gz",
                "app.env",
                "release.env",
                "app.compose.yaml",
                "app.service",
                "cutover-app.sh",
                "secure-env-file.py",
            ],
            cwd=self.stage,
            text=True,
            capture_output=True,
            check=True,
        ).stdout
        manifest_path = self.stage / "SHA256SUMS"
        manifest_path.write_text(manifest, encoding="utf-8")
        manifest_path.chmod(0o600)

    def environment(self) -> dict[str, str]:
        return {
            **os.environ,
            "PATH": f"{self.fake_bin}:/usr/bin:/bin",
            "READY_MARKER": str(self.ready),
            "EXPECTED_IMAGE": EXPECTED_IMAGE,
        }

    def run_installer(
        self,
        *,
        expected_image: str = EXPECTED_IMAGE,
        timeout: float = 10,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "/usr/bin/bash",
                str(INSTALLER),
                str(self.stage),
                str(os.getuid()),
                expected_image,
            ],
            text=True,
            capture_output=True,
            env=self.environment(),
            timeout=timeout,
            check=False,
        )

    def test_argument_failure_after_handoff_removes_stage(self) -> None:
        result = self.run_installer(expected_image="not-a-digest")

        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(self.stage.exists())

    def test_ordinary_failure_removes_stage_and_preserves_status(self) -> None:
        write_executable(self.fake_bin / "sha256sum", "#!/usr/bin/bash\nexit 42\n")

        result = self.run_installer()

        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertFalse(self.stage.exists())

    def test_cleanup_failure_does_not_overwrite_installer_error(self) -> None:
        write_executable(self.fake_bin / "sha256sum", "#!/usr/bin/bash\nexit 42\n")
        write_executable(self.fake_bin / "rm", "#!/usr/bin/bash\nexit 99\n")

        result = self.run_installer()

        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertIn("cleanup failed", result.stderr)
        self.assertTrue(self.stage.exists())

    def _assert_signal_cleanup(self, sent_signal: signal.Signals, expected_status: int) -> None:
        write_executable(
            self.fake_bin / "sha256sum",
            """#!/usr/bin/bash
: > "$READY_MARKER"
while :; do /usr/bin/sleep 1; done
""",
        )
        process = subprocess.Popen(
            [
                "/usr/bin/bash",
                str(INSTALLER),
                str(self.stage),
                str(os.getuid()),
                EXPECTED_IMAGE,
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=self.environment(),
            start_new_session=True,
        )
        deadline = time.monotonic() + 5
        while not self.ready.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        if not self.ready.exists():
            process.kill()
            process.communicate(timeout=5)
        self.assertTrue(self.ready.exists(), "installer did not reach the blocking fixture")
        os.killpg(process.pid, sent_signal)
        stdout, stderr = process.communicate(timeout=5)

        self.assertEqual(process.returncode, expected_status, stderr)
        self.assertEqual(stdout, "")
        self.assertFalse(self.stage.exists())

    def test_hup_removes_stage_and_returns_129(self) -> None:
        self._assert_signal_cleanup(signal.SIGHUP, 129)

    def test_int_removes_stage_and_returns_130(self) -> None:
        self._assert_signal_cleanup(signal.SIGINT, 130)

    def test_term_removes_stage_and_returns_143(self) -> None:
        self._assert_signal_cleanup(signal.SIGTERM, 143)

    def _write_success_fakes(self) -> None:
        write_executable(
            self.fake_bin / "gunzip",
            "#!/usr/bin/bash\nprintf 'image bytes\\n'\n",
        )
        write_executable(
            self.fake_bin / "docker",
            """#!/usr/bin/bash
if [[ $1 == load ]]; then /bin/cat >/dev/null; exit 0; fi
if [[ $1 == image && $2 == inspect ]]; then printf '%s\n' "$EXPECTED_IMAGE"; exit 0; fi
exit 64
""",
        )
        write_executable(self.fake_bin / "cmp", "#!/usr/bin/bash\nexit 0\n")
        write_executable(
            self.fake_bin / "sudo",
            """#!/usr/bin/bash
[[ ${1-} == -n ]] && shift
joined=" $* "
if [[ $joined == *" stat -c "* ]]; then
  if [[ $joined == *"app.env"* || $joined == *"release.env"* ]]; then
    printf '0:0:600\n'
  else
    printf '0:0:755\n'
  fi
elif [[ $joined == *" /bin/sh -c "* ]]; then
  printf '%s' "$EXPECTED_IMAGE"
elif [[ $joined == *"jarvis-command-cutover-app cutover"* ]]; then
  printf 'CUTOVER_STATE_DIR=/var/backups/jarvis-command/cutover-20260903T180000Z\n'
fi
exit 0
""",
        )

    def test_success_returns_cutover_state_and_removes_stage(self) -> None:
        self._write_success_fakes()

        result = self.run_installer()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            "/var/backups/jarvis-command/cutover-20260903T180000Z\n",
        )
        self.assertFalse(self.stage.exists())

    def test_successful_cutover_with_cleanup_failure_emits_no_state(self) -> None:
        self._write_success_fakes()
        write_executable(self.fake_bin / "rm", "#!/usr/bin/bash\nexit 99\n")

        result = self.run_installer()

        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("cleanup failed", result.stderr)
        self.assertTrue(self.stage.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
