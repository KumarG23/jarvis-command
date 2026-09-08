# Attended Runs approval candidate — built, not activated

## Finding

The live Hermes security documentation and this runtime's `website/docs/user-guide/security.md` document only `approvals.unattended_mode: deny|approve` for API sessions. There is no existing documented attended-API switch. `approve` would bypass the manual decision and is not an acceptable fix. The Runs API already registers an approval notification callback and has authenticated owner-scoped request resolution, but the tool guard rejects `api_server` before that callback is used.

The real blocked run `jcr_e8b22e006fc9817bf067500fd59ac8e6` and its unchanged fixture/evidence are retained. This work did not replay or admit another model/command run.

## Isolated implementation

Only `/home/neal/code/hermes-history-binding` runtime source changed:

- `tools/approval_context.py`: a context-local in-process capability permits attended classification only on `api_server`, in manual mode, outside cron/single-query context, with the same approval-session key, the exact still-registered callback, and a live owner-bound run. The unattended platform set is unchanged. A platform/env marker or ordinary callback registration alone does not confer this capability.
- `gateway/platforms/api_server_runs.py`: authenticated admission captures the existing opaque owner scope (no credentials), and the executor binds the capability only after registering its callback. Live checks cover owner, run/session association, transport queue identity, stopping/terminal status and adapter shutdown. The new manual path advertises and accepts only once/deny for an exact request ID; missing, whitespace-altered, wrong, reused and scope-widening requests fail. SSE transport removal, stop and adapter shutdown revoke/wake pending approvals; executor context cleanup restores the prior capability.
- `tools/approval_gateway_wait.py`: rechecks the attended capability after the blocking wait, so a resolved answer cannot authorize after capability revocation noticed before returning the decision.
- `tests/gateway/test_api_attended_approval.py`: real HTTP admission/resolver, executor, command guard and approval queue/callback are exercised using a stub model agent. No shell command is executed by these tests.

No sandbox redesign, production source/config change, provider change, fallback, public listener, automatic approval or bypass. Existing history-binding WIP in `api_server_runs.py` was preserved.

## Verification

Final `scripts/run_tests.sh` run: **241 passed, 0 failed** across six focused files:

- `tests/gateway/test_api_attended_approval.py` — 21 passed (manual once, deny, timeout, transport removal, shutdown, stop; request/owner checks; capability matrix; unauthenticated-listener denial).
- `tests/gateway/test_api_server_runs.py`
- `tests/gateway/test_api_server_run_idempotency.py`
- `tests/gateway/test_api_server_runs_extraction.py`
- `tests/tools/test_approval.py`
- `tests/tools/test_cron_approval_mode.py`

A first broader run found teardown of a partially initialized test adapter accessing the new set before initialization; `_close_run_state` now tolerates the absent set, preserving the existing shutdown contract. The final run above includes that regression. `git diff --check` passed.

These are guard/broker integration tests, **not** real-model/browser/sandbox approval acceptance. Existing eight-case real-Docker lifecycle evidence is unchanged and was not rerun.

## Review and activation boundary

Final readback: both candidate runtime containers have `running=false`, PID 0; broker unit `hermes-heavy-20260908-173429-3644283.service` is inactive/PID 0. The previously recorded BFF unit `hermes-heavy-20260908-171012-3614494.service` also reports inactive/PID 0 (unexpected relative to the handoff; this worker did not stop or restart it). Confirm the current BFF unit before later acceptance.

**Keep runtime and broker stopped.** This changes consequential-command authorization: independent review must cover only the three changed runtime files, their admission/context propagation, callback/queue lifecycle and owner/request resolution, plus the new tests. In particular, check revoke/resolve races and that unrelated API, cron/webhook and no-callback paths remain fail-closed. No full-candidate or unchanged-sandbox rereview is required absent a new concrete finding.

After that delta is accepted, the parent may activate only the already-authorized isolated broker/runtime, retaining manual mode, deny-by-default unattended policy, credential-free network-none fixture sandbox and configured Astra with no fallback. Reconcile the previous failed attempt file and fixture before any new admission; do not blindly rerun the acceptance harness. Then perform the genuine browser approve-once and deny cases, verify exact request/run/session binding and fixture effects, and stop the candidate again. This document does not claim those activation or real acceptance steps happened.
