#!/usr/bin/bash
set -Eeuo pipefail
umask 077

local_stage=''
remote_stage=''
app_env_source=${1-}
ssh_target=${2-}
ssh_key=${3-}
app_image_id=${4-}
read_proxy_image_id=${5-}
release_result=''

cleanup_release_stage() {
  local cleanup_status=$?
  local cleanup_failed=0
  trap - EXIT HUP INT TERM

  if [[ -n ${remote_stage} ]]; then
    if [[ ${remote_stage} =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]; then
      if ! ssh "${ssh_options[@]}" "${ssh_target}" bash -s -- "${remote_stage}" >/dev/null 2>&1 <<'REMOTE_CLEANUP'
set -Eeuo pipefail
stage=${1-}
[[ ${stage} =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]
rm -rf -- "${stage}"
[[ ! -e ${stage} ]]
REMOTE_CLEANUP
      then
        cleanup_failed=1
      fi
    else
      cleanup_failed=1
    fi
  fi

  if [[ -n ${local_stage} ]]; then
    if [[ ${local_stage} =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]; then
      if ! rm -rf -- "${local_stage}"; then
        cleanup_failed=1
      elif [[ -e ${local_stage} ]]; then
        cleanup_failed=1
      fi
    else
      cleanup_failed=1
    fi
  fi

  if (( cleanup_failed != 0 )); then
    printf 'release staging cleanup failed\n' >&2
    (( cleanup_status != 0 )) || cleanup_status=1
  elif (( cleanup_status == 0 )); then
    if [[ ${release_result} =~ ^/var/backups/jarvis-command/cutover-[0-9]{8}T[0-9]{6}Z$ ]]; then
      printf '%s\n' "${release_result}"
    else
      printf 'release completed without a valid cutover state\n' >&2
      cleanup_status=1
    fi
  fi

  exit "${cleanup_status}"
}

trap cleanup_release_stage EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if (( $# != 5 )); then
  printf 'usage: %s APP_ENV_SOURCE SSH_TARGET SSH_KEY APP_IMAGE_ID READ_PROXY_IMAGE_ID\n' "$0" >&2
  exit 64
fi

readonly app_env_source ssh_target ssh_key app_image_id read_proxy_image_id
[[ ${ssh_target} =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$ ]]
[[ ${ssh_key} == /* && -f ${ssh_key} && ! -L ${ssh_key} ]]
[[ ${app_image_id} =~ ^sha256:[0-9a-f]{64}$ ]]
[[ ${read_proxy_image_id} =~ ^sha256:[0-9a-f]{64}$ ]]

operator_uid=$(id -u)
[[ ${operator_uid} =~ ^[0-9]+$ ]]
ssh_key_metadata=$(stat -c '%u:%a:%h' -- "${ssh_key}")
[[ ${ssh_key_metadata} == "${operator_uid}:600:1" ]]
readonly operator_uid
readonly -a ssh_options=(
  -i "${ssh_key}"
  -o IdentitiesOnly=yes
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
)

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
readonly script_dir
for required_script in allocate-release-stage.sh install-app-release.sh secure-env-file.py; do
  [[ -f ${script_dir}/${required_script} && ! -L ${script_dir}/${required_script} ]]
done

local_stage=$(mktemp -d /tmp/jarvis-command-release.XXXXXXXXXX)
[[ ${local_stage} =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]
chmod 0700 "${local_stage}"
local_stage_metadata=$(stat -c '%u:%a' -- "${local_stage}")
[[ ${local_stage_metadata} == "${operator_uid}:700" ]]
cd -- "${local_stage}"

/usr/bin/python3 "${script_dir}/secure-env-file.py" stage \
  "${app_env_source}" "${local_stage}/app.env" "${operator_uid}"
docker save "${app_image_id}" | gzip -1 > "${local_stage}/app-image.tar.gz"
chmod 0600 "${local_stage}/app-image.tar.gz"
printf 'JARVIS_COMMAND_APP_IMAGE=%s\nJARVIS_COMMAND_READ_PROXY_IMAGE=%s\n' \
  "${app_image_id}" "${read_proxy_image_id}" > "${local_stage}/release.env"
chmod 0600 "${local_stage}/release.env"
install -m 0644 "${script_dir}/app.compose.yaml" "${local_stage}/app.compose.yaml"
install -m 0644 "${script_dir}/jarvis-command-app.service" "${local_stage}/app.service"
python3 "${script_dir}/bundle-recovery-script.py" "${script_dir}/cutover-app.sh" > "${local_stage}/cutover-app.sh"
chmod 0755 "${local_stage}/cutover-app.sh"
install -m 0755 "${script_dir}/secure-env-file.py" "${local_stage}/secure-env-file.py"
sha256sum app-image.tar.gz app.env release.env app.compose.yaml app.service \
  cutover-app.sh secure-env-file.py > SHA256SUMS
chmod 0600 SHA256SUMS

remote_stage_record=$(
  ssh "${ssh_options[@]}" "${ssh_target}" bash -s \
    < "${script_dir}/allocate-release-stage.sh"
)
[[ ${remote_stage_record} =~ ^([0-9]+):(/tmp/jarvis-command-release\.[A-Za-z0-9]{10})$ ]]
remote_operator_uid=${BASH_REMATCH[1]}
remote_stage=${BASH_REMATCH[2]}
readonly remote_operator_uid

scp -p "${ssh_options[@]}" \
  "${local_stage}/app-image.tar.gz" \
  "${local_stage}/app.env" \
  "${local_stage}/release.env" \
  "${local_stage}/app.compose.yaml" \
  "${local_stage}/app.service" \
  "${local_stage}/cutover-app.sh" \
  "${local_stage}/secure-env-file.py" \
  "${local_stage}/SHA256SUMS" \
  "${ssh_target}:${remote_stage}/"

cutover_output=$(
  ssh "${ssh_options[@]}" "${ssh_target}" bash -s -- \
    "${remote_stage}" "${remote_operator_uid}" "${app_image_id}" \
    < "${script_dir}/install-app-release.sh"
)
[[ ${cutover_output} =~ ^/var/backups/jarvis-command/cutover-[0-9]{8}T[0-9]{6}Z$ ]]
release_result=${cutover_output}
