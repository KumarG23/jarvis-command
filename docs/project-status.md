# Jarvis Command — current engineering status

Updated: 2026-09-05 (Eastern).

## Goal and shipped state

The v1.0 goal is a complete project-work loop on phone and desktop: converse, inspect context, supervise agents, approve a consequential step, review an artifact or diff, verify the outcome, and promote the durable result without retreating to Discord or a terminal.

Production remains the independently approved read-only v0.1. The protected web client and Android TWA are shipped; the v0.2 write-capable candidate is not deployed or release-approved.

## v0.2 Live Room progress

- Local session history/creation, message submission, typed progress, approve-once/deny, stop, steer, and bounded reconnection/reload recovery are implemented. The earlier complete local UI+BFF checkpoint received independent Sol approval; subsequent deployment changes invalidate that approval for the current candidate.
- Compiled desktop/mobile PWA flows exercised the actual BFF/HTTP clients/proxies against an explicitly synthetic upstream. This is not live-Hermes or production acceptance.
- Image packaging, restricted bridge/egress fixtures, durable audit admission, and lifecycle/hardening checks have substantial isolated runtime evidence.
- The supervised-runtime checkpoint passed 608 automated tests plus 11 Python tests, typecheck, lint, build, dependency audit, and whitespace checks. Jarvis independently reran the real supervised-app harness successfully after the worker. Complete-candidate independent review is still required before a code checkpoint is committed.

## Startup blocker resolved locally — 2026-09-05

The 04:24 Eastern worker stopped because Docker reported HostConfig.OomKillDisable=false after CREATE and null after START. A fresh implementation traced this to the installed Moby source: CREATE defaults the pointer to false; START clears it when disabling the OOM killer is unsupported on cgroup v2.

The supervisor still requires literal false before START. A post-START explicit null is accepted only after a fresh same-daemon query proves exact Linux, cgroup v2, and unsupported OOM-killer disabling. Missing, true, malformed and unqualified values still refuse. An asserting RED regression preceded the minimal repair; other container checks remain intact.

Both worker and parent executed the actual source-bound app under the real supervisor and systemd notification: readiness, missing/invalid JWT denial with zero upstream mutations, durable admission, SIGKILL and replacement replay with the same public run ID and ledger inode and one total upstream admission, normal cleanup, and damaged/corrupt/missing ledger refusal. Exact disposable containers, unit, PIDs and fixture directory were cleaned up. The bridge was synthetic; this is not containerized both-proxy/browser or production acceptance.

## Next gates, in order

1. Freeze the complete tracked/untracked supervised-runtime checkpoint, run applicable browser/security gates, and obtain fresh independent Sol review before committing/pushing this code checkpoint. Review approval is not production-cutover permission.
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
