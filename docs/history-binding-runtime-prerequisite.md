# History binding: runtime prerequisite and backend activation boundary

Reviewed against frontend `635efbd2c4a2f5dc3511115c9f68ab10d1012e4a` and running Hermes `5a0b1ba766956a1a16bc2f17dc3b83eb63633402`.

## Finding — producer is blocked, not implemented

The installed Hermes Runs API does not expose a supported association between an owned run and its exact persisted user/final-answer message IDs. The public documentation (`https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server`) describes run/session/output/usage but no such association. Source inspection agrees:

- `gateway/platforms/api_server_runs.py::_execute_run` receives the agent result and publishes terminal output/usage without saved-message identifiers.
- `_handle_get_run` returns the owned in-memory/durable run status; it cannot reconstruct message ownership.
- `agent/session_persistence.py::_db_flush_write` calls `append_messages_batch` but does not publish the resulting saved IDs through a run-facing contract.
- The Command proxy's existing history projection is `id: String(message.id)`; new binding IDs must use exactly the same validated representation, not invented public IDs.

An opted-in live BFF status read returned completed output and no `historyBinding`. No private session database was read to infer associations. No history-binding producer, pretend capability, text/timestamp/last-position matching, or speculative unsupported upstream field was added.

## Smallest necessary runtime change (proposal, not current API)

1. Capture returned persistent row IDs at successful message writes, attached to the *explicit current-turn user object* and *explicit final-answer object*. Preserve these associations across flushes and final response transformations; do not reconstruct them by scanning equal text or the final positions in a history page.
2. Make the completed `run_conversation` result carry a bounded saved-message receipt containing the actual saved session and the exact user/final-answer IDs. If session rotation, persistence failure, or output rewriting breaks the association, omit it rather than attach foreign or approximate IDs.
3. Store the receipt in the existing owned durable run status before advertising completed status/event. Require committed user and final rows and final saved content consistent with terminal output. Handle persistence failure explicitly; do not advertise a binding before persistence or rely on polling after the frontend has stopped normal terminal supervision.
4. Expose that receipt via the existing authenticated, owner-scoped `GET /v1/runs/{run_id}` representation, preferably explicitly negotiated for compatibility. Do not introduce generic SQL/database access, wider credentials, or generic upstream forwarding.
5. Teach the Command proxy to validate exact run/session and bounded receipt IDs and project IDs with the same convention as session history. Teach the BFF to include `historyBinding` only for `x-jarvis-history-binding: 1`, only after its existing actor/public-run/upstream-run/session checks. Other status responses must retain the old strict shape. Unavailable binding is omitted, never null.
6. Prove this with real temporary runtime storage (not only synthetic upstream fixtures): repeated identical turns, incremental flushes, final persistence failure, terminal ordering, wrong owner/run/session, durable reload, and exact persisted IDs. Then run the consumer's partial-history and older-identical-message regressions and actual active-run reload against that runtime.

This is separate from the existing runtime-recovery WIP. Nothing there was cherry-picked or edited.

## Why the current path-scoped preview cannot activate a candidate BFF independently

The frontend uses absolute `/api` routes on the shared `command.sharma-house.com` origin. Its static preview prefix isolates assets, not API routing or live data. Installing a BFF at that shared API target replaces the production backend. Routing requests heuristically by Referer or sharing the production append-only audit between independent writers is not an acceptable workaround.

Two legitimate activation paths require explicit scope:

- **Recommended for pre-production acceptance:** a separately Access-protected candidate hostname/origin, isolated BFF state/audit, and an explicitly scoped compatible Hermes runtime with manual approvals. Define fixture-only versus live-data access and apply the existing credential/network restrictions. A different Hermes profile must be explicitly authorized; none was created or changed here.
- **Later approved backend cutover:** freeze the runtime/proxy/BFF implementations, retain the current production frontend artifact, back up mutable state and immutable images, drain live runs, activate runtime then compatible proxy/BFF, and verify old-client response compatibility plus readiness, auth, idempotency, exact binding, metadata readback, and rollback. This is a production backend change even if the root UI looks unchanged. No part of that cutover was performed.

Current backend source checkpoint remains `584c3fc6f45dbc60cc8768ecd39c59e92cd219f8`, app image `sha256:83ea45ec8a19c7b88cc7b894375bd67f25858249ffa0d464ff85d48c8b3cf431`, command proxy `sha256:12b2c0dad24a92bedce266d24e4baf182ca8b7bbe8aefece148ca19a8bf16235`.

## Live approval prerequisite

Read-only inspection found `approvals.mode: off` and `approvals.enabled: false` in the installed Hermes configuration. A deliberately harmless deletion of an owned temporary fixture completed without an approval request. This does not establish approval or denial coverage. No approval policy, bypass setting, production runtime, or other profile was changed. Use an explicitly authorized manual-approval runtime for the genuine approval/denial acceptance test; do not manufacture a frontend approval or call a resolver without a real pending request.
