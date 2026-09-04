#!/usr/bin/bash
set -Eeuo pipefail
umask 077

mode=${1-}
if (( $# != 1 )) || [[ ${mode} != start && ${mode} != stop && ${mode} != reload && ${mode} != egress-start ]]; then
  printf 'usage: %s start|stop|reload|egress-start\n' "$0" >&2
  exit 64
fi

case ${mode} in
  start|stop|reload)
    printf 'global nftables %s is disabled while the Jarvis Command guard is installed; use a documented host-specific maintenance transaction\n' "${mode}" >&2
    exit 1
    ;;
esac

systemctl_bin=${SYSTEMCTL_BIN:-/usr/bin/systemctl}
[[ ${systemctl_bin} == /* && -x ${systemctl_bin} && ! -L ${systemctl_bin} ]] || {
  printf 'systemctl executable is invalid\n' >&2
  exit 65
}

systemctl_property() {
  local unit=$1
  local property=$2
  local value

  if ! value=$("${systemctl_bin}" show "--property=${property}" --value "${unit}"); then
    printf 'could not read %s for %s\n' "${property}" "${unit}" >&2
    return 65
  fi
  [[ -n ${value} && ${value} != *$'\n'* ]] || {
    printf 'invalid %s for %s\n' "${property}" "${unit}" >&2
    return 65
  }
  printf '%s' "${value}"
}

nftables_load_state=$(systemctl_property nftables.service LoadState)
[[ ${nftables_load_state} == loaded ]] || {
  printf 'refusing egress startup because nftables.service is not loaded\n' >&2
  exit 1
}

nftables_active_state=$(systemctl_property nftables.service ActiveState)
case ${nftables_active_state} in
  active)
    exit 0
    ;;
  inactive)
    nftables_unit_file_state=$(systemctl_property nftables.service UnitFileState)
    case ${nftables_unit_file_state} in
      disabled|masked)
        exit 0
        ;;
      *)
        printf 'refusing egress startup because nftables.service is enabled but inactive (%s)\n' "${nftables_unit_file_state}" >&2
        exit 1
        ;;
    esac
    ;;
  failed)
    printf 'refusing egress startup because nftables.service is failed\n' >&2
    exit 1
    ;;
  *)
    printf 'refusing egress startup while nftables.service is %s\n' "${nftables_active_state}" >&2
    exit 1
    ;;
esac
