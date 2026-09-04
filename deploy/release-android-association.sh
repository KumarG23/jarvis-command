#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

local_stage=''
remote_stage=''
release_result=''
ssh_target=${1-}
ssh_key=${2-}
expected_image=${3-}
readonly approved_image='sha256:2fd64f267f33feeb6a17a20e37b2a6594e3398817ba114b8ead13bc949cfe654'

cleanup_stages() {
  local status=${1-0}
  local cleanup_failed=0

  if [[ -n $remote_stage ]]; then
    if [[ $remote_stage =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]; then
      if ssh "${ssh_options[@]}" "$ssh_target" bash -s -- "$remote_stage" >/dev/null 2>&1 <<'REMOTE_CLEANUP'
set -Eeuo pipefail
stage=${1-}
[[ $stage =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]
rm -rf -- "$stage"
[[ ! -e $stage ]]
REMOTE_CLEANUP
      then
        remote_stage=''
      else
        cleanup_failed=1
      fi
    else
      cleanup_failed=1
    fi
  fi

  if [[ -n $local_stage ]]; then
    if [[ $local_stage =~ ^/tmp/jarvis-command-association\.[A-Za-z0-9]{10}$ ]]; then
      if rm -rf -- "$local_stage" && [[ ! -e $local_stage ]]; then
        local_stage=''
      else
        cleanup_failed=1
      fi
    else
      cleanup_failed=1
    fi
  fi

  if (( cleanup_failed != 0 )); then
    printf 'association release staging cleanup failed\n' >&2
    (( status != 0 )) || status=1
  fi
  return "$status"
}

exit_with_cleanup() {
  local status=$?
  local final_status
  trap - EXIT HUP INT TERM
  if cleanup_stages "$status"; then
    final_status=0
  else
    final_status=$?
  fi
  exit "$final_status"
}

trap exit_with_cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if (( $# != 3 )); then
  printf 'usage: %s SSH_TARGET SSH_KEY EXPECTED_CURRENT_APP_IMAGE_ID\n' "$0" >&2
  exit 64
fi
readonly ssh_target ssh_key expected_image
[[ $ssh_target =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$ ]]
[[ $ssh_key == /* && -f $ssh_key && ! -L $ssh_key ]]
[[ $expected_image =~ ^sha256:[0-9a-f]{64}$ ]]
[[ $expected_image == "$approved_image" ]] || {
  printf 'expected image does not match approved production image\n' >&2
  exit 65
}
operator_uid=$(id -u)
[[ $(stat -c '%u:%a:%h' -- "$ssh_key") == "$operator_uid:600:1" ]]
readonly operator_uid
readonly -a ssh_options=(
  -i "$ssh_key"
  -o IdentitiesOnly=yes
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
)

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repository_root=$(cd -- "$script_dir/.." && pwd -P)
association_source=$repository_root/apps/web/public/.well-known/assetlinks.json
compose_source=$script_dir/app.compose.yaml
installer_source=$script_dir/install-android-association.sh
allocator_source=$script_dir/allocate-release-stage.sh
for source in "$association_source" "$compose_source" "$installer_source" "$allocator_source"; do
  [[ -f $source && ! -L $source ]]
done

local_stage=$(mktemp -d /tmp/jarvis-command-association.XXXXXXXXXX)
[[ $local_stage =~ ^/tmp/jarvis-command-association\.[A-Za-z0-9]{10}$ ]]
chmod 0700 "$local_stage"
[[ $(stat -c '%u:%a' -- "$local_stage") == "$operator_uid:700" ]]
install -m 0644 "$association_source" "$local_stage/assetlinks.json"
install -m 0644 "$compose_source" "$local_stage/app.compose.yaml"
install -m 0755 "$installer_source" "$local_stage/install-android-association.sh"
(
  cd "$local_stage"
  sha256sum assetlinks.json app.compose.yaml > SHA256SUMS
)
chmod 0600 "$local_stage/SHA256SUMS"
read -r association_sha256 _ < <(sha256sum "$local_stage/assetlinks.json")
read -r compose_sha256 _ < <(sha256sum "$local_stage/app.compose.yaml")
[[ $association_sha256 =~ ^[0-9a-f]{64}$ ]]
[[ $compose_sha256 =~ ^[0-9a-f]{64}$ ]]
readonly association_sha256 compose_sha256

remote_stage_record=$(ssh "${ssh_options[@]}" "$ssh_target" bash -s < "$allocator_source")
[[ $remote_stage_record =~ ^([0-9]+):(/tmp/jarvis-command-release\.[A-Za-z0-9]{10})$ ]]
remote_operator_uid=${BASH_REMATCH[1]}
remote_stage=${BASH_REMATCH[2]}
readonly remote_operator_uid

scp -p "${ssh_options[@]}" \
  "$local_stage/assetlinks.json" \
  "$local_stage/app.compose.yaml" \
  "$local_stage/SHA256SUMS" \
  "$ssh_target:$remote_stage/"

remote_output=$(ssh "${ssh_options[@]}" "$ssh_target" \
  sudo -n /usr/bin/bash -s -- apply \
  "$remote_stage" "$remote_operator_uid" "$expected_image" \
  /var/backups/jarvis-command "$compose_sha256" "$association_sha256" \
  < "$local_stage/install-android-association.sh")
[[ $remote_output =~ ^ASSOCIATION_STATE_DIR=(/var/backups/jarvis-command/association-[0-9]{8}T[0-9]{6}Z)$ ]]
release_result=${BASH_REMATCH[1]}

cleanup_stages 0
trap - EXIT HUP INT TERM
printf 'ASSOCIATION_STATE_DIR=%s\n' "$release_result"
