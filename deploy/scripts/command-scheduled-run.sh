#!/usr/bin/env bash
# Starts a run in a Command project chat. For Hermes script-mode cron jobs.
#
#   COMMAND_SCHEDULED_URL=http://VM118:8652 COMMAND_SCHEDULED_KEY_FILE=~/.config/command/scheduled.key \
#     command-scheduled-run.sh <projectId> <label> <prompt>
#
# The idempotency id is derived from the project, label, prompt and the current minute, so a retry
# within the same minute replays the same run instead of starting a second one.
# Exit codes: 0 started or replayed, 2 usage, 3 refused (4xx), 4 unavailable (5xx or network).
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: $0 <projectId> <label> <prompt>" >&2; exit 2; }
project=$1 label=$2 prompt=$3
url=${COMMAND_SCHEDULED_URL:?set COMMAND_SCHEDULED_URL}
key=$(cat "${COMMAND_SCHEDULED_KEY_FILE:?set COMMAND_SCHEDULED_KEY_FILE}")
minute=$(date -u +%Y-%m-%dT%H:%M)
hex=$(printf '%s\0%s\0%s\0%s' "$project" "$label" "$prompt" "$minute" | sha256sum | cut -c1-32)
id="${hex:0:8}-${hex:8:4}-4${hex:13:3}-8${hex:17:3}-${hex:20:12}"
body=$(jq -n --arg id "$id" --arg p "$project" --arg l "$label" --arg q "$prompt" \
  '{id:$id, target:{projectId:$p}, label:$l, prompt:$q}')
for attempt in 1 2 3; do
  status=$(curl -sS -o /tmp/command-scheduled-run.$$ -w '%{http_code}' --max-time 20 \
    -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
    --data "$body" "$url/v1/scheduled-runs" || echo 000)
  case $status in
    200) cat /tmp/command-scheduled-run.$$; rm -f /tmp/command-scheduled-run.$$; exit 0 ;;
    409) sleep $((attempt * 30)) ;;  # chat busy with another run: retry with the same id
    4??) cat /tmp/command-scheduled-run.$$ >&2; rm -f /tmp/command-scheduled-run.$$; exit 3 ;;
    *) sleep $((attempt * 10)) ;;
  esac
done
rm -f /tmp/command-scheduled-run.$$
exit 4
