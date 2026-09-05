#!/usr/bin/env python3
"""Synthetic SSH only. Run as root under NEW net+mount+PID namespaces; never install accounts."""
import argparse
import json
import os
import pathlib
import pwd
import signal
import socket
import subprocess
import tempfile
import threading
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--parent-net', required=True)
    parser.add_argument('--parent-mnt', required=True)
    parser.add_argument('--user', required=True)
    args = parser.parse_args()
    net = os.readlink('/proc/self/ns/net')
    mnt = os.readlink('/proc/self/ns/mnt')
    assert os.geteuid() == 0 and net != args.parent_net and mnt != args.parent_mnt
    # Mount isolation is separate from network isolation. No host /run writes.
    subprocess.run(['mount', '--make-rprivate', '/'], check=True)
    subprocess.run(['mount', '-t', 'tmpfs', '-o', 'mode=755', 'tmpfs', '/run'], check=True)
    pathlib.Path('/run/sshd').mkdir(mode=0o755)
    subprocess.run(['ip', 'link', 'set', 'lo', 'up'], check=True)
    user = pwd.getpwnam(args.user)  # NSS lookup only; no account mutation.
    deploy = pathlib.Path(__file__).resolve().parent
    owned = []
    sockets = []
    logs = []
    results = {'netns': net, 'mountns': mnt, 'fixture_user_substitution': args.user, 'checks': []}
    with tempfile.TemporaryDirectory(prefix='jarvis-ssh-fixture-', dir='/run') as temp:
        root = pathlib.Path(temp)
        os.chown(root, user.pw_uid, user.pw_gid)

        def run(command, check=True):
            result = subprocess.run(command, capture_output=True, text=True, timeout=8)
            print(json.dumps({'command': command, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}), flush=True)
            if check:
                assert result.returncode == 0, result.stderr
            return result

        def start(command, name):
            log = open(root / (name + '.log'), 'w+')
            logs.append(log)
            proc = subprocess.Popen(command, stdout=log, stderr=log, start_new_session=True)
            owned.append(proc)
            return proc

        def wait_port(port):
            end = time.monotonic() + 4
            while time.monotonic() < end:
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.2):
                        return
                except OSError:
                    time.sleep(.05)
            raise AssertionError(f'listener {port} not ready')

        def canary(port, content):
            server = socket.socket()
            server.bind(('127.0.0.1', port))
            server.listen()
            sockets.append(server)
            def serve():
                while True:
                    try:
                        conn, _ = server.accept()
                        with conn:
                            conn.sendall(content)
                    except OSError:
                        return
            threading.Thread(target=serve, daemon=True).start()

        try:
            for name in ['host', 'client', 'bad']:
                run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'disposable-fixture', '-f', str(root / name)])
            key = run(['python3', str(deploy / 'render-bridge-key.py'), str(root / 'client.pub')]).stdout
            auth = root / 'authorized_keys'
            auth.write_text(key)
            auth.chmod(0o600)
            os.chown(auth, user.pw_uid, user.pw_gid)
            host_pub = (root / 'host.pub').read_text().split()
            (root / 'known_hosts').write_text('[127.0.0.1]:22222 ' + ' '.join(host_pub[:2]) + '\n')
            base = (f'Port 22222\nListenAddress 127.0.0.1\nHostKey {root}/host\nPidFile {root}/sshd.pid\n'
                    f'AuthorizedKeysFile {auth}\nStrictModes yes\nUsePAM yes\nPasswordAuthentication no\n'
                    'KbdInteractiveAuthentication no\nPubkeyAuthentication yes\nAuthenticationMethods publickey\n'
                    f'AllowUsers {args.user}\nLogLevel VERBOSE\n')
            production = (deploy / 'sshd-jarvis-bridge.conf').read_text()
            config = root / 'sshd.conf'
            config.write_text(base + production)
            run(['/usr/sbin/sshd', '-t', '-f', str(config)])
            effective = run(['/usr/sbin/sshd', '-T', '-f', str(config), '-C', 'user=jarvis-bridge,host=localhost,addr=127.0.0.1']).stdout
            required = ['permitlisten 127.0.0.1:18642 127.0.0.1:18643', 'permitopen none', 'maxsessions 0',
                        'allowtcpforwarding remote', 'gatewayports no', 'permittty no', 'permituserrc no',
                        'passwordauthentication no', 'kbdinteractiveauthentication no', 'allowagentforwarding no',
                        'x11forwarding no', 'authenticationmethods publickey', 'allowstreamlocalforwarding no']
            for line in required:
                assert line in effective.splitlines(), line
            results['checks'].append('unchanged production Match User effective policy')
            assert production.count('Match User jarvis-bridge') == 1
            config.write_text(base + production.replace('Match User jarvis-bridge', f'Match User {args.user}'))
            run(['/usr/sbin/sshd', '-t', '-f', str(config)])
            fixture = run(['/usr/sbin/sshd', '-T', '-f', str(config), '-C', f'user={args.user},host=localhost,addr=127.0.0.1']).stdout
            for line in required:
                assert line in fixture.splitlines(), line
            start(['/usr/sbin/sshd', '-D', '-e', '-f', str(config)], 'sshd')
            wait_port(22222)
            common = ['ssh', '-F', '/dev/null', '-p', '22222', '-i', str(root / 'client'),
                      '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'BatchMode=yes',
                      '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={root}/known_hosts',
                      '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ExitOnForwardFailure=yes',
                      '-o', 'ConnectTimeout=3']
            target = f'{args.user}@127.0.0.1'
            canary(8643, b'SYNTHETIC-READ\n')
            canary(8647, b'SYNTHETIC-COMMAND\n')
            bridge = start(common + ['-NT', '-R', '127.0.0.1:18642:127.0.0.1:8643',
                                    '-R', '127.0.0.1:18643:127.0.0.1:8647', target], 'bridge')
            for port, expected in [(18642, b'SYNTHETIC-READ\n'), (18643, b'SYNTHETIC-COMMAND\n')]:
                wait_port(port)
                with socket.create_connection(('127.0.0.1', port), timeout=2) as conn:
                    actual = conn.recv(100)
                    assert actual == expected, actual
                    results['checks'].append(f'{port}: {actual.decode().strip()}')
            for spec in ['127.0.0.1:18644:127.0.0.1:8643', '0.0.0.0:18644:127.0.0.1:8643',
                         '0.0.0.0:18642:127.0.0.1:8643', '127.0.0.2:18643:127.0.0.1:8647']:
                denied = run(common + ['-NT', '-R', spec, target], check=False)
                assert denied.returncode != 0 and 'remote port forwarding failed' in denied.stderr
                results['checks'].append('remote denied ' + spec)
            for options in [[], ['-tt']]:
                denied = run(common + options + [target, 'printf SESSION-MUST-NOT-RUN'], check=False)
                assert denied.returncode != 0 and 'SESSION-MUST-NOT-RUN' not in denied.stdout
                assert 'channel 0: open failed' in denied.stderr
                results['checks'].append('session denied ' + str(options))
            denied = run(common + ['-W', '127.0.0.1:8643', target], check=False)
            assert denied.returncode != 0 and 'administratively prohibited' in denied.stderr
            results['checks'].append('direct-tcpip local-forward channel denied')
            bad = common.copy()
            bad[bad.index('-i') + 1] = str(root / 'bad')
            denied = run(bad + ['-NT', target], check=False)
            assert denied.returncode != 0 and 'Permission denied (publickey)' in denied.stderr
            results['checks'].append('bad key denied by real publickey authentication')
            assert bridge.poll() is None
            results['passed'] = True
        finally:
            for proc in reversed(owned):
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=3)
            for server in sockets:
                server.close()
            for log in logs:
                log.seek(0)
                print('FIXTURE LOG ' + log.name + '\n' + log.read(), flush=True)
                log.close()
            results['owned_processes_reaped'] = all(p.poll() is not None for p in owned)
            results['owned_pids'] = [p.pid for p in owned]
            print(json.dumps(results, indent=2), flush=True)
    assert not root.exists()
    print('CLEANUP private key directory removed; owned processes reaped; anonymous namespaces expire on exit', flush=True)


if __name__ == '__main__':
    main()
