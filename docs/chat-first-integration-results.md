# Chat-first integration results — 635efbd

## Verdict

**Preview refreshed; integration acceptance remains blocked by runtime/backend dependencies. No merge, production application replacement, production backend activation, approval-policy change, or runtime-recovery WIP integration occurred.**

Preview: https://command.sharma-house.com/api/preview/chat-first/

- Exact frontend source: `635efbd2c4a2f5dc3511115c9f68ab10d1012e4a`.
- Build command: `JARVIS_PREVIEW_BASE=/api/preview/chat-first/ npm run build -w @jarvis-command/web`. PWA registration disabled by the candidate's supported flag, without source patches.
- Deployed BFF/command-proxy source checkpoint remains `584c3fc6f45dbc60cc8768ecd39c59e92cd219f8`, bound by the retained deployment receipt to the unchanged live image identities.
- App image: `sha256:83ea45ec8a19c7b88cc7b894375bd67f25858249ffa0d464ff85d48c8b3cf431`.
- Command proxy image: `sha256:12b2c0dad24a92bedce266d24e4baf182ca8b7bbe8aefece148ca19a8bf16235`.
- Running Hermes source: `5a0b1ba766956a1a16bc2f17dc3b83eb63633402`.
- Candidate BFF containing metadata editing was built/tested from `635efbd2c4a2f5dc3511115c9f68ab10d1012e4a`, but **not deployed**.

Authenticated public reads matched every preview asset hash and version/header identity. Anonymous preview and version requests returned Cloudflare Access 302 redirects. Existing tunnel/Access configuration was unchanged. Production root-shell SHA-256 remains `bf53e54031616ef2d6098979a53ea15c74ce93746bd774da17cd9e41b950f033`. Preview rollback is `/var/lib/jarvis-command-preview-backup-exoryxg4` on VM113; transfer staging was removed and absence verified.

## Changes made

Only isolated integration test files and documentation were changed. Frontend production sources and the Hermes checkout were not edited.

- Fixed the remaining real-chain denial teardown hang. The synthetic upstream retained a zero-byte replacement TCP connection after SSE cancellation. BFF/proxy closes had completed and no response stream remained, so response-only cleanup could not release it.
- Set `forceCloseConnections: true` only on the synthetic upstream, which closes **after** normal downstream teardown. No application/proxy shutdown behavior changed and no timeout was inflated.
- Added cleanup regressions covering the open stream, aborted stream plus extra probe, and a zero-byte replacement socket; allowed an explicit fixture-only WEB_DIST_DIR for isolated compiled build testing.
- Documented the smallest required runtime contract and activation boundary in `docs/history-binding-runtime-prerequisite.md`.

## Validation

- Updated full real-chain browser integration: **6 passed**, desktop and phone, including both denial cases completing teardown. Final run: 45.1 seconds; denial cases 4.3 and 4.8 seconds.
- Workspace browser integration: **2 passed**, desktop and phone; edits, persisted project navigation, filtering, and chat resume.
- Cleanup regression: **3 passed** (focused worker verification); changed-test lint passed.
- Focused BFF/backend checks: **75 passed** across live-room service (21), command client (21), project rooms (12), live-room routes (21). Metadata tests prove exact GET readback, preservation of session IDs/last selection, and restart persistence; negative auth/origin/metadata cases preserve existing state.
- Focused web history/recovery/environment checks: **73 passed** under the web workspace's jsdom configuration. Includes authoritative-ID consumer behavior and preview/prod storage separation. This is not evidence of a live runtime producer.
- Full workspace build and server typecheck passed. Supported isolated preview build passed.
- Compiled preview sign-in exercised in a disposable browser against a synthetic 401: existing real root worker stayed registered, seeded production session/local storage remained byte-exact, navigation returned to the clean preview prefix, and no root `/api/auth/recover` or recovered production-run request occurred. This is browser-code/state-isolation evidence, not a fresh live Cloudflare expiry/MFA test. Authenticated public preview navigation also retained the existing installed production root worker.

## Remaining live blockers

### 1. historyBinding producer unavailable — not implemented

Installed Hermes does not expose exact persisted user/final-answer IDs bound to a run. An opted-in completed status read also confirms the field is absent. Per the handoff contract, no binding was synthesized from text, last position, timestamps, or private database scraping. Implementing a real producer requires the runtime persistence receipt described in the prerequisite document, then validated proxy/BFF projection with old-client shape negotiation.

Live proof on the refreshed frontend: two identical replies were saved during consecutive fixture turns; the second run was reloaded while running. Both runs completed. The older reply's exact saved ID and content survived. Authoritative history contains **2** matching assistant messages, while the UI renders **3** copies. The duplicate is still real; frontend-only deployment cannot close it.

### 2. Metadata editing needs candidate BFF activation

Candidate endpoint `POST /api/rooms/:roomId` is included and locally passes authoritative persisted readback and restart tests. The current live BFF still returns **404**. One labeled existing test project was probed; GET readback proves metadata, chat membership, and last selection remained unchanged.

The path-scoped preview uses absolute root `/api` calls. A second backend cannot be selected merely by deploying different static assets. No Referer-based routing or shared-audit parallel writer was introduced. Activate a separately authorized Access-protected candidate origin/runtime, or approve a recoverable production backend cutover after implementation; see the prerequisite document. Production was not changed to make this pass.

### 3. Real Hermes approval/denial disabled by runtime policy

The installed configuration reports `approvals.mode: off` and `approvals.enabled: false`. A harmless `rm -rf` targeting only a newly created owned fixture directory completed without a pending approval; the expected file removal was read back. It is **not** a successful approve-once round-trip. The denial fixture was never submitted. No fake approval was fabricated and no policy changed.

The polling harness was stopped after terminal completion, and its exact owned heavy unit was verified inactive with MainPID=0. Remaining disposable fixture files were removed with absence verified. A genuine once/deny test requires explicitly scoped manual approvals on the candidate runtime.

## Scope and evidence

- Integration worktree: `/home/neal/code/jarvis-command-integration`, branch `integration/chat-first-history-binding` (name reflects intended task, not completion of the blocked producer).
- Frozen frontend build worktree: `/home/neal/code/jarvis-command-preview-635efbd`.
- Review artifacts backup: `/home/neal/backups/jarvis-command/chat-first-integration-635efbd`.
- Runtime-recovery branch remains `handoff/runtime-recovery-wip` at its original state; pre-existing AGENTS.md WIP is untouched. Other UI worktrees were not edited or resumed.
- One new clearly test-purpose chat remains with three completed runs. Supported API deletion is unavailable; no database deletion was attempted. The prior labeled project remains unchanged.
- Parent's initial failing denial fixtures were identified by exact recorded audit/public-run identity, archived, and removed. Successful final test fixtures did not remain.
- Earlier harness mistakes are not product defects: DOM tests were first invoked under Node instead of jsdom (corrected and passed); an unnecessary nonexistent contracts build script was attempted before using the documented successful preview build; a live history assertion first looked for top-level hasMore instead of pagination.hasMore. The last was resumed from its recorded completed admission without replaying it. None of those failed attempts is counted as a pass.

Neal's successful messages and good physical-phone layout in a private browser count as user-provided acceptance evidence. Only keyboard-open composer/Send visibility remains to clarify.
