#!/usr/bin/python3
"""One VM108/VM113 release, not a general installer. See single-user-v0.2.md.

No CLI path overrides. Root-private staging is populated and checksum-verified
by the operator AFTER exact-candidate review. Normal failures restore v0.1.
No recovery guarantee for host loss mid-cutover; retain the private snapshot.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import urllib.request

STAGE = Path('/var/lib/jarvis-command-v02-stage')
BACKUP = Path('/var/lib/jarvis-command-v02-backup')
SOURCE = STAGE / 'source/deploy'
ETC = Path('/etc/jarvis-command')
LIB = Path('/usr/local/libexec')
UNITS = Path('/etc/systemd/system')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(*args):
    # Never relay Compose/env/inspect output, including exception text.
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    require(result.returncode == 0, 'release operation failed: ' + args[0])
    return result.stdout.decode()


class FileCutover:
    """Snapshot just the fixed caller-owned files; keep baseline indefinitely."""
    def __init__(self, backup, files):
        self.backup, self.files = backup, files

    def snapshot(self):
        self.backup.mkdir(mode=0o700)
        records = []
        for index, (_, target, _) in enumerate(self.files):
            require(not target.is_symlink(), 'symlink target refused')
            metadata = target.stat() if target.exists() else None
            if metadata:
                require(stat.S_ISREG(metadata.st_mode), 'non-file target refused')
                shutil.copy2(target, self.backup / str(index))
            records.append(None if metadata is None else {
                'uid': metadata.st_uid, 'gid': metadata.st_gid,
                'mode': stat.S_IMODE(metadata.st_mode),
                'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            })
        (self.backup / 'files.json').write_text(json.dumps(records))

    def install(self):
        for source, target, mode in self.files:
            data = source.read_bytes()
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            target.write_bytes(data)
            target.chmod(mode)
            require(target.read_bytes() == data, 'installed bytes mismatch')

    def verify_snapshot(self):
        info = self.backup.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700, 'untrusted backup')
        records = json.loads((self.backup / 'files.json').read_text())
        require(len(records) == len(self.files), 'incomplete rollback snapshot')
        # Verify all old bytes before changing any target.
        for index, record in enumerate(records):
            if record:
                require(hashlib.sha256((self.backup / str(index)).read_bytes()).hexdigest() == record['sha256'], 'damaged rollback snapshot')
        return records

    def restore(self):
        records = self.verify_snapshot()
        for index, (_, target, _) in enumerate(self.files):
            record = records[index]
            if record is None:
                target.unlink(missing_ok=True)
            else:
                shutil.copy2(self.backup / str(index), target)
                os.chown(target, record['uid'], record['gid'])
                target.chmod(record['mode'])
                require(hashlib.sha256(target.read_bytes()).hexdigest() == record['sha256'], 'rollback bytes mismatch')


def cutover(change, preflight, stop, start, verify):
    preflight()
    change.snapshot()
    try:
        stop()
        change.install()
        start()
        verify()
    except Exception:
        stop()
        change.restore()
        start()
        verify()
        raise


def rollback(change, stop, start, verify):
    change.verify_snapshot()
    stop()
    change.restore()
    start()
    verify()


def environment(path):
    result = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        key, value = line.split('=', 1)
        require(key not in result and re.fullmatch(r'[A-Z][A-Z0-9_]*', key), 'invalid environment keys')
        require(not any(c in value for c in '\r\n\x00'), 'invalid environment value')
        result[key] = value
    return result


def save_env(name, values):
    target = STAGE / name
    target.write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))
    target.chmod(0o600)


def prepare(role):
    key = (STAGE / 'command.key').read_text().strip()
    require(re.fullmatch(r'[0-9a-z]{64}', key), 'expected separate 64-character command key')
    old = environment(ETC / ('app.env' if role == 'app' else 'read-proxy.env'))
    require(key not in old.values(), 'command key must be distinct from existing credentials')
    image = (STAGE / (role + '-image.txt')).read_text().strip()
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'immutable image ID required')
    release = environment(ETC / 'release.env')
    if role == 'app':
        require(old.get('AUTH_MODE') == 'cloudflare' and old.get('HOST') == '127.0.0.1' and old.get('PORT') == '3000', 'production Access/loopback baseline required')
        old.update(APP_VERSION='0.2.0', COMMAND_MODE='enabled',
                   PUBLIC_ORIGIN='https://command.sharma-house.com',
                   HERMES_COMMAND_API_BASE_URL='http://127.0.0.1:18643',
                   HERMES_COMMAND_PROXY_KEY=key,
                   COMMAND_AUDIT_LOG_PATH='/var/lib/jarvis-command/audit/events.jsonl')
        save_env('app.env', old)
        release['JARVIS_COMMAND_APP_IMAGE'] = image
    else:
        save_env('command-proxy.env', dict(HOST='127.0.0.1', PORT='8647', COMMAND_PROXY_KEY=key,
                 HERMES_API_BASE_URL='http://127.0.0.1:8642', HERMES_API_KEY=old['HERMES_API_KEY'], MAX_STREAM_SECONDS='1800'))
        release['JARVIS_COMMAND_COMMAND_PROXY_IMAGE'] = image
    save_env('release.env', release)


def files(role):
    common = [(SOURCE / 'jarvis-command-egress.nft', ETC / 'jarvis-command-egress.nft', 0o644)]
    if role == 'app':
        return common + [
            (SOURCE / 'app.compose.yaml', Path('/srv/jarvis-command/compose.yaml'), 0o644),
            (SOURCE / 'app-command-storage.compose.yaml', Path('/srv/jarvis-command/app-command-storage.compose.yaml'), 0o644),
            (SOURCE / 'prepare-audit-storage.py', LIB / 'jarvis-command-prepare-audit-storage', 0o755),
            (SOURCE / 'supervised-command-app.py', LIB / 'jarvis-command-supervised-command-app', 0o755),
            (SOURCE / 'jarvis-command-app-command-storage.conf', UNITS / 'jarvis-command-app.service.d/command-storage.conf', 0o644),
            (STAGE / 'app.env', ETC / 'app.env', 0o600),
            (STAGE / 'release.env', ETC / 'release.env', 0o600),
        ]
    return common + [
        (SOURCE / 'command-proxy.compose.yaml', Path('/srv/jarvis-command-command-proxy/compose.yaml'), 0o644),
        (SOURCE / 'validated-compose-up.sh', LIB / 'jarvis-command-validated-compose-up', 0o755),
        (SOURCE / 'jarvis-command-command-proxy.service', UNITS / 'jarvis-command-command-proxy.service', 0o644),
        (SOURCE / 'jarvis-command-bridge.service', UNITS / 'jarvis-command-bridge.service', 0o644),
        (STAGE / 'command-proxy.env', ETC / 'command-proxy.env', 0o600),
        (STAGE / 'release.env', ETC / 'release.env', 0o600),
    ]


def get_json(url, key=None):
    headers = {} if key is None else {'Authorization': 'Bearer ' + key}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as response:
        return json.load(response)


class Host:
    def __init__(self, role):
        self.role = role
        self.name = 'jarvis-command-app' if role == 'app' else 'jarvis-command-command-proxy'

    def preflight(self):
        image = (STAGE / (self.role + '-image.txt')).read_text().strip()
        require(run('/usr/bin/docker', 'image', 'inspect', '--format', '{{.Id}}', image).strip() == image, 'image not loaded')
        run('/usr/bin/systemctl', 'is-active', 'jarvis-command-egress.service')
        run('/usr/sbin/nft', '--check', '-f', str(SOURCE / 'jarvis-command-egress.nft'))
        if self.role == 'app':
            run('/usr/bin/python3', str(SOURCE / 'prepare-audit-storage.py'), 'verify', '--trusted-root', '/var/lib/jarvis-command', '--path', '/var/lib/jarvis-command/audit/events.jsonl')
            key = (STAGE / 'command.key').read_text().strip()
            require(get_json('http://127.0.0.1:18643/_ready', key).get('ready') is True, 'command bridge not ready')
            baseline = run('/usr/bin/docker', 'inspect', '--format', '{{.Image}}', self.name).strip()
            require(re.fullmatch(r'sha256:[0-9a-f]{64}', baseline), 'missing baseline image')
            run('/usr/bin/docker', 'image', 'save', '-o', str(STAGE / 'baseline-app-image.tar'), baseline)
        else:
            old = environment(ETC / 'read-proxy.env')
            cap = get_json('http://127.0.0.1:8642/v1/capabilities', old['HERMES_API_KEY'])['features']['runs_idempotency']
            require(cap.get('supported') is True and cap.get('durable') is True and cap.get('retention_seconds', 0) >= 86400, 'upstream durability unavailable')
            require(not run('/usr/bin/docker', 'ps', '-a', '--filter', 'name=^/jarvis-command-command-proxy$', '--format', '{{.ID}}').strip(), 'command proxy already exists')

    def stop(self):
        if self.role == 'app' or (UNITS / (self.name + '.service')).exists():
            run('/usr/bin/systemctl', 'stop', self.name + '.service')
        ids = run('/usr/bin/docker', 'ps', '-a', '--filter', 'name=^/' + self.name + '$', '--format', '{{.ID}}').split()
        require(len(ids) <= 1, 'ambiguous owned container')
        for identity in ids:
            require(run('/usr/bin/docker', 'inspect', '--format', '{{.State.Running}}', identity).strip() == 'false', 'container still running')
            run('/usr/bin/docker', 'rm', identity)
        if self.role == 'hermes':
            run('/usr/bin/systemctl', 'stop', 'jarvis-command-bridge.service')

    def start(self):
        run('/usr/bin/systemctl', 'daemon-reload')
        # Reload only the owned table; never restart egress dependencies or Docker.
        run('/usr/bin/systemctl', 'reload', 'jarvis-command-egress.service')
        if self.role == 'app' or (UNITS / (self.name + '.service')).exists():
            run('/usr/bin/systemctl', 'start', self.name + '.service')
        if self.role == 'hermes':
            run('/usr/bin/systemctl', 'start', 'jarvis-command-bridge.service')

    def verify(self):
        if self.role == 'hermes' and not (UNITS / (self.name + '.service')).exists():
            run('/usr/bin/systemctl', 'is-active', 'jarvis-command-bridge.service')
            require(not run('/usr/bin/docker', 'ps', '-a', '--filter', 'name=^/' + self.name + '$', '--format', '{{.ID}}').strip(), 'rollback proxy remains')
            return
        run('/usr/bin/systemctl', 'is-active', self.name + '.service')
        expected = environment(ETC / 'release.env')['JARVIS_COMMAND_APP_IMAGE' if self.role == 'app' else 'JARVIS_COMMAND_COMMAND_PROXY_IMAGE']
        require(run('/usr/bin/docker', 'inspect', '--format', '{{.Image}}', self.name).strip() == expected, 'running image mismatch')
        if self.role == 'app':
            require(get_json('http://127.0.0.1:3000/api/health').get('status') == 'ok', 'app health failed')
        else:
            key = environment(ETC / 'command-proxy.env')['COMMAND_PROXY_KEY']
            require(get_json('http://127.0.0.1:8647/_ready', key).get('ready') is True, 'command readiness failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['apply', 'rollback'])
    parser.add_argument('role', choices=['app', 'hermes'])
    parser.add_argument('--ack', required=True, choices=['REVIEWED_SINGLE_USER_V02'])
    args = parser.parse_args()
    require(os.geteuid() == 0, 'root required')
    os.umask(0o077)
    for path in [STAGE, *STAGE.parents]:
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'untrusted staging ancestor')
    require(stat.S_IMODE(STAGE.stat().st_mode) == 0o700, 'private staging required')
    require(Path(__file__).resolve() == SOURCE / 'single-user-release.py', 'execute only reviewed root-private staged source')
    host = Host(args.role)
    change = FileCutover(BACKUP, files(args.role))
    if args.action == 'rollback':
        rollback(change, host.stop, host.start, host.verify)
        print('Restored baseline; private snapshot retained')
        return
    require(not BACKUP.exists(), 'one-shot release: preserve existing backup and stop')
    prepare(args.role)
    cutover(change, host.preflight, host.stop, host.start, host.verify)
    print('Local service cutover verified; public authenticated acceptance remains required')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Release failed; inspect private snapshot and service state. No success claimed.', file=sys.stderr)
        raise SystemExit(1)
