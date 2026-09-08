# Attended Runs delta review and genuine browser acceptance

## Outcome — 2026-09-08, 5:52 PM Eastern

**Scoped independent review: no activation blockers found. Genuine approve-once and deny acceptance passed, harness exit 0. Candidate runtime and broker stopped afterward.** No production changes, merge, fallback, synthetic model responses or approval bypass.

Review covered the attended changes in runtime `tools/approval_context.py`, `tools/approval_gateway_wait.py`, `gateway/platforms/api_server_runs.py`, new `tests/gateway/test_api_attended_approval.py`, and the relevant broker cleanup lifecycle. Existing history-binding and isolation work was not re-reviewed wholesale; the reported 241 passing tests and eight real-Docker lifecycle cases were consumed, not rerun.

The capability is task-local, manual-only, API-specific, excludes cron/single-query, and requires exact registered callback/session identity plus live authenticated owner/run state. Queue removal revokes callback identity and removes pending resolver targets; stop/shutdown also revoke. The normal wait rechecks capability before returning authorization. Attended API resolution requires exact pending request identity and permits only once/deny, not session/always/all. Ordinary API callback registration alone remains unattended. No concrete new defect warranted additional mocked probes.

## Reconciliation and activation

The retained failed run `jcr_e8b22e006fc9817bf067500fd59ac8e6` was read back through the candidate BFF: completed, approval null, history confirms unattended guard block and no execution; original fixture contents remained exact. Original attempt evidence was preserved as `approval-acceptance-blocked-original.json` before new admissions. `approval-reconciliation.json` records this readback.

Contrary to the previous handoff, BFF unit `hermes-heavy-20260908-171012-3614494.service` was actually active, PID 3614507, with loopback listeners. It was reused without restart. Only the documented broker and runtime were started. Runtime bootstrap was online; configured model/provider remained `gpt-6-astra` / `openai-codex`, fallback null, manual approvals, terminal-only toolset and `candidate_fixture` backend. Runtime API publication remained 127.0.0.1:18741. The broker ran outside the gateway under the heavy slice.

## Actual browser results

Executed unchanged `e2e/history-candidate-approvals.ts` using Node v22.22.3 and Playwright Chromium against the real candidate UI/BFF/proxies/runtime/model. The browser clicked the visible exact-request approval buttons; this is not Cloudflare edge acceptance (the isolated BFF uses its documented cryptographically verified local fixture identity).

Both runs used session `jc_3bde5abdb8244baba51518f8851ff6ef`.

| Decision | Public run | Pending request | HTTP acknowledgement | Final status / effect |
|---|---|---|---|---|
| once | `jcr_66d01ad5d37a7ace6877f3bf46c9bf9e` | `41b617955798400882568043e88d0d84` | exact request, once, resolved 1 | completed; terminal exit 0; approved fixture directory absent |
| deny | `jcr_fe26797bf600940a89e863a77b70b815` | `8dad73a91a05429188700a57fb53c6bd` | exact request, deny, resolved 1 | completed; terminal blocked, exit -1; denied fixture retained unchanged |

Approved target: `/fixtures/approval-once-987ee57f-98e2-4a9e-ac3c-79fd411b5be6`.
Denied target: `/fixtures/approval-deny-92b557bf-1cca-4124-a4f9-cd2a7e2e7695`.

The harness verified pending request/run/session text in the browser, fixture presence before either decision, exact posted payload and acknowledgement, authoritative completed state and null pending approval. Independent final API/history/filesystem readback confirmed both effects. History tool messages 17 and 21 report success and user denial respectively; final history bindings are user 15/assistant 18 and user 19/assistant 22. No denied-command retry occurred.

## Evidence and cleanup

All state artifacts are under `/home/neal/code/jarvis-command-candidate-state/`:

- `approval-acceptance.json`: passed result, admissions, pending states, exact payloads/acknowledgements, terminal states and fixture effects.
- `approval-once-pending.png`, `approval-once-completed.png`, `approval-deny-pending.png`, `approval-deny-completed.png`: actual browser screenshots.
- `approval-final-readback.json`: fresh final BFF status/history and fixture directory checks.
- `approval-reconciliation.json`, `approval-acceptance-blocked-original.json`: reconciled and preserved prior failed attempt.
- `approval-cleanup.json`: final runtime/process/socket readback.

Both `jc-history-candidate-runtime` and preserved `jc-history-candidate-runtime-pre-isolation` verified stopped, PID 0. Broker `hermes-heavy-20260908-175044-3664647.service` and browser harness `hermes-heavy-20260908-175117-3665509.service` verified inactive, PID 0. No tool containers, broker socket or quarantine latch remained. Existing BFF remains active and unchanged. Production source/config and unrelated WIP were preserved; no source code edits were needed. Launcher reserialized only its already-selected candidate config. `git diff --check` passed.
