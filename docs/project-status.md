# Jarvis Command — current engineering status

Updated: 2026-09-05 (Eastern).

## Goal and shipped state

The v1.0 goal is a complete project-work loop on phone and desktop: converse, inspect context, supervise agents, approve a consequential step, review an artifact or diff, verify the outcome, and promote the durable result without retreating to Discord or a terminal.

Production remains the independently approved read-only v0.1. The protected web client and Android TWA are shipped; the v0.2 write-capable candidate is not deployed or release-approved.

## v0.2 Live Room progress

- Local session history/creation, message submission, typed progress, approve-once/deny, stop, steer, and bounded reconnection/reload recovery are implemented. The earlier complete local UI+BFF checkpoint received independent Sol approval; subsequent deployment changes invalidate that approval for the current candidate.
- Compiled desktop/mobile PWA flows exercised the actual BFF/HTTP clients/proxies against an explicitly synthetic upstream. This is not live-Hermes or production acceptance.
- Image packaging, restricted bridge/egress fixtures, durable audit admission, and lifecycle/hardening checks have substantial isolated runtime evidence.
- The supervised-runtime checkpoint passed 608 automated tests plus 11 Python tests and the additional runtime/browser gates. Complete independent Sol/high review covered all 209 frozen paths and returned APPROVE. Jarvis verified the exact staged/committed bytes and pushed `d5c4f4b` to `feat/v0.2-live-room`. That local checkpoint is not release approval; the later container-chain fixture amendments require fresh complete-candidate review.

## Startup blocker resolved locally — 2026-09-05

The 04:24 Eastern worker stopped because Docker reported HostConfig.OomKillDisable=false after CREATE and null after START. A fresh implementation traced this to the installed Moby source: CREATE defaults the pointer to false; START clears it when disabling the OOM killer is unsupported on cgroup v2.

The supervisor still requires literal false before START. A post-START explicit null is accepted only after a fresh same-daemon query proves exact Linux, cgroup v2, and unsupported OOM-killer disabling. Missing, true, malformed and unqualified values still refuse. An asserting RED regression preceded the minimal repair; other container checks remain intact.

Both worker and parent executed the actual source-bound app under the real supervisor and systemd notification: readiness, missing/invalid JWT denial with zero upstream mutations, durable admission, SIGKILL and replacement replay with the same public run ID and ledger inode and one total upstream admission, normal cleanup, and damaged/corrupt/missing ledger refusal. Exact disposable containers, unit, PIDs and fixture directory were cleaned up. The bridge was synthetic; this is not containerized both-proxy/browser or production acceptance.

## Next gates, in order

## App-only recovery locally verified — 2026-09-05

Controls checkpoint `1d5d8ea1b08a6a12605f8d1e220a9910fe8d28ed` is independently approved and pushed. Parent corrected an overclaimed initial review by verifying the same reviewer's remaining raw-source reads; all 220 paths and 47 chunks were actually inspected before accepting the cumulative APPROVE. Exact staged/committed bytes matched the approved archive. This is a development checkpoint, not release approval.

Deploy 9 extends only the synthetic deployment harness. Parent executed desktop AND phone app-only SIGKILL/removal/replacement with a new container/PID, unchanged immutable image, identical mounted audit inode/device/owner/mode/content and unchanged proxy/upstream identities. Browser recovered the same public/session/request identity and queued steer; controls and writer stayed locked before authoritative rebind. Invalid authentication and wrong Origin on the recovered app refused with zero upstream mutations. Explicit stop and terminal draft recovery completed without duplicate admission. Six admissions and 38 audit records were verified; all six exact containers, fixture paths and network-namespace descendants were removed. Evidence: `deploy-9-app-recovery/parent-runtime-2/` and parent audit scripts.

The worker's initial runtime missed actual empty HTTP 502 transport evidence during deliberate app death; its asserting regression fixed the recorder without fabricating a body. Parent then reproduced Docker's unordered Mounts inspection: only order varied in raw records. A RED/GREEN regression now compares complete mount objects keyed by unique destination, rejecting duplicate destinations and every changed field; no storage/security normalization was introduced. The actual guarded expression is exercised from trusted local AST, not user input.

Current Deploy 9 amendments are NOT independently approved or committed. Final full gates and fresh complete-candidate review remain required. Pending approval-at-death is not claimed: selected recovery slice is post-approval queued steer. Callback failure tests prove ordering/retained ownership, not full create-in-flight/host-reboot failure acceptance. Production app/proxy code and ledger handling are unchanged. Transactional installer/recovery and trusted backup-root hardening remain next; production, live-Hermes and physical-Pixel acceptance remain separate.

Earlier reports below are historical; the current checkpoint above supersedes their active-work language.

