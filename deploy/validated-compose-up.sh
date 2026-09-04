#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 3 || $# -gt 4 ]]; then
  printf 'usage: %s app|read-proxy /path/to/compose.yaml /path/to/release.env [--monitor]\n' "$0" >&2
  exit 64
fi

component=$1
compose_file=$2
release_environment=$3
monitor=false
if [[ $# -eq 4 ]]; then
  if [[ $4 != --monitor ]]; then
    printf 'the only supported fourth argument is --monitor\n' >&2
    exit 64
  fi
  monitor=true
fi

systemd_notify_bin=${SYSTEMD_NOTIFY_BIN:-/usr/bin/systemd-notify}
sleep_bin=${SLEEP_BIN:-/usr/bin/sleep}
monitor_interval=${MONITOR_INTERVAL_SECONDS:-5}

case ${component} in
  app)
    image_variable=JARVIS_COMMAND_APP_IMAGE
    container_name=jarvis-command-app
    ;;
  read-proxy)
    image_variable=JARVIS_COMMAND_READ_PROXY_IMAGE
    container_name=jarvis-command-read-proxy
    ;;
  *)
    printf 'unknown component: %s\n' "${component}" >&2
    exit 64
    ;;
esac

if [[ ! -r ${compose_file} || ! -r ${release_environment} ]]; then
  printf 'compose and release environment files must be readable\n' >&2
  exit 66
fi

if [[ ${monitor} == true ]]; then
  if [[ ! ${monitor_interval} =~ ^[1-9][0-9]*$ ]] || (( monitor_interval > 60 )); then
    printf 'MONITOR_INTERVAL_SECONDS must be an integer from 1 through 60\n' >&2
    exit 65
  fi
  if [[ ! -x ${systemd_notify_bin} || ! -x ${sleep_bin} ]]; then
    printf 'monitor helpers must be executable\n' >&2
    exit 66
  fi
fi

image_id=''
match_count=0
while IFS= read -r line || [[ -n ${line} ]]; do
  line=${line%$'\r'}
  [[ ${line} =~ ^[[:space:]]*$ || ${line} =~ ^[[:space:]]*# ]] && continue
  if [[ ${line} == "${image_variable}="* ]]; then
    image_id=${line#*=}
    match_count=$((match_count + 1))
  fi
done < "${release_environment}"

if [[ ${match_count} -ne 1 || ! ${image_id} =~ ^sha256:[0-9a-f]{64}$ ]]; then
  printf '%s must appear exactly once as sha256:<64 lowercase hex>\n' "${image_variable}" >&2
  exit 65
fi

local_image_id=$(docker image inspect --format '{{.Id}}' "${image_id}")
if [[ ${local_image_id} != "${image_id}" ]]; then
  printf 'local image identity does not match selected release identity\n' >&2
  exit 1
fi

resolved_images=$(docker compose --env-file "${release_environment}" \
  -f "${compose_file}" config --images)
if [[ ${resolved_images} != "${image_id}" ]]; then
  printf 'Compose resolved an image other than the selected immutable identity\n' >&2
  exit 1
fi

stop_and_verify_candidate() {
  local stop_status=0
  local running_containers=''

  docker stop "${container_name}" >/dev/null 2>&1 || stop_status=$?
  if ! running_containers=$(docker ps \
    --filter "name=^/${container_name}$" \
    --format '{{.Names}}'); then
    return 1
  fi

  if [[ -n ${running_containers} ]]; then
    return 1
  fi

  if (( stop_status != 0 )); then
    printf 'docker stop returned status %d; verified candidate is not running\n' \
      "${stop_status}" >&2
  fi
  return 0
}

cleanup_armed=false
cleanup_on_exit() {
  local status=$?
  trap - EXIT INT TERM HUP

  if [[ ${cleanup_armed} == true ]]; then
    set +e
    if stop_and_verify_candidate; then
      printf 'candidate cleaned up after interrupted or unexpected exit\n' >&2
    else
      printf 'candidate cleanup after interrupted or unexpected exit could not be verified\n' >&2
      status=1
    fi
  fi

  exit "${status}"
}

fail_candidate() {
  local reason=$1
  local status=${2:-1}

  if stop_and_verify_candidate; then
    cleanup_armed=false
    printf '%s; candidate stopped\n' "${reason}" >&2
    exit "${status}"
  fi

  printf '%s and candidate cleanup could not be verified\n' "${reason}" >&2
  exit 1
}

trap cleanup_on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
cleanup_armed=true

if docker compose --env-file "${release_environment}" -f "${compose_file}" \
  up -d --wait --wait-timeout 60; then
  :
else
  compose_status=$?
  fail_candidate 'Compose startup failed' "${compose_status}"
fi

if container_state=$(docker inspect \
  --format '{{.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
  "${container_name}"); then
  :
else
  inspect_status=$?
  fail_candidate 'running container identity inspection failed' "${inspect_status}"
fi

IFS='|' read -r running_image_id running_state health_status extra_state <<< "${container_state}"
if [[ -n ${extra_state:-} || -z ${running_image_id:-} || -z ${running_state:-} || -z ${health_status:-} ]]; then
  fail_candidate 'running container state was malformed'
fi

if [[ ${running_image_id} != "${image_id}" ]]; then
  fail_candidate 'running container identity mismatch'
fi

if [[ ${running_state} != true || ${health_status} != healthy ]]; then
  fail_candidate 'candidate is not running and healthy'
fi

printf '%s=%s\n' "${container_name}" "${running_image_id}"

if [[ ${monitor} == false ]]; then
  cleanup_armed=false
  exit 0
fi

if ! "${systemd_notify_bin}" --ready \
  --status="${container_name} is running, healthy, image-verified, and monitored"; then
  fail_candidate 'systemd readiness notification failed'
fi

while true; do
  if ! "${sleep_bin}" "${monitor_interval}"; then
    fail_candidate 'container health monitor delay failed'
  fi

  if monitored_state=$(docker inspect \
    --format '{{.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
    "${container_name}"); then
    :
  else
    fail_candidate 'container lifecycle monitor inspection failed'
  fi

  IFS='|' read -r monitored_image monitored_running monitored_health monitored_extra <<< "${monitored_state}"
  if [[ -n ${monitored_extra:-} || -z ${monitored_image:-} || -z ${monitored_running:-} || -z ${monitored_health:-} ]]; then
    fail_candidate 'container lifecycle monitor returned malformed state'
  fi
  if [[ ${monitored_image} != "${image_id}" ]]; then
    fail_candidate 'container identity changed after readiness'
  fi
  if [[ ${monitored_running} != true ]]; then
    fail_candidate 'container stopped after readiness'
  fi
  if [[ ${monitored_health} != healthy ]]; then
    fail_candidate 'candidate became unhealthy after readiness'
  fi
done
