# P14 Studio crew view — Phase 0 source and freshness report

Plan: [MASTER_PLAN.md §10 P14 and §11](../MASTER_PLAN.md). Issue: #112. This is the
documentation-only Phase 0 discovery required before any P14 implementation. No Command
UI, endpoint, exporter, relay, Studio/Dell runtime change, browser attempt or inference was
made. Command must keep Studio disabled/unavailable until the prerequisites below exist.

Source inspected: the pinned Studio release `2a42f238e8fd97dee7ad021d8a589efe3a216b22`
and the matching source checkout at the same commit. Citations are repository-relative
(`dashboard/...`, `tools/...`) and use that pin. Line numbers are from the pin.

## Verdict

**No supported end-to-end Studio → Command projection exists.**

- Studio has one real sanitized, read-only summary adapter (`dashboard/current.py`) and a
  loopback-only HTTP serving surface (`dashboard/server.py`). It is Vael-issue-centric, not a
  per-agent crew projection, and it is not reachable from Command.
- Command's existing read-proxy is Hermes-only with three fixed GET routes. It has no Studio
  route, no Studio upstream configuration and no Studio-to-Command relay.
- There is no safe per-agent projection of role, branch/worktree, verified task lifecycle or
  per-agent cooldown. The host assignment does hold an owner profile and an absolute worktree
  path, but that is host state, not a safe projection. Requested/configured model and effort
  are stored; an optional resolved model may be proven with explicit provenance, while effort
  remains requested-only and no executed-effort field exists.
- Phase 1 must therefore remain **staged/unimplemented and disabled/unavailable**. Phase 2
  activity detail is **unavailable** because no safe projected-event stream or redactor exists.

This is an honest unavailable state under MASTER_PLAN §0.3, not a failed Command build.

## Authoritative sources that do exist

