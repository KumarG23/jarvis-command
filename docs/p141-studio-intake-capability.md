# P14.1 Studio intake capability — Phase 0

Plan: `MASTER_PLAN.md` §§0.3, 10 P14.1 and 11 on `release/gpt6-sol-luna`. Issue: #113.
This is the admitted read-only source discovery prerequisite. No Studio source/runtime,
Command application source, credentials, authentication, relay, browser, live service,
directive, dispatch or model run was changed or exercised.

## Verdict

**Unsupported — Deferred. Keep steering unavailable.** The accessible source does not
prove one existing owner-input path that both the Studio lead and planner reliably consume,
or an end-to-end Command-to-Studio write relay and sensitive-action step-up contract.
Generic GitHub discussion observation is not a per-directive intake or delivery receipt.
Do not render a directive form or claim Sent, Seen, Acted/Acknowledged until a later
separately authorized capability proves those states. Feature implementation also remains
staged until P14 Phase 1 is accepted, as recorded in the current plan's §11 status row.

## Source and release provenance

- Current Studio checkout: `/home/studio/projects/dev-studio`, clean `main` at
  `2a42f238e8fd97dee7ad021d8a589efe3a216b22` (commit metadata only).
- Release metadata: `/home/studio/releases/dev-studio/current` resolves to the directory
  named `2a42f238e8fd97dee7ad021d8a589efe3a216b22`; the pinned release directory is the
  requested snapshot. The source checkout HEAD and release directory identifier match.
- The source/read evidence below is therefore attributable to that commit. The symlink
  and matching source HEAD do not attest which bytes a running process loaded or prove a
  built artifact/runtime behavior. No service or runtime status was read.
- Command evidence is from this issue worktree at base `8cee0265` plus the accepted
  `docs/p14-studio-capability.md`; no live Command endpoint was called.

## Owner input and pickup

| Question | Source evidence | Finding |
|---|---|---|
| Authoritative owner-input channel | `tools/lead_observation.py:51-57,68-105` scans comments on selected open issues and PR discussions, computes an ID/digest delta, excludes marked automation, and stores a receipt. The configured scan targets are supplied by `tools/team.py:2849-2852`; issue/PR lists come from the current project GitHub repository at `team.py:3190-3194`. | No dedicated owner-directive issue, directive schema, target field or authoritative owner-input contract is implemented. A human comment on a scanned discussion can be observed as generic discussion input; a comment on Command’s #20 is not part of the Dev Studio repository scan. `needs:neal` is outbound notification: `team.py:1382-1420` sends a ping for a label event and records notification delivery, not owner instruction intake. |
| Lead pickup | `team.py:3220-3225,3248-3259` includes discussion deltas in the existing material snapshot and uses changed material to decide whether to run the lead. `team.py:3342-3351` passes only `{kind,id,number,change}` to the Studio lead prompt and retains pending discussions outside the work window. The Studio lead prompt at `team.py:3036-3040` carries discussion revision identifiers, not comment text or a directive-specific instruction/receipt. | An existing lead pass may be triggered by a changed discussion on an open Dev Studio issue/PR. It does not prove the lead read a particular directive, targets the intended role, or acted on it. Delivery is not an interrupt. The scan is part of the existing scheduler; no new wake or polling is proposed. |
| Planner pickup | `team.py:1439-1463` schedules the optional planner at most once per Eastern date and only inside the configured work window. `planner.py:166-200` also enforces the 07:00–17:00 ET window and daily attempt limit, fetches issues, and supplies issue number/title/state/body to the planner. | Planner context includes issue bodies, not issue comments or a directive queue. A comment is not reliably visible to the planner. The planner has no target (`lead`/`planner`) directive contract and no action acknowledgement. |
| Existing work window | `docs/STANDING_POLICY.md:18`; `tools/team.py:1451-1463`; `tools/planner.py:166-179`. | The existing 07:00–17:00 America/New_York model-work window is enforced for planner admission. An owner-input feature must queue outside it; this report does not add a wake, timer or poll. |

### What the receipts establish

`lead_observation.py:82-105` keys generic discussion rows by kind and GitHub comment/review
ID and keeps a digest, issue/PR number and automation marker. It does not retain the
comment body or author/actor, a target (`lead`/`planner`), an idempotency key, or a
directive record. The ID/digest receipt can establish that the scanner observed a
discussion version; it is not exposed as a per-directive receipt to an owner.

