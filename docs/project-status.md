# Jarvis Command — current status

Plan of record: [MASTER_PLAN.md](../MASTER_PLAN.md) on `release/gpt6-sol-luna`.

P1–P4 and P4.5 are live. Requested/executed route distinctions, honest usage,
chat recovery/drafts, responsive shell, reliable artifacts and project context
are delivered. P5 Agents and P7 Rooms remain Unsupported—deferred with honest
unavailable UI. P6 inbox is in progress with Sonnet on #46; disabled Web Push and
P8 final acceptance/Neal packet remain pending.

Current reviewed/merged release: `014071e424cf00b4f08e33eb9add918e2565bc2c`
(PR #48, includes reviewed #45/#43/#40/#39). Deployed app:
`sha256:4e3af796d1c9ae1aa33f2b9cfbcaadb7ea2e70f012a9876bb7de0c02b1b9acf2`.
Rollback: `release-app-1793209222163523623`, previous `sha256:d2cf8292…` retained.
Both proxies are unchanged. Use `/home/studio/COMMAND_PROJECT_OPERATIONS.md`.
[Production browser/backend and restart acceptance](https://github.com/KumarG23/jarvis-command/issues/44#issuecomment-6476317648).

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
control changed. Production push remains unavailable pending its disabled-code
increment and separate enablement. P6 first slice (#46): an in-app inbox for app-originated run finished/failed and
approval-needed events is built for review, unreleased.

[Neal review queue #20](https://github.com/KumarG23/jarvis-command/issues/20) holds
phone steps and deferred contracts; the Final Neal packet is due at P8. Older M0
issues #2/#6/#9 are closed as superseded or partial/deferred, preserving history.
