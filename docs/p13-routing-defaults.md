# P13 durable defaults and frozen admission contract

Backend source and synthetic proof only. No selector UI, release, browser/live
readback, actual provider execution or phone acceptance is supplied by this slice.
Prior #144 acceptance/evidence remains preserved. Current #152
[compatible-reader bridge and release sequence](p13-compatible-reader-bridge.md)
disables NEW default/frozen-admission writes in source while retaining read/recovery.
The writer behavior described below requires a later reviewed source activation.

## Narrow protected operations

`POST /api/live/routing-defaults/read` accepts exactly one target:

```json
{"scope":"thread","sessionId":"jc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","projectId":null}
```

or `{ "scope": "project", "projectId": "room_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }`.
Thread targets require an explicit nullable `projectId`: null means unscoped;
a supplied project must currently contain the exact unarchived thread. The
preference belongs to the actor/session and follows that same verified session
between valid contexts. Project preferences belong to the actor/project and never
apply without an explicit project context. No project is inferred from a title,
bootstrap position, browser hint or preference saved elsewhere.

`POST /api/live/routing-defaults/set` accepts exactly:

```json
{
  "target": {"scope":"thread","sessionId":"jc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","projectId":null},
  "expectedRevision":0,
  "clientRequestId":"c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e",
  "selection":{"provider":"openai-codex","model":"gpt-6-luna","reasoningEffort":"low"}
}
```

These examples are synthetic and do not authorize execution or provider enablement.
A null selection clears the preference and increments its revision. Revision0/null
means no previous preference. Responses are strict `{target, revision, selection,
replayed, writesAvailable}` and no-store; missing `writesAvailable` means false.
Availability comes from the source write guard, not a Hermes capability; reads
return requested configuration, not current eligibility
or executed evidence. Read is a POST to carry a bounded typed target, like the existing
reaction read; it writes no preference, marker, project, message or run.

Both operations retain the existing Access identity, origin/JSON/header, readiness
and rate guards. Actor is derived server-side and hashed; callers cannot supply it.
Exact canonical Command ownership and current non-archived room/thread membership
are checked before preferences are exposed or changed. Project-target validation
also verifies its linked sessions. Deleted, external, mismatched, inaccessible or
unknown targets fail closed. No history is needed. Set eligibility requires the
current strict model options plus advertised/authenticated/eligible/selectable catalog
facts and supported exact effort. PR118 free/provider-default rules remain unchanged;
paid/lookalike/removed routes and invented effort fail. No flags are enabled.

Writes are revision compare-and-swap. Same actor/UUID and exact envelope returns the
original operation receipt without reapplying it, even after later edits. A different
target, revision or payload with that UUID conflicts409. Stale revisions conflict409.
Clearing an unavailable route remains possible when its target is still authorized.
A replay still requires current target access; read again for the current revision.

## Explicit admission mode and precedence

Only a new explicit run using the existing `POST /api/live/runs` may opt in:

```json
{"sessionId":"jc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","input":"SYNTHETIC prompt","clientRequestId":"c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e","routing":{"mode":"defaults","projectId":null}}
```

Resolution is explicit prompt `inference` → actor/thread preference → actor/project
preference (only with verified project context) → the currently eligible Command
default. A cleared preference falls through. An unavailable chosen preference does
**not** fall through. The Command default currently supplies provider/model only:
a supported provider-default-effort route can be pinned without inventing effort;
Codex/xAI defaults lacking an explicit effort fail unavailable, rather than choosing
an effort or silently using Inherit. Inventory/capability errors fail closed. Every
opt-in forwards an explicit override through the existing Command client/proxy
`require_model_lock`/no-fallback path; that control is not changed here.

Omitting `routing` preserves the legacy request/retry semantics byte-for-byte:
preferences are not applied retroactively, including to accepted or pending old runs.
Do not add/remove routing or replace inference on a retry. The caller must retain and
resubmit its original request envelope/clientRequestId. Changed payload, images,
session, project or mode conflicts instead of reinterpreting an uncertain admission.

