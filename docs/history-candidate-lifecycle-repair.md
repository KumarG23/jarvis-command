# Broker lifecycle repaired; real approval acceptance blocked upstream

## Repair and executed regression

Changed only the existing candidate broker lifecycle: `docker create` is settled with a bounded wait; cancellation is checked before `docker start -a -i <exact-ID>`. Cleanup removes that exact created ID, settles the start client, and checks Docker's exact-name inventory for absence. Delayed start cannot recreate a removed ID. Fixed fixture-only mount, pinned image, network-none, empty environment, no credentials/socket in tools and manual guards are unchanged.

Removal, readback, or wait uncertainty returns 125, never clean timeout/124, and closes admissions with both in-memory and persistent `broker/cleanup-uncertain.json` quarantine. A create operation that cannot settle is never granted start and also quarantines admissions. An operator must reconcile the recorded target before removing a real quarantine latch; tests use their own temporary latch directory.

`python3 scripts/test-candidate-fixture-lifecycle.py` passed eight real-Docker cases: delayed create, bounded create-settle failure, delayed start, command timeout, removal failure, removal timeout, start-client wait failure, and normal stdin. Delay injection is a real CLI wrapper; Docker execution and fixture effects are real. Removal/wait faults are explicitly injected. All uncertain cases reject subsequent admissions, including after resetting in-memory state to test the persistent latch. Removal faults can leave the owned marker written, as expected when teardown fails; they report uncertainty rather than false success. The harness reconciles and verifies absence of every exact test container and removes only its own markers. Result: `/home/neal/code/jarvis-command-candidate-state/lifecycle-regression.json`. Original reproducer and original failed result remain unchanged. `git diff --check` passed.

Self-review covered create/start ordering, cleanup exceptions, persistent fail-closed admission, stdin compatibility and unchanged sandbox argv boundaries. No wider approval/security changes were made.

## Genuine browser attempt: separate approval integration blocker

Started only the candidate broker and candidate gateway following the isolation-repair launcher. Verified loopback-only published API, protected control mounts, manual approvals, terminal-only toolset, `gpt-6-astra` / `openai-codex`, fallback null. Existing BFF was reused unchanged. The Playwright acceptance harness loaded the actual browser UI, verified online bootstrap, and submitted one real model run:

- Session: `jc_3bde5abdb8244baba51518f8851ff6ef`
- Run: `jcr_e8b22e006fc9817bf067500fd59ac8e6`
- Browser client request: `06ac7e9a-945b-44ea-93e1-bf8ba8713d01`
- Exact requested command: `rm -rf /fixtures/approval-once-7d17bdb1-0a2a-4a42-a5c0-ceb375322a54`

The model actually called terminal. Authoritative history tool message `13` returned `status: blocked`, `exit_code: -1`: the guard treats `api_server` as an unattended platform with no human present. The run completed, history binding user `11` / assistant `14`, with the truthful explanation that no command executed. The owned `owned.txt` file was read back unchanged. No approval request ID was generated, no approval acknowledgement exists, and neither approve-once nor deny was clicked. This is **not completed approval acceptance**.

Concrete source: `tools/approval_context.py:134` includes `api_server` in `_UNATTENDED_APPROVAL_PLATFORMS`; `_is_unattended_platform_approval_context` returns that classification. This conflicts with the browser/API approval surface advertised in bootstrap. Changing attended-session approval classification is outside this one broker repair and requires parent review. Do not use the tool error's suggested `unattended_mode: approve`: it would bypass the manual acceptance being tested.

Evidence: candidate-state `approval-acceptance.json` (failed UI wait, actual admission/bootstrap), `approval-blocker-history.json` (actual history readback), and the retained owned fixture above. The harness deliberately refuses replay while its attempt file exists.

## Final state and changed paths

Both `jc-history-candidate-runtime` and `jc-history-candidate-runtime-pre-isolation` verified `running=false`, PID 0. Broker unit `hermes-heavy-20260908-173429-3644283.service` stopped, PID 0; socket absent; no tool containers. Browser harness unit `hermes-heavy-20260908-173602-3646165.service` exited 1 and is inactive/PID 0. Existing BFF `hermes-heavy-20260908-171012-3614494.service` remains active. Production and pre-existing WIP unchanged; no merge, provider fallback, approval bypass, new credentials or public exposure.

Command integration paths added/modified by this task:
- `scripts/candidate-fixture-broker.py` — lifecycle repair.
- `scripts/test-candidate-fixture-lifecycle.py` — executable regression.
- `e2e/history-candidate-approvals.ts` — guarded real browser acceptance attempt.
- `docs/history-candidate-lifecycle-repair.md` — this finite result.

Candidate state changes: the two acceptance evidence JSON files, lifecycle regression JSON, owned acceptance fixture; launcher reserialized the already-selected isolated terminal/manual config without changing its values. Runtime history records the real attempt. Active/default `jarvis-command-isolated-acceptance` skill records lifecycle synchronization and unattended-approval pitfalls. No runtime source changed.
