"""Host-only, fixed-operation sandbox broker. Never mount this broker/socket in tools.
No Docker API pass-through: the only operation runs bash in a pinned image with
one fixed fixture bind, no networking, no capabilities and no caller-supplied env.
"""
import json
import os
import re
from pathlib import Path
import select
import signal
import socketserver
import subprocess
import tempfile
import time
import uuid

STATE = Path('/home/neal/code/jarvis-command-candidate-state')
FIXTURES = STATE / 'fixtures'
BROKER = STATE / 'broker'
QUARANTINE = BROKER / 'cleanup-uncertain.json'
LIFECYCLE_TIMEOUT = 15
QUARANTINED = False

IMAGE = subprocess.check_output(['docker', 'image', 'inspect', 'nikolaik/python-nodejs:python3.11-nodejs20', '--format', '{{.Id}}'], text=True).strip()


def argv(name):
    if FIXTURES.is_symlink() or FIXTURES.resolve() != FIXTURES:
        raise RuntimeError('fixture root must be a real directory')
    return ['docker', 'create', '-i', '--name', name, '--restart', 'no',
            '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--user', '1000:1000',
            '--cgroup-parent', 'hermes-heavy.slice', '--memory', '512m', '--memory-swap', '512m',
            '--cpus', '1', '--pids-limit', '64', '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m',
            '--mount', f'type=bind,src={FIXTURES},dst=/fixtures', '-w', '/fixtures',
            '--entrypoint', '/usr/bin/env', IMAGE, '-i', 'HOME=/tmp',
            'PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8', '/bin/bash', '--noprofile', '--norc', '-c']


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        global QUARANTINED
        self.connection.settimeout(5)
        name = 'jc-history-tool-' + uuid.uuid4().hex
        proc = None
        create = None
        cid = None
        uncertain = False
        try:
            raw = self.rfile.readline(262145)
            if len(raw) > 262144 or not raw.endswith(b'\n'):
                raise ValueError('request too large')
            p = json.loads(raw)
            if set(p) != {'command', 'stdin', 'timeout'} or not isinstance(p['command'], str):
                raise ValueError('invalid operation')
            if p['stdin'] is not None and not isinstance(p['stdin'], str):
                raise ValueError('invalid stdin')
            timeout = p['timeout']
            if type(timeout) not in (int, float) or not 0 < timeout <= 180:
                raise ValueError('invalid timeout')
            if QUARANTINED or QUARANTINE.exists():
                raise RuntimeError('broker quarantined: operator reconciliation required')
            # Disk-backed bounded output avoids untrusted-output RAM exhaustion.
            with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as inp:
                inp.write((p['stdin'] or '').encode()); inp.seek(0)
                deadline = time.monotonic() + timeout

                def cancelled():
                    readable, _, _ = select.select([self.connection], [], [], 0)
                    return readable or time.monotonic() >= deadline or output.tell() > 900000

                # Creation cannot execute the command. Settle it before any cleanup,
                # and check cancellation before granting start to its exact ID.
                create = subprocess.Popen(argv(name) + [p['command']], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                created, _ = create.communicate(timeout=LIFECYCLE_TIMEOUT)
                if create.returncode != 0:
                    raise RuntimeError('container creation failed')
                cid = created.decode().strip()
                if not re.fullmatch(r'[0-9a-f]{64}', cid):
                    raise RuntimeError('invalid container identity')
                if cancelled():
                    raise TimeoutError('sandbox cancelled before start')
                proc = subprocess.Popen(['docker', 'start', '-a', '-i', cid], stdin=inp, stdout=output, stderr=subprocess.STDOUT)
                while proc.poll() is None:
                    if cancelled():
                        raise TimeoutError('sandbox cancelled or resource bound exceeded')
                    select.select([self.connection], [], [], 0.05)
                output.seek(0)
                result = {'output': output.read(900000).decode(errors='replace'), 'returncode': proc.returncode}
        except (ValueError, OSError, TimeoutError):
            result = {'output': 'candidate sandbox rejected/cancelled; no host fallback', 'returncode': 124}
        except (RuntimeError, subprocess.SubprocessError):
            result = {'output': 'candidate sandbox lifecycle failed; no host fallback', 'returncode': 125}
        finally:
            # A timed-out create may still be in flight in the daemon. Never start
            # it, never claim clean cancellation, and persistently close admissions.
            if create is not None and create.poll() is None:
                uncertain = True
                create.kill()
                try:
                    create.communicate(timeout=LIFECYCLE_TIMEOUT)
                except (OSError, subprocess.SubprocessError):
                    pass
            target = cid or name
            if create is not None:
                try:
                    removed = subprocess.run(['docker', 'rm', '-f', target], capture_output=True, timeout=LIFECYCLE_TIMEOUT)
                    if removed.returncode != 0:
                        uncertain = True
                except (OSError, subprocess.SubprocessError):
                    uncertain = True
            # rm of an exact created ID prevents even a delayed start from running.
            # Settle that start client too; failures must not skip the readback.
            if proc is not None:
                try:
                    proc.wait(timeout=LIFECYCLE_TIMEOUT)
                except (OSError, subprocess.SubprocessError):
                    uncertain = True
                    proc.kill()
                    try:
                        proc.wait(timeout=LIFECYCLE_TIMEOUT)
                    except (OSError, subprocess.SubprocessError):
                        pass
            if create is not None:
                try:
                    remaining = subprocess.run(['docker', 'container', 'ls', '-a', '--no-trunc', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}'], capture_output=True, text=True, timeout=LIFECYCLE_TIMEOUT)
                    if remaining.returncode != 0 or remaining.stdout.strip():
                        uncertain = True
                except (OSError, subprocess.SubprocessError):
                    uncertain = True
            if uncertain:
                QUARANTINED = True
                BROKER.mkdir(mode=0o700, exist_ok=True)
                QUARANTINE.write_text(json.dumps({'name': name, 'container_id': cid, 'reason': 'cleanup uncertain; reconcile before removing this latch'}))
                result = {'output': 'candidate sandbox cleanup uncertain; admissions quarantined; no host fallback', 'returncode': 125}
        try:
            self.wfile.write(json.dumps(result).encode() + b'\n')
        except OSError:
            pass


if __name__ == '__main__':
    def stop(signum, frame):
        # Unwind an active handler so its finally destroys the whole tool container.
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    os.umask(0o077)
    BROKER.mkdir(mode=0o700, exist_ok=True)
    path = BROKER / 'exec.sock'
    if path.exists():
        raise SystemExit('broker socket exists: verify old service stopped before removing it')
    try:
        with socketserver.UnixStreamServer(str(path), Handler) as server:
            print('candidate fixed fixture broker ready', flush=True)
            server.serve_forever()
    finally:
        path.unlink(missing_ok=True)
