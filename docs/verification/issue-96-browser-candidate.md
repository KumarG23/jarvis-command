<!-- dev-studio:auto -->
# Issue #96 browser candidate fixture

Status: offline synthetic candidate fixture PASSES (see the P10.5 section at the end; the earlier sections are history). Not live route acceptance.

The Studio wrapper accepted the prepared local endpoint/profile configuration and ran the issue-owned fixture with task `command#issue-96`. The wrapper acquired its lock and the Playwright test created a new context. A first, limited fixture run passed the Free label, catalog Use action, provider-default effort state, and viewport checks at 1280×720, 360×740, and 360×360. That run did not exercise send or draft/error behavior and did not assert that model inventory had loaded.

The stricter fixture now validates its synthetic bootstrap payload against `CommandBootstrapSchema`, waits for bootstrap and model inventory, simulates one inventory 429, checks draft retention, and checks one exact synthetic run request. On three subsequent wrapper runs, the isolated page rendered **Command unavailable**; no model-options inventory loaded, so no send or draft/error acceptance ran. The Playwright runner timed out once at 30 seconds and twice at 90 seconds. The final error context contained the unavailable screen. No conclusion about production behavior follows from this fixture state.

Each run used only a new Playwright context owned by this task and closed that context. The original browser tabs and storage were not inspected or changed; Chrome was left running. The wrapper lock was respected. No authenticated readback, provider call, live API mutation, proxy operation, or physical-phone check occurred.

Source checks in PR #109 and this candidate browser state are separate. The full desktop/mobile candidate fixture, live route proof, and physical-phone acceptance remain unverified.

## Bounded #115 follow-up (2026-11-06)

Status: **partial candidate evidence; full acceptance deferred after two failed
attempts**. No third browser run was made. Both required Studio-wrapped runs used
`command#issue-115` in its own worktree, the existing local configuration, a new
synthetic context and an app built from preserved PR #109 head `66a8a251`.
The #96/#97 branches, WIP and sessions were preserved.

Prior-gap recheck: the original strict fixture used a manually created context
and awaited the full navigation load before checking bootstrap (`66a8a251`,
`e2e/issue-96-browser.spec.ts:10`, `:63`). #115 attempt 1 retained that lifecycle,
added response/error observation, and again timed out at 90 seconds with
**Command unavailable**. Its post-navigation diagnostic attachment was never
reached. This reproduces the prior gap; it does not establish an HTTP/schema cause.

Attempt 2 uses #97's accepted `base.extend({ browser })` owned-page/context
pattern (reference: `0752a408`, `e2e/project-identity.spec.ts:6`) and bounded
`domcontentloaded` navigation. It asserts the received bootstrap HTTP 200,
validates the received JSON against `CommandBootstrapSchema`, and verifies the
mounted synthetic development-preview label before selecting the chat. These
assertions passed. This proves a valid synthetic bootstrap reaches the mounted
Command UI; it does not isolate which lifecycle/navigation difference caused the
first run's unavailable state. Diagnostic recording now also runs in `finally`.

Attempt 2 passed Free labels, provider grouping, search, Use selection, disabled
provider-default effort and the omitted-effort selection state. Synthetic inventory
returned 200 then one 429; the exact error appeared, the draft remained, and there
were **zero POSTs**. There were no page errors; the only console error was the
expected synthetic 429. It then timed out waiting for **Retry model choices**.
The error snapshot shows the picker dismissed: clicking the outside Send button
closes it (`apps/web/src/TurnView.tsx:294`, `:492`); Retry lives inside it (`:519`).
The existing inference-controls fixture explicitly reopens the picker before Retry
(`e2e/inference-controls.spec.ts:56`). The final fixture adds that same reopen
before Retry and before viewport checks, preserving every assertion. These final
reopen steps are **not browser-verified**, because the two-attempt cap applies.
The exact synthetic provider/model-only POST, explicit retry completion, and
1280×720 / 360×740 / 360×360 full viewport sequence remain unverified.

[Sanitized attempt-2 network evidence](issue-115-synthetic-diagnostic.json) records
only synthetic API paths/statuses/errors and observed outcomes. The owned context
closed with zero pages; the wrapper released ownership and exited **1**. Original
tabs/storage were not accessed, and Chrome was left running. No authenticated
readback, live inference/provider call, live API mutation or browser smoke claim.
**Phone check pending.**

