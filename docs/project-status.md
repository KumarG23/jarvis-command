# Jarvis Command — current branch handoff

## Current policy (2026-09-08)

Follow `../AGENTS.md` and `/home/neal/AGENTS.md`. Build first, validate proportionately; one owner, coherent batch, focused tests and applicable type/lint/build, concise self-review. Classify the change, not the repository. Name a concrete failure risk before broader testing or independent review. No mandatory whole-candidate approval, repeated full gates, source-read receipts or parent reviewer audits. Preserve identity/MFA, authorization, isolation, audit and recovery.

## Branch and product state

This checkout is `feat/artifact-studio`. It preserves the deployed navigation fix and Grok 4.7 roster while adding the complete Artifact Studio scope. The product now has typed durable artifacts; immutable versions and compare; provenance, comments and canonical promotion; Markdown/code/diff/log/report/Mermaid/image/PDF/file previews; isolated script-capable HTML/SVG previews; upload, camera and paste intake; session/project scopes; desktop side panel and mobile full-screen workspace; download/delete; approval-routed Obsidian and repository export prompts; and a `Create with Jarvis` flow that binds an exact run and persists its terminal output idempotently.

Browser Workbench and the later coding/IDE workbench remain intentionally deferred. Product sequencing is one finished scope at a time.

Production was updated on 2026-09-22 at 13:49 ET from runtime source commit `c483d8b3f9197065b7c48d2f2f70774064a4e990`. The running immutable app image is `sha256:1e2af2167c541b9f0612cfd8711b59602752efefd3718c75c960d970dd6cbcc4`; rollback image `sha256:25ec7f76a787a6974bfbdecc1a22e300b23dcf281e0f6296bdded42ba1ebc9c2` is retained. Recovery state is retained under `/var/lib/jarvis-command/release-backups/20260922T174911Z-artifact-hotfix-c483d8b`.

Live acceptance created a Markdown artifact, saved immutable v2, compared v1→v2, promoted it canonical, added feedback, restarted the service, and read back the exact persisted checksum. A script-capable HTML artifact rendered in an `allow-scripts` opaque-origin sandbox without parent access. Desktop and 390×844 mobile geometry passed. Both synthetic artifacts were deleted and exact 404 responses plus an empty artifact list were verified after the deletion-semantics hotfix.

Focused server/web/contracts tests, typecheck, lint, production build, deployment helper/supervisor tests, desktop/mobile Playwright acceptance, dependency audit, authenticated public-path checks, restart persistence and live cleanup passed. The independent security/correctness review findings were repaired before release.

The concise canonical product/state/priorities note is `05 Coding Projects/Jarvis Command/Jarvis Command.md` in the vault. Prepared deployments verify requested artifact/provenance, recovery, health and affected behavior without repeating development review.

## History

[Historical status and recovery references](archive/project-status-before-policy-reset-20260908.md) preserves this branch's former detailed handoff. Consult it only for relevant technical facts, not superseded release/review instructions. Resolve demonstrated defects and outstanding authorization constraints; historical review status alone does not dictate the new engineering workflow.