## Durable freeze and recovery

The existing private append-only hash-chained audit ledger stores preference changes,
revision/UUID receipts and the new run's frozen requested inference/provenance in its
single durable `run.requested` append **before** upstream admission. The frozen record
contains an original envelope hash, provider/model/effort, winning source, explicit
project context and observed thread/project revisions. No raw prompt, credential,
image bytes or fabricated execution receipt is added. Existing image references and
reaction send claims retain their original envelope fingerprint and frozen context.

Retry/restart uses that frozen tuple despite subsequent preference edits. Pending
recovery revalidates current ownership/membership and current eligibility, with the
same upstream `jc-v1-…` idempotency key and existing 23-hour safety window. A removed
frozen route is refused; it is never re-resolved or sent through a fallback. Already
admitted retries recover the existing run/status without another admission or a new
inventory dependency. Request lookup and executed receipts keep their existing
actor/run/session boundaries; no historical answer/run association is introduced.

The existing keyed request/session guards prevent duplicate concurrent admission.
Preference UUIDs also serialize against run/compaction claims in that actor's request
namespace. The room store's read-only transaction lock holds current membership
through the bounded final inventory check and upstream admission; room writes wait
and metadata is not rewritten. Preference commits use the same scope lock. This
preserves upstream errors/lost ACKs for existing recovery rather than manufacturing
success. No second coordinator or session store is introduced.

Storage retains the existing 0600 file/0700 private parent, hash chain, integrity
checks, sync-before-return, single app writer and 16MiB total ledger bound. At most
4096 preference mutations are retained globally, including clears and replay claims;
there is no eviction that could forget an old UUID. Malformed/tampered/unavailable
storage fails closed. Existing entries are neither rewritten nor reset.

**Release/rollback prerequisite:** the new reader accepts pre-change ledgers, but
older strict binaries reject the new action/optional fields. Lead must retain a
rollback binary that understands this format before admitting writes. Never trim,
reset or restore an old ledger over newer admissions to make an old reader start;
that would lose frozen identities and risk duplicate execution. No worker release,
service operation or rollback is performed here.

## Evidence and remaining acceptance

146 scoped server tests passed across defaults, audit, service, reactions, room
storage, routes and synthetic integration; 53 scoped contracts tests passed. These
cover identity/scope/revision/UUID isolation, precedence/clear/unavailable behavior,
concurrent edits, scope locking, the 4096-event bound/no eviction, complete audit
dedupe projection, fresh route removal, lost ACK/restart with edited
defaults, images/reaction claims and old persisted recovery. The checked-in
`routing-legacy-f37537d.jsonl` fixture was produced by the pre-change f37537d audit
writer; accepted and pending-prefix replay preserve its original bytes/hashes.
Server/contracts typechecks, scoped lint and server build pass. No whole-suite or
browser certification is claimed; unchanged accepted checks are reused.

UI preference controls and resolution presentation remain a later serialized slice.
For Codex/xAI Command-default completion, the precise missing schema fact is a
verified default effort: the existing `/api/live/model-options.default` contains only
provider/model. Command's contract/proxy owner (`KumarG23/jarvis-command`) must expose
a supported authenticated/approved full default tuple, with explicit source, only
when the installed Hermes contract can prove it. Otherwise its exact Hermes source
repository/version needs a separately admitted source prerequisite; no default effort
is guessed. The tuple must use the same frozen envelope, current eligibility, UUID
and model-lock/no-fallback path, with same-run requested/executed receipt proof.
Explicit prompt/thread/project tuples work without inventing this missing fact.

Installed exact requested/executed full-tuple proof, including the known requested
minimal versus wire-low discrepancy, needs its existing separately admitted
Command/Hermes contract repair/proof. Provider advertisement/authentication is not
execution evidence. Native delegation independently requires a supported authorized
immutable thread/persona↔session binding and attributable same-run receipt; no endpoint
or binding is guessed. Lead owns exact-head review, compatible rollback/release and
subsequent live admission. Whole P13 is incomplete; phone check pending.
