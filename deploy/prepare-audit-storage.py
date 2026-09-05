#!/usr/bin/python3
"""Prepare/verify audit metadata, never repair existing storage or validate its chain.

Run with the app stopped. Explicit trusted root must already exist; every ancestor
through / must be root-owned and not group/world writable. Only audit/ and its
single events.jsonl are created. The emitted app remains the chain authority.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

MAX_BYTES = 16_777_216
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def identity(s):
    return (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def directory(fd, uid, exact=None):
    s = os.fstat(fd)
    mode = stat.S_IMODE(s.st_mode)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != uid or s.st_gid != uid or mode & 0o7022 or (exact is not None and mode != exact):
        raise ValueError('unsafe directory ownership/mode')


def storage(trusted_root: Path, path: Path, *, prepare=False):
    if os.geteuid() != 0:
        raise ValueError('root required; fixture privilege is not deployment authorization')
    root, path = Path(trusted_root), Path(path)
    if not root.is_absolute() or '..' in root.parts or path != root / 'audit/events.jsonl':
        raise ValueError('path must be exactly trusted-root/audit/events.jsonl')
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
        created_dir = False
        if prepare:
            try:
                os.mkdir('audit', 0o700, dir_fd=parent)
                created_dir = True
            except FileExistsError:
                pass
        leaf = bound(parent, 'audit', opened(os.open('audit', DIR_FLAGS, dir_fd=parent)))
        if created_dir:
            os.fchown(leaf, 10001, 10001)
            os.fchmod(leaf, 0o700)
            os.fsync(leaf)
            os.fsync(parent)
        directory(leaf, 10001, 0o700)
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
        created_file = False
        if prepare:
            try:
                fd = opened(os.open('events.jsonl', flags | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=leaf))
                created_file = True
            except FileExistsError:
                fd = opened(os.open('events.jsonl', flags, dir_fd=leaf))
        else:
            fd = opened(os.open('events.jsonl', flags, dir_fd=leaf))
        bound(leaf, 'events.jsonl', fd)
        if created_file:
            os.fchown(fd, 10001, 10001)
            os.fchmod(fd, 0o600)
            os.fsync(fd)
            os.fsync(leaf)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != 10001 or before.st_gid != 10001 or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size > MAX_BYTES:
            raise ValueError('unsafe ledger ownership/type/mode/links/size')
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(fd, min(65536, MAX_BYTES + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError('ledger exceeds capacity')
            digest.update(chunk)
        if size != before.st_size or identity(before) != identity(os.fstat(fd)):
            raise ValueError('ledger changed during verification; stop writer first')
        for ancestor, name, descriptor in bindings:
            if identity(os.stat(name, dir_fd=ancestor, follow_symlinks=False)) != identity(os.fstat(descriptor)):
                raise ValueError('path binding changed')
        directory(parent, 0)
        directory(leaf, 10001, 0o700)
        return {'device': before.st_dev, 'inode': before.st_ino, 'size': size, 'sha256': digest.hexdigest(), 'uid': before.st_uid, 'gid': before.st_gid, 'mode': '0600', 'chain_validated': False}
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
        print('audit storage refused; no existing ledger repaired', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
