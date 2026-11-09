<!-- dev-studio:auto -->
# Issue #96 browser candidate fixture

Status: unavailable for full acceptance. This is offline candidate evidence only.

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
