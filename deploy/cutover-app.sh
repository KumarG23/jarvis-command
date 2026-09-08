#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/trusted-recovery-directory.sh"

usage() {
  printf 'usage: %s cutover <bootstrap-container> <bootstrap-unit|none> <app-unit> <expected-app-image-id> <backup-root>\n' "$0" >&2
  printf '       %s rollback <cutover-state-directory>\n' "$0" >&2
  exit 64
}

fail() {
  printf '%s\n' "$1" >&2
  return 1
}

docker_bin=${DOCKER_BIN:-docker}
systemctl_bin=${SYSTEMCTL_BIN:-systemctl}
ss_bin=${SS_BIN:-ss}
curl_bin=${CURL_BIN:-curl}
date_bin=${DATE_BIN:-date}
sleep_seconds=${CUTOVER_SLEEP_SECONDS:-0.25}
app_container=jarvis-command-app
local_root_url=http://127.0.0.1:3000/
local_health_url=http://127.0.0.1:3000/api/health

valid_container_name() {
  [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]
}

valid_unit_name() {
  [[ $1 =~ ^[A-Za-z0-9_.@-]+\.service$ ]]
}

write_state() {
  local state_directory=$1
  local name=$2
  local value=$3
  printf '%s\n' "${value}" > "${state_directory}/${name}"
}

read_state() {
  recovery_read "$2"
}

container_running() {
  "${docker_bin}" inspect --format '{{.State.Running}}' "$1"
}

port_3000_is_bound() {
  [[ -n $("${ss_bin}" -H -ltn 'sport = :3000') ]]
}

wait_for_port_3000_unbound() {
  local attempt
  for attempt in {1..20}; do
    if ! port_3000_is_bound; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done
  fail 'port 3000 remained bound after bootstrap shutdown'
}

