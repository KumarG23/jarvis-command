# Jarvis Command — current branch handoff

## Source and deployment identity (2026-10-26)

Canonical release branch: release/gpt6-sol-luna. The UI commits for narrow headers and saved receipt/context were originally merged without the production-only durable Hermes contract and terminal audit fixes. The reconciliation merge on this branch incorporates the deployed integration lineage c142e9f3ed5ccd42b745df803de2e5c506113baf, including backend commits 6a18472 and fe3ea4b, while retaining canonical PR-validation CI. Its backend and web source trees match the deployed integration revision; the additional changes are canonical CI and this handoff note. Do not rebuild the pre-reconciliation 5119ddd source as though it represented production.

VM113 currently runs app image sha256:98e7050126d7e11e6f94d7218c909603148918880ab00ebd269401d1db87a7de, labeled with source c142e9f3ed5ccd42b745df803de2e5c506113baf. The last cutover only replaced the app-image pin; it preserved the independent Command proxy. The baseline app image sha256:16778467dc81805afd0b4ae5a28d490f50daba3dc26b5a4b1fa2650bca902ee1 remains available for rollback. This source reconciliation is not a deployment and does not change the running image. A later release must still verify its own artifact provenance, rollback, health, and public Access boundary.

## Current policy (2026-09-08)

Follow `../AGENTS.md` and `/home/neal/AGENTS.md`. Build first, validate proportionately; one owner, coherent batch, focused tests and applicable type/lint/build, concise self-review. Classify the change, not the repository. Name a concrete failure risk before broader testing or independent review. No mandatory whole-candidate approval, repeated full gates, source-read receipts or parent reviewer audits. Preserve identity/MFA, authorization, isolation, audit and recovery.

## Branch and product state

This checkout is `release/gpt6-sol-luna`, based on the deployed Artifact Studio branch. It preserves the complete Artifact Studio and chat-image scope while adding GPT-6 Sol and Luna to the curated per-prompt roster. GPT-5.6 Sol and Luna remain explicitly selectable as rollback lanes; authenticated Hermes inventory validation and exact-route admission remain unchanged.

Browser Workbench and the later coding/IDE workbench remain intentionally deferred. Product sequencing is one finished scope at a time.

Historical release: production was updated on 2026-09-22 at 18:10 ET from pushed source commit `26d374378abfd282c9951ded2d0c34a8f40919f0`. The then-running immutable app image was `sha256:8500562a986e58d7fbe32784cb899cb0b9fea8d5656fff3943501f019af71518`; the command-proxy image is `sha256:efbe43b6be60645e4954ebce4068c95b9f939670113899e09175b5eeea583a7f`. The prior Artifact Studio app and proxy images remain loaded. App rollback is `/var/lib/jarvis-command/release-backups/20260922T181004-0400-gpt6-roster`; command-proxy rollback is `/var/backups/jarvis-command/20260922T180836-0400-gpt6-command-proxy`.

Focused contracts, command-proxy and web tests passed with repository typecheck, lint and production build. Production inventory returned GPT-6 Sol/Luna plus both GPT-5.6 rollback routes without provider metadata. Disposable exact-route turns completed through Jarvis Command as `openai-codex/gpt-6-sol` and `openai-codex/gpt-6-luna`, each with one API call, wire-level requested reasoning, no fallback, and matching execution receipts; the temporary session was deleted.

Live acceptance created a Markdown artifact, saved immutable v2, compared v1→v2, promoted it canonical, added feedback, restarted the service, and read back the exact persisted checksum. A script-capable HTML artifact rendered in an `allow-scripts` opaque-origin sandbox without parent access. Desktop and 390×844 mobile geometry passed. Production chat-image acceptance pasted a PNG into the real composer, persisted and attached version 1, submitted the multimodal run, and exposed a separate bounded private proxy route rather than weakening the ordinary run body limit. The synthetic session and artifact were deleted afterward; the artifact list returned to zero.

Focused server/web/contracts/proxy tests, full repository tests, typecheck, lint, production build, paste-specific Playwright acceptance, deployment helper/supervisor tests, dependency audit, authenticated public-path checks, restart persistence and live cleanup passed. Hermes commit `37b5f49c20` makes API-originated images honor configured native/text routing; the configured auxiliary-vision path was exercised against a known red PNG and returned an exact solid-red description. The independent security/correctness review findings were repaired before release.

The concise canonical product/state/priorities note is `05 Coding Projects/Jarvis Command/Jarvis Command.md` in the vault. Prepared deployments verify requested artifact/provenance, recovery, health and affected behavior without repeating development review.

## History

[Historical status and recovery references](archive/project-status-before-policy-reset-20260908.md) preserves this branch's former detailed handoff. Consult it only for relevant technical facts, not superseded release/review instructions. Resolve demonstrated defects and outstanding authorization constraints; historical review status alone does not dictate the new engineering workflow.