Reproduction commands (configuration values intentionally local): build with
`npm run build -w @jarvis-command/web`, then invoke the existing Studio
`tools/browser_qa.py run --endpoint <configured> --profile <existing>
--task command#issue-115 --cwd "$PWD" -- npx playwright test
--config e2e/issue-96-browser.config.ts`. No independent browser launch.

CI diagnostic: inspected validate run `42270640806`, job `128073973490`;
its sole workspace failure is `LiveTurn.test.tsx:265`, a running generation
record after the saved-artifact message. The unchanged focused command
`npm test -w @jarvis-command/web -- src/LiveTurn.test.tsx -t 'creates an artifact
with Jarvis only from the exact successful terminal run'` passed **1 / 117 skipped**
(3.70s). This does not reproduce the CI failure or establish flakiness.
`ArtifactStudio.tsx:165–167` sets the saved message then consumes the save;
`App.tsx:781` schedules pending-generation cleanup, and `App.tsx:352–354`
persists that state in a separate effect. The saved message is not a storage
completion barrier. The proposed synchronization fix waits for the same exact
null-storage assertion; it neither changes production behavior nor retries a
failed test. The changed focused command passed **1 / 117 skipped** (3.56s).
Web typecheck, scoped ESLint, candidate web build and diff checks pass. Reused
unchanged proxy167/server280/contracts63/header28/turn-recovery46 evidence;
no full-suite rerun or CI polling. New exact-head CI and Sol review remain pending.
The inherited live proxy release/enablement/route-proof prerequisite remains deferred.

## P10.5 candidate completion on integrated base (2026-11-09, #115 / PR #118)

Status: **offline synthetic candidate fixture passed; live route proof and phone check pending.**
Source is the ordinary merge of `release/gpt6-sol-luna` (`21f971ae`) into the preserved
#109 + #118 stack (`f9ae034`, containing `33c9ea2`); no reset/rebase/force. Flag stays
default-disabled; no provider, proxy, flag, auth or network action.

Prior-gap recheck: the retry/viewport failure was the picker being dismissed by the outside
Send button (`TurnView.tsx` Send vs. in-picker Retry); the committed reopen-before-Retry step
was exercised for the first time and works. The `LiveTurn.test.tsx` artifact-cleanup
`waitFor` conflicted with an equivalent canonical repair; canonical's was kept once.
New remaining failure on the integrated base (reproduced, run 1): the strict unexpected-request guard
rejected canonical's newer `GET .../thread-state` and `POST /api/notifications/presence`.
Fixed in `e2e/issue-96-browser.spec.ts` by reusing the accepted `handleThreadState`
(Unknown, never unread) and `handlePresence` (strict `{sessionId, visible}` 204) seams; no
assertion weakened and `unexpected` must still be empty.

Wrapper runs (task `command#issue-115`, own worktree, new synthetic context, built candidate):
run 1 failed as above; run 2 and run 3 (adds screenshots) **passed, wrapper exit 0**. Verified in
one test: bootstrap 200 and schema-valid and mounted; grouped searchable Free label, `Use`
selection, disabled Provider-default effort; inventory 429 shows the unavailable notice,
draft retained, **zero POSTs**; after explicit reopen + Retry, **exactly one** `POST /api/live/runs`
with keys `clientRequestId,inference,input,sessionId` and inference `{provider, model}` only; draft
cleared on that send; panel within bounds with no horizontal overflow at 1280x720, 360x740,
360x360 (named captures inspected: `issue-96-free-selector-<w>x<h>.png`; the panel scrolls
internally at 360x360 with controls reachable). Owned context closed with zero pages; original
tabs/storage untouched; Chrome left running. A post-close vite proxy ECONNREFUSED for a
presence beacon is the preview having no backend; no request reached a real API.
Synthetic evidence only: no authenticated readback, no live inference. **Phone check pending.**

## Review 6747589420 repair: egress guard and per-viewport adverse sequence (2026-11-09)

Status: **offline synthetic candidate only; supersedes the single-test claims in the section above** (its "zero POSTs"
counted run admissions only, and its post-close presence ECONNREFUSED was a forwarded request, not isolation).
Phone check pending; no authenticated readback, live inference or route proof.

