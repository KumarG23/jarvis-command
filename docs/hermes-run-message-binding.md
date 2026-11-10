# Candidate native Hermes run/message binding

Issue [#166](https://github.com/KumarG23/jarvis-command/issues/166) is the
source prerequisite for P6.1 exact final-answer delivery and P12 exact user-message
targeting under `release/gpt6-sol-luna` MASTER_PLAN §§0.2–0.4, 10, 11 and 12.
It does not complete either product outcome.

Source candidate: [KumarG23/hermes-agent PR #1](https://github.com/KumarG23/hermes-agent/pull/1),
against actual source `main` at `4a3e5c4094d96c2e184dead99bccb4f4aabb2e1b`.
Candidate head: `b5d4529297106a9c8fa6bfe73bf6998445f3ba5a`.
[Raw diff](https://github.com/KumarG23/hermes-agent/pull/1.diff).
Source review is pending; no merge, deployment or runtime activation is claimed.
**Current installed Hermes version/patch/support: UNKNOWN.** Source main is not
production evidence. The older #9 installed-contract finding remains historical
evidence and is not replaced by this candidate.

## Proposed existing-status contract

For a new `/v1/runs` request with explicit string `session_id` and string `input`,
the existing authenticated `GET /v1/runs/{run_id}` can optionally return:

```json
{
  "status": "completed",
  "session_id": "owned-test-session",
  "history_binding": {
    "version": 1,
    "user_message_id": 41,
    "assistant_message_id": 44
  }
}
```

The identities are exactly the native integer `id` values in that session's
existing `GET /api/sessions/{session_id}/messages` response (`data` array).
No UUID, prefix or offset conversion occurs in Hermes. Command must validate its
supported integer range and apply the **same lossless decimal conversion** to
history and binding IDs before its existing public ID projection. No lossy
JavaScript number coercion is acceptable.

The actual newly created user object and finalizer's completed assistant object
are tracked by reference. The existing SessionDB batch writer supplies inserted
row IDs; the agent retains them only after commit. Successful Runs API completion
atomically records the run association on those two existing message rows.
Content/hash checks invalidate already-identified rows; they never find a pair
by text, timestamps, ordering or latest-session receipt. There is no parallel
transcript/run database or new endpoint.

Every status read revalidates the pair. Legacy, absent, ambiguous, conflicting,
cross-session/profile, incomplete, failed, cancelled, uncommitted, tool-tail and
transformed-output evidence remains unbound. Rewrites/retirement invalidate the
pair; fork/import/replace copies do not inherit it. Compression/rotation paths
without preserved exact objects remain unavailable rather than selecting a
replacement row. A transcript or binding commit failure cannot advertise bound
success.

A still-valid committed pair survives agent/API/SessionDB recreation as a minimal
`completed` status with `recovered: true`, run/session IDs, output and binding.
It does not reconstruct usage, model/effort/route receipts, timestamps, events or
active runs. Unknown stays unknown; no latest-session receipt can be attached to
a selected answer. Legacy/incomplete status can become 404 after memory expiry.
GET/reconnect/recovery never admits or replays work. This candidate adds **no POST
deduplication or client-request-key recovery**: lost POST acknowledgements must
not cause blind resends. Existing Command admission/audit recovery remains required.
The small synchronous confirmation uses existing transcript-write patience;
SQLite contention can delay completion, preserving an unsplit cancellation boundary.

## Validation and consumer boundary

Source-only disposable-home fixtures exercise real imported agent prologue,
conversation loop, finalizer, SessionDB and aiohttp handlers with deterministic
local SDK responses. Seventeen new cases plus 35 affected existing tests passed;
Ruff and diff checks passed. Initial exact-ID regressions failed before the
patch; a subsequent real insert-failure regression reproduced `completed` where
`failed` was required and now passes. Tests cover repeated identical turns,
older/newer pairs, exact history IDs, tool/intermediate rejection, missing and
conflicting evidence, cross-session/profile isolation, auth, rollback, cancellation,
repeated reads/flushes/recreation without extra rows or calls, rewrites/rewinds,
native copy/replace and nullable-column reconciliation without backfill.

These are offline candidate proofs, not installed-contract or authenticated
readback evidence. The minimal test venv was not the full lockfile environment;
optional `nemo_relay` was absent and emitted its existing warning. SQLite used
Hermes' existing DELETE-journal safety fallback. No executed-route claim follows.
The external global policy/product-note files were permission-denied; repository
policy, the canonical release plan, issue/history and Hermes AGENTS were read.

Command behavior is unchanged: `UpstreamRunStatusSchema`/`projectRunStatus` do not
project this candidate, the BFF does not supply `historyBinding`, and
`REPLY_EVIDENCE_SOURCE` remains undefined. Follow-on implementation must separately
validate version/IDs/status/session against the existing actor-scoped public-run
mapping, reuse the existing history/public-ID conversion, reject mismatches, and
retain immutable audit and retry/reconnect dedupe. P6.1 may then consume only that
run's exact final assistant ID; P12 Phase 2 may target only its exact user ID.
Neither consumer may infer a binding or treat requested model/effort as execution
proof. Push/reaction enablement and prompt markers remain separate lead decisions.

## Exact next owner action

1. Lead reviews the source PR's exact head, especially commit timing, identity
   conversion, profile/session scope, cancellation, SQLite failure and rewrite
   paths. No Hermes merge/release gate is registered for this worker assignment;
   any upstream merge must be separately assigned to the source owner.
2. Runtime owner identifies the installed commit and applied patches through
   existing authorized access, checks compatibility against the accepted source,
   and prepares a pinned recoverable deployment with retained prior code/artifact,
   state snapshot and rollback. Only that owner may deploy/drain/restart using the
   existing path. Rollback must preserve canonical messages accepted since the
   snapshot; do not overwrite current state with a stale database or drop rows.
   This source-only PR grants no runtime operation or control change.
3. After reviewed deployment, the authorized owner uses isolated owned test
   sessions, existing approved routes/quotas and the existing restricted API path
   to prove two identical-text turns resolve to distinct exact history pairs,
   an older pair survives a newer turn, and repeated GET plus supported restart
   recovery appends no messages and admits no runs. Check missing/retired/foreign evidence fails
   closed and record exact deployed version/patch and sanitized contract evidence.
   Retain the original run IDs; never blindly retry an uncertain POST.
4. Only after that proof, separately review and implement the proxy/BFF projection
   and each consumer. Any actual auth/access/credential/network/provider/spend or
   live-runtime boundary goes to the lead/runtime owner. No source, reviewed,
   merged, deployed, authenticated or physical-phone state substitutes for another.

No browser, live, candidate-UI or phone acceptance is claimed here.