| Field | Authoritative source (pinned Studio source) | Provenance and freshness | What is actually verifiable |
|---|---|---|---|
| Role (lead/planner/worker) | Lead is the fixed `LEAD = 'sol'` (`tools/team.py:442`). Planner is a child job with `role = 'planner'` (`tools/team.py:1485`) and a daily receipt (`tools/team.py:1434,1449`). Worker role is implicit in the per-issue assignment (`tools/team.py:2284-2290`). | Derived from process identity, not stored as a per-agent role field. | Lead and planner are source-supported. Worker ownership is source-supported. **QA is not a role**: it is only a usage category (`tools/usage_analytics.py:66,69,1679`). No persisted `role` field exists on an assignment. |
| Profile and configured model/effort | `PROFILES` maps each profile to `(tool, model, effort)` (`tools/team.py:388-407`); assignment stores the owner and `route_effort` (`tools/team.py:2284-2290`). | Configuration/admission-time data. | Profile, requested model and requested effort are authoritative as *requested* values. They are **not** executed-route evidence. |
| Resolved model (optional) and effort | `record_start` stores `requested_model` with `requested_model_source = 'launcher_profile'` and the launcher `effort` (`tools/usage_analytics.py:1524-1540`). `build_run` keeps that launcher effort (`tools/usage_analytics.py:1236-1243`). Only provider paths that support it populate `resolved_model` plus `resolved_model_provenance` (`tools/usage_analytics.py:1280-1287`); there is no resolved/executed-effort field. | Requested model/effort are admission-time data. A resolved model is evidence only when its provenance is non-null; effort stays requested-only. | Not exposed by the dashboard crew summary. Do not substitute a requested profile/model for an executed route, and do not claim any receipt proves effort. Unknown stays unknown. |
| Current issue / PR / task | Per-issue assignment JSON contains the fetched issue snapshot (`tools/team.py:2284-2290`). GitHub holds issue/PR titles, labels and PR head/CI (`dashboard/current.py:86-104,257-281`). | Assignment is written at dispatch; GitHub cache is at most 30 s old (`dashboard/current.py:89-102`). | Supported for a project whose repository is queried. The existing dashboard only queries the Vael repository (`dashboard/current.py:20`; `dashboard/app.js:811-812,821,850`), not every registered project. |
| Branch / worktree | Branch is deterministic from project and issue (`tools/team.py:77-79`); assignment stores the absolute worktree path (`tools/team.py:2288-2290`); worktree inspection exists (`tools/team.py:1851-1881`). | Written at dispatch; worktree state is read from git on demand. | Host-assignment state, supported on the Studio host but absent from any safe projection. The absolute path must not be sent to Command. |
| Process liveness (tmux session) | `active()` lists matching session names only (`tools/team.py:1743-1753`); it ignores command return codes. The dashboard's `sessions()` separately returns `None` on observation failure (`dashboard/current.py:145-167`). | Liveness observation at read time; not a task event. | Process presence only. A session name does not prove progress, turn activity, Working state or last event. Unknown when observation fails; never fabricate idle. |
| Issue display state (blocked/running/ready/unverified/open) | GitHub labels plus live-session membership (`dashboard/current.py:267-276`). | Derived per snapshot from label and presence observations. | Display classification only: blocked from a label, running from session presence, ready from a label, otherwise unverified/open. This is not authoritative task lifecycle or per-agent progress. |
| Verified task lifecycle / progress / per-agent Working-Idle | No authoritative per-agent lifecycle, progress or idle record exists. Logs and file mtimes are incidental. | Absent. | **Not reported.** Do not turn tmux presence, issue labels or a snapshot into verified Working/Idle or progress. |
| Last event time | No dedicated per-agent last-event field exists. File mtimes and CLI log lines are incidental, not an authoritative event contract. | Incidental filesystem/log metadata. | **Not reported.** Do not present a log mtime, snapshot time or tmux presence as an agent's last event. |
| Quota / cooldown | Pool-scope markers and status: `record_provider_quota` (`tools/team.py:828-851`), `provider_quota_status` (`tools/team.py:871-950`), `quota_status_all` (`tools/team.py:950-958`); capacity/route/availability markers (`tools/team.py:706-757,1005-1058`). | Recorded provider limit or observation, with reset provenance. | Supported at **pool** granularity, not per agent. A quota file can name the last issue/run that hit it, but that is not a live per-agent cooldown. |
| Pause / work window | `paused.json` with typed kind and resume time (`tools/team.py:1558,1573`); `work_schedule.status(...)` (`tools/team.py:3572`). | Local marker and schedule module. | Supported. These are already surfaced honestly by the dashboard as dispatch/schedule state. |

## The existing Studio dashboard projection

`dashboard/current.py` is explicitly a bounded read-only projection: it never returns native
sessions, paths, logs, process arguments or credentials (`dashboard/current.py:1-8`). It does:

- cache a complete GitHub page for 30 s and fail unknown rather than zero (`dashboard/current.py:86-104`);
- read paused markers, systemd unit state, tmux session names and quota files
  (`dashboard/current.py:120-185`);
- emit `read_only: true`, `observed_at`, a source label, projects, services, work schedule,
  quotas, a configured-profile roster and Vael issues/PRs (`dashboard/current.py:201-290`);
- bound individual JSON marker reads to 128 KiB (`dashboard/current.py:71-76`) and GitHub
  pages to 200 items (`dashboard/current.py:96`).

`dashboard/server.py` serves it on loopback only (`dashboard/server.py:178`), through GET-only
handlers (`dashboard/server.py:99`). `/api/status` and `/api/team/current` return the same
snapshot (`dashboard/server.py:117-123`); there is no POST/PUT/DELETE, no CORS, no per-actor
authorization and no JSON-schema validation at that boundary. The browser polls every 30 s
(`dashboard/app.js:899`).

What this projection is **not**:

- it is not per-agent: `roster` is a static configured-profile list with eligibility
  (`dashboard/current.py:210-215`), not the set of currently running agents;
- it has no role, branch/worktree, verified-progress, last-event or per-agent cooldown fields;
- its tmux session names are process-presence observations, not task progress or Working state;
- issue/PR rows are Vael-only (`dashboard/current.py:20`; `dashboard/app.js:811-812,821,850`);
- it has no transport from the Studio host to Command.

### Freshness and deployed-artifact caveat

