#!/usr/bin/bash
set -Eeuo pipefail
umask 077

stage=''
handed_off=0

cleanup_allocator_stage() {
  local cleanup_status=$?
  local cleanup_failed=0
  trap - EXIT HUP INT TERM

  if (( handed_off == 0 )) && [[ -n ${stage} ]]; then
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
  fi

  exit "${cleanup_status}"
}

trap cleanup_allocator_stage EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

stage=$(mktemp -d /tmp/jarvis-command-release.XXXXXXXXXX)
[[ ${stage} =~ ^/tmp/jarvis-command-release\.[A-Za-z0-9]{10}$ ]]
chmod 0700 "${stage}"
operator_uid=$(id -u)
[[ ${operator_uid} =~ ^[0-9]+$ ]]
[[ -d ${stage} && ! -L ${stage} ]]
stage_metadata=$(stat -c '%u:%a' -- "${stage}")
[[ ${stage_metadata} == "${operator_uid}:700" ]]
printf '%s:%s\n' "${operator_uid}" "${stage}"
handed_off=1
