# P11 model-family marks — source candidate, browser acceptance incomplete

Base: accepted release `ef80628`. Original #110 worktree stays at `1906e1e`;
#96/#115, notification and plan worktrees/source are untouched. This is a new
source-only branch, not a P11 Done/released/live claim. Phone check pending.

Small original OA/CL/GE/GR monograms have persistent accessible labels. Explicit
executed provider/model pairs map OpenAI, Claude, Gemini and Grok; unsupported,
incomplete or conflicting pairs display a neutral `?` / “Model family unknown”.
OpenRouter requires an explicit matching vendor-qualified model. This display
mapping grants no route eligibility. Requested route, session.model and answer
text are never evidence. A requested/executed mismatch marks actual execution
while retaining existing route/fallback/usage/copy labels and telemetry.

Live response and run-receipt marks require the existing verified turn/run,
with no conflicting event run id. Canonical message attribution additionally
requires the existing exact session/run/user/assistant binding validated by
`matchTurn` on complete history. Baseline/text-only echo projection is excluded;
two runs claiming the same message stay unknown. No new binding or endpoint.
The installed runtime's historical binding support is not established by this
fixture. Latest-session receipt marks stay inside its explicitly labelled aside;
no latest-session receipt is joined to a selected historical answer.

53 focused web checks pass (ModelFamilyMark, TurnView, LiveRoom, HistoryReceipt),
including known/null/conflicting identities, actual-route mismatch, unverified
turns, incomplete/foreign/ambiguous bindings, duplicate answer text and latest
receipt isolation. Accessible labels and WCAG AA contrast are checked against
actual CSS tokens on existing dark surfaces; minimum colored accent contrast is
7.00:1. Web typecheck, changed-file lint and affected web build pass. Existing
project/header checks and their accepted evidence are unchanged and reused.

Browser budget: **two wrapper attempts consumed; no third run**. All browser
work used own isolated contexts in approved existing Chrome through Studio,
task `command#issue-97`. APIs were intercepted with labelled synthetic fixtures;
no production reads/writes, provider calls, real admissions, auth export or
original-page/storage interaction. Owned contexts closed; Chrome left running.

1. Initial baseline runner exited 1 at desktop: target detached while scrolling
   a transitioning live response. Harness now waits for terminal status and
   scrolls the timeline container. No complete result is claimed for that run.
2. Final combined baseline/candidate runner exited 1: all three baseline cases
   passed (1280×720, 360×740, 360×360). Desktop candidate passed latest-session
   isolation, actual Claude live response, fallback receipt and spend assertions,
   then failed its canonical-history assertion: expected two Claude mark nodes,
   observed zero. Candidate mobile cases did not run. Baseline screenshots and
   partial desktop candidate captures below are not full browser acceptance.

Diagnosis from current recovery source: the fixture seeded the legacy singleton
after V2 had already imported it. No retained turn was restored; canonical replies
correctly stayed neutral and only the separately labelled latest receipt had a
family mark. Fixture now seeds the existing version-2 thread recovery record.
That correction is linted but **not browser-verified** because the budget is
exhausted. Unit integration tests independently prove exact-bound attribution
and neutral text-only history. No production recovery logic was changed.

The standalone config expects the original release build retained locally at
`test-results/model-family-baseline`; it serves that and the candidate build on
isolated loopback previews. A later explicitly admitted QA turn can use the same
Studio wrapper around `npx playwright test --config e2e/model-family-marks.config.ts
--max-failures=1` after preparing both builds. Do not replay this turn automatically.

Synthetic captures (baseline canonical history had no retained recovered turn):

| Size | Baseline | Partial candidate |
| --- | --- | --- |
| 1280×720 | [latest aside](issue-97-model-marks/1280x720-SYNTHETIC-before-latest-separate.png), [live](issue-97-model-marks/1280x720-SYNTHETIC-before-live.png), [receipt](issue-97-model-marks/1280x720-SYNTHETIC-before-receipt.png), [history](issue-97-model-marks/1280x720-SYNTHETIC-before-history.png) | [latest aside](issue-97-model-marks/1280x720-SYNTHETIC-after-latest-separate.png), [live](issue-97-model-marks/1280x720-SYNTHETIC-after-live.png), [receipt](issue-97-model-marks/1280x720-SYNTHETIC-after-receipt.png); bound-history check failed |
| 360×740 | [latest aside](issue-97-model-marks/360x740-SYNTHETIC-before-latest-separate.png), [live](issue-97-model-marks/360x740-SYNTHETIC-before-live.png), [receipt](issue-97-model-marks/360x740-SYNTHETIC-before-receipt.png), [history](issue-97-model-marks/360x740-SYNTHETIC-before-history.png) | Not run |
| 360×360 | [latest aside](issue-97-model-marks/360x360-SYNTHETIC-before-latest-separate.png), [live](issue-97-model-marks/360x360-SYNTHETIC-before-live.png), [receipt](issue-97-model-marks/360x360-SYNTHETIC-before-receipt.png), [history](issue-97-model-marks/360x360-SYNTHETIC-before-history.png) | Not run |

Sol owns review, further admitted fixture acceptance, merge, recoverable release
and authenticated applicable-receipt readback. Full P11/model marks are pending.
