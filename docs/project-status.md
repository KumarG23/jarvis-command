# Jarvis Command — current engineering status

Updated: 2026-09-05 (Eastern).

## Goal and shipped state

The v1.0 goal is a complete project-work loop on phone and desktop: converse, inspect context, supervise agents, approve a consequential step, review an artifact or diff, verify the outcome, and promote the durable result without retreating to Discord or a terminal.

Production remains the independently approved read-only v0.1. The protected web client and Android TWA are shipped; the v0.2 write-capable candidate is not deployed or release-approved.

## v0.2 Live Room progress

- Local session history/creation, message submission, typed progress, approve-once/deny, stop, steer, and bounded reconnection/reload recovery are implemented. The earlier complete local UI+BFF checkpoint received independent Sol approval; subsequent deployment changes invalidate that approval for the current candidate.
- Compiled desktop/mobile PWA flows exercised the actual BFF/HTTP clients/proxies against an explicitly synthetic upstream. This is not live-Hermes or production acceptance.
- Image packaging, restricted bridge/egress fixtures, durable audit admission, and lifecycle/hardening checks have substantial isolated runtime evidence.
- The last complete hardening checkpoint passed 606 automated tests plus 10 Python tests, typecheck, lint, build, dependency audit, and whitespace checks. The later runtime-verifier amendment was not fully exercised; these counts are historical checkpoint evidence, not certification of current bytes.

## Current blocker

The isolated supervised-app worker ended at 04:24 Eastern on 2026-09-05 with BLOCKED_PARTIAL. Docker reported HostConfig.OomKillDisable=false after CREATE and null after START. The supervisor refused readiness during starting-health validation. The transition reproduced outside the systemd sandbox as well. No safety policy was relaxed and no production service was changed.

The worker added a repeatable isolated verifier, saved partial work, and recorded cleanup of its exact containers, units, and private fixtures. Authentication, crash/replay, and corrupted-ledger acceptance under the final supervisor remain incomplete.

## Next gates, in order

1. Establish the real Docker/cgroup metadata contract; reproduce with a failing regression before a minimal safe fix. Do not accept arbitrary absent/null security values.
2. Exercise the final supervised app: readiness, JWT denial/admission, durable replay after crash/replacement, exactly one upstream admission, normal cleanup, and damaged/missing ledger refusal.
3. Complete containerized browser/both-proxy integration and transactional installation/recovery procedures. Preserve the read-only production path.
4. Freeze the complete tracked/untracked candidate, run all applicable gates, and obtain fresh independent review before a code checkpoint is committed/pushed. Review approval is not production-cutover permission.
5. Complete authorized production cutover, desktop/Pixel human-path acceptance, negative authorization, restart/reboot and rollback proof before declaring v0.2 shipped.

External Continue in Command remains unavailable because the installed upstream fork API mutates the source session. Uncertain pre-acknowledgement admission remains locked for trusted reconciliation rather than risking a duplicate command. Neither gap is silently counted complete.

## Continuity and evidence

- Canonical product/roadmap: Obsidian `05 Coding Projects/Jarvis Command/Jarvis Command.md`.
- Implementation plan: [v0.2 Live Room](plans/2026-09-04-v0.2-live-room.md).
- Local evidence root: `/home/neal/backups/jarvis-command/20260904T210906Z-astra-bff-resume/`.
- Last complete hardening receipt: `deploy-6-hardening/PARENT-VERIFICATION.json` under that evidence root.
- Blocked runtime receipt: `deploy-6-runtime/IMPLEMENTATION-RESULT.json` and `process-receipt.json`.
- Historical exact candidate archives and inherited WIP remain preserved. Local evidence paths are not downloadable repository artifacts.

Neal requested frequent repo/vault updates on 2026-09-05. Update this status and vault canon at meaningful verified milestones and material blockers; commit sanitized documentation separately where appropriate. Code checkpoint commits require complete-candidate verification/review, with no implied main merge or deployment. Use Astra/high for implementation and Sol/high for independent review; no silent fallback. Do not replace evidence with chat-only updates or leave stopped workers labeled running.
