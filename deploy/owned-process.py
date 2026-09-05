#!/usr/bin/python3
"""Linux per-command subreaper. No process-group or stale numeric PID signals.

The dedicated supervisor adopts orphan descendants. It only signals live children
whose identity/parentage is revalidated after pidfd_open, then reaps every child.
stdout/stderr are inherited regular evidence files, never PIPEs held by browsers.
"""
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'pid': pid, 'ppid': int(fields[1]), 'start': int(fields[19])}
    except (FileNotFoundError, ProcessLookupError):
        return None


def main():
    receipt, seconds, separator, *argv = sys.argv[1:]
    if separator != '--' or not argv:
        raise ValueError('receipt timeout -- command required')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER')
    cancelled = False

    def cancel(_signum, _frame):
        nonlocal cancelled
        cancelled = True

    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    me = os.getpid()
    data = {'supervisor': identity(me), 'signalled': [], 'reaped': [], 'cleanup_verified': False}
    child = None
    code = 125
    try:
        child = subprocess.Popen(argv)
        data['leader'] = identity(child.pid)
        deadline = time.monotonic() + float(seconds)
        while child.poll() is None and not cancelled and time.monotonic() < deadline:
            time.sleep(.01)
        code = 130 if cancelled else 124 if child.returncode is None else child.returncode
        data['exit'] = code
    finally:
        # Kill direct children first; grandchildren are then adopted by this
        # subreaper. Repeating reaches double-fork/setsid descendants too.
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            for path in Path('/proc').iterdir():
                if not path.name.isdecimal():
                    continue
                before = identity(int(path.name))
                if not before or before['ppid'] != me:
                    continue
                try:
                    fd = os.pidfd_open(before['pid'])
                except ProcessLookupError:
                    continue
                try:
                    if identity(before['pid']) == before:
                        try:
                            signal.pidfd_send_signal(fd, signal.SIGKILL)
                            if before not in data['signalled']:
                                data['signalled'].append(before)
                        except ProcessLookupError:
                            pass
                finally:
                    os.close(fd)
            try:
                while True:
                    pid, status = os.waitpid(-1, os.WNOHANG)
                    if pid == 0:
                        break
                    data['reaped'].append({'pid': pid, 'status': status})
            except ChildProcessError:
                data['cleanup_verified'] = True
                break
            time.sleep(.01)
        Path(receipt).write_text(json.dumps(data, indent=2) + '\n')
        if not data['cleanup_verified']:
            code = 125
    return code


if __name__ == '__main__':
    sys.exit(main())
