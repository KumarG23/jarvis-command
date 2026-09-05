"""Fixed, private synthetic fixture handshake; no browser/container identifiers accepted."""
import json
import os
import stat


def request(path, expected, uid=0):
    state = path.lstat()
    if not stat.S_ISREG(state.st_mode) or state.st_uid != uid or state.st_mode & 0o777 != 0o600 or state.st_nlink != 1 or state.st_size > 256:
        raise RuntimeError('unsafe recovery request')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if os.fstat(fd) != state:
            raise RuntimeError('replaced recovery request')
        value = json.loads(os.read(fd, 257))
    finally:
        os.close(fd)
    if expected not in ['desktop', 'phone'] or value != {'mode': expected}:
        raise ValueError('unexpected recovery command or replay')
    return expected


def same_mounts(current, expected):
    """Docker inspection order is unspecified; retain every per-mount field."""
    def keyed(mounts):
        if not isinstance(mounts, list):
            return None
        result = {}
        for mount in mounts:
            if not isinstance(mount, dict):
                return None
            destination = mount.get('Destination')
            if not isinstance(destination, str) or not destination or destination in result:
                return None
            result[destination] = mount
        return result
    left, right = keyed(current), keyed(expected)
    return left is not None and right is not None and left == right


def replace_app(*, validate, snapshot, kill, absent, launch, ready, unchanged):
    # Ownership is maintained by the parent before CREATE, including failed launches.
    validate()
    before = snapshot()
    kill()
    absent()
    replacement = launch()
    ready()
    after = unchanged()
    return {'before': before, 'replacement': replacement, 'after': after}
