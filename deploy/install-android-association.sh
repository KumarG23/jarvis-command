#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

app_container=${APP_CONTAINER:-jarvis-command-app}
app_unit=${APP_UNIT:-jarvis-command-app.service}
compose_target=${APP_COMPOSE_PATH:-/srv/jarvis-command/compose.yaml}
association_target=${ASSOCIATION_PATH:-/srv/jarvis-command/public/.well-known/assetlinks.json}
local_root_url=${LOCAL_ROOT_URL:-http://127.0.0.1:3000/}
local_health_url=${LOCAL_HEALTH_URL:-http://127.0.0.1:3000/api/health}
local_association_url=${LOCAL_ASSOCIATION_URL:-http://127.0.0.1:3000/.well-known/assetlinks.json}
sleep_seconds=${ASSOCIATION_SLEEP_SECONDS:-0.25}
readonly approved_image='sha256:2fd64f267f33feeb6a17a20e37b2a6594e3398817ba114b8ead13bc949cfe654'
state_directory=''
stage_snapshot=''
rollback_armed=false

usage() {
  printf 'usage: %s apply <stage> <operator-uid> <expected-current-image-id> <backup-root> <compose-sha256> <assetlinks-sha256>\n' "$0" >&2
  printf '       %s rollback <association-state-directory>\n' "$0" >&2
  exit 64
}

fail() {
  printf '%s\n' "$1" >&2
  return 1
}

valid_absolute_path() {
  [[ $1 == /* && $1 != *$'\n'* && $1 != *$'\r'* ]]
}

valid_image_id() {
  [[ $1 =~ ^sha256:[0-9a-f]{64}$ ]]
}

cleanup_stage_snapshot() {
  local status=${1-0}
  if [[ -z $stage_snapshot ]]; then
    return "$status"
  fi
  if [[ ! $stage_snapshot =~ ^/tmp/jarvis-command-association-root\.[A-Za-z0-9_]+$ ]] \
    || [[ ! -d $stage_snapshot || -L $stage_snapshot ]] \
    || [[ $(stat -c '%u:%a' -- "$stage_snapshot") != "$(id -u):700" ]] \
    || ! rm -rf -- "$stage_snapshot" \
    || [[ -e $stage_snapshot ]]; then
    printf 'association stage snapshot cleanup failed\n' >&2
    (( status != 0 )) || status=1
  else
    stage_snapshot=''
  fi
  return "$status"
}

exit_with_snapshot_cleanup() {
  local status=$?
  local final_status
  trap - EXIT
  if cleanup_stage_snapshot "$status"; then
    final_status=0
  else
    final_status=$?
  fi
  exit "$final_status"
}

snapshot_release_stage() {
  local source_stage=$1
  local source_uid=$2
  local reviewed_compose_sha256=$3
  local reviewed_assetlinks_sha256=$4
  python3 - "$source_stage" "$source_uid" "$reviewed_compose_sha256" "$reviewed_assetlinks_sha256" <<'PY'
import hashlib
import os
import re
import shutil
import stat
import sys
import tempfile

source_path = sys.argv[1]
source_uid = int(sys.argv[2])
reviewed_hashes = {
    "app.compose.yaml": sys.argv[3],
    "assetlinks.json": sys.argv[4],
}
if any(re.fullmatch(r"[0-9a-f]{64}", value) is None for value in reviewed_hashes.values()):
    raise RuntimeError("reviewed release checksum is malformed")
required = {
    "SHA256SUMS": (0o600, 4096),
    "app.compose.yaml": (0o644, 1024 * 1024),
    "assetlinks.json": (0o644, 1024 * 1024),
}
snapshot = None

def fail(message):
    raise RuntimeError(message)

def open_checked(directory_fd, name, expected_mode, maximum_size):
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        dir_fd=directory_fd,
    )
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode):
        os.close(descriptor)
        fail(f"release stage is not a regular file: {name}")
    if metadata.st_uid != source_uid or stat.S_IMODE(metadata.st_mode) != expected_mode:
        os.close(descriptor)
        fail(f"release stage metadata is invalid for {name}")
    if metadata.st_nlink != 1 or metadata.st_size > maximum_size:
        os.close(descriptor)
        fail(f"release stage link count or size is invalid for {name}")
    return descriptor

def read_all(descriptor, maximum_size):
    chunks = []
    total = 0
    while True:
        chunk = os.read(descriptor, min(65536, maximum_size + 1 - total))
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        total += len(chunk)
        if total > maximum_size:
            fail("release stage file exceeds its size limit")

try:
    directory_fd = os.open(source_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    directory_metadata = os.fstat(directory_fd)
    if directory_metadata.st_uid != source_uid or stat.S_IMODE(directory_metadata.st_mode) != 0o700:
        fail("release stage metadata is invalid")

    manifest_fd = open_checked(directory_fd, "SHA256SUMS", *required["SHA256SUMS"])
    try:
        manifest = read_all(manifest_fd, required["SHA256SUMS"][1])
    finally:
        os.close(manifest_fd)
    try:
        manifest_text = manifest.decode("ascii")
    except UnicodeDecodeError as error:
        fail(f"release checksum manifest is not ASCII: {error}")
    expected_hashes = {}
    for line in manifest_text.splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (app\.compose\.yaml|assetlinks\.json)", line)
        if match is None or match.group(2) in expected_hashes:
            fail("release checksum manifest is malformed")
        expected_hashes[match.group(2)] = match.group(1)
    if set(expected_hashes) != {"app.compose.yaml", "assetlinks.json"}:
        fail("release checksum manifest has the wrong file set")
    if expected_hashes != reviewed_hashes:
        fail("release stage does not match reviewed checksum")

    snapshot = tempfile.mkdtemp(prefix="jarvis-command-association-root.", dir="/tmp")
    os.chmod(snapshot, 0o700)
    for name in ("app.compose.yaml", "assetlinks.json"):
        expected_mode, maximum_size = required[name]
        source_fd = open_checked(directory_fd, name, expected_mode, maximum_size)
        destination_path = os.path.join(snapshot, name)
        destination_fd = os.open(destination_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, expected_mode)
        os.fchmod(destination_fd, expected_mode)
        digest = hashlib.sha256()
        try:
            while True:
                chunk = os.read(source_fd, 65536)
                if not chunk:
                    break
                digest.update(chunk)
                view = memoryview(chunk)
                while view:
                    written = os.write(destination_fd, view)
                    view = view[written:]
            os.fsync(destination_fd)
        finally:
            os.close(source_fd)
            os.close(destination_fd)
        if digest.hexdigest() != reviewed_hashes[name]:
            fail(f"release stage checksum changed while copying {name}")

    manifest_path = os.path.join(snapshot, "SHA256SUMS")
    manifest_output = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        manifest_view = memoryview(manifest)
        while manifest_view:
            written = os.write(manifest_output, manifest_view)
            manifest_view = manifest_view[written:]
        os.fsync(manifest_output)
    finally:
        os.close(manifest_output)
    snapshot_fd = os.open(snapshot, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(snapshot_fd)
    finally:
        os.close(snapshot_fd)
    print(snapshot)
except Exception as error:
    if snapshot is not None:
        shutil.rmtree(snapshot, ignore_errors=True)
    print(str(error), file=sys.stderr)
    sys.exit(1)
finally:
    if 'directory_fd' in locals():
        os.close(directory_fd)
PY
}

trap exit_with_snapshot_cleanup EXIT

write_state() {
  local state_path=$1/$2
  local state_parent=${state_path%/*}
  local state_name=${state_path##*/}
  local temporary_path=''

  if [[ $3 == *$'\n'* || $3 == *$'\r'* ]]; then
    fail "association state value is malformed for $2"
    return 1
  fi
  if ! temporary_path=$(mktemp -- "$state_parent/.${state_name}.tmp.XXXXXXXXXX"); then
    fail "association state temporary file could not be created for $2"
    return 1
  fi
  if ! printf '%s\n' "$3" > "$temporary_path"; then
    fail "association state could not be written for $2"
    rm -f -- "$temporary_path" || true
    return 1
  fi
  if ! chmod 0600 "$temporary_path"; then
    fail "association state metadata could not be set for $2"
    rm -f -- "$temporary_path" || true
    return 1
  fi
  if ! python3 - "$temporary_path" "$3" <<'PY'
import os
import stat
import sys

path, expected = sys.argv[1:]
descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
try:
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError("state temporary path is not a regular file")
    if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1:
        raise RuntimeError("state temporary metadata is invalid")
    chunks = []
    while True:
        chunk = os.read(descriptor, 4096)
        if not chunk:
            break
        chunks.append(chunk)
    if b"".join(chunks) != (expected + "\n").encode():
        raise RuntimeError("state temporary bytes differ")
    os.fsync(descriptor)
finally:
    os.close(descriptor)
parent_descriptor = os.open(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(parent_descriptor)
finally:
    os.close(parent_descriptor)
PY
  then
    fail "association state temporary file could not be verified for $2"
    rm -f -- "$temporary_path" || true
    return 1
  fi
  if ! mv -fT -- "$temporary_path" "$state_path"; then
    fail "association state could not be published for $2"
    rm -f -- "$temporary_path" || true
    return 1
  fi
  return 0
}

read_state() {
  local state_path=$1/$2
  local metadata value
  if [[ ! -f $state_path || -L $state_path ]]; then
    fail "association state is missing $2"
    return 1
  fi
  if ! metadata=$(stat -c '%u:%a:%h' -- "$state_path"); then
    fail "association state metadata could not be read for $2"
    return 1
  fi
  if [[ $metadata != "$(id -u):600:1" ]]; then
    fail "association state metadata is invalid for $2"
    return 1
  fi
  if ! value=$(<"$state_path"); then
    fail "association state could not be read for $2"
    return 1
  fi
  if [[ $value == *$'\n'* || $value == *$'\r'* ]]; then
    fail "association state $2 is malformed"
    return 1
  fi
  printf '%s' "$value"
}

app_runtime_state() {
  docker inspect \
    --format '{{.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
    "$app_container"
}

verify_runtime() {
  local expected_image=$1
  local expected_association=${2-}
  local runtime app_image app_running app_health extra_state root_body
  local attempt

  for attempt in {1..20}; do
    if systemctl is-active --quiet "$app_unit"; then
      if runtime=$(app_runtime_state 2>/dev/null); then
        IFS='|' read -r app_image app_running app_health extra_state <<< "$runtime"
        if [[ -z ${extra_state:-} && $app_image == "$expected_image" && $app_running == true && $app_health == healthy ]]; then
          break
        fi
      fi
    fi
    if ! sleep "$sleep_seconds"; then
      fail 'application verification wait failed'
      return 1
    fi
  done

  if ! systemctl is-active --quiet "$app_unit"; then
    fail 'application unit is not active'
    return 1
  fi
  if ! runtime=$(app_runtime_state); then
    fail 'application runtime inspection failed'
    return 1
  fi
  IFS='|' read -r app_image app_running app_health extra_state <<< "$runtime"
  if [[ -n ${extra_state:-} || $app_image != "$expected_image" ]]; then
    fail 'application image identity changed during association release'
    return 1
  fi
  if [[ $app_running != true || $app_health != healthy ]]; then
    fail 'application container is not healthy after association release'
    return 1
  fi

  if ! curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
    "$local_health_url" > "$state_directory/runtime-health.json"; then
    fail 'application health endpoint failed after association release'
    return 1
  fi
  if ! root_body=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "$local_root_url"); then
    fail 'application root failed after association release'
    return 1
  fi
  if [[ $root_body != *'Jarvis Command'* ]]; then
    fail 'application root lost reviewed product identity'
    return 1
  fi

  if [[ -n $expected_association ]]; then
    if ! curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
      "$local_association_url" > "$state_directory/runtime-assetlinks.json"; then
      fail 'Digital Asset Links endpoint failed after association release'
      return 1
    fi
    if ! cmp -s "$expected_association" "$state_directory/runtime-assetlinks.json"; then
      fail 'served Digital Asset Links bytes differ from the reviewed artifact'
      return 1
    fi
  fi
  return 0
}

restore_previous() {
  local state=$1
  local status_value=$2
  local previous_image previous_active previous_enabled association_existed previous_association=''
  local active_state unit_file_state expected_unit_file_state
  local overall=0

  state_directory=$state
  if ! previous_image=$(read_state "$state" previous-app-image-id); then return 1; fi
  if ! previous_active=$(read_state "$state" previous-unit-active); then return 1; fi
  if ! previous_enabled=$(read_state "$state" previous-unit-enabled); then return 1; fi
  if ! association_existed=$(read_state "$state" previous-association-existed); then return 1; fi
  valid_image_id "$previous_image" || return 1
  [[ $previous_active =~ ^(true|false)$ && $previous_enabled =~ ^(true|false)$ ]] || return 1
  [[ $association_existed =~ ^(true|false)$ ]] || return 1

  [[ -f $state/previous-compose.yaml && ! -L $state/previous-compose.yaml ]] || return 1
  [[ $(stat -c '%u:%a:%h' -- "$state/previous-compose.yaml") == "$(id -u):600:1" ]] || return 1
  if ! install -d -m 0755 "$(dirname "$compose_target")" "$(dirname "$association_target")"; then
    fail 'rollback runtime target directories could not be prepared'
    return 1
  fi
  install -m 0644 "$state/previous-compose.yaml" "$compose_target" || overall=1

  if [[ $association_existed == true ]]; then
    [[ -f $state/previous-assetlinks.json && ! -L $state/previous-assetlinks.json ]] || return 1
    [[ $(stat -c '%u:%a:%h' -- "$state/previous-assetlinks.json") == "$(id -u):600:1" ]] || return 1
    install -m 0644 "$state/previous-assetlinks.json" "$association_target" || overall=1
    previous_association=$state/previous-assetlinks.json
  else
    rm -f -- "$association_target" || overall=1
  fi

  systemctl daemon-reload || overall=1
  if [[ $previous_enabled == true ]]; then
    systemctl enable "$app_unit" >/dev/null || overall=1
    expected_unit_file_state=enabled
  else
    systemctl disable "$app_unit" >/dev/null || overall=1
    expected_unit_file_state=disabled
  fi
  if (( overall == 0 )); then
    if ! unit_file_state=$(systemctl show --property=UnitFileState --value "$app_unit"); then
      fail 'application UnitFileState could not be read after rollback'
      overall=1
    elif [[ $unit_file_state != "$expected_unit_file_state" ]]; then
      fail 'application UnitFileState was not restored during rollback'
      overall=1
    fi
  fi
  if [[ $previous_active == true ]]; then
    systemctl restart "$app_unit" || overall=1
    if (( overall == 0 )); then
      verify_runtime "$previous_image" "$previous_association" || overall=1
    fi
  else
    if ! systemctl stop "$app_unit" >/dev/null 2>&1; then
      fail 'application unit could not be stopped during rollback'
      overall=1
    fi
    if (( overall == 0 )); then
      if ! active_state=$(systemctl show --property=ActiveState --value "$app_unit"); then
        fail 'application unit state could not be read after rollback stop'
        overall=1
      elif [[ $active_state != inactive ]]; then
        fail 'application unit is not inactive after rollback stop'
        overall=1
      fi
    fi
  fi

  if (( overall != 0 )); then
    printf 'previous association release could not be verified; manual recovery required from %s\n' "$state" >&2
    return 1
  fi
  write_state "$state" status "$status_value"
}

rollback_on_error() {
  local exit_status=$?
  trap - ERR INT TERM HUP
  (( exit_status != 0 )) || exit_status=1
  if [[ $rollback_armed == true && -n $state_directory ]]; then
    if restore_previous "$state_directory" association-restored-after-failure; then
      printf 'association release failed; previous association release restored from %s\n' "$state_directory" >&2
    else
      printf 'association release failed; restoration also failed for %s\n' "$state_directory" >&2
      exit_status=1
    fi
  fi
  exit "$exit_status"
}

[[ $# -ge 1 ]] || usage
mode=$1
shift

for runtime_path in "$compose_target" "$association_target"; do
  valid_absolute_path "$runtime_path" || fail 'runtime targets must be absolute paths'
done
[[ $sleep_seconds =~ ^([0-9]+|[0-9]*\.[0-9]+)$ ]] || fail 'ASSOCIATION_SLEEP_SECONDS must be numeric'

if [[ $mode == rollback ]]; then
  [[ $# -eq 1 ]] || usage
  state_directory=$1
  valid_absolute_path "$state_directory" || fail 'association state directory must be absolute'
  [[ -d $state_directory && ! -L $state_directory ]] || fail 'association state directory is invalid'
  [[ $(stat -c '%u:%a' -- "$state_directory") == "$(id -u):700" ]] || fail 'association state directory metadata is invalid'
  restore_previous "$state_directory" association-rolled-back
  printf 'ASSOCIATION_ROLLED_BACK_FROM=%s\n' "$state_directory"
  exit
fi

[[ $mode == apply && $# -eq 6 ]] || usage
stage=$1
operator_uid=$2
expected_image=$3
backup_root=$4
reviewed_compose_sha256=$5
reviewed_assetlinks_sha256=$6
valid_absolute_path "$stage" || fail 'stage must be an absolute path'
valid_absolute_path "$backup_root" || fail 'backup root must be an absolute path'
[[ $operator_uid =~ ^[0-9]+$ ]] || fail 'operator UID must be numeric'
valid_image_id "$expected_image" || fail 'expected image must be immutable sha256'
[[ $expected_image == "$approved_image" ]] || fail 'expected image does not match approved production image'
[[ $reviewed_compose_sha256 =~ ^[0-9a-f]{64}$ ]] || fail 'reviewed compose checksum is malformed'
[[ $reviewed_assetlinks_sha256 =~ ^[0-9a-f]{64}$ ]] || fail 'reviewed assetlinks checksum is malformed'
stage_snapshot=$(snapshot_release_stage \
  "$stage" "$operator_uid" "$reviewed_compose_sha256" "$reviewed_assetlinks_sha256")
stage=$stage_snapshot
operator_uid=$(id -u)
[[ -d $stage && ! -L $stage ]] || fail 'release stage is invalid'
[[ $(stat -c '%u:%a' -- "$stage") == "$operator_uid:700" ]] || fail 'release stage metadata is invalid'

check_stage_file() {
  local path=$1
  local mode=$2
  [[ -f $stage/$path && ! -L $stage/$path ]] || fail "release stage is missing $path"
  [[ $(stat -c '%u:%a:%h' -- "$stage/$path") == "$operator_uid:$mode:1" ]] || fail "release stage metadata is invalid for $path"
}
check_stage_file SHA256SUMS 600
check_stage_file app.compose.yaml 644
check_stage_file assetlinks.json 644
(
  cd "$stage"
  sha256sum -c SHA256SUMS
) >&2

[[ -f $compose_target && ! -L $compose_target ]] || fail 'active compose file is invalid'
[[ $(stat -c '%u:%a:%h' -- "$compose_target") == "$(id -u):644:1" ]] || fail 'active compose metadata is invalid'
systemctl is-active --quiet "$app_unit" || fail 'application unit must be active before association release'
current_runtime=$(app_runtime_state)
IFS='|' read -r current_image current_running current_health extra_state <<< "$current_runtime"
[[ -z ${extra_state:-} && $current_image == "$expected_image" ]] || fail 'active application image does not match expected immutable identity'
[[ $current_running == true && $current_health == healthy ]] || fail 'active application is not healthy before association release'
if ! previous_active_state=$(systemctl show --property=ActiveState --value "$app_unit"); then
  fail 'application ActiveState could not be captured'
  exit 1
fi
if [[ $previous_active_state != active ]]; then
  fail 'application ActiveState changed before association capture'
  exit 1
fi
previous_active=true
if ! previous_enabled_state=$(systemctl show --property=UnitFileState --value "$app_unit"); then
  fail 'application UnitFileState could not be captured'
  exit 1
fi
case $previous_enabled_state in
  enabled) previous_enabled=true ;;
  disabled) previous_enabled=false ;;
  *)
    fail 'application UnitFileState is unsupported for association rollback'
    exit 1
    ;;
esac

install -d -m 0700 "$backup_root"
[[ -d $backup_root && ! -L $backup_root ]] || fail 'backup root is invalid'
[[ $(stat -c '%u:%a' -- "$backup_root") == "$(id -u):700" ]] || fail 'backup root metadata is invalid'
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
state_directory=$backup_root/association-$timestamp
mkdir "$state_directory"
chmod 0700 "$state_directory"

install -m 0600 "$compose_target" "$state_directory/previous-compose.yaml"
install -m 0600 "$stage/app.compose.yaml" "$state_directory/new-compose.yaml"
install -m 0600 "$stage/assetlinks.json" "$state_directory/new-assetlinks.json"
cmp -s "$stage/app.compose.yaml" "$state_directory/new-compose.yaml"
cmp -s "$stage/assetlinks.json" "$state_directory/new-assetlinks.json"
write_state "$state_directory" previous-app-image-id "$current_image"
write_state "$state_directory" previous-unit-active "$previous_active"
write_state "$state_directory" previous-unit-enabled "$previous_enabled"
if [[ -e $association_target ]]; then
  [[ -f $association_target && ! -L $association_target ]] || fail 'active association target is not a regular file'
  install -m 0600 "$association_target" "$state_directory/previous-assetlinks.json"
  write_state "$state_directory" previous-association-existed true
else
  write_state "$state_directory" previous-association-existed false
fi
write_state "$state_directory" status captured

curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "$local_health_url" > "$state_directory/previous-health.json"
curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "$local_root_url" > "$state_directory/previous-root.html"
grep -Fq 'Jarvis Command' "$state_directory/previous-root.html" || fail 'active application root lacks reviewed product identity'

rollback_armed=true
trap rollback_on_error ERR INT TERM HUP
install -d -m 0755 "$(dirname "$association_target")"
install -m 0644 "$state_directory/new-assetlinks.json" "$association_target"
install -m 0644 "$state_directory/new-compose.yaml" "$compose_target"
cmp -s "$state_directory/new-assetlinks.json" "$association_target"
cmp -s "$state_directory/new-compose.yaml" "$compose_target"
systemctl daemon-reload
systemctl restart "$app_unit"
verify_runtime "$expected_image" "$state_directory/new-assetlinks.json"
write_state "$state_directory" status association-verified
rollback_armed=false
trap - ERR INT TERM HUP
release_result=$state_directory
cleanup_stage_snapshot 0
trap - EXIT
printf 'ASSOCIATION_STATE_DIR=%s\n' "$release_result"
