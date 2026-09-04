#!/usr/bin/python3
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

DEPLOY_DIR = Path(__file__).resolve().parent
RELEASE = DEPLOY_DIR / "release-app.sh"
EXPECTED_IMAGE = f"sha256:{'a' * 64}"
READ_PROXY_IMAGE = f"sha256:{'b' * 64}"


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


class LocalReleaseOrchestratorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="jarvis-command-release-client-test-"))
        self.fake_bin = self.root / "local-bin"
        self.remote_fake_bin = self.root / "remote-bin"
        self.fake_bin.mkdir(mode=0o700)
        self.remote_fake_bin.mkdir(mode=0o700)
        self.app_env = self.root / "app.env"
        self.app_env.write_text("SYNTHETIC=value\n", encoding="utf-8")
        self.app_env.chmod(0o600)
        self.ssh_key = self.root / "identity"
        self.ssh_key.write_text("synthetic identity\n", encoding="utf-8")
        self.ssh_key.chmod(0o600)
        self.local_stage_marker = self.root / "local-stage"
        self.remote_stage_marker = self.root / "remote-stage"
        self.remote_created_stage_marker = self.root / "remote-created-stage"
        self.scp_marker = self.root / "scp-called"
        self.ready = self.root / "ready"
        self._write_default_fakes()

    def tearDown(self) -> None:
        for marker in (
            self.local_stage_marker,
            self.remote_stage_marker,
            self.remote_created_stage_marker,
        ):
            if marker.exists():
                shutil.rmtree(Path(marker.read_text(encoding="utf-8").strip()), ignore_errors=True)
        shutil.rmtree(self.root, ignore_errors=True)

    def _write_default_fakes(self) -> None:
        write_executable(
            self.fake_bin / "docker",
            """#!/usr/bin/bash
if [[ ${1-} == save && ${2-} == "$EXPECTED_IMAGE" ]]; then
  printf 'synthetic image archive\n'
  exit 0
fi
exit 64
""",
        )
        write_executable(
            self.fake_bin / "install",
            """#!/usr/bin/bash
destination=${@: -1}
/usr/bin/dirname -- "$destination" > "$LOCAL_STAGE_MARKER"
exec /usr/bin/install "$@"
""",
        )
        write_executable(
            self.fake_bin / "rm",
            """#!/usr/bin/bash
if [[ ${FAIL_LOCAL_RM:-0} == 1 && ${*: -1} == /tmp/jarvis-command-release.* ]]; then
  exit 99
fi
exec /usr/bin/rm "$@"
""",
        )
        write_executable(
            self.fake_bin / "ssh",
            """#!/usr/bin/bash
while (( $# > 0 )); do
  case $1 in
    -i|-o) shift 2 ;;
    --) shift; break ;;
    *) shift; break ;;
  esac
done
[[ ${1-} == bash && ${2-} == -s ]] || exit 65
shift 2
[[ ${1-} == -- ]] && shift

if (( $# == 3 )) && [[ -n ${FAIL_REMOTE_INSTALLER:-} ]]; then
  exit "${FAIL_REMOTE_INSTALLER}"
fi
if (( $# == 3 )) && [[ ${BLOCK_REMOTE_INSTALLER:-0} == 1 ]]; then
  : > "${READY_MARKER}"
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  while :; do sleep 1; done
fi

if (( $# == 0 )); then
  output=$(PATH="$REMOTE_FAKE_BIN:/usr/bin:/bin" /usr/bin/bash -s)
  status=$?
  if [[ $output =~ ^[0-9]+:(/tmp/jarvis-command-release\.[A-Za-z0-9]{10})$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}" > "$REMOTE_STAGE_MARKER"
  fi
  [[ -z $output ]] || printf '%s\n' "$output"
  exit "$status"
fi
PATH="$REMOTE_FAKE_BIN:/usr/bin:/bin" /usr/bin/bash -s -- "$@"
""",
        )
        write_executable(
            self.fake_bin / "scp",
            """#!/usr/bin/bash
args=("$@")
index=0
while (( index < ${#args[@]} )); do
  case ${args[$index]} in
    -p) ((index+=1)) ;;
    -i|-o) ((index+=2)) ;;
    *) break ;;
  esac
done
remaining=("${args[@]:$index}")
(( ${#remaining[@]} >= 2 ))
destination=${remaining[-1]}
destination_path=${destination#*:}
: > "$SCP_MARKER"
for source in "${remaining[@]:0:${#remaining[@]}-1}"; do
  /usr/bin/cp -p -- "$source" "$destination_path/"
done
""",
        )
        write_executable(
            self.remote_fake_bin / "gunzip",
            "#!/usr/bin/bash\nprintf 'image bytes\\n'\n",
        )
        write_executable(
            self.remote_fake_bin / "docker",
            """#!/usr/bin/bash
if [[ ${1-} == load ]]; then /bin/cat >/dev/null; exit 0; fi
if [[ ${1-} == image && ${2-} == inspect ]]; then printf '%s\n' "$EXPECTED_IMAGE"; exit 0; fi
exit 64
""",
        )
        write_executable(self.remote_fake_bin / "cmp", "#!/usr/bin/bash\nexit 0\n")
        write_executable(
            self.remote_fake_bin / "sudo",
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

    def environment(self, **overrides: str) -> dict[str, str]:
        return {
            **os.environ,
            "PATH": f"{self.fake_bin}:/usr/bin:/bin",
            "REMOTE_FAKE_BIN": str(self.remote_fake_bin),
            "LOCAL_STAGE_MARKER": str(self.local_stage_marker),
            "REMOTE_STAGE_MARKER": str(self.remote_stage_marker),
            "REMOTE_CREATED_STAGE_MARKER": str(self.remote_created_stage_marker),
            "SCP_MARKER": str(self.scp_marker),
            "READY_MARKER": str(self.ready),
            "EXPECTED_IMAGE": EXPECTED_IMAGE,
            **overrides,
        }

    def command(self) -> list[str]:
        return [
            "/usr/bin/bash",
            str(RELEASE),
            str(self.app_env),
            "neal@192.168.6.113",
            str(self.ssh_key),
            EXPECTED_IMAGE,
            READ_PROXY_IMAGE,
        ]

    def run_release(self, **environment_overrides: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            self.command(),
            text=True,
            capture_output=True,
            env=self.environment(**environment_overrides),
            timeout=15,
            check=False,
        )

    def marked_local_stage(self) -> Path:
        return Path(self.local_stage_marker.read_text(encoding="utf-8").strip())

    def marked_remote_stage(self) -> Path:
        marker = (
            self.remote_stage_marker
            if self.remote_stage_marker.exists()
            else self.remote_created_stage_marker
        )
        return Path(marker.read_text(encoding="utf-8").strip())

    def _write_remote_failure(self, command: str, status: int) -> None:
        write_executable(
            self.remote_fake_bin / command,
            f"""#!/usr/bin/bash
printf '%s' "${{@: -1}}" > "$REMOTE_CREATED_STAGE_MARKER"
exit {status}
""",
        )

    def test_remote_chmod_failure_rejects_record_and_never_calls_scp(self) -> None:
        self._write_remote_failure("chmod", 42)

        result = self.run_release()

        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.scp_marker.exists())
        self.assertFalse(self.marked_local_stage().exists())
        self.assertFalse(self.marked_remote_stage().exists())

    def test_remote_stat_failure_rejects_record_and_never_calls_scp(self) -> None:
        self._write_remote_failure("stat", 43)

        result = self.run_release()

        self.assertEqual(result.returncode, 43, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.scp_marker.exists())
        self.assertFalse(self.marked_local_stage().exists())
        self.assertFalse(self.marked_remote_stage().exists())

    def test_success_returns_state_and_removes_both_stages(self) -> None:
        result = self.run_release()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            "/var/backups/jarvis-command/cutover-20260903T180000Z\n",
        )
        self.assertTrue(self.scp_marker.exists())
        self.assertFalse(self.marked_local_stage().exists())
        self.assertFalse(self.marked_remote_stage().exists())

    def test_ordinary_local_failure_preserves_status_and_removes_stage(self) -> None:
        write_executable(
            self.fake_bin / "docker",
            "#!/usr/bin/bash\nprintf '%s' \"$PWD\" > \"$LOCAL_STAGE_MARKER\"\nexit 42\n",
        )

        result = self.run_release()

        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertFalse(self.scp_marker.exists())
        self.assertFalse(self.marked_local_stage().exists())

    def test_remote_install_failure_preserves_status_and_removes_both_stages(self) -> None:
        result = self.run_release(FAIL_REMOTE_INSTALLER="42")

        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertTrue(self.scp_marker.exists())
        self.assertFalse(self.marked_local_stage().exists())
        self.assertFalse(self.marked_remote_stage().exists())

    def test_term_during_remote_install_removes_both_stages(self) -> None:
        process = subprocess.Popen(
            self.command(),
            env=self.environment(BLOCK_REMOTE_INSTALLER="1"),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        deadline = time.monotonic() + 5
        while not self.ready.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        if not self.ready.exists():
            process.kill()
            process.communicate(timeout=5)
        self.assertTrue(self.ready.exists(), "release did not reach the remote blocking fixture")
        os.killpg(process.pid, signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=10)

        self.assertEqual(process.returncode, 143, stderr)
        self.assertEqual(stdout, "")
        self.assertTrue(self.scp_marker.exists())
        self.assertFalse(self.marked_local_stage().exists())
        self.assertFalse(self.marked_remote_stage().exists())

    def test_cleanup_failure_preserves_original_local_error(self) -> None:
        write_executable(
            self.fake_bin / "docker",
            "#!/usr/bin/bash\nprintf '%s' \"$PWD\" > \"$LOCAL_STAGE_MARKER\"\nexit 42\n",
        )

        result = self.run_release(FAIL_LOCAL_RM="1")

        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertIn("cleanup failed", result.stderr)
        self.assertTrue(self.marked_local_stage().exists())

    def test_cleanup_failure_turns_success_into_failure(self) -> None:
        result = self.run_release(FAIL_LOCAL_RM="1")

        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("cleanup failed", result.stderr)
        self.assertTrue(self.marked_local_stage().exists())
        self.assertFalse(self.marked_remote_stage().exists())

    def _assert_signal_cleanup(self, sent_signal: signal.Signals, expected_status: int) -> None:
        write_executable(
            self.fake_bin / "docker",
            """#!/usr/bin/bash
printf '%s' "$PWD" > "$LOCAL_STAGE_MARKER"
: > "$READY_MARKER"
while :; do /usr/bin/sleep 1; done
""",
        )
        process = subprocess.Popen(
            self.command(),
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
        self.assertTrue(self.ready.exists(), "release did not reach the blocking fixture")
        os.killpg(process.pid, sent_signal)
        stdout, stderr = process.communicate(timeout=5)

        self.assertEqual(process.returncode, expected_status, stderr)
        self.assertEqual(stdout, "")
        self.assertFalse(self.marked_local_stage().exists())
        self.assertFalse(self.scp_marker.exists())

    def test_hup_removes_stage_and_returns_129(self) -> None:
        self._assert_signal_cleanup(signal.SIGHUP, 129)

    def test_int_removes_stage_and_returns_130(self) -> None:
        self._assert_signal_cleanup(signal.SIGINT, 130)

    def test_term_removes_stage_and_returns_143(self) -> None:
        self._assert_signal_cleanup(signal.SIGTERM, 143)


if __name__ == "__main__":
    unittest.main(verbosity=2)
