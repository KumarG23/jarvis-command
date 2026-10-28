# Jarvis Command — current status

Plan of record: [MASTER_PLAN.md](../MASTER_PLAN.md) on `release/gpt6-sol-luna`.

P1–P4 and P4.5 are live. Requested/executed route distinctions, honest usage,
chat recovery/drafts, responsive shell, reliable artifacts and project context
are delivered. P5 Agents and P7 Rooms remain Unsupported—deferred with honest
unavailable UI. P6 inbox source is reviewed/merged (#46/#51, PRs #50/#53/#55),
but its live attempt was rolled back. Startup-wiring repair #57 and disabled
Web Push #56 remain with active Sol-dev; P8 final acceptance/Neal packet is pending.

Current live source: `42ef5c8d9184c801fb04919101a551a3e27e57ae` (PR #54).
Healthy app: `sha256:1f1e2c9cd504b0059712f9a647f5166ae42acb69d072e2adc34c945b56e50750`;
its retained rollback receipt is `release-app-1793213040097289455`.
Both proxies are unchanged. Use `/home/studio/COMMAND_PROJECT_OPERATIONS.md`.
[Short-navigation live acceptance](https://github.com/KumarG23/jarvis-command/issues/52#issuecomment-6477626307).

P6 attempted source `98a1b3db20a8515bfc034cc9b86bd8586d483aa2` built and deployed
as app `74fff65e…`, then rolled back via `release-app-1793213852377815867`.
One owned run completed with one admission/notification; reconcile returned 500
because registration captured the service before startup initialized it.
[Failure and rollback](https://github.com/KumarG23/jarvis-command/pull/50#issuecomment-6478000754);
#57 resumes the existing owned proof without another inference. No full P6 live
acceptance, inbox restart/read-state/preferences proof or physical-phone claim.

P4: images render through the existing authenticated resource route; PDFs show
an explicit download-only state; HTML/SVG remain sandboxed and oversized preview
failures are honest. Saved text retains indentation, Unicode and final newlines.
Immutable v1/v2 and all uploaded checksums survive app restart. Accepted lost-ACK
save recovery proof was reused without replaying mutations.

P4.5: project create/rename/archive/restore, standing instructions, chats and P4
references work live. One owned send included instructions exactly once; after
reload/restart its canonical history has one user message and one answer. Project
metadata, saved response and reference bytes persist. Desktop 1280×720,
320/360/390/430 px and short-height emulation pass. Physical Android is **phone
check pending**; device steps are on the review queue.

Known limits: historical message/run receipts, native profiles/Bot/group driver,
delegation detail, non-image reference transport, automatic arbitrary tool-output
capture and cross-surface notifications remain unproven/deferred. Latest-session
receipts stay separate from historical answers. Artifact association-policy
tightening and PDF preview enablement remain deferred; full wrong-session
rejection is not claimed. No auth/Access, credential, network, provider or paid-route
control changed. Production push remains disabled. #56 builds/tests the full push
path with ephemeral local keys and captured transport, and includes the #57 lazy
startup repair/regression. Production VAPID/approved egress/enablement are deferred
to the Final Neal packet ([details](web-push.md)); Sol owns exact-head review and
repaired release/live proof. Merged inbox source prevents pruned approval replay
with bounded exact receipts (1,024 per actor); capacity/legacy gaps make new
approval notifications explicitly unavailable. It reports incomplete delivery
for first-use, retention and bounded recovery gaps; this source is currently
rolled back.

[Neal review queue #20](https://github.com/KumarG23/jarvis-command/issues/20) holds
phone steps and deferred contracts; the Final Neal packet is due at P8. Older M0
issues #2/#6/#9 are closed as superseded or partial/deferred, preserving history.
