"""Actual Docker lifecycle regression. Faults affect CLI timing/errors, not effects."""
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from typing import Any
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('broker', Path(__file__).with_name('candidate-fixture-broker.py'))
assert spec is not None and spec.loader is not None
m: Any = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
real_popen = subprocess.Popen
real_run = subprocess.run
results = []


def request(command, timeout, stdin=None):
    client, server = socket.socketpair()
    errors = []
    def handle():
        try:
            m.Handler(server, None, None)
        except BaseException as e:
            errors.append(repr(e))
        finally:
            server.close()
    thread = threading.Thread(target=handle)
    thread.start()
    client.sendall(json.dumps(dict(command=command, stdin=stdin, timeout=timeout)).encode() + b'\n')
    client.settimeout(65)
    try:
        with client.makefile('rb') as stream:
            result = json.loads(stream.readline())
    finally:
        client.close()
    thread.join(65)
    assert not thread.is_alive() and not errors, errors
    return result


with tempfile.TemporaryDirectory(prefix='jc-lifecycle-') as temp:
    m.BROKER = Path(temp)
    m.QUARANTINE = m.BROKER / 'cleanup-uncertain.json'
    for case in ['delayed-create', 'create-settle-timeout', 'delayed-start', 'running-timeout', 'remove-failure', 'remove-timeout', 'wait-failure', 'normal-stdin']:
        m.LIFECYCLE_TIMEOUT = 0.2 if case == 'create-settle-timeout' else 15
        names = []
        starts = []
        marker = m.FIXTURES / ('lifecycle-' + uuid.uuid4().hex)
        def popen(args, *a, **kw):
            if args[:2] == ['docker', 'create']:
                names.append(args[args.index('--name') + 1])
            if args[:2] == ['docker', 'start']:
                starts.append(args[-1])
            if (case in ['delayed-create', 'create-settle-timeout'] and args[:2] == ['docker', 'create']) or (case == 'delayed-start' and args[:2] == ['docker', 'start']):
                args = ['/bin/bash', '-c', 'sleep 0.6; exec "$@"', 'lifecycle-delay'] + args
            proc = real_popen(args, *a, **kw)
            if case == 'wait-failure' and args[:2] == ['docker', 'start']:
                wait = proc.wait
                def fail_once(*a, **kw):
                    proc.wait = wait
                    raise subprocess.TimeoutExpired('injected start wait failure', 15)
                proc.wait = fail_once
            return proc
        def run(args, *a, **kw):
            if args[:2] == ['docker', 'rm'] and case == 'remove-failure':
                return subprocess.CompletedProcess(args, 1, b'', b'injected removal failure')
            if args[:2] == ['docker', 'rm'] and case == 'remove-timeout':
                raise subprocess.TimeoutExpired(args, 15)
            return real_run(args, *a, **kw)
        started = time.monotonic()
        try:
            with patch.object(m.subprocess, 'Popen', popen), patch.object(m.subprocess, 'run', run):
                cmd = 'sleep 1; printf late > /fixtures/' + marker.name
                timeout = 0.01 if case == 'delayed-create' else 0.2
                if case == 'normal-stdin':
                    cmd, timeout = 'read value; printf "%s" "$value"', 5
                result = request(cmd, timeout, 'stdin-preserved\n' if case == 'normal-stdin' else None)
                uncertain = case in ['create-settle-timeout', 'remove-failure', 'remove-timeout', 'wait-failure']
                assert result['returncode'] == (125 if uncertain else 0 if case == 'normal-stdin' else 124), result
                if uncertain:
                    assert m.QUARANTINE.exists() and m.QUARANTINED
                    count = len(names)
                    assert request('printf forbidden', 2)['returncode'] == 125
                    assert len(names) == count, 'quarantine admitted a command'
                    m.QUARANTINED = False  # simulate a fresh broker's in-memory state
                    assert request('printf forbidden-after-restart', 2)['returncode'] == 125
                    assert len(names) == count, 'persistent quarantine admitted a command'
                else:
                    assert not marker.exists(), case
                    if case == 'normal-stdin':
                        assert result['output'] == 'stdin-preserved', result
                    if case == 'delayed-create':
                        assert not starts, starts
                results.append(dict(case=case, response=result, elapsed=round(time.monotonic()-started, 3), marker_exists=marker.exists(), names=names, starts=starts, quarantine=uncertain))
        finally:
            for name in names:
                real_run(['docker', 'rm', '-f', name], capture_output=True, timeout=20)
                remaining = real_run(['docker', 'container', 'ls', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}'], capture_output=True, text=True, check=True)
                assert not remaining.stdout.strip(), remaining.stdout
            marker.unlink(missing_ok=True)
            m.QUARANTINE.unlink(missing_ok=True)
            m.QUARANTINED = False
print(json.dumps(results, indent=2))
(m.STATE / 'lifecycle-regression.json').write_text(json.dumps(results, indent=2))
