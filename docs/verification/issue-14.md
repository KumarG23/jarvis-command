# Issue #14 — desktop recovery slice

Authority: current superseding directive at #2 and assigned feature slice #14. Branch `team/command/issue-14`, based on `release/gpt6-sol-luna` at `9f48fe9`. Full blueprint and kickoff read on `origin/docs/jarvis-command-v2-plan`; this implements ordinary conversation/recovery and truthful activity requirements (§§4A, 5–6, 12). PR #3 remains unmerged/parent-owned, #4/#5 and discovery work are untouched. Repository AGENTS.md read; the host denied reads of `/home/neal/AGENTS.md` and the canonical vault product note. No architecture expansion or policy bypass.

## Candidate behavior

- Reload with an opaque session/request identity but no acknowledged public run ID now performs one authenticated GET of `/api/live/sessions/:sessionId/run-requests/:clientRequestId`. It resolves only the same actor's exact request/session from verified audit storage. No upstream call, message content, upstream identifier or mutation is involved.
- A known durable admission resumes by exact run-status GET. Missing, pending, unauthorized, corrupt or unavailable evidence leaves the writer locked. “Check admission status” explicitly repeats only the read. A ledger row without a durable upstream binding is unknown even if Hermes may have admitted work.
- Reload/disconnect marks activity incomplete; observed zero events cannot masquerade as proof that no tools ran. Receipt transport counters explicitly describe this tab, not lifetime execution counts.
- Without a supported exact message binding, recovered run output stays in a separate collapsed disclosure. Canonical saved messages render once by ID. No inferred historical join or selected-answer receipt was introduced. Existing latest-session receipts remain separate.

Risk: disclosing another actor/session's admission, admitting twice during recovery, or presenting missing activity as zero. Focused actor/session, immutable-storage, no-write and missing-evidence regression checks cover these paths; Sol still reviews the exact PR head before any merge/release. Runtime auth, credentials, network, providers, paid-route controls and audit storage format are unchanged.

## Focused validation

Failing regressions were observed before implementation: missing request lookup, lost-ACK reload remaining locked despite known admission, and missing activity presented as no activity.

- Web recovery/live turn/history/timeline/receipt: 202 tests passed; subsequent lookup cancellation/storage-replacement additions: recovery file 50 passed (48 previously, two added). Reused the unchanged passing tests.
- Server service/routes/integration: 55 passed, including actor/session isolation, restart/reopen, pending upstream admission, corrupted storage, strict params/query and authenticated lookup.
- Repository typecheck, lint and production build passed. Build is local source validation, not a published artifact.
- `npx playwright test -c e2e/turn-recovery.config.ts`: one desktop test passed. Synthetic backend admits once, drops ACK, then serves GET-only recovery, a second mid-run reload, canonical tool/answer and completion. One POST total; one answer article; recovery identity clears only after verified completion. 1280×720 and 390×844 had no document overflow. The new test is included in the existing unprivileged PR CI script.
- [Candidate desktop](issue-14/candidate-desktop-synthetic.png) and [narrow viewport](issue-14/candidate-narrow-synthetic.png) use visibly labeled synthetic fixtures. Neither is real inference or physical Android acceptance.

## Actual authorized desktop + backend readback

The installed browser helper was inspected before use and its current dedicated CDP listener discovered. Used a new owned tab; existing tabs, GUI slots and services were preserved. One fresh Command-owned session and one real task were created through the actual desktop UI at 1280×800, using inherited routing. No second inference, resend or retries.

- Session `jc_f12d26d280cc4d39b3fd71b48afb82b5`; request `55c5c427-cd43-4810-96dd-4c689ad5ad75`; public run `jcr_490e7bd18ba35e754da9bfb3a8629ce2`.
- UI task requested one read-only terminal calculation, `python3 -c "print(17 * 23)"`, with no files/services/delegation. One POST returned queued, not replayed. Exact public status later returned completed with output `COMMAND_14_PROOF 391`.
- Canonical history in that isolated session contained user `453921`, empty assistant activity `453922`, terminal result `453923` (`391`, exit 0), final answer `453924` and setup record `453925`. One user message, one tool result, one nonempty final answer; no duplicate canonical messages. This is same-task evidence, not a newly supported historical message/run join.
- Actual DOM showed the saved terminal disclosure/result and one final answer. Post-completion reload sent zero run POSTs and rendered one answer. [Sanitized owned readback](issue-14/live-baseline.json); [inspected live desktop crop](issue-14/live-baseline-desktop.png). The crop excludes unrelated navigation/private chats.
- Returned receipt: 33,821 input / 41 output / 33,862 total; 2 API calls; 0 reasoning; 16,768 cache read; 0 cache write. Context is separately 16,940 / 500,000. Executed `openai-codex/gpt-6.1-sol`, medium, wire-attributed effort; requested overrides null, route source unknown, exact false. No route lock or cost inferred. Status `updatedAt` is not asserted to be completion time.

This live evidence is for the **existing deployed baseline**, version `0.2.0`, not this candidate. It proves an owned real task plus saved tool activity and completed reload. It does not prove candidate live recovery, live lost-ACK handling, live tool-event streaming or live mid-run reload. Those remain Sol's release acceptance steps; no additional inference was spent to fill gaps. The owned fixture is retained for read-only verification; discovery fixtures are untouched.

## Delivery / remaining gates

Source implemented and locally built/tested. Exact-head Sol review, source merge, published artifact, deployment and candidate live acceptance are pending. Hosted CI is reported on the PR separately. Physical Android/keyboard acceptance is pending separately; native Bot/groups are unnecessary for this slice and untouched.

Worker did not merge, publish builds, patch/restart Hermes or operate live services. Sol's recoverable Command release must independently establish current artifact provenance and rollback before cutover. Existing deployment handoff records app image `sha256:98e7050126d7e11e6f94d7218c909603148918880ab00ebd269401d1db87a7de` with prior `sha256:16778467dc81805afd0b4ae5a28d490f50daba3dc26b5a4b1fa2650bca902ee1` available; these are historical recovery references, not a fresh worker deployment inspection. This change needs only an app image cutover; no proxy, credential, audit schema or network migration. Reverting the app image restores old behavior; unresolved opaque pending identities stay safely locked.
