#!/usr/bin/env python3
"""Manual root-only probe; invoke ONLY through a NEW unshare --net namespace.

sudo -n unshare --net --fork python3 deploy/verify-command-egress-isolated.py \
  deploy/jarvis-command-egress.nft "$(readlink /proc/self/ns/net)"
No Docker, host nft, persistent namespaces, credentials, or service changes.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading


def main():
    policy = Path(sys.argv[1]).resolve()
    parent_namespace = sys.argv[2]
    namespace = os.readlink('/proc/self/ns/net')
    if os.geteuid() != 0 or namespace == parent_namespace:
        raise SystemExit('REFUSED: must be root inside a NEW network namespace')
    print(json.dumps({'namespace': namespace, 'parent_namespace': parent_namespace,
                      'isolated': True}), flush=True)

    def run(*args, input=None, check=True):
        result = subprocess.run(args, input=input, text=True, capture_output=True, check=check)
        if result.stderr:
            print(result.stderr, file=sys.stderr, flush=True)
        return result

    def nft(*args, **kwargs):
        return run('/usr/sbin/nft', *args, **kwargs)

    run('/usr/sbin/ip', 'link', 'set', 'lo', 'up')
    run('/usr/sbin/ip', 'addr', 'add', '192.0.2.1/32', 'dev', 'lo')
    nft('add', 'table', 'inet', 'unrelated_fixture')
    sentinel = nft('list', 'table', 'inet', 'unrelated_fixture').stdout
    nft('add', 'table', 'inet', 'jarvis_command_egress')
    nft('--check', '-f', str(policy))
    nft('-f', str(policy))
    first = nft('list', 'table', 'inet', 'jarvis_command_egress').stdout
    nft('-f', str(policy))
    assert first == nft('list', 'table', 'inet', 'jarvis_command_egress').stdout
    bad = nft('-f', '-', input='delete table inet jarvis_command_egress\ntable inet jarvis_command_egress { invalid syntax }\n', check=False)
    assert bad.returncode != 0
    assert first == nft('list', 'table', 'inet', 'jarvis_command_egress').stdout
    assert sentinel == nft('list', 'table', 'inet', 'unrelated_fixture').stdout
    print(json.dumps({'parse': True, 'repeat_atomic_replace': True,
                      'invalid_batch_retains_policy': True, 'unrelated_table_preserved': True}), flush=True)

    sockets = []
    def serve(listener):
        while True:
            try:
                conn, _ = listener.accept()
                with conn:
                    conn.settimeout(1)
                    conn.sendall(conn.recv(1))
            except OSError:
                return

    ports = [3000, 8642, 8643, 8644, 8647, 18642, 18643, 9999]
    for family, address in [(socket.AF_INET, '0.0.0.0'), (socket.AF_INET6, '::1')]:
        for port in ports:
            listener = socket.socket(family)
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind((address, port))
            listener.listen(16)
            sockets.append(listener)
            threading.Thread(target=serve, args=(listener,), daemon=True).start()
    checks = []
    try:
        for uid, allowed in [(10001, {3000, 18642, 18643}), (10002, {8642, 8643}), (10003, {8642, 8647}), (10004, set(ports))]:
            for host in ['127.0.0.1', '127.0.0.2', '192.0.2.1', '::1']:
                for port in ports:
                    expected = uid == 10004 or (host == '127.0.0.1' and port in allowed)
                    # Separate process drops real/effective/saved IDs before creating socket.
                    probe = subprocess.run([sys.executable, '-c',
                        'import os,socket,sys; os.setgroups([]); os.setgid(int(sys.argv[1])); os.setuid(int(sys.argv[1])); '
                        's=socket.create_connection((sys.argv[2],int(sys.argv[3])),timeout=0.4); '
                        's.sendall(b"x"); assert s.recv(1)==b"x"; s.close()', str(uid), host, str(port)],
                        capture_output=True, timeout=2)
                    actual = probe.returncode == 0
                    row = {'uid': uid, 'host': host, 'port': port, 'allowed': actual, 'expected': expected}
                    checks.append(row)
                    print(json.dumps(row), flush=True)
                    assert actual == expected, row
        print(json.dumps({'success': True, 'tcp_checks': len(checks)}), flush=True)
    finally:
        for listener in sockets:
            listener.close()
        nft('delete', 'table', 'inet', 'jarvis_command_egress')
        nft('delete', 'table', 'inet', 'unrelated_fixture')
        assert nft('list', 'ruleset').stdout == ''
        print(json.dumps({'fixture_tables_removed': True, 'namespace_destroyed_on_process_exit': True}), flush=True)


if __name__ == '__main__':
    main()