restore_bootstrap() {
  local state_directory=$1
  local bootstrap_container bootstrap_unit app_unit bootstrap_image
  local bootstrap_restart bootstrap_was_running bootstrap_unit_enabled bootstrap_unit_active
  local app_unit_enabled overall=0 current prior_status

  recovery_validate_files || return 1
  prior_status=$(read_state "$state_directory" status) || return 1
  [[ $prior_status =~ ^(captured|cutover-verified|bootstrap-restored)$ ]] || return 1
  [[ -s $state_directory/bootstrap-root.html ]] || return 1

  bootstrap_container=$(read_state "${state_directory}" bootstrap-container) || return 1
  bootstrap_unit=$(read_state "${state_directory}" bootstrap-unit) || return 1
  app_unit=$(read_state "${state_directory}" app-unit) || return 1
  bootstrap_image=$(read_state "${state_directory}" bootstrap-image-id) || return 1
  bootstrap_restart=$(read_state "${state_directory}" bootstrap-restart-policy) || return 1
  bootstrap_was_running=$(read_state "${state_directory}" bootstrap-was-running) || return 1
  bootstrap_unit_enabled=$(read_state "${state_directory}" bootstrap-unit-enabled) || return 1
  bootstrap_unit_active=$(read_state "${state_directory}" bootstrap-unit-active) || return 1
  app_unit_enabled=$(read_state "${state_directory}" app-unit-enabled) || return 1

  valid_container_name "${bootstrap_container}" || return 1
  valid_unit_name "${app_unit}" || return 1
  [[ ${bootstrap_unit} == none ]] || valid_unit_name "${bootstrap_unit}" || return 1
  [[ ${bootstrap_image} =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  [[ ${bootstrap_restart} =~ ^(no|always|unless-stopped|on-failure)$ ]] || return 1
  [[ ${bootstrap_was_running} =~ ^(true|false)$ ]] || return 1
  [[ ${bootstrap_unit_enabled} =~ ^(true|false)$ ]] || return 1
  [[ ${bootstrap_unit_active} =~ ^(true|false)$ ]] || return 1
  [[ ${app_unit_enabled} =~ ^(true|false)$ ]] || return 1

  "${systemctl_bin}" stop "${app_unit}" >/dev/null 2>&1 || overall=1
  "${docker_bin}" stop "${app_container}" >/dev/null 2>&1 || true
  if ! current=$("${docker_bin}" ps --filter "name=^/${app_container}$" --format '{{.Names}}' 2>/dev/null); then
    overall=1
  elif [[ -n $current ]]; then
    overall=1
  fi
  if [[ ${app_unit_enabled} == true ]]; then
    "${systemctl_bin}" enable "${app_unit}" >/dev/null 2>&1 || overall=1
  else
    "${systemctl_bin}" disable "${app_unit}" >/dev/null 2>&1 || overall=1
  fi

  "${docker_bin}" update --restart="${bootstrap_restart}" "${bootstrap_container}" >/dev/null || overall=1

  if [[ ${bootstrap_unit} != none ]]; then
    if [[ ${bootstrap_unit_enabled} == true ]]; then
      "${systemctl_bin}" enable "${bootstrap_unit}" >/dev/null 2>&1 || overall=1
    else
      "${systemctl_bin}" disable "${bootstrap_unit}" >/dev/null 2>&1 || overall=1
    fi
    if [[ ${bootstrap_unit_active} == true ]]; then
      "${systemctl_bin}" start "${bootstrap_unit}" >/dev/null || overall=1
    else
      "${systemctl_bin}" stop "${bootstrap_unit}" >/dev/null 2>&1 || true
    fi
  fi

  if [[ ${bootstrap_was_running} == true ]]; then
    current=$(container_running "${bootstrap_container}" 2>/dev/null || true)
    if [[ ${current} != true ]]; then
      "${docker_bin}" start "${bootstrap_container}" >/dev/null || overall=1
    fi
  else
    "${docker_bin}" stop "${bootstrap_container}" >/dev/null 2>&1 || true
  fi

  current=$("${docker_bin}" inspect --format '{{.Image}}' "${bootstrap_container}" 2>/dev/null || true)
  [[ ${current} == "${bootstrap_image}" ]] || overall=1
  current=$("${docker_bin}" inspect --format '{{.HostConfig.RestartPolicy.Name}}' "${bootstrap_container}" 2>/dev/null || true)
  [[ ${current} == "${bootstrap_restart}" ]] || overall=1
  current=$(container_running "${bootstrap_container}" 2>/dev/null || true)
  [[ ${current} == "${bootstrap_was_running}" ]] || overall=1

  if [[ ${bootstrap_was_running} == true ]]; then
    if "${curl_bin}" --fail --silent --show-error --connect-timeout 3 --max-time 5 \
      "${local_root_url}" > "${state_directory}/bootstrap-restored-root.html"; then
      cmp -s "${state_directory}/bootstrap-root.html" \
        "${state_directory}/bootstrap-restored-root.html" || overall=1
    else
      overall=1
    fi
  fi

  if (( overall != 0 )); then
    printf 'bootstrap restoration could not be verified; manual recovery required from %s\n' \
      "${recovery_display}" >&2
    return 1
  fi

  recovery_verify || return 1
  write_state "${state_directory}" status bootstrap-restored || return 1
  printf 'BOOTSTRAP_RESTORED_FROM=%s\n' "${recovery_display}"
}

rollback_armed=false
state_directory=''
rollback_on_error() {
  local status=$?
  trap - ERR INT TERM HUP
  (( status != 0 )) || status=1
  if [[ ${rollback_armed} == true && -n ${state_directory} ]]; then
    if restore_bootstrap "${state_directory}" >/dev/null; then
      printf 'cutover failed; bootstrap restored from %s\n' "${recovery_display}" >&2
    else
      printf 'cutover failed; bootstrap restoration also failed for %s\n' "${recovery_display}" >&2
      status=1
    fi
  fi
  exit "${status}"
}

[[ $# -ge 1 ]] || usage
mode=$1
shift

if [[ ${mode} == rollback ]]; then
  [[ $# -eq 1 ]] || usage
  [[ $1 =~ /cutover-[0-9]{8}T[0-9]{6}Z$ ]] || fail 'invalid cutover state directory name'
  recovery_open "$1"
  restore_bootstrap "$recovery_directory"
  exit
fi

[[ ${mode} == cutover && $# -eq 5 ]] || usage
bootstrap_container=$1
bootstrap_unit=$2
app_unit=$3
expected_app_image=$4
backup_root=$5

valid_container_name "${bootstrap_container}" || fail 'invalid bootstrap container name'
[[ ${bootstrap_unit} == none ]] || valid_unit_name "${bootstrap_unit}" || fail 'invalid bootstrap systemd unit'
valid_unit_name "${app_unit}" || fail 'invalid application systemd unit'
[[ ${expected_app_image} =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'expected application image must be sha256:<64 lowercase hex>'
[[ ${backup_root} == /* && ${backup_root} != *$'\n'* && ${backup_root} != *$'\r'* ]] || fail 'backup root must be an absolute path'
[[ ${sleep_seconds} =~ ^([0-9]+|[0-9]*\.[0-9]+)$ ]] || fail 'CUTOVER_SLEEP_SECONDS must be numeric'
recovery_open "$backup_root"

if "${systemctl_bin}" is-active --quiet "${app_unit}"; then
  fail 'application unit is already active; refusing bootstrap cutover'
fi
if [[ $(container_running "${bootstrap_container}") != true ]]; then
  fail 'bootstrap container must be running before cutover'
fi
if ! port_3000_is_bound; then
  fail 'bootstrap does not own an active port 3000 listener'
fi

timestamp=$("${date_bin}" -u +%Y%m%dT%H%M%SZ)
recovery_create "cutover-${timestamp}"
state_directory=$recovery_directory

bootstrap_image=$("${docker_bin}" inspect --format '{{.Image}}' "${bootstrap_container}")
bootstrap_restart=$("${docker_bin}" inspect --format '{{.HostConfig.RestartPolicy.Name}}' "${bootstrap_container}")
bootstrap_was_running=$(container_running "${bootstrap_container}")
bootstrap_compose_project=$("${docker_bin}" inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "${bootstrap_container}")
bootstrap_compose_files=$("${docker_bin}" inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "${bootstrap_container}")
bootstrap_compose_working_directory=$("${docker_bin}" inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "${bootstrap_container}")

[[ ${bootstrap_image} =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'bootstrap image identity is not immutable'
[[ ${bootstrap_restart} =~ ^(no|always|unless-stopped|on-failure)$ ]] || fail 'bootstrap restart policy is unsupported'
[[ ${bootstrap_was_running} == true ]] || fail 'bootstrap stopped during cutover capture'

if "${systemctl_bin}" is-enabled "${app_unit}" >/dev/null 2>&1; then
  app_unit_enabled=true
else
  app_unit_enabled=false
fi
bootstrap_unit_enabled=false
bootstrap_unit_active=false
if [[ ${bootstrap_unit} != none ]]; then
  if "${systemctl_bin}" is-enabled "${bootstrap_unit}" >/dev/null 2>&1; then
    bootstrap_unit_enabled=true
  fi
  if "${systemctl_bin}" is-active --quiet "${bootstrap_unit}"; then
    bootstrap_unit_active=true
  fi
fi

"${curl_bin}" --fail --silent --show-error --connect-timeout 3 --max-time 5 \
  "${local_root_url}" > "${state_directory}/bootstrap-root.html"
[[ -s ${state_directory}/bootstrap-root.html ]] || fail 'bootstrap artifact capture is empty'

write_state "${state_directory}" bootstrap-container "${bootstrap_container}"
write_state "${state_directory}" bootstrap-unit "${bootstrap_unit}"
write_state "${state_directory}" app-unit "${app_unit}"
write_state "${state_directory}" app-unit-enabled "${app_unit_enabled}"
write_state "${state_directory}" bootstrap-image-id "${bootstrap_image}"
write_state "${state_directory}" bootstrap-restart-policy "${bootstrap_restart}"
write_state "${state_directory}" bootstrap-was-running "${bootstrap_was_running}"
write_state "${state_directory}" bootstrap-unit-enabled "${bootstrap_unit_enabled}"
write_state "${state_directory}" bootstrap-unit-active "${bootstrap_unit_active}"
write_state "${state_directory}" bootstrap-compose-project "${bootstrap_compose_project}"
write_state "${state_directory}" bootstrap-compose-config-files "${bootstrap_compose_files}"
write_state "${state_directory}" bootstrap-compose-working-directory "${bootstrap_compose_working_directory}"
write_state "${state_directory}" expected-app-image-id "${expected_app_image}"
write_state "${state_directory}" status captured

rollback_armed=true
trap rollback_on_error ERR INT TERM HUP

if [[ ${bootstrap_unit} != none ]]; then
  "${systemctl_bin}" disable --now "${bootstrap_unit}"
fi
"${docker_bin}" update --restart=no "${bootstrap_container}" >/dev/null
"${docker_bin}" stop "${bootstrap_container}" >/dev/null
[[ $(container_running "${bootstrap_container}") == false ]] || fail 'bootstrap container remained running after stop'
wait_for_port_3000_unbound

"${systemctl_bin}" enable --now "${app_unit}"
"${systemctl_bin}" is-active --quiet "${app_unit}"
app_state=$("${docker_bin}" inspect \
  --format '{{.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
  "${app_container}")
IFS='|' read -r app_image app_running app_health extra_state <<< "${app_state}"
[[ -z ${extra_state:-} && ${app_image} == "${expected_app_image}" ]] || fail 'application image identity verification failed'
[[ ${app_running} == true && ${app_health} == healthy ]] || fail 'application container is not running and healthy'

"${curl_bin}" --fail --silent --show-error --connect-timeout 3 --max-time 5 \
  "${local_health_url}" > "${state_directory}/app-health.json"
"${curl_bin}" --fail --silent --show-error --connect-timeout 3 --max-time 5 \
  "${local_root_url}" > "${state_directory}/app-root.html"
[[ -s ${state_directory}/app-health.json && -s ${state_directory}/app-root.html ]] || fail 'application health or root artifact is empty'
grep -Fq 'Jarvis Command' "${state_directory}/app-root.html" || fail 'application root does not contain the reviewed product name'
if cmp -s "${state_directory}/bootstrap-root.html" "${state_directory}/app-root.html"; then
  fail 'application root still matches the bootstrap artifact'
fi

recovery_verify
write_state "${state_directory}" status cutover-verified
rollback_armed=false
trap - ERR INT TERM HUP
printf 'CUTOVER_STATE_DIR=%s\n' "${recovery_display}"