The live dashboard process answered on loopback during this discovery and its snapshot carried
a current `observed_at`, so the observation path is alive. The running artifact's top-level
JSON keys did **not** include the `projects` row present in the checked-in source
(`dashboard/current.py:229`). Studio's own release notes already warn that the deployed
dashboard artifact is separate and must not be assumed equal to the source snapshot
(`docs/MIGRATION_ACCEPTANCE.md:13,19` in the Studio tree). Any exporter must pin and verify its
own deployed artifact rather than treat the legacy dashboard as the contract.

Legacy `/api/status` cards must not be trusted on their own; the owner direction in #112 says
the same. The live `/api/team/current` observation above is stale-safe summary evidence, not
authorization to expose it to Command.

## Why Command cannot consume it today

Command's read-proxy exposes exactly three authenticated GET routes: `/health/detailed`,
`/v1/capabilities` and `/api/sessions` (`apps/read-proxy/src/app.ts:34-67`). Unknown paths
return 404 (`apps/read-proxy/src/app.ts:69-71`). Its upstream is a credentialless loopback
Hermes origin only (`apps/read-proxy/src/config.ts:3-9,19-33`); it has no Studio origin, no
Studio credential and no Studio route. It is bounded to 1 MiB, 10 s and GET-only
(`apps/read-proxy/src/app.ts:6,17-22,39-67,109-139`).

The Command BFF likewise has no Studio route: its bootstrap reads Hermes health, capabilities
and sessions only (`apps/server/src/hermes-client.ts:122-132`; `apps/server/src/app.ts:144-196`).
Deployment topology permits one reverse loopback forward from the Hermes host to the app host
and nothing from the Studio host (`docs/deployment/v0.1.md:5-16`). The egress allowlist is
fixed to those loopback peers; adding a Studio peer is a network-boundary change.

Therefore "the Dell relay pattern" currently carries Hermes reads only. A Studio projection
would need a new narrow relay path; no such path exists in accessible source or docs.

## Supported / unsupported summary

| Question | Verdict |
|---|---|
| Authoritative source for profile, requested model/effort, issue, host assignment branch/worktree, process presence, issue-label display state, pool quota | **Supported on the Studio host** (raw sources above); host assignment is not a safe projection. |
| Authoritative per-agent role including QA | **Not reported.** Lead/planner/worker can be derived; QA is a task category only. |
| Authoritative per-agent task lifecycle / verified Working-Idle progress | **Not reported.** Tmux presence and issue labels are observations, not task events. |
| Authoritative last event per agent | **Not reported.** No event record. |
| Authoritative per-agent cooldown/quota | **Partially supported** at pool level; not per agent. |
| Executed route evidence in a crew view | **Partially supported only as an optional resolved model with provenance; effort is requested-only.** The existing dashboard does not expose it, and there is no executed-effort field. |
| A sanitized, bounded, schema-validated read-only projection already served by Studio | **Partially supported in source, not contract-ready.** Sanitized and bounded, but no strict schema, no auth contract, Vael-centric and not per-agent. |
| A Dell-to-Command Studio relay | **Unsupported / absent.** No route, origin, credential or egress allowance exists. |
| Safe redacted event stream for Phase 2 | **Unavailable.** No allowlist-first event schema or redactor over CLI transcripts. |

## Exact minimum prerequisites before Phase 1

These are Final Neal packet prerequisites and involve Studio, relay, credential or network
changes that Command workers must not perform:

1. **Studio-side exporter.** Add a separate read-only exporter (or extend the existing
   adapter behind a new versioned contract) that emits a per-agent rows array for the lead,
   planner and every running/blocked worker. Each row may contain only allowlisted values:
   stable agent/profile label, derived role (`lead`/`planner`/`worker`; QA only if a real role
   source is added), requested model/effort with an explicit `requested` marker, an optional
   resolved model only when its provenance is non-null, issue/PR number and safe title, safe
   repository slug, branch name (never an absolute worktree path), process presence and
   issue-label display state as separate observational fields, pool quota state, and
   `observed_at`. Do not add or claim an executed-effort field. Absent fields must be
   `null`/`not reported`.
