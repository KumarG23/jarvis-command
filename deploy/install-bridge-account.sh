#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 || $# -ne 1 ]]; then
  printf 'usage: sudo %s /path/to/bridge_public_key.pub\n' "$0" >&2
  exit 64
fi

public_key_file=$1
if [[ ! -r ${public_key_file} ]]; then
  printf 'public key is not readable: %s\n' "${public_key_file}" >&2
  exit 66
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Complete validation/rendering before any account, file, or service mutation.
authorized_key=$(python3 "${script_dir}/render-bridge-key.py" "${public_key_file}")
account=jarvis-bridge
home=/var/lib/jarvis-bridge

if ! id "${account}" >/dev/null 2>&1; then
  useradd --system --user-group --create-home --home-dir "${home}" --shell /usr/sbin/nologin "${account}"
fi

install -d -m 0700 -o "${account}" -g "${account}" "${home}/.ssh"
install -m 0600 -o "${account}" -g "${account}" /dev/null "${home}/.ssh/authorized_keys"
printf '%s\n' "${authorized_key}" > "${home}/.ssh/authorized_keys"
chown "${account}:${account}" "${home}/.ssh/authorized_keys"

install -m 0644 -o root -g root \
  "${script_dir}/sshd-jarvis-bridge.conf" \
  /etc/ssh/sshd_config.d/60-jarvis-bridge.conf
/usr/sbin/sshd -t
systemctl reload ssh.service

printf 'bridge account installed; shell, PTY, agent/X11, local forwarding, and alternate listeners remain denied\n'
