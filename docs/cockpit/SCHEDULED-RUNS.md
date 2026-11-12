# Scheduled runs: reminders and cron jobs into Command

Neal uses Jarvis-in-Discord often for reminders and cron jobs. Hermes cron delivers only to gateway chat platforms such as Discord. It has no outbound webhook (Jarvis, PR #177 comment 6811806876). So Command accepts the call itself:

1. A Hermes **script-mode cron job** runs `deploy/scripts/command-scheduled-run.sh`.
2. The script POSTs to the BFF's **scheduled-runs listener** with its own bearer key.
3. Command starts an ordinary run in the target project's chat as Neal (the configured owner actor). The model is the project's routing default, so it uses the subscription default and never a paid fallback.
4. The run's answer appears in that chat's history. The BFF polls the run until it finishes, so the existing inbox entry and the reply push fire even when no browser is open. An approval request also lands in the inbox.

The prompt appears in the chat as `[Scheduled task: <label>]` followed by the prompt, so it is clear it didn't come from Neal typing.

## API

The listener is separate from the Access-protected app port and serves only these two routes. Every request needs `Authorization: Bearer <SCHEDULED_RUNS_KEY>`.

`GET /v1/scheduled-runs/targets` lists the projects that aren't archived:

```json
{ "targets": [ { "projectId": "room_…", "name": "Homelab", "sessionId": "jc_…" } ] }
```

`sessionId` is the chat a scheduled run lands in: the project's lead chat, else its most recent chat. It is `null` when the project has no chat yet.

`POST /v1/scheduled-runs`:

```json
{
  "id": "UUID, the idempotency key",
  "target": { "projectId": "room_…" },
  "label": "Morning homelab check",
  "prompt": "Check disk usage on every server and tell me anything over 80%."
}
```

- `target` may be `{ "sessionId": "jc_…" }` instead, but the chat must belong to a project that isn't archived.
- `prompt` is at most 8000 characters; `label` at most 80, on one line.
- Repeating the same `id` with the same body replays the existing run (`"replayed": true`). The same `id` with a different body gets 409.

Responses:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{publicRunId, projectId, sessionId, status, replayed}` | Started or replayed. |
| 400 | `invalid_request` | Malformed body. |
| 401 | `unauthorized` | Missing or wrong key. |
| 404 | `target_not_found` / `project_has_no_chat` | No such project or chat. |
| 409 | `conflict` | The chat is busy, or the `id` was used for another body. Retry later with the same `id`. |
| 422 | `routing_refused` | The project's model isn't eligible. Nothing was sent. |
| 503 | `unavailable` | Command or Hermes isn't ready. Retry. |

Logs record only the route, status and error type, never the key, prompt, label or output.

## Setup (Jarvis)

1. **Owner actor.** This is the actor fingerprint Neal's own chats are recorded under, a 64-hex value. Read it from the BFF audit ledger, for example `jq -r 'select(.action=="run.requested") | .actor' /var/lib/jarvis-command/audit/events.jsonl | sort | uniq -c`. Use the one with Neal's runs. Command is single-user, so it should be the only one.
2. **Key.** Generate a new random value of at least 32 characters. It goes in the BFF env file and in a 0600 file on the Dell. It is never posted on GitHub.
3. **BFF env** (`command.env`), then restart `jarvis-command.service`:
   ```
   SCHEDULED_RUNS_MODE=enabled
   SCHEDULED_RUNS_HOST=<VM118 LAN address the Dell can reach>
   SCHEDULED_RUNS_PORT=8652
   SCHEDULED_RUNS_KEY=<key>
   SCHEDULED_RUNS_OWNER_ACTOR=<owner actor>
   ```
   Limit the port to the Dell with the VM firewall, as with the session-host MCP port. This needs no Cloudflare Access change.
4. **For phone push.** `WEB_PUSH_MODE=enabled`, `REPLY_NOTIFICATIONS_MODE=enabled` and `REPLY_EVIDENCE_MODE=enabled` must already be on. Without them, results still land in the chat and inbox.
5. **Dell.** Install `deploy/scripts/command-scheduled-run.sh`; it needs `curl`, `jq` and `sha256sum`. Set `COMMAND_SCHEDULED_URL=http://<VM118>:8652` and `COMMAND_SCHEDULED_KEY_FILE=<0600 key file>`.
6. **Cron job.** Create a Hermes script-mode job that runs, for example:
   ```
   command-scheduled-run.sh room_… "Morning homelab check" "Check disk usage on every server and tell me anything over 80%."
   ```
   Give each timer occurrence a UUID that the scheduler saves before the first attempt, and pass it as `COMMAND_SCHEDULED_OCCURRENCE`. A retry with it replays the same run, even after a restart. Without it, the script derives an id from the project, label, prompt and the minute it started, which only protects retries within that one process. The key goes to curl through a config file, never on the command line, and the response file comes from `mktemp`. It retries a busy chat (409) three times, and exits 3 when refused and 4 when unavailable.

## Acceptance

1. `curl -H "Authorization: Bearer …" http://<VM118>:8652/v1/scheduled-runs/targets` lists Neal's projects.
2. A one-off job with a harmless prompt ("Say hello and the current time") shows up in the project chat as a scheduled task, and Jarvis's answer follows.
3. With Neal's phone locked, the answer arrives as a push notification.
4. Running the same command again within the minute returns `"replayed": true`, and no second message appears.

## Deliveries: Hermes cron and reminders that stay in Hermes

Jobs that keep running inside Hermes cron (including reminders the lead creates from chat) deliver to Command through a Hermes `command` platform plugin. Its `send(chat_id, content)` POSTs the already composed message here. Command stores it, shows it in the chat, adds an inbox entry and pushes it. It is not a run, and nothing is appended to Hermes session history.

`POST /v1/deliveries`, same listener and bearer key:

```json
{
  "id": "stable key, 1-160 chars of [A-Za-z0-9._:-], e.g. <job_id>:<fire_time>",
  "chatId": "jc_… | room_… | home",
  "content": "markdown, at most 16000 characters",
  "title": "optional, at most 80 characters on one line, e.g. the job name",
  "kind": "cron | reminder"
}
```

- `room_…` lands in the project's lead chat, else its latest chat. `jc_…` must exist and must not be in an archived project; a chat outside any project is fine.
- `home` lands at `SCHEDULED_RUNS_HOME` (a `room_…` or `jc_…` in `command.env`). Unset, it gets `404 home_not_set`.
- The same `id` with the same body replays (`"replayed": true`, no second inbox entry or push). The same `id` with a different body gets 409.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{deliveryId, sessionId, replayed}` | Stored, or replayed. |
| 400 | `invalid_request` | Malformed body. |
| 401 | `unauthorized` | Missing or wrong key. |
| 404 | `target_not_found` / `project_has_no_chat` / `home_not_set` | No such target. |
| 409 | `conflict` | The `id` was used for different content. |
| 503 | `unavailable` | Command isn't ready or storage failed. Retry with the same `id`. |

In the chat the message shows as "Jarvis · Reminder: <title>" or "Jarvis · Scheduled: <title>", placed by its delivery time. The inbox entry and push use the title (else "Reminder" or "Scheduled task") and the first line of content, or a generic line when "Show reply text" is off. A push is skipped while that chat is open and focused. Push needs only `WEB_PUSH_MODE=enabled`.

Storage is `deliveries.json` next to the audit ledger, private (0700 directory, 0600 file), keeping the newest 300 deliveries. Logs record only route, status and error type.

**Rollback:** a BFF older than this change can't read an inbox that holds a delivery item and reports notification storage unavailable. Before rolling back past it, move `notifications.json` aside (the inbox then starts empty).

## Replacing a job, not transporting a result

A scheduled run **replaces** a Hermes cron job. The migrated job becomes script-only and runs its prompt once, in Command. Don't keep an LLM cron job and then start a second run just to carry its answer into Command; that is two model turns for one job.

Jobs that should keep running inside Hermes cron use the deliveries endpoint above through the Hermes `command` plugin instead.

## Not yet

- Reminders the lead creates from chat ("remind me at 5") land in Command once the Hermes `command` plugin is installed and the job delivers to it. Until then they go to Discord.
- There is no Command UI yet for listing or editing scheduled jobs; they live in Hermes cron.
