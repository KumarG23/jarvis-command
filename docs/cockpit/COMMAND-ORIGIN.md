# Command origin assertion (v1)

Status: proxy side built (unset by default). Hermes side in Jarvis's candidate, not deployed. Agreed on PR #177 (comments 6863411390 and 6863567396).

## Why

A reminder Neal creates in a Command chat should be delivered back to that chat. Hermes binds every `/v1/runs` turn as `api_server` (non-push) and drops it as a cron origin. A `jc_…` session id alone is not proof that the run came from Command, because any authorized API client could choose one.

## Contract

- **Secret.** `COMMAND_ORIGIN_KEY`: at least 32 visible-ASCII characters, held only by the command proxy and Hermes. It is distinct from `COMMAND_PROXY_KEY`, `HERMES_API_KEY`/`API_SERVER_KEY` and every other key. Never on GitHub or in logs.
- **Proxy (this repo).** On upstream `POST /v1/runs` only, and only when the key is set and the session is `jc_<32 lowercase hex>`:
  `x-command-origin: v1.<lowercase hex HMAC-SHA256(key, UTF-8 "command-origin/v1\n" + session_id + "\n" + idempotency_key)>`.
  The proxy builds upstream headers itself and never forwards a caller-supplied `x-command-origin`. Context compaction and other routes are unsigned.
- **Hermes (`/v1/runs`).**
  - Exactly one header and one non-empty visible-ASCII `Idempotency-Key` are required.
  - The session must be a canonical `jc_` id.
  - Verification recomputes the HMAC over the admitted session and key with a constant-time compare.
  - The assertion is part of the replay fingerprint, and a resolved or rotated session that differs from the signed id is rejected.
  - Bad or missing configured key, mismatch, or a duplicate header: reject. Absent: today's stateless behaviour.
- **Binding.** The run itself stays `api_server`/non-push. A valid assertion only sets a request-local, persisted *cron-return origin* `command:<session_id>`, so `deliver=origin` for jobs created in that turn goes to the existing `command` delivery plugin. `async_delivery` is not turned on globally.
- **Scope.** `/v1/runs` with exact session continuation only. No `/api/jobs`, response-chain, supplied-history or room-dispatch retargeting. Existing cron destinations are unchanged.

## Commissioning (Jarvis, with Neal's OK for the key)

1. Generate the key on the host and put it in the command proxy env and the Hermes env (0600). Don't post it.
2. Restart the proxy, and the gateway when Neal agrees.
3. In a Command chat, "remind me in 5 minutes to …". Check the job's stored origin is `command:jc_…`, then that the delivery lands in that chat (inbox, phone alert, card), not Discord.
