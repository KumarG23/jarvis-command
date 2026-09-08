#!/usr/bin/python3
"""Emit a standalone recovery script with the shared trust boundary embedded.

Used before checksum staging; no helper is ever executed from an operator stage
as root. The resulting script also supports the association stdin publisher.
"""
import sys
from pathlib import Path

SOURCE_LINE = 'source "$(dirname -- "${BASH_SOURCE[0]}")/trusted-recovery-directory.sh"'


def bundle(source: Path) -> str:
    if source.name not in {"cutover-app.sh", "install-android-association.sh"}:
        raise ValueError("unsupported recovery script")
    text = source.read_text()
    if text.count(SOURCE_LINE) != 1:
        raise ValueError("recovery helper source marker must occur exactly once")
    helper = source.with_name("trusted-recovery-directory.sh").read_text()
    return text.replace(SOURCE_LINE, helper.rstrip())


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: bundle-recovery-script.py SCRIPT")
    sys.stdout.write(bundle(Path(sys.argv[1])))
