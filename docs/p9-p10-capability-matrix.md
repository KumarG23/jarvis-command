# P9 / P10 capability matrix (2026-10-31, issue #63)

Plan: [MASTER_PLAN §10 P9–P10](../MASTER_PLAN.md). Method: current source on this branch plus prior accepted live evidence in the plan status table. No live service, model inference or write was used for this document, and no private host paths or logs are recorded.

**States.** *Supported* = implemented here and covered by accepted live evidence (cited). *Source-only* = implemented and tested here, not freshly live-read for this issue. *Unsupported* = no contract exists. *Unknown* = cannot be established with existing access; stays unknown, no endpoint or availability is assumed. Installed Hermes source is not readable from this worker; the delegated-subtask question is settled in #35 and not repeated.

## P9 — independent threads

| Capability | State | Current contract / finding |
|---|---|---|
| Create session | Supported (P2/P4.5) | `POST /api/live/sessions` → proxy `POST /api/sessions`: `jc_<32hex>` id, source `api_server`, optional title; audited per actor. |
| List sessions | Supported, limited | Read proxy `GET /api/sessions` (limit ≤ 50, offset, `include_children=false`); bootstrap shows the 12 newest. No project, owner or title filter. A roster cannot be built from the global list. |
| Resume session | Supported | A run on the same `session_id`; `GET /api/sessions/:id`; messages paged (limit ≤ 100, oldest first, session id re-checked). |
| Rename / archive session in Hermes | Unknown (unused) | No PATCH exists in source. Thread title/archived are Command metadata only. |
| Project ↔ session link | Command metadata only | `ProjectRoom.sessionIds` (≤ 100) + `lastSessionId`; attach checks the session exists. Hermes has no project field (Unsupported upstream). **Missing in Command:** lead designation and thread metadata (title, archived, createdAt). |
| Session ownership / writability | Supported | Runs, fork and delete need a `jc_` id with source `jarvis-command`/`api_server` (proxy); other sessions attach read-only. Actor = Access subject fingerprint in the audit ledger. Single-user: no per-actor session ownership upstream. |
| Start run, no duplicates | Supported (P2) | `POST /v1/runs` with `Idempotency-Key`; durable idempotency ≥ 24 h; ledger replays by `clientRequestId`. |
| One run per thread | Supported (Command) | BFF rejects a second run while the session has an unsettled admission. Hermes-side guard unknown. |
| Concurrent threads | Source-only, bounded | No cross-session cap in source, but mutating requests are limited to 30/min, reads 240/min, and **live SSE to 4 streams** (server and proxy). Hermes' own concurrent-run ceiling is Unknown. Multi-thread UI must poll status, not hold a stream per thread. |
| Per-session run status | Supported for Command-admitted runs only | Status needs a run id (`GET /v1/runs/:id`); Command finds it via its ledger (`activeRunsForSession`, `listUnsettledRuns`). No Hermes list-runs-by-session is used: runs started by CLI/Discord are Unknown. |
| Stop / steer / approval per run | Supported (P2/P6) | `run_stop`, `run_steer`, approval endpoints, all per run and audited. Steer is *queued*; consumption and cancellation are not claimed. |
| Recovery | Supported | Request lookup, unsettled-run reconcile on reopen, idempotent replay. Covers Command-admitted runs only. |
| Bounded roster summary | Source-only (new projection) | Derivable from session fields (title, lastActive, messageCount, toolCallCount, model) + a bounded last-message page. No Hermes summary endpoint; summaries must be stored-message excerpts, not generated. |
| Lead context injection | Supported mechanism | Plain-text prefix in the run `input` (`projectContext`, P4.5, exactly-once proven), cap 16,000 chars. A roster must fit a fixed budget inside it and be labelled untrusted data. |
| Validated thread links | Command-only, missing | No upstream need. BFF/UI validate a token against the project's `sessionIds`; anything else renders inert. |
| Historical message↔run join, delegated sub-tasks | Unsupported (#9, #35) | Unchanged; do not infer. |
| Writes into other threads, auto-spawn, approvals on behalf of the user | Out of scope | Not built (plan P9 invariants). |

## P10 — model catalog

| Item | State | Finding |
|---|---|---|
| Catalog source | Supported | Hermes `GET /api/model/options`: `provider`, `model`, `providers[{slug, authenticated, models[]}]` (extra fields pass through unvalidated); capability `model_options`. |
| Currently selectable | Supported | Only Command's **curated 8**: `openai-codex` gpt-6-astra/-sol/-luna, gpt-5.6-sol/-terra/-luna and `xai-oauth` grok-4.7/-4.6, each kept only if its provider is `authenticated` and lists the model. |
| Anthropic / Haiku, OpenAI API-key, OpenRouter `:free` | **Not selectable today**; advertised: **Unknown** | No source entry exists for them. Whether Hermes advertises or authenticates them cannot be read with existing access (the ops helper has no catalog read; the BFF endpoint returns only the filtered list behind Access). Names in #62 are requests, not availability. |
| Aliases | None | Exact provider+model strings and hard-coded labels; whether Hermes normalises aliases is Unknown. |
| Capability limits | Gap | The same five effort levels (`minimal`…`xhigh`) are attached to every option and the contract requires an effort. Effort support per model is not sourced from Hermes; it must not be assumed for new families. |
| Large catalogs | **Defect risk** | Upstream schema caps `models` at 500 and providers at 100; a larger list (OpenRouter) fails the whole parse, so the existing selector would error. Needs tolerant parsing/truncation. |
| `:free` identification | Rule only | Match the advertised id suffix `:free`; no price inference, no paid fallback (`require_model_lock` is sent on every override). |
| Refresh / failure | Supported | Fresh no-cache GET per send in the web client, proxy re-reads the catalog at admission; absent entry → 409 `inference_unavailable`, upstream failure → error with draft kept. No catalog cache to go stale. |
| Credentials | Supported | Provider/model credentials stay in Hermes/server; clients get slug, model, label only. |
| Requested vs executed | Supported for current routes (P1); Unknown for new providers | Executed route is read from the run receipt; whether receipts carry provider/model for Anthropic/OpenRouter is unproven. |
| Hermes change | Not performed | If Hermes does not advertise/authenticate these families, enabling them is a provider/credential change outside worker authority → Final Neal packet addendum. No narrower Hermes source change is identified. |

## Follow-up slices (for Sol to admit)

| # | Slice | Depends on | Focused / runtime check |
|---|---|---|---|
| P9.1 | Lead + thread metadata on `ProjectRoom` (contract, store migration-safe, routes), create/attach/open thread | #63 | contracts/store/route tests incl. legacy rooms without the fields; one owned create round trip |
| P9.2 | Read-only roster projection + bounded, labelled lead-context injection | P9.1 | tests: bounds, unknown states, external session attached read-only, injection once per send, no inference by Command; one owned lead send |
| P9.3 | Validated thread links (`sessionIds` membership, inert otherwise) | P9.2 | forged/foreign/archived id tests; jump chip works desktop + mobile emulation |
| P9.4 | Concurrent-thread UI: per-thread indicator, inbox, split view, mobile drawer | P9.1–P9.3; serialize with P10.2 | two owned concurrent runs, reload/restart no duplicate, stop one only; 320–430 px |
| P10.1 | Tolerant catalog read model, advertised-vs-selectable, optional effort, raw-list visibility for Sol | #63 | proxy tests: >500 models, unauthenticated provider, `:free` rule, no alias guessing; Sol reads the live advertised list |
| P10.2 | Selector UI for the extended catalog and unavailable reasons | P10.1; serialize with P9.4 | selector tests, fresh-inventory-per-send unchanged; desktop + mobile |
| P10.3 | Live proof on advertised free/included routes, requested vs executed | P10.1–P10.2 | one owned run per entry, receipt compared; no paid route |
| P9.5 | Phone check items into Final Neal packet addendum | P9.4, P10.2 | **phone check pending** |
