#!/usr/bin/env python3
"""Validate one canonical Ed25519 public key; emit only fixed bridge restrictions."""
import base64
import binascii
import os
import re
import stat
import sys


def render(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError('public key must be a regular file')
        data = source.read(4097)
    if len(data) > 4096:
        raise ValueError('public key is too large')
    # One optional terminal LF, printable ASCII comment only; never preserve comments.
    match = re.fullmatch(rb'ssh-ed25519 ([A-Za-z0-9+/]{68})(?: ([\x21-\x7e][\x20-\x7e]*))?\n?', data)
    if not match or (match[2] and re.search(rb'\bssh-[a-z0-9-]+\b', match[2])):
        raise ValueError('expected one canonical Ed25519 public key')
    blob = match[1]
    wire = base64.b64decode(blob, validate=True)
    if (base64.b64encode(wire) != blob or len(wire) != 51
            or wire[:19] != b'\0\0\0\x0bssh-ed25519\0\0\0\x20'):
        raise ValueError('invalid Ed25519 wire format')
    return ('restrict,port-forwarding,permitlisten="127.0.0.1:18642",'
            'permitlisten="127.0.0.1:18643" ssh-ed25519 ' + blob.decode('ascii'))


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('expected public key path')
        print(render(sys.argv[1]))
    except (OSError, ValueError, binascii.Error):
        print('expected one canonical Ed25519 public key in a regular file', file=sys.stderr)
        sys.exit(65)