`lead_observation.py:151-155` records a lead-run audit with wake reasons, before/after
material snapshots, success and action-command classification. Its `post_github_state`
is explicitly `not_rescanned`; `action_evidence` at `:120-148` detects successful native
command patterns but explicitly is not delivery attestation. It cannot establish that a
specific directive was read or acted on. The planner's `planner.json` at
`planner.py:201-203,262-264` records a daily attempt and aggregate proposed/promoted/dropped
counts, not directive identity or acknowledgement.

Thus:

- **Seen:** Unsupported as a per-directive owner-facing state. The discussion scanner's
  internal ID/hash proves only generic observation.
- **Acted/Acknowledged:** Unsupported. No directive-scoped readback, acknowledgement
  contract, or independently verified action is present.
- **Idempotent identity:** Unsupported for directives. GitHub discussion IDs identify
  generic comments; no Command request key maps a send to a Studio intake item or prevents
  duplicate application on an uncertain result.
- **Durable actor/target audit:** Unsupported for directives. Existing private scanner/run
  receipts omit directive body, actor and target. They are not a durable Command write
  audit for a Studio intake.

## Existing Command write and confirmation paths

- The accepted `docs/p14-studio-capability.md` records that the Command read proxy has
  fixed Hermes-only GET routes and no Studio origin/upstream or Studio relay. Current
  source confirms `apps/read-proxy/src/app.ts:34-71` exposes three fixed GET paths and
  returns 404 for unknown paths; `apps/command-proxy/src/config.ts:3-14,26-50` accepts a
  loopback Hermes origin and Hermes-held key.
- The existing Command BFF routes at `apps/server/src/live-room-routes.ts:312-323` approve,
  steer or stop a verified Hermes run. They are not a Studio intake. The route hook at
  `:92-110` verifies the Cloudflare Access assertion, binds the verified subject, and
  requires same-origin/Command headers on mutating requests. These facts describe existing
  Hermes operations, not an approved new Studio write relay.
- Existing run approvals at `live-room-service.ts:684-709` are typed, run/request-scoped
  Hermes tool approvals. `audit-ledger.ts:21-65` has typed run actions, hashed actor,
  timestamp and hash-chained entries. Neither provides a target Studio project/role,
  directive identity/body hash, or sensitive-action step-up contract for Studio steering.
- Bounded source inspection found no trusted-device sensitive-action confirmation/step-up
  policy or endpoint in the Command auth/run-approval path. Access verification and
  ordinary run approval do not prove that policy. No authentication was exercised.

## Evidence states

- **Source-supported:** generic GitHub discussion scanning and lead wake inputs; planner
  daily issue-body planning; existing Hermes-only Command routes and run-scoped approval/audit.
- **Runtime-observed:** none. No running Studio/Command status or process state was read.
- **Unreachable/not established:** no existing Studio write relay or directive readback
  was found in the inspected source/docs. No network reachability probe was made.
- **Not attempted:** directive, dispatch, API mutation, authentication exercise, model run,
  browser, test project/dry-run intake, service/process operation and physical-device check.
- Source/release identifiers above are provenance metadata only; this report does not claim
  build, independent source review, merge, deployment, authenticated readback or device
  acceptance.

## Packet-ready prerequisite

Before Command exposes steering, Studio must provide a documented, authoritative owner-input
intake consumed by both `lead` and `planner` within their existing 07:00–17:00 ET work window,
plus directive-scoped readback that distinguishes Sent, Seen and Acted/Acknowledged without
claiming mid-turn interruption. A separately authorized Command/Dell integration must then
provide a narrow authenticated POST-only relay to that intake, with no Studio/GitHub write
credentials on VM113; strict schema and allowlisted `lead`/`planner` targets and project IDs;
UTF-8 text capped at 2 KiB, request bounds and per-actor rate limit; stable idempotency key
and duplicate-safe unknown-outcome readback with no automatic retry; durable audit of actor,
target, time and text hash; and an explicit confirmation/step-up that displays the exact
target and text. The directive must remain advisory and cannot grant permissions, alter
quota/pause state, merge, deploy or spend. No timer, idle polling or extra model wake is
part of this prerequisite. Until those contracts are independently accepted, keep steering
plainly unavailable with no disabled fake form or fabricated receipt.
