#!/usr/bin/env bash
# Starts a run in a Command project chat. For Hermes script-mode cron jobs.
#
#   COMMAND_SCHEDULED_URL=http://VM118:8652 COMMAND_SCHEDULED_KEY_FILE=~/.config/command/scheduled.key \
#     command-scheduled-run.sh <projectId> <label> <prompt>
#
# Idempotency: set COMMAND_SCHEDULED_OCCURRENCE to a UUID that the scheduler persists before the
# first attempt (one per timer occurrence); a retry with it, even after a restart, replays the same
# run. Without it, the id is derived from the project, label, prompt and the minute the script
# started, which is only safe for retries inside this one process.
# Exit codes: 0 started or replayed, 2 usage, 3 refused (4xx), 4 unavailable (5xx or network).
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: $0 <projectId> <label> <prompt>" >&2; exit 2; }
project=$1 label=$2 prompt=$3
url=${COMMAND_SCHEDULED_URL:?set COMMAND_SCHEDULED_URL}
key=$(cat "${COMMAND_SCHEDULED_KEY_FILE:?set COMMAND_SCHEDULED_KEY_FILE}")
if [ -n "${COMMAND_SCHEDULED_OCCURRENCE:-}" ]; then
  id=$(printf '%s' "$COMMAND_SCHEDULED_OCCURRENCE" | tr 'A-F' 'a-f')
  [[ $id =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "COMMAND_SCHEDULED_OCCURRENCE must be a UUID" >&2; exit 2; }
else
  minute=$(date -u +%Y-%m-%dT%H:%M)
  hex=$(printf '%s\0%s\0%s\0%s' "$project" "$label" "$prompt" "$minute" | sha256sum | cut -c1-32)
  id="${hex:0:8}-${hex:8:4}-4${hex:13:3}-8${hex:17:3}-${hex:20:12}"
fi
out=$(mktemp)
trap 'rm -f "$out"' EXIT
body=$(jq -n --arg id "$id" --arg p "$project" --arg l "$label" --arg q "$prompt" \
  '{id:$id, target:{projectId:$p}, label:$l, prompt:$q}')
for attempt in 1 2 3; do
  # The key goes through a process-substitution config file, never argv.
  status=$(curl -sS -o "$out" -w '%{http_code}' --max-time 20 \
    --config <(printf 'header = "Authorization: Bearer %s"\n' "$key") -H 'Content-Type: application/json' \
    --data "$body" "$url/v1/scheduled-runs" || echo 000)
  case $status in
    200) cat "$out"; exit 0 ;;
    409) sleep $((attempt * 30)) ;;  # chat busy with another run: retry with the same id
    4??) cat "$out" >&2; exit 3 ;;
    *) sleep $((attempt * 10)) ;;
  esac
done
exit 4
