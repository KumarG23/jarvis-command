#!/usr/bin/python3
"""Descriptor-safe staging and installation for deployment environment files."""

from __future__ import annotations

import argparse
import os
import secrets
import stat
import sys
from pathlib import Path

MAX_ENV_BYTES = 64 * 1024


class SecureEnvError(RuntimeError):
    """Raised when a credential file cannot be handled safely."""


def _source_flags() -> int:
    return (
        os.O_RDONLY
        | os.O_CLOEXEC
        | os.O_NOFOLLOW
        | os.O_NONBLOCK
    )


def _directory_flags() -> int:
    return os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_DIRECTORY


def _validate_absolute(path: Path, label: str) -> None:
    if not path.is_absolute():
        raise SecureEnvError(f"{label} must be an absolute path")
    if ".." in path.parts:
        raise SecureEnvError(f"{label} must not contain parent traversal")
    if path.name in {"", ".", ".."}:
        raise SecureEnvError(f"{label} must name a file")


def _open_directory_path(path: Path) -> int:
    """Open an absolute directory path one no-follow component at a time."""

    _validate_absolute(path / "placeholder", "directory")
    descriptor = os.open("/", _directory_flags())
    try:
        for component in path.parts[1:]:
            if component in {"", "."}:
                continue
            next_descriptor = os.open(component, _directory_flags(), dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _open_validated_source(path: Path, expected_uid: int) -> int:
    _validate_absolute(path, "source")
    parent_descriptor = -1
    try:
        parent_descriptor = _open_directory_path(path.parent)
        descriptor = os.open(path.name, _source_flags(), dir_fd=parent_descriptor)
    except OSError as error:
        raise SecureEnvError("source must open without following a link") from error
    finally:
        if parent_descriptor >= 0:
            os.close(parent_descriptor)

    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise SecureEnvError("source must be a regular file")
        if metadata.st_uid != expected_uid:
            raise SecureEnvError("source owner does not match the expected operator")
        if stat.S_IMODE(metadata.st_mode) != 0o600:
            raise SecureEnvError("source mode must be exactly 0600")
        if metadata.st_nlink != 1:
            raise SecureEnvError("source must have exactly one hard link")
        if metadata.st_size < 1 or metadata.st_size > MAX_ENV_BYTES:
            raise SecureEnvError("source size is outside the allowed range")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _open_validated_directory(path: Path, expected_uid: int, exact_mode: int | None) -> int:
    try:
        descriptor = _open_directory_path(path)
    except OSError as error:
        raise SecureEnvError("destination parent must be a non-symlink directory") from error

    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISDIR(metadata.st_mode):
            raise SecureEnvError("destination parent must be a directory")
        if metadata.st_uid != expected_uid:
            raise SecureEnvError("destination parent owner is not trusted")
        mode = stat.S_IMODE(metadata.st_mode)
        if exact_mode is not None and mode != exact_mode:
            raise SecureEnvError(f"destination parent mode must be exactly {exact_mode:04o}")
        if exact_mode is None and mode & 0o022:
            raise SecureEnvError("destination parent must not be group- or world-writable")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _write_all(descriptor: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:
            raise SecureEnvError("destination write made no progress")
        view = view[written:]


def _copy_fd(source_fd: int, destination_fd: int) -> None:
    copied = 0
    while True:
        chunk = os.read(source_fd, min(16 * 1024, MAX_ENV_BYTES + 1 - copied))
        if not chunk:
            break
        copied += len(chunk)
        if copied > MAX_ENV_BYTES:
            raise SecureEnvError("source grew beyond the allowed size")
        _write_all(destination_fd, chunk)
    if copied < 1:
        raise SecureEnvError("source became empty while being copied")


def _verify_destination_fd(descriptor: int, expected_uid: int, expected_gid: int) -> None:
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode):
        raise SecureEnvError("destination is not a regular file")
    if metadata.st_uid != expected_uid or metadata.st_gid != expected_gid:
        raise SecureEnvError("destination ownership verification failed")
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        raise SecureEnvError("destination mode verification failed")
    if metadata.st_nlink != 1:
        raise SecureEnvError("destination must have exactly one hard link")


def stage_file(source: Path, destination: Path, expected_source_uid: int) -> None:
    """Copy a validated source descriptor into an operator-private directory."""

    _validate_absolute(destination, "destination")
    source_fd = _open_validated_source(source, expected_source_uid)
    parent_fd = -1
    destination_fd = -1
    created = False
    try:
        parent_fd = _open_validated_directory(destination.parent, os.geteuid(), 0o700)
        destination_fd = os.open(
            destination.name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW,
            0o600,
            dir_fd=parent_fd,
        )
        created = True
        os.fchmod(destination_fd, 0o600)
        _copy_fd(source_fd, destination_fd)
        os.fsync(destination_fd)
        _verify_destination_fd(destination_fd, os.geteuid(), os.getegid())
        os.fsync(parent_fd)
    except OSError as error:
        raise SecureEnvError("secure staging failed") from error
    finally:
        if destination_fd >= 0:
            os.close(destination_fd)
        if created and sys.exc_info()[0] is not None and parent_fd >= 0:
            try:
                os.unlink(destination.name, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
        if parent_fd >= 0:
            os.close(parent_fd)
        os.close(source_fd)


def install_file(source: Path, destination: Path, expected_source_uid: int) -> None:
    """Atomically install a validated source as root:root mode 0600."""

    if os.geteuid() != 0:
        raise SecureEnvError("install requires root privilege")
    _validate_absolute(destination, "destination")

    source_fd = _open_validated_source(source, expected_source_uid)
    parent_fd = -1
    destination_fd = -1
    temporary_name = f".{destination.name}.{secrets.token_hex(12)}.tmp"
    temporary_exists = False
    replaced = False
    try:
        parent_fd = _open_validated_directory(destination.parent, 0, None)
        destination_fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW,
            0o600,
            dir_fd=parent_fd,
        )
        temporary_exists = True
        os.fchmod(destination_fd, 0o600)
        os.fchown(destination_fd, 0, 0)
        _copy_fd(source_fd, destination_fd)
        os.fsync(destination_fd)
        _verify_destination_fd(destination_fd, 0, 0)
        os.replace(
            temporary_name,
            destination.name,
            src_dir_fd=parent_fd,
            dst_dir_fd=parent_fd,
        )
        temporary_exists = False
        replaced = True
        os.fsync(parent_fd)

        installed_fd = os.open(
            destination.name,
            os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW,
            dir_fd=parent_fd,
        )
        try:
            _verify_destination_fd(installed_fd, 0, 0)
        finally:
            os.close(installed_fd)
    except OSError as error:
        raise SecureEnvError("secure installation failed") from error
    finally:
        if destination_fd >= 0:
            os.close(destination_fd)
        if temporary_exists and parent_fd >= 0:
            try:
                os.unlink(temporary_name, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
        if parent_fd >= 0:
            os.close(parent_fd)
        os.close(source_fd)

    if not replaced:
        raise SecureEnvError("destination replacement did not complete")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Safely stage or install a mode-0600 deployment environment file.",
    )
    parser.add_argument("action", choices=("stage", "install"))
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("expected_source_uid", type=int)
    return parser


def main() -> int:
    arguments = _parser().parse_args()
    try:
        if arguments.expected_source_uid < 0:
            raise SecureEnvError("expected source UID must be non-negative")
        if arguments.action == "stage":
            stage_file(arguments.source, arguments.destination, arguments.expected_source_uid)
        else:
            install_file(arguments.source, arguments.destination, arguments.expected_source_uid)
    except SecureEnvError as error:
        print(f"secure-env-file: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
