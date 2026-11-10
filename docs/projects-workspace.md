# Project workspace (#41)

Built for review; unreleased. Sol owns isolated live readback and recoverable release.
Phone check pending (desktop/320/360/390/430 px and 360 px height use synthetic APIs).

Project details edits name, goal, standing instructions (4,000 characters), repository
and note references. Archive separates a project from active work without deleting
its chats, files or metadata; restore reopens it. Version-1 registries without the
new optional fields remain readable. Metadata saves require authoritative readback;
failed edits keep the draft in the current tab, including when the panel closes.

Each new project message includes the saved context as labeled ordinary input.
Expand the composer disclosure to inspect it and the complete character count.
A fresh project read checks membership/archive state and context before admission;
changed text requires review and a second explicit send. Oversized input is refused
without truncation. The existing intent captures composed text once; admission
retries reuse it exactly. Reload stores only opaque project/session/request/run IDs
and reconciles read-only. It never rebuilds or resends input from current metadata.
Failed generation Retry is a new admission: it rechecks current membership/archive
and saved context before assigning a new ID. A stale captured prompt stays intact;
review context, cancel and create a new request rather than silently recomposing it.

Project files use P4 storage, immutable version downloads and the existing upload,
preview and response-save panel. Saved file bytes are not automatically delivered
to Hermes. Images require the explicit attachment action and existing image limits.
“In-run delegation detail is not available from this Hermes installation.” This
reuses accepted #35; no new probe, endpoint, global memory or delegated threads.

Sol acceptance remains pending: one owned project chat/context round trip, artifact
readback and recoverable release. Synthetic worker proof does not mark P4.5 Done.

## Internal project metadata recovery (#164)

`ProjectRoomStore.recover(roomId, { basename, sha256 })` is an explicitly invoked,
source-only prerequisite exercised only in disposable fixtures. Supply the exact
room id, retained `.project-rooms-snapshot-<room-id>-<32 lowercase hex>.json`
basename and SHA-256 of its bytes; there is no discovery or latest-snapshot choice.
The bounded strict snapshot must be a private 0600, singly linked, current-owner
regular file in the existing private store directory. Its selected room must exist
in the snapshot and be absent with a matching deletion tombstone in the current
registry. A repeat or current-room conflict returns 409 without overwriting it;
a missing snapshot target returns 404. Unsafe/changed sources fail without commit.

Recovery appends only that recorded metadata/links and removes only its tombstone,
preserving all unrelated current records and tombstones. The retained snapshot is
unchanged. Existing serialization, atomic replacement and uncertain-commit poisoning
apply: after a post-rename failure, use a new store for authoritative readback;
never blindly retry or rewind the whole registry. The audit ledger is untouched.

There is no HTTP, startup, retry, configuration or live operator integration.
Removing the tombstone would also re-expose retained artifact project ids through
the existing API projection; recorded chat links may refer to externally changed
sessions. This fixture proof establishes neither current ownership/authorization
nor session/history/artifact-byte recovery. Public enablement still needs a
lead-approved actor/target authorization, confirmation, audit and admission contract,
verified upstream/retained-content state, recoverable release/rollback and isolated
production/operator readback. Contents deletion/recovery remains unavailable;
P9.6 live recovery, authenticated acceptance and phone acceptance are not proven.