## Resumed controls checkpoint — 2026-09-05

Neal explicitly resumed ongoing integration work after a usage reset became available. Parent revalidated the complete saved 220-path snapshot, immutable image-source bindings, four controls cases, six admissions and 38 audit records, bounded transport evidence and exact four-container/namespace cleanup. Final suite contains 618 automated tests plus the Python and browser gates below. New complete-candidate independent review is pending; no production cutover.
Parent completed the remaining gate-error preservation and bounded held-status fixes with asserting RED/GREEN, then successfully executed desktop and phone-emulated approval-once/deny, queued steer, stop confirmation, same-tab reload/rebind and draft recovery through the immutable app and both proxies. Runtime evidence: `deploy-8-parent-controls/runtime-1/` (successful runtime, lifecycle, payload, audit and cleanup receipts).

Full final gates passed: automated suite, supervisor/owned-process/cross-UID gate/root-storage tests, typecheck, lint, build, dependency audit (zero vulnerabilities), 17 standard browser tests (one skip), six signed-source chain tests and e2e typecheck. Evidence: `deploy-8-parent-controls/final-gates/`. Raw secret scan still flags five exact unchanged synthetic fixtures matching the prior checkpoint; no new suppressions. The initial full run exposed a wall-clock-dependent replay test: fixed ledger time had aged outside the real clock's retention horizon. Parent fixed only the test's injected clock; production retention enforcement is unchanged.

Current code is UNREVIEWED WIP, not committed or released. Last approved/pushed checkpoint remains `94bc5946e60acfaeaecdc1d890d44b025c820ea4`. Pause archive and exact manifest are under `PAUSED-CONTROLS-CHECKPOINT/` in the evidence root. Next on explicit resume: verify snapshot, complete parent payload/cleanup evidence audit, then independent full-candidate Sol/high review; only exact APPROVE permits the code checkpoint. App-container restart, transactional installation/trusted backup-root hardening and separately authorized live acceptance remain pending. Production is unchanged.

Earlier attempt reports below are historical and superseded by this pause checkpoint.


### Deploy 8 bounded implementation attempt

Deploy 8 controls repair is a smaller **unreviewed partial**, not controls acceptance.
The repair adds a Linux per-command subreaper with pidfd-validated child signalling,
progressive stdout/stderr evidence, and descendant reaping. Asserting RED/GREEN
exercised normal exit, ordinary failure, timeout, and cancellation with a real
grandchild and an unrelated sentinel. Browser diagnostic/close stages now have
independent deadlines; request failures are recorded synchronously rather than
awaiting response retrieval, and original assertions are recorded before cleanup.

The real cross-UID gate reproduction confirmed inherited umask 0077 creates a
root-owned 0600 gate despite Node's requested 0644, denying synthetic UID 10004.
The repair uses atomic rename and explicit synthetic ownership/0600 without
broadening private directories. Final focused/lint/type results and exact source
binding are in `deploy-8-controls-repair/IMPLEMENTATION-RESULT.json`.
No new container runtime was launched: held-status disconnect/deadline behavior
still needs asserting RED/GREEN before a privileged retry. Full browser controls,
transport classification/count bounds and audit acceptance remain unverified.
The subprocess helper and its integration still require independent review;
no claim covers forced supervisor death or hostile endless-fork containment.
App restart and installation remain untouched. No production changes, vault edits,
commit, push, or release approval occurred in this repair.

The exact `94bc5946e60acfaeaecdc1d890d44b025c820ea4` container-chain checkpoint
received complete independent Sol/high APPROVE; the continuation receipt is at
`container-chain-checkpoint/continuation-1/SOL-REVIEW.json`. The new Deploy 8
worktree amendments are **unreviewed and incomplete**, with no commit or push.
Production remains read-only v0.1; application/proxy sources are unchanged.

Asserting RED/GREEN covered explicit non-assert execution preflight (including
optimized refusal/read-only default) and independent persisted synthetic approval,
queued steer, and nonterminal stop state. A new real-container browser scenario
attempts once/deny, same-tab recovery and explicit cancellation. Runtime-1 timed
out after 110 seconds: desktop basic and once-approval screenshots exist, but
controls/recovery acceptance is NOT established. The fixture removed its four
exact containers and storage; the parent browser runner timeout left namespace
descendants, which required exact-network-namespace cleanup recorded separately.
Do not count the fixture's container-only cleanup receipt as browser cleanup.

Evidence: `deploy-8-container-controls/IMPLEMENTATION-RESULT.json` and `runtime-1/`
under the evidence root. Resume by diagnosing the timeout, testing bounded gate
lifecycle/permissions and browser-descendant cleanup, then rerun desktop/phone
controls. App-container restart/replacement is not implemented. Continue remaining
recovery, then transactional installation and trusted backup-root hardening; no
production cutover. Plain live-turn/clipped-selector polish debt remains.

