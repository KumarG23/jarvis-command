#!/usr/bin/bash
set -Eeuo pipefail
umask 077

stage=${1-}
operator_uid=${2-}
expected_app_image=${3-}
release_result=''

cleanup_remote_stage() {
  local cleanup_status=$?
  local cleanup_failed=0
  trap - EXIT HUP INT TERM

  if [[ -n ${stage} ]]; then
    if [[ ${stage} =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]; then
      if ! rm -rf -- "${stage}"; then
        cleanup_failed=1
      elif [[ -e ${stage} ]]; then
        cleanup_failed=1
      fi
    else
      cleanup_failed=1
    fi
  fi

  if (( cleanup_failed != 0 )); then
    printf 'remote release staging cleanup failed\n' >&2
    (( cleanup_status != 0 )) || cleanup_status=1
  elif (( cleanup_status == 0 )); then
    if [[ ${release_result} =~ ^/var/backups/jarvis-command/cutover-[0-9]{8}T[0-9]{6}Z$ ]]; then
      printf '%s\n' "${release_result}"
    else
      printf 'remote release completed without a valid cutover state\n' >&2
      cleanup_status=1
    fi
  fi

  exit "${cleanup_status}"
}

trap cleanup_remote_stage EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

readonly stage operator_uid expected_app_image
[[ ${stage} =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]
[[ ${operator_uid} =~ ^[0-9]+$ ]]
[[ ${expected_app_image} =~ ^sha256:[0-9a-f]{64}$ ]]
[[ -d ${stage} && ! -L ${stage} ]]
stage_metadata=$(stat -c '%u:%a' -- "${stage}")
[[ ${stage_metadata} == "${operator_uid}:700" ]]
cd -- "${stage}"

check_staged_file() {
  local path=$1
  local expected_mode=$2
  local metadata
  [[ -f ${path} && ! -L ${path} ]]
  metadata=$(stat -c '%u:%a' -- "${path}")
  [[ ${metadata} == "${operator_uid}:${expected_mode}" ]]
}

check_staged_file SHA256SUMS 600
check_staged_file app-image.tar.gz 600
check_staged_file app.env 600
check_staged_file release.env 600
check_staged_file app.compose.yaml 644
check_staged_file app.service 644
check_staged_file cutover-app.sh 755
check_staged_file secure-env-file.py 755
sha256sum -c SHA256SUMS >&2

gunzip -c "${stage}/app-image.tar.gz" | docker load >&2
loaded_image_id=$(docker image inspect --format '{{.Id}}' "${expected_app_image}")
[[ ${loaded_image_id} == "${expected_app_image}" ]]

sudo -n install -d -o root -g root -m 0755 \
  /srv/jarvis-command /srv/jarvis-command/public \
  /srv/jarvis-command/public/.well-known /etc/jarvis-command /usr/local/libexec
sudo -n install -m 0755 "${stage}/secure-env-file.py" \
  /usr/local/libexec/jarvis-command-secure-env-file
sudo -n /usr/local/libexec/jarvis-command-secure-env-file install \
  "${stage}/app.env" /etc/jarvis-command/app.env "${operator_uid}"
sudo -n install -o root -g root -m 0600 "${stage}/release.env" \
  /etc/jarvis-command/release.env
sudo -n install -m 0644 "${stage}/app.compose.yaml" /srv/jarvis-command/compose.yaml
sudo -n install -m 0644 "${stage}/app.service" /etc/systemd/system/jarvis-command-app.service
sudo -n install -m 0755 "${stage}/cutover-app.sh" /usr/local/libexec/jarvis-command-cutover-app

sudo -n test -f /etc/jarvis-command/app.env
sudo -n test ! -L /etc/jarvis-command/app.env
app_env_metadata=$(sudo -n stat -c '%u:%g:%a' /etc/jarvis-command/app.env)
[[ ${app_env_metadata} == 0:0:600 ]]
sudo -n test -f /etc/jarvis-command/release.env
sudo -n test ! -L /etc/jarvis-command/release.env
release_env_metadata=$(sudo -n stat -c '%u:%g:%a' /etc/jarvis-command/release.env)
[[ ${release_env_metadata} == 0:0:600 ]]
helper_metadata=$(sudo -n stat -c '%u:%g:%a' /usr/local/libexec/jarvis-command-secure-env-file)
[[ ${helper_metadata} == 0:0:755 ]]
sudo -n cmp -s "${stage}/app.env" /etc/jarvis-command/app.env
sudo -n cmp -s "${stage}/release.env" /etc/jarvis-command/release.env
cmp -s "${stage}/app.compose.yaml" /srv/jarvis-command/compose.yaml
cmp -s "${stage}/app.service" /etc/systemd/system/jarvis-command-app.service
cmp -s "${stage}/cutover-app.sh" /usr/local/libexec/jarvis-command-cutover-app
cmp -s "${stage}/secure-env-file.py" /usr/local/libexec/jarvis-command-secure-env-file

selected_app_image=$(sudo -n /bin/sh -c '
  while IFS="=" read -r key value; do
    if [ "$key" = JARVIS_COMMAND_APP_IMAGE ]; then printf "%s" "$value"; fi
  done < /etc/jarvis-command/release.env
')
[[ ${selected_app_image} == "${expected_app_image}" ]]
app_image_id=$(docker image inspect --format '{{.Id}}' "${selected_app_image}")
[[ ${app_image_id} == "${selected_app_image}" ]]
sudo -n systemctl daemon-reload

cutover_output=$(sudo -n /usr/local/libexec/jarvis-command-cutover-app cutover \
  jarvis-command-bootstrap none jarvis-command-app.service \
  "${app_image_id}" /var/backups/jarvis-command)
cutover_state=${cutover_output#CUTOVER_STATE_DIR=}
[[ ${cutover_output} == "CUTOVER_STATE_DIR=${cutover_state}" ]]
[[ ${cutover_state} =~ ^/var/backups/jarvis-command/cutover-[0-9]{8}T[0-9]{6}Z$ ]]
sudo -n test -f "${cutover_state}/status"
sudo -n grep -Fxq cutover-verified "${cutover_state}/status"
release_result=${cutover_state}
