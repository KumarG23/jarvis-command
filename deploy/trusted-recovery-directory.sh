# Sourced by both recovery scripts; release packaging embeds these exact bytes.
# No environment override for the trust anchor or owner. Tests map source constants.
read -r -d '' recovery_python <<'RECOVERY_PY' || true
import os
import re
import stat
import sys

TRUSTED_RECOVERY_UID = 0
TRUSTED_RECOVERY_ANCHOR = "/"
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

def directory(fd, private=False):
    info = os.fstat(fd)
    mode = stat.S_IMODE(info.st_mode)
    if info.st_uid != TRUSTED_RECOVERY_UID or info.st_gid != TRUSTED_RECOVERY_UID:
        raise RuntimeError("recovery directory owner is not trusted")
    if mode & 0o022 or (private and mode != 0o700):
        raise RuntimeError("recovery directory mode is not trusted")
    return info

def open_path(path):
    if re.fullmatch(r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+", path) is None:
        raise RuntimeError("recovery path must be an exact absolute directory path")
    if any(part in (".", "..") for part in path.split("/")):
        raise RuntimeError("recovery path traversal is forbidden")
    anchor = TRUSTED_RECOVERY_ANCHOR
    if anchor != "/" and not path.startswith(anchor + "/"):
        raise RuntimeError("recovery path is outside the trusted anchor")
    fd = os.open(anchor, FLAGS)
    chain = []
    try:
        chain.append((fd, directory(fd)))
        parts = path[len(anchor):].lstrip("/").split("/")
        for part in parts:
            child = os.open(part, FLAGS, dir_fd=fd)
            fd = child
            chain.append((fd, directory(fd)))
        directory(fd, private=True)
        # Retain and recheck every ancestor, not just the final leaf. A parent
        # permission change can admit an unprivileged replacer during traversal.
        for index, (descriptor, before) in enumerate(chain):
            after = directory(descriptor)
            if (before.st_mode, before.st_uid, before.st_gid, before.st_ctime_ns) != (after.st_mode, after.st_uid, after.st_gid, after.st_ctime_ns):
                raise RuntimeError("recovery ancestor metadata changed during acquisition")
            if index:
                linked = os.stat(parts[index - 1], dir_fd=chain[index - 1][0], follow_symlinks=False)
                if (linked.st_dev, linked.st_ino) != (after.st_dev, after.st_ino):
                    raise RuntimeError("recovery ancestor identity changed during acquisition")
        for descriptor, _ in chain[:-1]:
            os.close(descriptor)
        return fd
    except BaseException:
        for descriptor in {fd, *(item[0] for item in chain)}:
            os.close(descriptor)
        raise

def checked_file(fd, name):
    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        info = os.fstat(child)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != TRUSTED_RECOVERY_UID
            or info.st_gid != TRUSTED_RECOVERY_UID or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_nlink != 1 or info.st_size > 1024 * 1024):
            raise RuntimeError("state metadata is invalid for " + name)
        return child
    except BaseException:
        os.close(child)
        raise

try:
    action, path = sys.argv[1:3]
    if action in ("open", "create"):
        fd = open_path(path)
        if action == "create":
            pinned = os.stat(sys.argv[3])
            current = os.fstat(fd)
            if (current.st_dev, current.st_ino) != (pinned.st_dev, pinned.st_ino):
                raise RuntimeError("recovery parent identity changed before creation")
            name = sys.argv[4]
            if re.fullmatch(r"(cutover|association)-[0-9]{8}T[0-9]{6}Z", name) is None:
                raise RuntimeError("invalid recovery leaf name")
            os.mkdir(name, mode=0o700, dir_fd=fd)
            directory(fd, private=True)
            child = os.open(name, FLAGS, dir_fd=fd)
            directory(child, private=True)
            verified = open_path(path + "/" + name)
            if (os.fstat(child).st_dev, os.fstat(child).st_ino) != (os.fstat(verified).st_dev, os.fstat(verified).st_ino):
                raise RuntimeError("recovery leaf identity changed during creation")
            os.fsync(fd)
            os.close(verified)
            os.close(fd)
            fd = child
        print(f"/proc/{os.getpid()}/fd/{fd}", flush=True)
        # Keep the validated identity alive until Bash has duplicated it.
        sys.stdin.buffer.read()
    elif action == "verify":
        fd = open_path(path)
        pinned = os.stat(sys.argv[3])
        current = os.fstat(fd)
        if (current.st_dev, current.st_ino) != (pinned.st_dev, pinned.st_ino):
            raise RuntimeError("recovery directory identity changed; retain original state")
        os.fsync(fd)
    elif action in ("files", "read"):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        directory(fd, private=True)
        names = os.listdir(fd) if action == "files" else [sys.argv[3]]
        for name in names:
            child = checked_file(fd, name)
            try:
                if action == "read":
                    value = os.read(child, 4097)
                    if len(value) > 4096 or not value.endswith(b"\n") or b"\n" in value[:-1] or b"\r" in value or b"\0" in value:
                        raise RuntimeError("recovery state value is malformed")
                    sys.stdout.buffer.write(value[:-1])
            finally:
                os.close(child)
    else:
        raise RuntimeError("invalid recovery operation")
except (OSError, RuntimeError) as error:
    print("trusted recovery: " + str(error), file=sys.stderr)
    sys.exit(1)
RECOVERY_PY
readonly recovery_python

recovery_open() {
  local path=$1 pinned guardian reader writer
  local action=${2-open} parent=${3-} name=${4-}
  coproc RECOVERY_OPEN { exec python3 -c "$recovery_python" "$action" "$path" "$parent" "$name"; }
  guardian=$RECOVERY_OPEN_PID
  reader=${RECOVERY_OPEN[0]}
  writer=${RECOVERY_OPEN[1]}
  if ! IFS= read -r pinned <&"$reader"; then
    wait "$guardian" || true
    return 1
  fi
  # The proc path is produced by our child, never supplied by the operator.
  if ! exec {recovery_fd}< "$pinned"; then
    exec {writer}>&-
    wait "$guardian" || true
    return 1
  fi
  exec {writer}>&-
  wait "$guardian" || return 1
  recovery_directory=/proc/$$/fd/$recovery_fd
  recovery_display=$path${name:+/$name}
  recovery_verify
}

recovery_create() {
  local name=$1 parent_fd=$recovery_fd
  [[ $name =~ ^(cutover|association)-[0-9]{8}T[0-9]{6}Z$ ]] || return 1
  recovery_open "$recovery_display" create "$recovery_directory" "$name" || return 1
  exec {parent_fd}<&-
}

recovery_verify() {
  python3 -c "$recovery_python" verify "$recovery_display" "$recovery_directory"
}

recovery_validate_files() {
  python3 -c "$recovery_python" files "$recovery_directory"
}

recovery_read() {
  python3 -c "$recovery_python" read "$recovery_directory" "$1"
}