Deploy 7's containerized desktop/phone tracer now passes twice consecutively
(`deploy-7-container-chain-repair/runtime-2` and `runtime-3`). The synthetic upstream
previously reused one run ID, correctly triggering the production ledger's identity
rebinding guard on the second admission. Fixture-only RED/GREEN regressions now
cover distinct admissions, persisted same-key replay, conflicting payload refusal,
unknown IDs and method restrictions. The ledger enforcement is unchanged.

The existing TLS transport now retains bounded actual request/response bytes;
browser-reader disposal cannot silently erase privacy evidence. Admissions bind
the submitted request to captured response, authoritative run/session status and
the durable audit's client/public/upstream identity mapping. Both browser paths
verify active PWA/history, 24 identity/Origin denials and eight proxy-key denials,
one upstream admission, typed tool event, one final answer, and screenshots.
Known ERR_ABORTED is accepted only with exact method/URL, HTTP 200, retained payload
and verified terminal outcome. A failed desktop refuses a cascading phone admission.

Jarvis independently reran the exact executable candidate: both containerized
browser paths passed again with audit identity binding and cleanup. Parent gates
passed 613 automated tests, 11 Python tests, types, lint, build, zero-vulnerability
production dependency audit, 17 standard browser tests (one skip), six signed
local-source browser-chain tests, and explicit e2e typecheck. The source scanner
still reports five exact unchanged synthetic fixtures from the approved archive;
all other security checks pass, with no new suppressions. All 16 exact containers
from the three worker attempts and parent run, recorded PIDs, and fixture roots
were verified absent. The first repair attempt failed an incorrect harness assertion
that status exposes clientRequestId; admission and audit contracts provide that binding.
The parent verified the worker model/session and all 213 source paths/archive/modes;
only this status document was then reconciled. Fresh complete-candidate independent
review is the next checkpoint gate. Production and application/proxy sources are unchanged.
This is synthetic network-none/TLS integration, not SSH, host-egress, supervisor,
real Cloudflare login or release acceptance. UI polish debt remains: live-turn content
is plain stacked text compared with styled history, and the phone session selector
clips its label without an ellipsis. Both screenshots remain readable without page
overflow; neither is a real-device usability sign-off. No redesign in this slice.

Next: parent verification/review, control/recovery integration, then transactional
installation. Keep transactional recovery and backup-root hardening separate:
`cutover-app.sh:196-210` and `install-android-association.sh:496-497,553-555`
accept arbitrary absolute backup roots whose existing directory modes may change;
the shipped orchestrators fix `/var/backups/jarvis-command`.

1. Freeze the complete tracked/untracked container-chain checkpoint and obtain fresh independent Sol review before committing/pushing its code. Review approval is not production-cutover permission.
2. Complete containerized browser/both-proxy integration and transactional installation/recovery procedures. Preserve the read-only production path; subsequent code amendments require new exact-candidate review.
3. Complete authorized production cutover, desktop/Pixel human-path acceptance, negative authorization, restart/reboot and rollback proof before declaring v0.2 shipped.

External Continue in Command remains unavailable because the installed upstream fork API mutates the source session. Uncertain pre-acknowledgement admission remains locked for trusted reconciliation rather than risking a duplicate command. Neither gap is silently counted complete.

## Continuity and evidence

- Canonical product/roadmap: Obsidian `05 Coding Projects/Jarvis Command/Jarvis Command.md`.
- Implementation plan: [v0.2 Live Room](plans/2026-09-04-v0.2-live-room.md).
- Local evidence root: `/home/neal/backups/jarvis-command/20260904T210906Z-astra-bff-resume/`.
- Last complete hardening receipt: `deploy-6-hardening/PARENT-VERIFICATION.json` under that evidence root.
- Historical blocked runtime receipt: `deploy-6-runtime/IMPLEMENTATION-RESULT.json`.
- Verified repair and parent runtime evidence: `deploy-6-oom-contract/PARENT-VERIFICATION.json`, `parent-gates.json`, and `parent-live/{runtime-result,cleanup}.json`.
- Historical exact candidate archives and inherited WIP remain preserved. Local evidence paths are not downloadable repository artifacts.

Neal requested frequent repo/vault updates on 2026-09-05. Update this status and vault canon at meaningful verified milestones and material blockers; commit sanitized documentation separately where appropriate. Code checkpoint commits require complete-candidate verification/review, with no implied main merge or deployment. Use Astra/high for implementation and Sol/high for independent review; no silent fallback. Do not replace evidence with chat-only updates or leave stopped workers labeled running.
