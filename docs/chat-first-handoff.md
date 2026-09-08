# Chat-first frontend handoff

Branch: `codex/chat-first-shell`, based directly on frontend checkpoint `ea7697166a6423a28fcc14400a379899792c709b` (tree `5329cd925f5777d9279b64f03c23da081b64e7fb`). Target the existing `feat/room-workspace-usability` branch for review. Do not merge into the older application state on main without reconciling its history.

## What changed

The three approved mockups are implemented as states of one workspace: conversation, expanded project chats, and optional project details. There is one sidebar with new chat, search, projects, recent chats, and settings. The right pane resizes on desktop and becomes a focused sheet on narrow screens. The conversation title appears once. Hermes connection facts are available on demand; unhealthy connection states remain visible.

Project create/edit, Save/Cancel, failed-save draft retention, exact chat selection, association recovery, existing typed approvals, stop/steer controls, and history reconciliation remain connected to the existing API. Saved tool output and live activity use disclosures. New replies stay in view; scrolling back disables automatic following. External chats remain read-only. References remain metadata and are not applied automatically.

No backend, authorization, deployment, runtime-recovery, or live-turn identity/reconciliation modules changed. No model/reasoning overrides, file upload, artifact storage, or automatic repository access were added.

## Validation

- 147 focused web tests passed across App, ProjectRooms, LiveRoom, and LiveTurn; the shell was checked again after scroll handling changed.
- Web typecheck, lint of changed code, and Vite/PWA production build passed.
- Cloud browser: conversation/project selection, pane resize keys, Save/error/reopen/retry, selected-chat retention, synthetic send/completion, phone navigation, Escape, focus entry/wrap, and 320/390/844 CSS-width layouts.
- `e2e/workspace.integration.ts` selectors/layout checks were adapted. This real-chain suite was **not rerun** here; existing backend evidence is inherited, not renewed.
- Physical phone, software keyboard, actual Hermes traffic, production Access, and deployment acceptance remain unverified by this change. See `design-qa.md` for visual checks and remaining polish.

## Reproduce the isolated preview

Run `npm ci`, then `npm run dev -- --host 0.0.0.0 --port 4173 --strictPort` at the repository root. These explicit preview flags launch only `e2e/chat-first-preview.ts` plus Vite. Ordinary `npm run dev` retains the server/web development workflow. `/viewport-preview.html` provides 390×844, 320×640, and 844×390 iframe views.

Everything in the preview is synthetic and held in memory; no Hermes endpoint or credentials are used. The name `Preview save failure` exercises failed-save behavior. A serve-only compatibility script supplies cryptographically random UUIDs for this HTTP preview; it is absent from the production HTML/build. Production keeps the native HTTPS UUID path.

## Hermes continuation prompt

> Frontend ownership remains with Codex; keep overlapping UI jobs paused. Fetch `codex/chat-first-shell` and inspect the diff against `ea7697166a6423a28fcc14400a379899792c709b`. Keep `handoff/runtime-recovery-wip` separate. Run the adapted workspace integration check against this frontend when preparing runtime integration. Report concrete API or runtime incompatibilities for Codex to fix; do not redesign the shell. Deployment stays with Hermes and must use the existing release/rollback path when authorized. Do not treat this draft PR or local preview as deployment acceptance.