- **Isolation:** `e2e/issue-96-browser.config.ts` now serves the candidate through
  `e2e/issue-96-browser.preview.config.ts` (`proxy: {}`, `/api` answers 503), the same pattern as
  `thread-status.preview.config.ts`, so nothing falls back to the loopback BFF. The spec asserts
  `STUDIO_QA_TASK_ID === 'command#issue-115'`, and installs a context-level guard **before navigation** that stays
  through teardown: any non-preview origin is aborted and recorded, `/api` is served only by the synthetic handler,
  and WebSockets are refused and counted. After the send the test navigates to `about:blank` so the unload presence
  beacon runs under the guard. Result in each case: escaped requests/websockets `[]`, unexpected `[]`.
- **Per-viewport cases:** three independent tests (desktop 1280x720; 360x740 and 360x360 with mobile emulation,
  touch `tap`). Each runs bootstrap, grouped/searchable Free label, Use selection (provider-default, effort disabled),
  keyboard-typed draft, Send with one inventory 429 -> notice, draft retained, **0 run admissions**; explicit picker
  reopen + Retry (still 0 admissions); Send -> **exactly 1** `POST /api/live/runs` with keys
  `clientRequestId,inference,input,sessionId` and inference `{provider, model}` only; draft cleared; same session
  header. Presence is counted separately (3 requests per case, `204`, strict `{sessionId, visible}`).
- **Reachability:** for the session row, picker summary, catalog search, Use, draft input, Send (twice) and Retry the
  test scrolls into view and requires the control's centre to be inside the viewport and topmost by
  `elementFromPoint` (catches clipping ancestors and overlays), plus focus on the draft.
- **Run (wrapper, task `command#issue-115`, new synthetic contexts):** run 4 failed only on my own session-identity
  locator (everything through the send had passed in all three cases); run 5 after fixing that locator:
  **3 passed, wrapper exit 0**, each context closed with zero pages. Captures
  `issue-96-<case>-{1-catalog,2-error-draft-retained,3-retry,4-sent}.png` inspected for 360x360 (error, retry) and
  360x740 (sent): Retry sits inside the internally scrolling picker; the 360x360 composer Send button is partly
  below the fold but its centre is in the viewport and hit-tested. Original tabs/storage untouched, Chrome left running.

## Re-review 6747686821 repair: full-bound reach at 360x360 (2026-11-09)

Status: **offline synthetic candidate only; phone check pending; no live route or authenticated proof.** This
**corrects the "centre in viewport" reachability claim and the "partly below the fold" note above**: the earlier
helper checked only the control's centre and accepted a Send button whose bottom was clipped.

- **Diagnosis (no production change needed):** at 360x360 the P13 rule `@media (max-height: 480px)
  .command-main:has(.header-thread-states) .composer-wrap { max-height: 35dvh; overflow-y: auto }`
  (`apps/web/src/styles.css`) caps the composer footer at 126px; after the inventory 429 the preflight notice grows the
  composer to 202px. In the natural (unscrolled) state Send's box is `[295,325,339,369]` against clip bottom 360, so it
  is clipped by 9px, and the draft input `[21,306,290,369]` likewise. The footer is an existing scroll container, so no
  TurnView/styles change was made. Desktop and 360x740 are fully visible without scrolling.
- **Fixture:** `reachable` now requires the full rectangle inside the viewport and every clipping ancestor
  (`overflow` auto/scroll/hidden/clip) plus a centre hit, after the user's own `scrollIntoViewIfNeeded`; `extent`
  measures without scrolling. After the 429 the spec records the natural state, then requires the whole draft input and
  Send to be reachable, scrolls the composer footer to its end, requires Send reachable and the composer's bottom edge
  inside its clip, and asserts scrolling admits no run. The natural-state geometry is recorded in the diagnostic
  attachment (`naturalAfter429`), so the clipping stays visible rather than hidden.
- **Run (wrapper, task `command#issue-115`, new synthetic contexts):** run 8 on this head: **3 passed, exit 0**,
  each with 1 run admission, 3 presence requests, escaped `[]`, unexpected `[]`, context closed with zero pages.
  Captures inspected: `issue-96-short360x360-2a-error-natural.png` (clipped, honest), `-2b-error-draft-scrolled`,
  `-2c-error-send-scrolled`, `-2d-error-composer-end` (full Send, composer bottom edge and retained draft visible).
  Retry state: the picker panel scrolls internally and Retry is fully reachable; Send is reachable after the retry once
  the picker closes (Send itself dismisses the picker).
- **Request categories:** "zero POSTs" means zero `POST /api/live/runs` admissions; foreground-presence POSTs
  (`/api/notifications/presence`, 3 per case) are counted separately.
