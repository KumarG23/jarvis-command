# P9.6 source candidate — delete projects

Project-only deletion is prepared behind `PROJECT_DELETION_MODE=enabled`; the
server default is **disabled**. No deployment, live flag enablement, production
project deletion, Hermes operation or provider call is part of this delivery.
All writes and deletion proofs use disposable fixture stores.

## Supported behavior

- Project list and details actions open a named confirmation with fresh linked-chat
  and artifact counts. Cancel receives focus; Tab remains inside the dialog and
  Escape cancels. Disabled servers explain unavailability. Repeated explicit
  deletion works without reloading.
- The POST body repeats the exact room id and `project-only` choice plus a digest
  of the confirmed project metadata/membership and sorted artifact ids. The
  existing Access identity, origin and mutation-header protections run afresh.
  A stale digest, different target or unsupported contents mode cannot commit.
- The existing service admission set is reserved synchronously across linked
  sessions. Active ledger runs (including unknown upstream admission) and
  concurrent send/compaction/session deletion block removal. Fresh session
  identities are checked through the supported client. This observes Command
  admissions; it does not claim discovery of arbitrary native/external runs.
- A private, retained `.project-rooms-snapshot-<room-id>-<random>.json` preimage is
  file-synced and directory-synced before the atomic project-store replacement.
  Snapshot failure prevents deletion. The existing private-directory/file
  identity checks and uncertain-commit poisoning remain.
- Deletion commits the removed room and its tombstone in one project-store
  replacement. The tombstone detaches retained artifact scopes at the API
  boundary, without modifying artifact bytes, versions or source identities.
  Original stored project ids remain recovery references, not effective links.
  Deleted-project queries return no artifacts; ordinary lists/metadata return
  standalone artifacts with `projectId: null`. Downloads are never rewritten.
  No artifact count is asserted when its store cannot be inspected; deletion is
  unavailable in that state.
- The hash-chained ledger records requested/completed project deletion using the
  hashed actor and exact room id as its `sessionId` scope identifier; run ids and
  content fields are absent. This reuses the immutable ledger rather than making
  another audit store. A crash may leave only a requested event; the authoritative
  project tombstone resolves whether the metadata commit landed.
- Repeated deletion of a tombstoned project is a clean no-op. Unknown ids remain
  missing. Readback clears selected project/artifact scope, pending attachment
  hints and stale edit/thread state while retaining the selected chat. A late
  attachment cannot report success after its project disappears.
- Lost acknowledgements always trigger authoritative project readback, never a
  second POST. Failed readback leaves only a read-again action and Cancel.

Snapshots are retained for lead-controlled recovery, not automatically restored
or garbage-collected. A whole-store preimage includes other projects as of that
instant; restoring it requires preserving subsequent unrelated changes. No live
restore operation or new recovery coordinator is introduced here. After approved future enablement, rollback must understand both
`deletedRoomIds` and the new project audit actions; older binaries reject these
records and must not write the store. With production deletion disabled this PR
creates no production tombstones or deletion audit events.

## Unsupported — deferred for Final Neal packet

**Delete project and its chats/artifacts** is visibly unavailable. Current public
Command/Hermes contracts provide session deletion but do not establish retained
session snapshot/restore preserving identity/history. Artifact deletion uses
transient trash, not retained recovery. There is no proven cross-store restore
contract for the optional contents choice. No endpoint, guarantee or coordinator
has been invented; no additional capability queue is needed.

## Verification

Focused server tests exercise default-disabled configuration, no preconfirmation
writes, forged/stale/unauthorized requests, unsupported contents, external unlink
only, exact counts, artifact/session survival, active/admitting runs, both
concurrent-send directions, late attachment, idempotency, retained snapshot
failure and restart/legacy-store consistency. UI tests cover Cancel focus,
disabled choices, current/pending cleanup and lost-ACK/readback failure without
resubmission. Existing session/artifact protections are regression checked.

Passing source checks: 22 config/deletion checks on the final service/store
source (including reopened ledger/service), 94 unchanged store/room/session/
artifact regressions reused from their successful focused runs; 30 final
ProjectRooms component checks plus 42 unchanged thread-entry/input checks; 16
project contract checks. Repository typecheck/lint and full production build
pass, with the existing web bundle-size advisory. Final web/server builds also
pass after the focus repair.

Four final candidate browser cases pass at 1280×720, 1280×360, 360×740 and
360×360. Each checks both entry targets (≥44 px), exact fixture counts, disabled
contents/server choices, Cancel focus/Tab trap/Escape/return, trial-click and
viewport reachability, selected-project deletion with the same chat and unsent
draft, lost ACK with exactly one POST, pending cleanup, repeated deletion without
reload, and reload persistence. Screenshots: [desktop](issue-100/SYNTHETIC-delete-1280-720.png),
[short desktop](issue-100/SYNTHETIC-delete-1280-360.png),
[360 px](issue-100/SYNTHETIC-delete-360-740.png),
[short 360 px](issue-100/SYNTHETIC-delete-360-360.png).

Browser runs
must use Studio's configured existing-browser wrapper, task command#issue-100,
own worktree and isolated contexts. Offline API fixtures are not authenticated
production readback. Physical Android: **phone check pending**. Device checklist:
open project deletion with keyboard visible, verify counts/options, Cancel/back
and focus return, then verify repeated removal/current selection only after
separate lead authorization for enablement and an owned disposable project.

Independent lead review of the exact authorization/destructive/audit diff is
required before merge. Sol owns merge, recoverable release/rollback and live
acceptance; workers do not enable this feature or perform live deletions.

## Factory binding repair (PR #107 first review)

The original source froze bootstrap's lazy `liveRoom` getter while spreading
route dependencies before `onReady`. The three existing production-factory
regression files reproduced all five 503 failures from CI 42263113136.
Live routes now receive the original dependency object unchanged and the
resolved artifact store as a separate argument, preserving lazy lookup for all
service dependencies. Factory tests and assertions were not modified for this
repair. All five factory cases and five project-deletion cases pass together.

Synced the accepted release base through #106 (`6bf2584`) by ordinary merge,
retaining the original branch commits. No worker edits to inference/provider
or plan files. Reuse the unchanged successful deletion/UI/browser evidence above;
this server wiring repair adds no new browser or live-readback claim. Repository
typecheck/lint and affected server build are checked for the repaired source.
Hosted CI and independent exact-head review remain separate merge gates.
