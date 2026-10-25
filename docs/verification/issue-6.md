# Issue #6 — existing receipt/context repair

Source base: `release/gpt6-sol-luna` at `dd102c5d94e4aca6c2318199879af38447ac32ba`. Candidate branch: `team/command/issue-6`. UI only; no Hermes, BFF, authorization, provider, network or deployment change.

Read: issue #6 including lead assignment, #2's live delta `6399102503` and owner receipt `6398951895`, full `MASTER_PLAN.md` and kickoff on `origin/docs/jarvis-command-v2-plan` (`8df9b018`), and unmerged clarification PR #5 (`4a2857d0`). `/home/neal/AGENTS.md` was permission-denied; the supplied repository policy governs this scoped repair. No architecture/scope expansion.

## Behavior and exact contract boundary

History/reload now displays the existing authoritative **latest saved session receipt**, separately from all message cards. It reuses `ExecutionReceipt`, preserves supplied zero counters, labels absent optional facts unavailable, and never infers a historical run from text, timestamps or message order. Existing rendered live-turn execution receipts remain the only receipt while they own usage. Context has visible compact used/limit and exact accessible value text, including an honest unavailable state on narrow screens.

**Partial acceptance / linkage boundary:** the release's `SessionMessage` has no run ID; `SessionContextResponse` contains only session ID, receipt and observation time. The existing public run GET returns no history binding for this fixture (the release BFF does not project one). There is no public run-list operation. Therefore this candidate cannot restore a receipt on **each exact historical turn** or name the receipt's public run ID from history. It explicitly says “Individual message association unavailable.” Old/unmatched historical messages receive no inferred receipt. No new BFF/Hermes contract, browser run-index storage, hardcoded fixture ID, or stale-run backfill was introduced. Exact per-turn acceptance remains open pending an approved supported identity projection; this PR must not close #6 as fully accepted.

Files: `LiveRoom.tsx`, new `HistoryReceipt.tsx` and focused regression, `TurnView.tsx`, `SessionContextMeter.tsx` and regression, narrowly related styles. One additional bounded session-context GET per selected history snapshot; no inference/token-spend impact, polling, admission, message or artifact mutation.

## Actual authenticated reads — 2026-10-25, approximately 16:41 UTC

Reused session `jc_300d0e2efc094ab38ebc2398d13e5114`, public run `jcr_5c9c5f6e4d89969471684e5b28380bc0`. Existing authenticated Chrome listener `127.0.0.1:44889`; only new test tabs/isolated test context, closed afterward. Original discovery tab left intact. Credentials remained in browser memory and were not written to evidence.

Same-origin GET run/context/history: all 200; completed `M0-RECEIPT-OK`; 25,249 input / 13 output / 25,262 total; reasoning/cache read/cache write supplied 0; 1 API call; 2,340 ms provider / 2,392 ms end-to-end / 5.56 tok/s; effective context 25,249 / 500,000. Requested overrides all null; executed `openai-codex/gpt-6.1-sol`, medium, source wire; `routeSource=unknown`, `exact=false`, `fallbackUsed=false` do not prove route lock. Nine history messages, one fixture reply. Run `updatedAt` tracked this read (~16:41:19Z), unlike #2's earlier observation; no completion-time claim. Session receipt observation remained 14:34:16.377Z.

Normal current bootstrap recents no longer include this older fixture, and no project's last-session slot selects it. A normal GET-only UI selection was unavailable. No project metadata was changed to make it selectable.

## Candidate browser preview — not live deployment

Built candidate HTML/JS/CSS supplied by test-page route interception; APIs used real existing authenticated same-origin GETs. An isolated browser context inherited existing authentication cookies in memory, blocked service workers for that test context only, and used no original tab view/recovery storage. The genuine GET session object was added to this test page's bootstrap recent list so the existing UI could select and reload it. This is **seeded candidate preview evidence**, not an unmodified live-UI acceptance pass. No auth response or API receipt/history was fabricated. Non-GET requests were blocked; none were attempted. No service, root worker or installed browser configuration changed.

After selection/reload at all three widths: one receipt, nine canonical messages, one fixture reply; visible meter `25.2K / 500K` with `5%`; accessible value `25,249 / 500,000 tokens · 5%`. Receipt matches the read fixture including zero counters. No horizontal overflow. DOM geometry and screenshot SHA-256 values: [browser-report.json](issue-6/browser-report.json).

| Viewport | Receipt / meter | Remaining interaction |
|---|---|---|
| 1280×720 | Receipt and denominator readable | Composer visible |
| 390×844 emulated | Receipt and denominator readable | Existing 201 px header; composer visible |
| 360×740 emulated | Receipt exists and meter denominator readable | **Not full visual acceptance:** existing #7 header is 633 px; receipt screenshot is clipped, composer bottom ~780 exceeds viewport |

Sanitized element crops: [desktop receipt](issue-6/1280-receipt.png), [390 receipt](issue-6/390-receipt.png), [360 clipped receipt](issue-6/360-receipt.png), [desktop meter](issue-6/1280-meter.png), [narrow meter](issue-6/390-meter.png). No unrelated conversation, account identity or navigation included. Crops are component evidence, not full-screen acceptance.

Physical Android, soft keyboard/touch, native Bot/group contracts, visual direction and #2 discovery remain pending/separately owned. Emulation does not satisfy them. #7's header repair and PRs #3/#4/#5 are untouched.

## Validation and status

- Regression proof against unchanged release components: the new history/meter regression files failed (7 failing tests / 2 passing); restored candidate passes. Baseline attempt used temporary source substitutions restored immediately, with no commit/base change.
- Initial focused web run: six files, 174 tests passed (`HistoryReceipt`, `LiveRoom`, `TurnView`, `SessionContextMeter`, `ReloadRecovery`, `LiveTurn`). Final affected-component run: 3 files / 18 tests passed, including added live-receipt duplication and session-switch cases and final placement/safety fixes.
- Web typecheck, changed TypeScript/TSX ESLint and Vite production build passed. Existing Vite large-chunk warning remains.
- Self-review: session validation, abort/stale-result isolation, no message association inference, no POST/storage admission path, zero-vs-absent fields, existing live/history projection untouched.

Built locally: yes. Merged: no. Deployed: no. Live candidate activation/readback: not performed. Exact historical per-turn acceptance and 360 px full usability remain open. No deployment rollback is needed; a future authorized release can revert this isolated UI commit via its normal recoverable path. No next issue started.
