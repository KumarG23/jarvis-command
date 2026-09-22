# Jarvis Command — current branch handoff

## Current policy (2026-09-08)

Follow `../AGENTS.md` and `/home/neal/AGENTS.md`. Build first, validate proportionately; one owner, coherent batch, focused tests and applicable type/lint/build, concise self-review. Classify the change, not the repository. Name a concrete failure risk before broader testing or independent review. No mandatory whole-candidate approval, repeated full gates, source-read receipts or parent reviewer audits. Preserve identity/MFA, authorization, isolation, audit and recovery.

## Branch and product state

This checkout is `feat/artifact-studio`. It preserves the deployed navigation fix and Grok 4.7 roster while adding the complete Artifact Studio scope. The product now has typed durable artifacts; immutable versions and compare; provenance, comments and canonical promotion; Markdown/code/diff/log/report/Mermaid/image/PDF/file previews; isolated script-capable HTML/SVG previews; upload, camera and paste intake; session/project scopes; desktop side panel and mobile full-screen workspace; download/delete; approval-routed Obsidian and repository export prompts; and a `Create with Jarvis` flow that binds an exact run and persists its terminal output idempotently. The chat composer now accepts pasted/dropped/picked images, persists them as linked private artifacts, and submits exact artifact versions to Hermes as bounded multimodal input.

Browser Workbench and the later coding/IDE workbench remain intentionally deferred. Product sequencing is one finished scope at a time.

Production was updated on 2026-09-22 at 15:00 ET from runtime source commit `99bd744d2f8808d45459c2b86301778889b6a349`. The running immutable app image is `sha256:490d39f8a8f9d0766989b4ef99117df4dd71f235f3d19e32a6b583b5592a86ab`; the matching command-proxy image is `sha256:30b84e2bff554b61f729f00feb4bad34e3dfba2a01923f5ed9e748f58cc2fe20`. The previous app and proxy images remain loaded for rollback. Recovery state is retained under `/var/lib/jarvis-command/release-backups/20260922T184854Z-chat-image-command-99bd744` on the Hermes host and `/var/lib/jarvis-command/release-backups/20260922T185007Z-chat-image-app-99bd744` on the Command host.

Live acceptance created a Markdown artifact, saved immutable v2, compared v1→v2, promoted it canonical, added feedback, restarted the service, and read back the exact persisted checksum. A script-capable HTML artifact rendered in an `allow-scripts` opaque-origin sandbox without parent access. Desktop and 390×844 mobile geometry passed. Production chat-image acceptance pasted a PNG into the real composer, persisted and attached version 1, submitted the multimodal run, and exposed a separate bounded private proxy route rather than weakening the ordinary run body limit. The synthetic session and artifact were deleted afterward; the artifact list returned to zero.

Focused server/web/contracts/proxy tests, full repository tests, typecheck, lint, production build, paste-specific Playwright acceptance, deployment helper/supervisor tests, dependency audit, authenticated public-path checks, restart persistence and live cleanup passed. Hermes commit `37b5f49c20` makes API-originated images honor configured native/text routing; the configured auxiliary-vision path was exercised against a known red PNG and returned an exact solid-red description. The independent security/correctness review findings were repaired before release.

The concise canonical product/state/priorities note is `05 Coding Projects/Jarvis Command/Jarvis Command.md` in the vault. Prepared deployments verify requested artifact/provenance, recovery, health and affected behavior without repeating development review.

## History

[Historical status and recovery references](archive/project-status-before-policy-reset-20260908.md) preserves this branch's former detailed handoff. Consult it only for relevant technical facts, not superseded release/review instructions. Resolve demonstrated defects and outstanding authorization constraints; historical review status alone does not dictate the new engineering workflow.
