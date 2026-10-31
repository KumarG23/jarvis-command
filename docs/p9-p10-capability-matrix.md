# P9 / P10 capability matrix (2026-10-31, issue #63)

Plan: [MASTER_PLAN §10 P9–P10](../MASTER_PLAN.md). Method: current source on this branch plus accepted live evidence in the plan status table. No live service, model inference or write was used; no private host paths or logs are recorded.

**States.**
- **Supported** — implemented in this repo and tied to a source anchor or accepted proof.
- **Planned** — a Command-side change that does not exist yet.
- **Unsupported** — only where accepted evidence says so (#9, #35, plan §2).
- **Unknown** — Hermes may or may not offer it. Installed Hermes source is not readable from this worker and no raw runtime catalog was observed, so what the Command adapter does not call is *not consumed*, not proven absent.

Anchors are files under `apps/` / `packages/`. `proxy` = `apps/command-proxy/src/app.ts`, `svc` = `apps/server/src/live-room-service.ts`, `routes` = `apps/server/src/live-room-routes.ts`.

## P9 — independent threads

| Capability | State | Anchor / evidence |
|---|---|---|
| Create session | Supported | `POST /api/sessions` (`proxy` ~368): `jc_<32hex>` id, source `api_server`, optional title; `svc.createSession` audits it. Live: P2/P4.5. |
| List sessions | Supported, limited | `read-proxy/src/app.ts` `GET /api/sessions` (limit ≤ 50, offset, `include_children=false`). Bootstrap reads 12 (`server/src/hermes-client.ts`). No project/owner/title filter is requested. |
| Resume / read session | Supported | A run on the same `session_id`; `GET /api/sessions/:id` and paged messages (`proxy` 305, 342; limit ≤ 100). |
| Rename / archive session in Hermes | Unknown, not consumed | No such call in the adapter (it uses GET/POST/DELETE only). Thread title/archived would be Command metadata. |
| Hermes-side project field, per-project ownership, session summary endpoint | Unknown, not consumed | Not requested by any adapter call. Not claimed absent. |
| Project ↔ session link | Supported (Command metadata) | `ProjectRoom.sessionIds` ≤ 100 + `lastSessionId` (`packages/contracts/src/project-rooms.ts`); attach route `routes` `/api/rooms/:roomId/sessions` checks the session exists. Live: P4.5. |
| Lead designation, thread metadata (title, archived, createdAt) | Planned | Not in `ProjectRoomSchema`. P9.1. |
| Session writability | Supported | `isWritableSession` (`proxy` ~697): `jc_` id and source in `COMMAND_SOURCES` required for run/fork/delete; others are read-only. Actor identity is the audit-ledger subject fingerprint. |
| Start run, no duplicates | Supported | `POST /v1/runs` with `Idempotency-Key` (`proxy` ~440); ledger replay by `clientRequestId` (`svc` ~176–205). Live: P2. |
| One run per thread | Supported (Command-side) | `svc` 209–213 rejects a second unsettled run on the session. Any Hermes-side guard is Unknown. |
| Concurrent threads | Supported with limits | Mutating 30/min, reads 240/min (`routes` 101); live SSE capped at 4 (`routes` 224, `proxy` `MAX_ACTIVE_STREAMS`). Hermes' own concurrency ceiling is Unknown. UI must poll status. |
| Per-session run status | Supported for Command-admitted runs | `GET /v1/runs/:id` (`proxy` 511) needs a run id from the ledger (`activeRunsForSession`). Runs started outside Command, and any Hermes list-runs-by-session, are Unknown, not consumed. |
| Stop / steer / approval per run | Supported | `proxy` 621, 642; `svc` `steerRun`/`stopRun`/`approveRun`. Steer is queued; consumption not claimed (P2 evidence). |
| Recovery after reload/restart | Supported | `svc.lookupRunRequest` (517), `listUnsettledRuns` (543); Command-admitted runs only. |
| Lead context injection | Supported mechanism | Text prefix in run input: `apps/web/src/projectInput.ts` `composeProjectInput`; input cap 16,000 (`proxy` 205). Exactly-once proven for instructions (P4.5). |
| Roster projection (bounded, read-only, stored-message excerpts) | **Planned / missing** | No roster code exists. P9.2. Fields would come from session GET fields and a bounded message page already consumed above. |
| Validated thread links | **Planned / missing** | Would validate against `sessionIds`; nothing built. P9.3. |
| Historical message↔run join | Unsupported | Plan §2, #9. |
| Delegated sub-task detail | Unsupported | #35 (settled, not repeated). |

## P10 — model catalog

Four separate questions per entry: **advertised** (in Hermes catalog), **authenticated** (provider flag), **eligible** (approved free/included, Command-side), **selectable** (all three). Authentication does not prove a route is included or spend is approved.

| Item | State | Anchor / finding |
|---|---|---|
| Catalog source | Supported | Hermes `GET /api/model/options` read by `readInferenceOptions` (`proxy` 669): `provider`, `model`, `providers[{slug, authenticated, models[]}]` (`proxy` 193–201). |
| Eligibility control | Supported | `CURATED_INFERENCE_OPTIONS` (`proxy` 46): `openai-codex` gpt-6-astra/-sol/-luna, gpt-5.6-sol/-terra/-luna and `xai-oauth` grok-4.7/-4.6. Selectable = advertised ∩ authenticated ∩ this list (`proxy` 675–679). This is the existing route/spend control and stays. |
| Anthropic/Haiku, OpenAI API-key, OpenRouter `:free` | Not selectable today; advertised and authenticated: **Unknown**; eligibility: **Unknown** | No allowlist entry. No existing-access read of the raw catalog (ops helper has none; BFF `/api/live/model-options` returns only the filtered list behind Access). #62 names are requests, not availability. |
| Aliases | Unknown | Exact strings and hard-coded labels only; Hermes alias normalisation not observed. |
| Effort levels | Gap | The same five levels (`proxy` 45) are attached to every option; the contract requires one. Per-model support is not sourced; do not assume for new families. |
| Large catalogs | Defect risk | `models` `.max(500)` / providers `.max(100)` (`proxy` 199–200): a larger list fails the whole parse, breaking the selector. |
| `:free` rule | Planned | Id suffix `:free` is necessary only; still needs an allowlist entry and approved eligibility. No price inference. |
| Refresh / failure | Supported | Fresh no-cache GET per send (`apps/web/src/TurnView.tsx` ~431); proxy re-reads at admission, absent → 409 `inference_unavailable` (`proxy` 445). |
| No paid fallback | Supported | `upstreamInference` sends `require_model_lock: true`. Catalog expansion must not change this. |
| Credentials | Supported | Clients get provider/model/label only (`InferenceOptionsResponseSchema`). |
| Requested vs executed | Supported for current routes (P1); Unknown for new providers | Executed route comes from the run receipt; Anthropic/OpenRouter receipts unobserved. |
| Hermes change | Not performed | If Hermes does not advertise/authenticate these families, enabling them is a provider/credential change outside worker authority. Eligibility of any API-billed family is a lead decision. |

## Follow-up slices

| # | Slice | Depends on | Checks |
|---|---|---|---|
| P9.1 | Lead + thread metadata on `ProjectRoom`, create/attach/open | #63 | contract/store/route tests incl. legacy rooms; one owned create round trip |
| P9.2 | Roster projection + bounded labelled lead injection | P9.1 | bounds, unknown states, read-only external session, injected once per send; one owned lead send |
| P9.3 | Validated thread links | P9.2 | forged/foreign/archived ids inert; desktop + 320–430 px |
| P9.4 | Concurrent-thread UI | P9.1–P9.3; serialize with P10.2 | two owned concurrent runs, no duplicates on reload/restart, stop one only |
| P10.1 | Tolerant catalog read model with separate advertised/authenticated/eligible/selectable fields, optional effort, raw-list visibility for Sol | #63 | proxy tests: >500 models, unauthenticated provider, advertised-but-ineligible entry rejected at admission, no alias guessing; Sol reads the live list |
| P10.2 | Selector UI with unavailable reasons | P10.1; serialize with P9.4 | selector tests; fresh inventory per send unchanged |
| P10.3 | Live proof | P10.1–P10.2 and lead-approved eligibility | one owned run per advertised, authenticated, approved free/included entry; executed vs requested; no spend |
| P9.5 | Phone checks to Final Neal packet addendum | P9.4, P10.2 | **phone check pending** |
