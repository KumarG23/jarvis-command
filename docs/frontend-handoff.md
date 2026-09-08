# Jarvis Command — product/frontend handoff

## Ownership and scope

Neal's explicit handoff: ChatGPT/Codex leads product design and frontend implementation. Jarvis retains Hermes runtime integration and deployment ownership. Jarvis's overlapping UI work and review continuations are paused. This is a WIP checkpoint, not a merge, release, deployment or certification. Do not restart historical review machinery from archived notes. Coordinate BFF/contracts changes with Jarvis; preserve identity, narrow server-side operations and credential isolation.

## Start here

- Repository: https://github.com/KumarG23/jarvis-command
- Working branch: `feat/room-workspace-usability`
- Local worktree: `/home/neal/code/jarvis-command-workspace`
- Exact immediate checkpoint base: `5c1854ed3f2bcb2f6299cf80e614f61e7a95df82`.
- Application feature/deployed-record baseline: `584c3fc6f45dbc60cc8768ecd39c59e92cd219f8` (persistent rooms and owned conversation links).
- Between those bases: documentation/policy commits `d9397271f01796fc988e8abad2a6642c70dc1bb4` and `5c1854ed3f2bcb2f6299cf80e614f61e7a95df82`; no application changes. Latest recorded production remains the application baseline; production was not probed or changed for this handoff.
- The checkpoint commit containing this document preserves the existing implementation; use branch HEAD, not `main`, as the frontend starting point.

## Application changes in this checkpoint

Previously tracked/modified:
- `apps/server/src/live-room-routes.ts`
- `apps/server/src/project-rooms.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/ProjectRooms.test.tsx`
- `apps/web/src/ProjectRooms.tsx`
- `apps/web/src/styles.css`

Previously untracked, now included:
- `e2e/workspace.config.ts`
- `e2e/workspace.integration.ts`

Handoff-only addition: `docs/frontend-handoff.md`.

Already committed changes since the application baseline: `AGENTS.md`, `docs/project-status.md`, `docs/archive/project-status-before-policy-reset-20260908.md`.

## Implemented and locally exercised

- Metadata-only room editing via `POST /api/rooms/:roomId`; strict existing creation schema and serialized private registry preserve room IDs, conversation links and selection. Name, goal, repository reference and pinned note references can be edited. References remain metadata, never execution context or tool grants.
- Save/Cancel, saving/error state, failed-save draft retention, and no conversation reset on successful metadata save.
- Client-only filtering of the bounded fetched room list, no-match/clear states, selection retention.
- Accessible drawer close/Escape/focus return, full selected room/conversation labels outside truncated controls, and narrow-screen layout that separates drawer, history, composer and bottom navigation.
- Tests cover update denial/no mutation, invalid metadata/IDs, concurrent attachment preservation, saved-state restart/reload, edit/cancel/error behavior, filtering, and desktop/phone-width composition.

Existing verification (NOT rerun for handoff): web212 + server151 + contracts32 passing tests; relevant types/lint/build; two compiled local-BFF browser cases passed. A focused JSON-reporter repeat also passed both viewports and retained real diagnostics. Browser fixture uses synthetic upstream identities/data, not live Hermes model admissions. These are local test results, not production acceptance.

## Unfinished / limitations

- This usability batch has not been deployed or exercised through the public production route. No final independent approval receipt was produced; review was paused at Neal's request. No additional review is requested by this handoff.
- Native conversation selects may truncate; full selected title is separately readable. The oversized duplicate history title remains visual polish debt.
- Unsaved drafts survive errors/drawer closure, not browser reload. Saved metadata and selection persist.
- Full metadata edits are last processed write wins; in-process link updates serialize safely. No multi-user conflict UI.
- Search is local to the fetched room list (maximum100), not global session/repository search.
- Physical phone/soft keyboard, landscape and320px layouts were not exercised in this batch.
- Actual per-room model/provider/tool/workdir/context controls, repository file access, deletion/archive, and wider workspace/product redesign are not implemented by this batch.

## Runtime WIP — separate, do not merge blindly

The primary checkout held unrelated uncommitted deployment/recovery work based on `9d4819431efb5ce4749495e6fbfa6c80d19f74b9`. It is checkpointed separately on `handoff/runtime-recovery-wip`, not combined with frontend changes. It concerns trusted recovery-directory validation, recovery helper bundling, app cutover and Android association rollback/tests. Its live acceptance status is not established by this handoff. Jarvis retains this lane.

## Other local worktrees at inventory

All paths begin `/home/neal/code/`:

- `jarvis-command`: `feat/v0.2-live-room`, HEAD `9d4819431efb5ce4749495e6fbfa6c80d19f74b9`; deployment WIP moved WITH this checkout onto `handoff/runtime-recovery-wip` for checkpointing, no reset/stash/merge.
- `jarvis-command-access-fix`: `fix/access-callback-recovery`, `4ed3c938280f7ee4d88d310328869591743b0d46`; clean.
- `jarvis-command-policy-main`: `main`, `6697cefed960fb344f06370ee2503ec6f9cda889`; clean.
- `jarvis-command-project-rooms`: `feat/project-rooms`, `107cce0233b5bb52a0d172c2e14cc32ac3406192`; clean.
- `jarvis-command-release`: `feat/v0.2-single-user-release`, `89b5dd6fdbfb5d0eb49b7c0621385eabd43de5b1`; clean.
- `jarvis-command-session-fix`: `fix/session-source-contract`, `ab78c75de14552679aa85014d10a8346d9d20dea`; clean.
- `jarvis-command-timeline`: `fix/continuous-timeline`, `38b2cc52c4208ee24e76ce9061f9e102d740bbc8`; clean.
- `jarvis-command-ui`: `feat/live-room-usability`, `7fa666e11e78a1ffb673d6b1a5d2949805d4d00b`; clean, historical UI lane, not the new starting branch.
- `jarvis-command-workspace`: frontend working branch/base above; application WIP now checkpointed.

No running Hermes heavy jobs or processes with a Jarvis Command worktree as cwd were found at handoff inventory. No matching Jarvis Command cron job was found in the default profile job registry. Old implementation/review work orders remain on disk but are paused, not queued work. No overlapping UI worker will be resumed by Jarvis.

## Local evidence retained, not uploaded

`/home/neal/backups/jarvis-command/workspace-usability/` contains implementation RESULT/HANDOFF, test/build logs, screenshots, `browser-review-report.json`, and partial review checkpoints under `evidence/review/`. These are optional debugging references; do not reread them all as an initiation ritual. Runtime recovery evidence remains separate. No secrets, live credentials, or private runtime state are included in this handoff document.
