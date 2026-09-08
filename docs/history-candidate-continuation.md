# Isolated candidate continuation — browser reload and metadata

## Outcome

Passing real-model browser active-reload acceptance and project metadata persistence, including candidate BFF process restart. No production changes, merge, public route, approval bypass, or provider fallback.

## Root cause and repair

Actual browser history HTTP returned 200, two messages, `hasMore:false`. History loading was transient, not the admission failure. Bootstrap was `degraded` solely because the prior isolated entrypoint started APIServerAdapter without a gateway lifecycle. The UI correctly disabled messaging. The old harness started an unhandled admission waiter before checking composer readiness, obscuring that failure.

Changed only candidate runtime entrypoint to use real `GatewayRunner.start()` with an explicit API-only GatewayConfig, no multiplex profiles, and `runner.stop()` on shutdown. It does not invoke `start_gateway` or its cron/housekeeping launcher. No status fabrication or frontend gate relaxation. Bootstrap now reports online and all readiness checks pass.

Acceptance harness now asserts bootstrap readiness, actual history HTTP/completeness and enabled composer; admission waiter is paired with the click. Previous no-admission attempt was reconciled against audit (only original probe admitted) and archived, not silently replayed.

## Real execution

- `e2e/history-candidate-acceptance.ts`: exit 0, `passed:true`. Two real gpt-6-astra/openai-codex turns each observed running before same-tab reload and completed afterward. Both used harmless `sleep 12` fixture tool work. No approval interaction in this slice.
- Session `jc_3bde5abdb8244baba51518f8851ff6ef`.
- Run `jcr_619a586fc7190c0c6c05b0cb77aa9437`: saved user/assistant IDs `3`/`6`; UI count 2, older answer ID `2` preserved.
- Run `jcr_137f96a5bec599106190169cad3123a4`: saved IDs `7`/`10`; UI count 3, authoritative answer IDs `[2,6,10]`.
- Exact identical output `CANDIDATE_HISTORY_OK` with no duplicate handoff. Zero page errors. Post-BFF-restart status GETs retain completed status and both exact bindings.
- `e2e/history-candidate-metadata.ts --resume`: exit 0. UI project creation/link/edit, exact authoritative GET equality and browser reload passed. Locator failures were harness-only (nested select/textarea label text), reconciled before resuming same room.
- `--verify-only`: exit 0 in a fresh browser after candidate BFF process replacement. Room `room_9c35af582060c8a8e0ff0889b7f39efa` preserves exact edited name/goal/repository/notes plus unchanged sessionIds/lastSessionId.
- Focused project-room tests: 12 passed. Web LiveRoom + HistoryCache tests: 10 passed using workspace Vitest config. Initial root invocation lacked jsdom and failed; corrected workspace invocation passed.
- Server and command-proxy typechecks passed. Both worktree `git diff --check` passed. Previous worker's 2 receipt tests and unchanged backend/proxy tests were not redundantly rerun.

Screenshots are viewport/scroll-container captures, not whole-history proofs. Active reload intentionally shows recovery copy explaining original input was not retransmitted; tool-call assistant records can have empty saved text. DOM count + authoritative exact IDs, not screenshot appearance, establish duplicate-free handoff.

## Evidence and live handles

Private state root `/home/neal/code/jarvis-command-candidate-state`:
- `history-http-diagnostic.json`
- `browser-acceptance-pre-readiness.json` (original unsuccessful attempt)
- `browser-acceptance.json` (passed)
- `history-reload-desktop.png`
- `metadata-acceptance.json` (passed and restartPassed; retains historical error/failureBody from earlier harness failures)
- `metadata-reload.png`, `metadata-restart.png`, `metadata-failure.png`
- `post-bff-restart-status.json`

Running: Docker `jc-history-candidate-runtime`; BFF heavy service `hermes-heavy-20260908-171012-3614494.service`, wrapper `proc_953544ce47d8`, Node PID 3614535. Prior `hermes-heavy-20260908-165553-3597074.service` was stopped and verified MainPID=0 before replacement. All ports 18741–18744 remain 127.0.0.1 only. Container is unprivileged/read-only root, production config/auth and Docker socket absent. Read-only shared interpreter dependencies remain mounted, as before. Candidate source/state are isolated.

## Exact uncommitted paths at handoff

Command integration (prior WIP retained):
- apps/command-proxy/src/app.ts
- apps/server/src/command-client.ts
- apps/server/src/live-room-routes.ts
- apps/server/src/live-room-service.ts
- e2e/history-candidate-acceptance.ts (modified this slice)
- e2e/history-candidate-diagnose.ts (new)
- e2e/history-candidate-metadata.ts (new)
- e2e/history-candidate-stack.ts
- scripts/probe-history-candidate.py
- scripts/start-history-candidate.py
- docs/history-candidate-continuation.md (this report)

Runtime (prior WIP retained):
- agent/session_persistence.py
- agent/turn_context.py
- agent/turn_final_response.py
- agent/turn_finalizer.py
- gateway/platforms/api_server_runs.py
- agent/history_binding.py
- scripts/history_binding_candidate.py (modified this slice)
- tests/agent/test_history_binding_receipts.py

Reusable skill added to active default skill library: `jarvis-command-isolated-acceptance`.

## Remaining boundaries

Parent-owned scoped security review and real approve/deny roundtrip remain outstanding. No public exposure attempted. This proves browser reload and metadata behavior in the local fixture stack, not production release/Cloudflare-edge acceptance or full runtime-restart binding durability.
