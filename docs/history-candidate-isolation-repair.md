# Candidate isolation repair — delta review required

## State

The exact unsafe candidate `jc-history-candidate-runtime` was inspected, stopped, and verified `running=false`, `pid=0` before changes. Its stopped container metadata is preserved as `jc-history-candidate-runtime-pre-isolation`. Candidate home/history and existing fixture evidence were retained. The replacement `jc-history-candidate-runtime` ran **only containment probes**, then exited. Both containers are now stopped. The host fixture broker is stopped, its socket removed, and no `jc-history-tool-*` containers remain. Existing BFF `hermes-heavy-20260908-171012-3614494.service` was not stopped or modified. Production was not changed.

No approval admission, browser approve/deny, provider inference, public exposure, merge or end-to-end acceptance was performed. **Independent delta review remains required before restarting the gateway for genuine approval acceptance.**

## Boundary

- Commands use `candidate_fixture`, implemented using Hermes's documented `TerminalEnvironmentProvider` and `BaseEnvironment` interfaces. The live documentation at `https://hermes-agent.nousresearch.com/docs/developer-guide/terminal-environment-plugin/` was retrieved; the corresponding implementation and Docker backend were inspected.
- Native Docker construction inside the control container would require Docker authority there. Instead, a host-only Unix-socket broker accepts one fixed operation and constructs each disposable command container itself. It cannot accept Docker options, caller mounts, environment forwarding, image selection, or a different target.
- Each command container uses a pinned local image ID, `--network none`, read-only root, UID/GID 1000, cap-drop ALL, no-new-privileges, private default namespaces, CPU/memory/PID bounds, a bounded temporary filesystem and **only the fixed candidate fixture bind**. No source/dependency, credential, control-home, broker-socket or Docker-socket mounts enter commands. The command environment starts with `env -i`; Hermes's ordinary nonsecret shell markers are then added by BaseEnvironment.
- Only the credential-bearing control plane mounts the narrow broker socket. It no longer mounts command fixtures, preventing fixture content from becoming host/control Python imports or startup files. No Docker socket is mounted in either plane.
- `skip_container_guards=False` is explicit: the provider default would otherwise skip container command guards. Manual approvals and terminal-only platform tools remain configured. `gpt-6-astra` / `openai-codex`, fallback null, are unchanged.
- Existing candidate `home/auth.json` remains the single retained selected provider copy, mode 0600, reachable only in the control plane—not the tool namespace. No new token copies, token output or production rotations. The retired container references that same host directory; it is not another token-file copy.
- Sandboxes are fresh per command. Fixture files persist; exported shell environment/functions do not. This deliberately restricted backend is for fixture-only acceptance, not general interactive development.
- Deadlines, excess output, transport disconnects and broker SIGTERM destroy the entire sandbox, including detached descendants. Missing broker/backend errors have no local fallback.

## Executed evidence

`/home/neal/code/jarvis-command-candidate-state/isolation-probes.jsonl` contains actual probe output (its first line is Docker's removed-container name, not JSON).

The repaired launcher ran successfully with exit 0. Inside the **actual configured execution backend**:

- UID 1000; existence/readability/writability all false for candidate auth, API key, config, broker socket, Docker socket, original production auth pathname and `/proc/1/root/candidate-home/auth.json`.
- A write attempt to candidate auth failed. A fixture write succeeded and was read back through a subsequent fresh sandbox.
- TCP-only `connect_ex`: host bridge `172.17.0.1:22` = **101 (network unreachable)**; `1.1.1.1:443` = **101**; sandbox loopback `127.0.0.1:18741` = **111 (connection refused)**. No protocol payload was sent.
- Actual `terminal_tool` dispatch resolved `candidate_fixture` and returned `configured-backend-ok`, exit 0, after asserting control auth/broker socket were absent.
- Caller-supplied mount override rejected. Bounded sleeping command returned 124. No leaked tool containers.
- After adding graceful broker shutdown, a separate live test started a 30-second sandbox command, terminated the broker, and returned `PASS broker SIGTERM removes active sandbox and socket`, exit 0.
- Both worktree `git diff --check` checks passed during the repair. Final readback: backend `candidate_fixture`, approvals `{enabled: true, mode: manual}`, Astra/Codex unchanged, fallback null; both runtime containers `running=false`, PID 0. Only the original BFF heavy service remains running.

An initial probe failed because its nonsecret environment-name allowlist omitted Hermes's `AI_AGENT`, `HERMES_AGENT`, pager and cwd markers. No credential exposure was found in that failed probe. The assertion was corrected to enumerate those known names, and the real probes passed; no values were logged.

## Files and restart procedure

Command integration:
- Updated `scripts/start-history-candidate.py`: no production auth read/copy, validates provider/manual/terminal-only configuration, installs isolated backend config, preserves stopped old container; default is a network-none probe run, not service startup.
- Added `scripts/candidate-fixture-broker.py`: fixed-operation host broker, bounded cleanup.
- Added this report.

Runtime candidate:
- Updated `scripts/history_binding_candidate.py`: installs the provider and refuses a nonisolated backend/manual-approval mismatch before gateway import/start.
- Added `scripts/candidate_fixture_backend.py` and `scripts/probe_candidate_isolation.py`.

Candidate state: changed only terminal backend configuration, broker socket lifecycle, probe evidence and disposable `fixtures/isolation-probe.txt`; pre-existing auth/history preserved. Active/default isolated-acceptance skill records the provider-default guard pitfall.

For the reviewer/operator, from `/home/neal/code/jarvis-command-integration`:

1. Start the fixed broker under `/usr/local/bin/hermes-heavy-run -- /usr/bin/python3 scripts/candidate-fixture-broker.py`; record its exact transient service and verify socket readiness.
2. `/home/neal/.hermes/hermes-agent/venv/bin/python scripts/start-history-candidate.py` exercises containment only and leaves runtime stopped.
3. **Only after independent delta review**, `scripts/start-history-candidate.py --serve-after-delta-review` starts the existing gateway lifecycle on loopback 18741. That switch is an operator workflow gate, not a substitute for review or application approval/auth.
4. Recheck runtime bootstrap/toolset resolution, then parent-owned genuine browser approval acceptance. Stop the exact recorded broker unit when done; do not stop the existing BFF or production services.

The credential-bearing gateway's provider connectivity and browser acceptance were intentionally not exercised in this repair. The reviewed serve mode retains provider networking in the control plane; the tested command plane remains network-disabled.