2. **Authoritative lifecycle source if Working/Idle/progress is shown.** Tmux presence is only
   process liveness, and issue labels are only display classification. Before Phase 1 shows
   per-agent Working/Idle, progress, elapsed work or a last event, Studio must expose an
   authoritative lifecycle/task event source with timestamps. Without it those fields must be
   `not reported`/unknown, never inferred from tmux or labels.
3. **Strict contract and bounds.** A versioned JSON schema (shared Zod or equivalent) with
   strict unknown-field rejection, enum allowlists, ISO-8601 UTC timestamps, a maximum agent
   count, a hard payload size (recommend ≤ 64 KiB), a per-read timeout, and explicit
   `source_state`/`stale`/`observed_at`. Malformed, hostile, duplicate-key or oversized
   snapshots must fail closed.
4. **Narrow GET-only relay.** One new read-only route on the existing read-proxy, fed by the
   Studio exporter, with GET-only/searchless semantics, no write method, no generic
   passthrough, a separate credential from the Hermes read key, and a fixed upstream path.
   The final route name and port are a lead/operations decision; this report intentionally
   does not invent them.
5. **Transport and credential isolation.** A dedicated reverse-forward/relay from the Studio
   host (or its approved relay host) to a loopback listener on the Command host, with the
   matching fixed egress allowance. The Studio exporter credential must not be placed on the
   Internet-facing VM. This is a network/credential boundary change requiring lead approval.
6. **Command-side authorization and rate limit.** The Command read route must use the same
   Cloudflare Access JWT signature/issuer/audience/expiry/approved-identity validation as
   other protected read APIs, apply a bounded rate limit, and be disabled by default until the
   contract is proven. No new write endpoint.
7. **Freshness semantics.** Command must show `observed_at`, source state and age; mark stale
   snapshots explicitly and show `unavailable` on timeout/error. It must never present the
   last-known snapshot as live, and must not poll while the Studio destination is hidden.
   Process liveness must not be labeled as task progress.
8. **Phase 2 only after Phase 1 acceptance.** A separate allowlist-first event schema, at most
   100 lines or 20 KiB, ANSI/control-sequence stripping, secret/token/key/auth-header/env/PHI
   redaction with hostile-sample tests, and no attachments. Phase 2 remains unavailable until
   such safe projected events are proven.

## Packet-ready paragraph

> **P14 Studio crew view — deferred prerequisite.** Command has no supported Studio crew
> projection or relay today. Studio's existing dashboard adapter is a loopback-only,
> Vael-centric summary, not a per-agent crew contract; its live deployed artifact also differs
> from checked-in source. Command's read-proxy is Hermes-only. To deliver P14, Studio needs a
> versioned, sanitized, per-agent exporter (role, requested model/effort, optional resolved
> model with provenance, issue/PR, branch, process presence kept separate from verified
> progress, pool quota, `observed_at`; absent fields `not reported`), an authoritative
> lifecycle source for any Working/Idle/progress field, a strict bounded schema, a new GET-only
> route on the read-proxy with a separate credential, and a dedicated Studio-to-Command relay
> plus egress allowance. Command must stay disabled/unavailable until those exist; Phase 2
> redacted activity detail is unavailable unless a safe projected-event schema and
> hostile-sample redaction are also proven.

## Evidence state

- **Source-supported:** all source citations above; the Studio adapter and raw host state exist.
- **Runtime-observed:** the loopback dashboard health/snapshot endpoint was readable and
  reported a current observation time; `team.py --project command status` returned its
  documented paused/schedule/lead/running/disabled/unqualified/quota keys. Its `running` list
  is tmux session presence, not verified progress. No private values are recorded here.
- **Unreachable / not supported:** per-agent crew projection, Dell-to-Command Studio relay,
  Command route, strict schema, auth contract and redacted event stream.
- **Not attempted:** no browser QA, no fixture, no inference, no Studio/Dell/Hermes/service or
  proxy action, no new endpoint or credential. Candidate, authenticated and phone evidence do
  not apply; physical phone remains pending for any later accepted UI slice.
