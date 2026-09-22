#!/usr/bin/python3
"""Prepare/verify the Jarvis Command artifact storage directory.

Run with the app stopped. The only accepted path is trusted-root/artifacts.
Existing storage is verified, never repaired or chowned.
"""
import argparse
import json
import os
from pathlib import Path
import stat
import sys

DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def identity(s):
    return (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def directory(fd, uid, exact=None):
    s = os.fstat(fd)
    mode = stat.S_IMODE(s.st_mode)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != uid or s.st_gid != uid or mode & 0o7022 or (exact is not None and mode != exact):
        raise ValueError('unsafe directory ownership/mode')
    return s


def storage(trusted_root: Path, path: Path, *, prepare=False):
    if os.geteuid() != 0:
        raise ValueError('root required; fixture privilege is not deployment authorization')
    root, path = Path(trusted_root), Path(path)
    if not root.is_absolute() or '..' in root.parts or path != root / 'artifacts':
        raise ValueError('path must be exactly trusted-root/artifacts')
    fds = []
    bindings = []

    def opened(fd):
        fds.append(fd)
        return fd

    def bound(parent, name, fd):
        bindings.append((parent, name, fd))
        return fd

    try:
        parent = opened(os.open('/', DIR_FLAGS))
        directory(parent, 0)
        for part in root.parts[1:]:
            parent = bound(parent, part, opened(os.open(part, DIR_FLAGS, dir_fd=parent)))
            directory(parent, 0)
        created = False
        if prepare:
            try:
                os.mkdir('artifacts', 0o700, dir_fd=parent)
                created = True
            except FileExistsError:
                pass
        leaf = bound(parent, 'artifacts', opened(os.open('artifacts', DIR_FLAGS, dir_fd=parent)))
        if created:
            os.fchown(leaf, 10001, 10001)
            os.fchmod(leaf, 0o700)
            os.fsync(leaf)
            os.fsync(parent)
        info = directory(leaf, 10001, 0o700)
        for ancestor, name, descriptor in bindings:
            if identity(os.stat(name, dir_fd=ancestor, follow_symlinks=False)) != identity(os.fstat(descriptor)):
                raise ValueError('path binding changed')
        directory(parent, 0)
        directory(leaf, 10001, 0o700)
        return {
            'device': info.st_dev,
            'inode': info.st_ino,
            'uid': info.st_uid,
            'gid': info.st_gid,
            'mode': '0700',
            'path': str(path),
            'created': created,
            'chain_validated': True,
        }
    finally:
        for fd in reversed(fds):
            os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'verify'])
    parser.add_argument('--trusted-root', type=Path, required=True)
    parser.add_argument('--path', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(storage(args.trusted_root, args.path, prepare=args.action == 'prepare')))
        return 0
    except (OSError, ValueError):
        print('artifact storage refused; no existing storage repaired', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
