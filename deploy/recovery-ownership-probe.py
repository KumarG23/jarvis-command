#!/usr/bin/python3
"""Private-root-only ownership probe. Never run the mutable Node fixtures as root.

Stage this file plus the exact helper and TWO bundled scripts as root:root0400
under a unique root:root0700 /root/jarvis-recovery-probe.* directory. Verify the
reviewed SHA256SUMS before invoking /usr/bin/python3 -I this-file --private-root-probe.
No service/network/container commands are permitted; immutable guard executables
replace every consequential command. Only this exact directory may be removed.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    require(os.geteuid() == 0 and sys.argv[1:] == ["--private-root-probe"], "explicit root-only contract required")
    root = Path(__file__).absolute().parent
    require(root.parent == Path('/root') and root.name.startswith('jarvis-recovery-probe.'), 'private root path required')
    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700, 'private root metadata invalid')
    names = ['recovery-ownership-probe.py', 'trusted-recovery-directory.sh', 'cutover-app.sh', 'install-android-association.sh']
    bindings = {}
    for name in names:
        path = root / name
        meta = path.lstat()
        require(stat.S_ISREG(meta.st_mode) and meta.st_uid == meta.st_gid == 0 and meta.st_nlink == 1 and stat.S_IMODE(meta.st_mode) == 0o400, 'staged input metadata invalid')
        bindings[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    bin_dir = root / 'bin'
    bin_dir.mkdir(mode=0o700)
    commands = root / 'forbidden.log'
    for name in ['docker', 'systemctl', 'install', 'curl', 'ss']:
        path = bin_dir / name
        path.write_text('#!/bin/bash\nprintf "forbidden command\\n" >> ' + str(commands) + '\nexit 99\n')
        path.chmod(0o500)
    env = {'PATH': str(bin_dir) + ':/usr/bin:/bin', 'HOME': str(root), 'LC_ALL': 'C',
           'DOCKER_BIN': str(bin_dir / 'docker'), 'SYSTEMCTL_BIN': str(bin_dir / 'systemctl'),
           'CURL_BIN': str(bin_dir / 'curl'), 'SS_BIN': str(bin_dir / 'ss'),
           'APP_COMPOSE_PATH': str(root / 'untouched-compose'), 'ASSOCIATION_PATH': str(root / 'untouched-association')}
    backup = root / 'backups'
    backup.mkdir(mode=0o700)
    sentinel = root / 'sentinel'
    sentinel.write_text('unrelated sentinel\n')
    sentinel.chmod(0o600)
    sentinel_before = sentinel.stat()
    outcomes = []

    def run(argv, success, label):
        result = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=10)
        require((result.returncode == 0) == success, label + ': unexpected status ' + repr(result.stderr))
        require(not commands.exists(), label + ': consequential command attempted')
        if not success:
            require('STATE_DIR=' not in result.stdout and 'RESTORED_FROM=' not in result.stdout and 'ROLLED_BACK_FROM=' not in result.stdout, 'false receipt')
        outcomes.append({'case': label, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})

    helper = root / 'trusted-recovery-directory.sh'
    run(['/bin/bash', '-c', 'set -Eeuo pipefail; umask 077; source "$1"; recovery_open "$2"; recovery_create cutover-20260905T000000Z; recovery_verify', 'probe', str(helper), str(backup)], True, 'unmapped root create/open/verify')
    shutil.rmtree(backup / 'cutover-20260905T000000Z')
    for script, prefix, scalar in [('cutover-app.sh', 'cutover', 'bootstrap-was-running'), ('install-android-association.sh', 'association', 'previous-unit-active')]:
        for attack in ['leaf-uid', 'leaf-gid', 'ancestor-uid', 'ancestor-gid', 'file-uid', 'file-gid']:
            state = backup / (prefix + '-20260905T000000Z')
            state.mkdir(mode=0o700)
            value = state / scalar
            value.write_text('true\n')
            value.chmod(0o600)
            target = backup if attack.startswith('ancestor') else value if attack.startswith('file') else state
            os.chown(target, 1000 if attack.endswith('uid') else 0, 1000 if attack.endswith('gid') else 0)
            before = (target.lstat(), value.read_bytes())
            run(['/bin/bash', str(root / script), 'rollback', str(state)], False, script + ':' + attack)
            after = target.lstat()
            for field in ['st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_mtime_ns']:
                require(getattr(before[0], field) == getattr(after, field), 'refusal changed hostile metadata')
            require(value.read_bytes() == before[1], 'state bytes changed')
            os.chown(target, 0, 0)
            shutil.rmtree(state)
    for change in ['chown 1000:1000', 'chmod 0777']:
        run(['/bin/bash', '-c', 'set -Eeuo pipefail; source "$1"; recovery_open "$2"; ' + change + ' "$2"; recovery_verify', 'probe', str(helper), str(backup)], False, 'pinned metadata change: ' + change)
        os.chown(backup, 0, 0)
        backup.chmod(0o700)
    for field in ['st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_size', 'st_mtime_ns']:
        require(getattr(sentinel.stat(), field) == getattr(sentinel_before, field), 'sentinel metadata changed')
    require(sentinel.read_text() == 'unrelated sentinel\n', 'sentinel bytes changed')
    require(not (root / 'untouched-compose').exists() and not (root / 'untouched-association').exists(), 'runtime path changed')
    print(json.dumps({'status': 'PASS', 'uid': os.geteuid(), 'anchor': '/', 'bindings': bindings, 'outcomes': outcomes, 'sentinel_unchanged': True, 'consequential_commands': 0}, indent=2))


if __name__ == '__main__':
    main()
