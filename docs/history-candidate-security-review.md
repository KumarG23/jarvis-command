# Bounded independent candidate review

## Decision

**Do not run genuine approve/deny acceptance in the current container.** Two verified isolation findings block that conditional task. No public exposure, merge, production modification, provider switch, or approval bypass was performed. Candidate runtime/BFF remain as found. Existing active-reload/metadata evidence was consumed, not rerun.

## Findings

### High — command identity can read copied production provider credentials and alter control state

`scripts/start-history-candidate.py:47–50` copies the configured provider's access token, ID token and account ID from production auth into candidate `auth.json`. Omitting a refresh token does not reduce the access token's account permissions. Lines 29–34 configure manual approvals with a **local** terminal; lines 57,64 run the gateway and its shell as UID 1000 with a writable `/candidate-home` mount.

Actual `docker exec` under the configured container identity returned:

```json
{"uid":1000,"candidate_provider_credential_readable":true,"candidate_provider_credential_writable":true,"production_auth_path_exists":false,"production_config_path_exists":false,"docker_socket_exists":false,"bridge_host_tcp_22_connect_result":0}
```

No credential bytes were displayed or changed. Production auth's original pathname is absent, but its selected credential material is present at `/candidate-home/auth.json`. The same UID and writable home also undermine separation from gateway API/control files. Mode 0600 does not isolate a same-UID shell.

Minimal non-disclosing reproducer:

```sh
docker exec jc-history-candidate-runtime python -c 'import os; print(os.getuid(), os.access("/candidate-home/auth.json", os.R_OK), os.access("/candidate-home/auth.json", os.W_OK))'
```

Fix proposal: keep the configured provider in the runtime/control plane, but execute terminal tools in a separate credential-free sandbox with only disposable fixtures writable, no gateway home/API keys/config, no production dependencies containing secrets, and no Docker socket. Do not copy additional production credentials or merely chmod same-UID files. Validate actual command-backend mounts/identity before manual approval acceptance. This is an isolation repair requiring explicit implementation, not a change applied by this review.

### High — default Docker bridge allows outbound access to host services

Launcher has no egress boundary; live `NetworkMode=bridge`, gateway `172.17.0.1`, container `172.17.0.2`. A TCP-only `connect_ex(("172.17.0.1",22))` from the container returned **0 (connected)**. No SSH handshake, login, command, scan, or data transfer was attempted. This proves host-service reachability, not authentication or access to every LAN service. Loopback publishing limits inbound host ports; it does not restrict container egress.

Minimal reproducer:

```sh
docker exec jc-history-candidate-runtime python -c 'import socket; s=socket.socket(); s.settimeout(2); print(s.connect_ex(("172.17.0.1",22))); s.close()'
```

Fix proposal: network-disabled command sandbox for these file-only approval fixtures, distinct from the configured provider's networked runtime. If using an egress broker for the runtime, deny host/private networks and expose only the necessary provider operation; do not treat that broker as a shell-accessible generic forward proxy.

## Isolation properties that did pass

Live Docker metadata: UID/GID 1000:1000, privileged=false, read-only rootfs, cap-drop ALL, no-new-privileges, private PID namespace, 2 GiB memory limit, 256 PID limit, `hermes-heavy.slice`. Read-only binds: candidate source, shared interpreter venv and managed Python generation. Writable binds: candidate home and fixtures only. No production home/config original path and no Docker socket. Runtime port 18741 and BFF/proxy ports 18742–18744 listen only on 127.0.0.1. These properties do **not** negate the copied-credential and outbound-network findings.

## History binding review

No additional reproducible ownership/persistence/backcompat defect found in the changed history-binding source within this scope:

- Fresh receipt stamping occurs after `append_messages_batch` returns; `SessionDB._execute_write` commits before return. Tested INSERT-success/COMMIT-failure rollback, not only pre-insert rejection.
- Binding requires current user/final object identity in the messages list, committed markers, exact session, positive ordered row IDs and exact saved/live final output. Existing-row repair removes the fresh receipt.
- API attaches run ID only when result session equals admitted agent session. Status GET performs owned-run resolution before opt-in projection and copies the status before removing the field for old clients. SSE terminal payload remains unchanged.
- Proxy validates receipt run/session against status, completed state, ordered positive IDs, and explicit opt-in. BFF locates audit record by actor before any upstream read and checks upstream run/session against the admitted record before projection.

This is bounded review, not a claim that every finalizer/compression recovery branch produces a binding. Fail-closed omission is intentional. Full runtime-restart durability was not rerun or newly claimed.

## Focused executed regressions

All commands completed with exit 0 under `hermes-heavy-run`; after completion only the pre-existing BFF heavy service remained running.

1. Runtime `scripts/run_tests.sh tests/agent/test_history_binding_receipts.py tests/gateway/test_api_history_binding_boundary.py`: **4 passed, 0 failed**, two files. Covers real SQLite receipts/repeated replies, foreign object/session, existing-row repair revocation, INSERT then failed COMMIT with no persisted row/receipt, opt-in legacy equality, and foreign-owner 404.
2. Command proxy `npm test -w @jarvis-command/command-proxy -- src/app.test.ts -t "projects opted-in receipts"`: **1 passed, 88 skipped**. Opt-in header forwarding/legacy equality; foreign run/session, unordered/zero IDs and noncompleted receipt rejected with 503.
3. BFF `npm test -w @jarvis-command/server -- src/live-room-service.test.ts -t "binds receipts"`: **1 passed, 21 skipped**. Legacy equality; foreign actor rejected before upstream access; mismatched admitted run/session rejected.
4. Node **v22.22.3**; command-proxy and server typechecks passed. Both worktree `git diff --check` passed.

Test fixtures in these regressions are explicitly unit/integration test data, not synthesized browser approval outcomes. **No approval request was admitted, approved, denied, or claimed successful in this review.** Genuine browser approve-once/deny and exact file-effect verification remain blocked pending isolation repair.

## Files changed by this reviewer only

- Runtime: extended `tests/agent/test_history_binding_receipts.py`; new `tests/gateway/test_api_history_binding_boundary.py`.
- Command integration: added focused tests in `apps/command-proxy/src/app.test.ts` and `apps/server/src/live-room-service.test.ts`; this report.
- Active/default skill `jarvis-command-isolated-acceptance`: added copied-credential/shared-UID and outbound-network checks.

No implementation/launcher source was changed. All prior WIP preserved.
