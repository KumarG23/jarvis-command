# Isolation repair delta review — blocked on cancellation cleanup

## Verdict

Keep candidate admissions stopped. Credential/network separation is materially repaired, but the broker's cancellation cleanup has a reproduced startup race. No browser run or approve/deny request was admitted by this review. No model/provider invocation, fallback, approval bypass, production change, merge or launcher implementation change was made.

## Finding — medium, acceptance blocker: cancellation can miss a not-yet-created sandbox

`scripts/candidate-fixture-broker.py:55–70` starts `docker run` asynchronously. A timeout/disconnect triggers a single `docker rm -f <name>` without checking its return code. If Docker has not created the named container yet, removal fails with not-found; the still-running launch process subsequently creates it and executes the command. `proc.wait(timeout=15)` waits rather than cancelling the launch. The response can report cancellation/124 despite a post-deadline file effect. If the subsequent command lasts over 15 seconds, `proc.wait` raises and the handler has no second removal/reconciliation. Similarly, a timeout/error in the removal subprocess skips the following wait entirely. Existing normal-timeout and SIGTERM checks do not cover this ordering.

### Executed reproducer

Ran `python3 /home/neal/code/jarvis-command-candidate-state/probe-broker-startup-race.py` against the actual imported Handler with a socketpair and real Docker operations. The sole fault injection delays the Docker CLI's start by 600 ms. It does not mock cancellation responses, Docker removals, container execution or fixture effects. Requested command: `sleep 1; printf late-effect > /fixtures/delta-review-timeout-203c87b9f56f4fed8396bbfe86d8f0c3.txt`, timeout 0.01 seconds.

Observed, exit 0 for the probe:

- broker response `{ "output": "candidate sandbox rejected/cancelled; no host fallback", "returncode": 124 }`
- elapsed 2.103 seconds
- `file_created_after_timeout: true`
- handler errors: none
- sandbox name `jc-history-tool-089feabc62fb44458e57fd7d378f1afb`

Artifact: `/home/neal/code/jarvis-command-candidate-state/delta-review-startup-race.json`. Disposable marker retained as evidence. The probe explicitly removed its exact tool container afterwards; readback showed no `jc-history-tool-*` containers.

This is a cancellation/lifecycle defect, **not** evidence of a credential leak, network escape or host-command injection. The marker remained within the authorized fixed fixture mount.

### Bounded repair direction

Make cancellation cover container creation and execution as one lifecycle: prevent the launcher from completing creation after cleanup, reconcile the exact named container after the launcher is reaped, check removal results, and ensure cleanup errors cannot skip remaining cleanup. Alternatively use a tracked create/start lifecycle with cancellation synchronization. Fail admissions closed on uncertain teardown; do not claim cancellation success from an unchecked `docker rm`. Add the delayed-start case and removal-failure case to focused tests. No large redesign was attempted here.

## Reviewed boundary passes

- Broker constructs a fixed argv and passes the command only as bash's command argument inside the sandbox. Caller key-set validation prevents mount/network/image/env option overrides.
- Commands receive only the fixed fixtures bind, no broker/Docker socket, control home, source/interpreter dependencies or provider credentials; `env -i`, UID 1000, read-only root, no network, dropped capabilities and no-new-privileges are explicit.
- The control plane no longer mounts the writable host fixtures. Fixture symlinks resolve inside the command namespace and cannot reach absent host/control mounts through ordinary path traversal.
- The provider's only local subprocess is the fixed Python transport; model command text enters JSON/stdin, not host shell syntax. Unavailable transport has no local execution fallback.
- `skip_container_guards=False` preserves approval checks. Launcher validates terminal-only toolset, manual mode and Astra/Codex with no fallback. Existing actual-dispatch credential/network/fixture/override evidence was consumed, not unnecessarily rerun.

## Final state / scope

Verified both `jc-history-candidate-runtime` and `jc-history-candidate-runtime-pre-isolation`: `running=false`, `pid=0`. Broker socket absent. No remaining tool containers. Existing BFF `hermes-heavy-20260908-171012-3614494.service` remains active and untouched. Worktree diff check passed. No pre-existing WIP was changed.

Created only this report, the candidate-state reproducible probe, its JSON result and the owned disposable marker. Approval request/run/session IDs and acknowledgments do not exist for this review because conditional browser acceptance remains blocked.
