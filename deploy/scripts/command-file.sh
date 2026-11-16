#!/usr/bin/env bash
# Moves files between Jarvis (the Hermes host) and Command chats, over the scheduled-runs listener.
#
#   COMMAND_SCHEDULED_URL=http://VM118:8652 COMMAND_DELIVERIES_KEY_FILE=~/.config/command/deliveries.key \
#     command-file.sh send <path> [chatId]     # prints Markdown to put in a reply; the chat shows the
#                                              # image inline or a download card for any other file
#     command-file.sh send <path> <chatId> --say "Here's the report"
#                                              # also posts it to that chat as a message (a delivery)
#     command-file.sh get <artifactId> <version> [outPath]
#                                              # fetches a file Neal attached in a chat
#
# chatId is jc_… (a chat), room_… (a project's lead chat) or, with --say only, "home".
# The key is the deliveries key (SCHEDULED_DELIVERIES_KEY). It goes to curl through a config file, never argv.
# Exit codes: 0 ok, 2 usage, 3 refused (4xx), 4 unavailable (5xx or network).
set -euo pipefail
usage() { sed -n '2,13p' "$0" >&2; exit 2; }
[ $# -ge 2 ] || usage
url=${COMMAND_SCHEDULED_URL:?set COMMAND_SCHEDULED_URL}
key=$(cat "${COMMAND_DELIVERIES_KEY_FILE:?set COMMAND_DELIVERIES_KEY_FILE}")
auth() { printf 'header = "Authorization: Bearer %s"\n' "$key"; }
out=$(mktemp)
trap 'rm -f "$out"' EXIT
check() {
  case $1 in
    200) return 0 ;;
    4??) cat "$out" >&2; echo >&2; exit 3 ;;
    *) cat "$out" >&2 2>/dev/null || true; exit 4 ;;
  esac
}

case $1 in
  send)
    path=$2 chat=${3:-} say=
    [ -f "$path" ] || { echo "no such file: $path" >&2; exit 2; }
    if [ "${4:-}" = "--say" ]; then say=${5:?--say needs a message}; [ -n "$chat" ] || usage; fi
    name=$(basename -- "$path")
    mime=$(file --brief --mime-type -- "$path" 2>/dev/null || echo application/octet-stream)
    # The same file sent to the same chat is stored once, even if the command is retried.
    id=$(printf '%s\0%s\0' "$chat" "$name" | cat - "$path" | sha256sum | cut -c1-40)
    query="name=$(jq -rn --arg v "$name" '$v|@uri')&id=$id"
    case $chat in jc_*|room_*) query="$query&chatId=$chat" ;; esac
    status=$(curl -sS -o "$out" -w '%{http_code}' --max-time 300 --config <(auth) \
      -H "Content-Type: $mime" --data-binary "@$path" "$url/v1/files?$query" || echo 000)
    check "$status"
    markdown=$(jq -r .markdown "$out")
    if [ -z "$say" ]; then echo "$markdown"; exit 0; fi
    body=$(jq -n --arg id "file.$id" --arg c "$chat" --arg t "$say" --arg m "$markdown" \
      '{id:$id, chatId:$c, content:($t + "\n\n" + $m), title:($t | split("\n")[0] | .[0:80]), kind:"cron"}')
    status=$(curl -sS -o "$out" -w '%{http_code}' --max-time 30 --config <(auth) \
      -H 'Content-Type: application/json' --data "$body" "$url/v1/deliveries" || echo 000)
    check "$status"
    echo "$markdown"
    ;;
  get)
    [ $# -ge 3 ] || usage
    artifact=$2 version=$3 target=${4:-}
    [[ $artifact =~ ^art_[a-f0-9]{32}$ && $version =~ ^[0-9]+$ ]] || usage
    status=$(curl -sS -o "$out" -w '%{http_code}' --max-time 300 --config <(auth) \
      "$url/v1/files/$artifact/$version" || echo 000)
    check "$status"
    if [ -n "$target" ]; then mv "$out" "$target"; trap - EXIT; echo "$target"; else cat "$out"; fi
    ;;
  *) usage ;;
esac
