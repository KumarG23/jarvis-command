# Issue #7 — confirmed baseline repair

2026-10-26, `team/command/issue-7`; implementation `b571d3f`, following preserved
`64fed98a5e60c43633c6aeff3fcac009f5e71758`, based on `release/gpt6-sol-luna` / `dd102c5`.
The tests ran on the working tree before that implementation commit. Their runner
metadata correctly records the parent HEAD; the tested CSS/spec/config bytes were
compared with `b571d3f` and match. This report adds documentation only.

The actual project path exposed a 14 px title/project width in the inherited
candidate at 360 px (focused test exit 1). The repair gives the existing mobile
controls a second header row, constrains both identities, and anchors mobile
lifecycle feedback to the actions row. Desktop retains one row. The prior 400 px
font/button/composer reductions are removed; composer styling matches release.
Original `shell.spec.ts` is restored byte-for-byte to `dd102c5`.

## Fixture and method

All new evidence is **synthetic local Chromium**, served by a static loopback
preview on port 3107. No BFF, live Hermes reads/writes, authenticated browser or
other owner's session was used. Existing fixture identity attribution is
`jc_300d0e2efc094ab38ebc2398d13e5114` /
`jcr_5c9c5f6e4d89969471684e5b28380bc0`; these tests do not reproduce its actual
history or bind any receipt to that run. The fixture supplies five synthetic
messages and synthetic context 15,500/128,000.

Bootstrap, project room, resolved session, context, history, capabilities, model
options and running/failed status are parsed with production schemas. Selecting
the real Projects navigation button resolves its `lastSessionId` through the
existing GET path. Reload restores the selected project/session. No breadcrumb
DOM insertion or project-membership POST is used. Every API request is intercepted;
unexpected paths and all non-GET methods are aborted and fail the candidate tests.
Pending recovery is seeded only in isolated test browser storage. Feedback is
asserted exactly as `Compacting…` or `Context compaction could not be completed.`

## Reproduction and actual process results

Run from the repository root, in order; each command's process status was captured
directly, with no masking pipeline:

| Command | Result |
| --- | --- |
| `npm run build -w @jarvis-command/web` | exit 0; existing large-chunk warning |
| `npx playwright test --config e2e/header-layout.config.ts` | exit 0; 9 passed, 0 skipped; 11:19:00 UTC |
| `HEADER_CSS=release npx playwright test --config e2e/header-layout.config.ts` | exit 1; 6 narrow layout failures, 3 desktop passes, 0 skipped; 11:19:47 UTC |
| `npx eslint e2e/header-layout.spec.ts e2e/header-layout.config.ts` | exit 0 |
| `npx tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --skipLibCheck --types node e2e/header-layout.spec.ts e2e/header-layout.config.ts` | exit 0 |

The release comparison bundles the **entire unchanged** `git show
dd102c5:apps/web/src/styles.css`, including its font imports, with Vite. It replaces
the single stylesheet response before page load in fresh browser contexts. It
never overlays candidate CSS. The candidate uses its actual built stylesheet.
Both runs use the same fixtures and assertions, with no caught assertion errors,
expected-failure conversion or skipped baseline. A green release run would be an
unexpected reproduction result, not failure evidence. The observed six failures
are actual rectangle assertions (`header top`), not setup/schema/network errors.
The release narrow cases stop before reload at their first layout failure.

## Measured geometry and inspected captures

Candidate measurements below are identical before/after reload and across idle,
running and failed cases. All title/project/control/composer/input rectangles fit
the viewport; title/project clear both actions and buttons, readable identity
width is at least 80 px, context is visible, and horizontal overflow is 0.
Trial clicks check reachable controls without activating operations.

| Viewport | Header height | Title / project width | Actions rectangle (x,y,w,h) | Composer bottom |
| --- | ---: | ---: | --- | ---: |
| 360×740 | 102 | 291 / 291 | 12,55,336,36 | 740 |
| 390×844 | 102 | 321 / 321 | 12,55,366,36 | 844 |
| 1280×720 | 64 | 195.05 / 198.95 | 729,13.5,526,36 | 720 |

At 360 px, pending feedback is `(260,104,88,30.5)` and failed feedback is
`(113,104,235,30.5)`; both remain visible and untruncated. At 390 px their right
edge is 378. Desktop failed feedback is `(754,59.5,235,30.5)`.
Full-release CSS instead gives 0 px identity widths and a 1,669 px header at both
narrow widths; the observed composer bottoms are 1,422.08 / 1,878.08. Native focus
scrolling shifts the oversized header top to -464 / -8. Desktop release geometry
passes, with an 83.5 px wrapped header. This deliberately crowded synthetic
project composition differs from #2's live measurements.

Inspected captures contain only synthetic content, including the desktop sidebar:
[360 failed](candidate-360-failed.png), [360 running](candidate-360-running.png),
[390 idle](candidate-390-idle.png), [desktop idle](candidate-1280-idle.png),
[release 360 failure](release-360-idle.png). Additional local selected/reloaded
captures and per-test JSON geometry attachments are under ignored
`test-results/header-{candidate,release}`; machine results are under ignored
`e2e/test-results/header-{candidate,release}.json`.

## Provenance and limits

SHA-256 of tested files:

```text
styles.css          2555192d8a029957af75f5d5bb5c0d4418aff4642ca1668c4b9769a5f2cacfbb
header-layout.spec  7d6941168eaeba5bb083321b7ed270eacb486a5ffb6665b67b1f6401ab8814eb
header-layout.config 4b4194b7f992fa6e47d077c84408898b5500e8cb177c971a5bea60fc9ded012a
candidate built CSS 2bbf47de963542bebac282ab3e181b701136b450e1952e6d7e7defc58d353387
release bundled CSS 56bb92d4590752e42a779baae8c0cf16d84238dea54543b9d9e23b966d1561a9
```

Built locally; draft PR #10; not merged, activated or deployed. Hosted CI is
unproven and was not polled. Prior successful unchanged checks are reused from
the lead review; no backend/full-suite repetition. Older shell failures were not
rerun or diagnosed here, and no claim that they are unrelated is made. Physical
Android, keyboard/touch/network acceptance, live deployment readback and M0 remain
open. No inference/cost impact or production rollback is applicable. Lockfile WIP
is preserved and excluded. #2/#6/#9 and other PRs remain separately owned; no next
issue was started.
