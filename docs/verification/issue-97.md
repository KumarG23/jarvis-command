# Issue 97 — P11 project identity candidate

Source-only first vertical slice against `release/gpt6-sol-luna`; baseline `518b400`.
This does **not** complete P11. Verified executed-model marks remain staged after
#96's exclusive picker/inference work. No model, receipt or historical-route marks
changed. No plan/ROADMAP, runtime configuration, provider, auth or network changes.

Projects have optional `projectIcon` / `projectColor` metadata on the existing
version-one project store and create/update/readback routes. Writes accept only
four simple glyphs, four labelled accents, or `auto`. Reads accept bounded future
tokens and display deterministic defaults. Defaults depend only on project id,
so rename/reload keeps identity. Unrelated writes omit unknown values and the
existing serialized metadata merge preserves them. No migration or second store.
List, selected project header, details and roster context retain text labels;
decoration is hidden from assistive technology and preserves exact label text.

Focused evidence:

- Before implementation, new contract regression failed (16 existing checks
  passed); after implementation all 17 project-contract checks pass.
- Server project-route/store checks: 26 pass, including explicit identity create,
  invalid writes without mutation, unrelated edit/archive, restart and disabled
  deletion preview. Existing deletion checks: 5 pass. Startup/authorization,
  snapshot/audit/recovery logic and disabled deletion behavior are unchanged.
- Web identity/ProjectRooms/App checks: 83 pass; after the small Cancel/Save focus
  repair, ProjectRooms 35 and identity/contrast 2 pass again. The #82 readback
  helper arms identity reads after initial load and explicitly rejects, mismatches
  or confirms them. Failed readback retains settings, Cancel discards the draft,
  and success/reload plus unknown-metadata unrelated edits are covered.
- Repository typecheck/lint/full build pass; final affected web build passes.
  Build emits the existing bundle-size advisory.
- Accent text contrast, WCAG relative-luminance calculation against existing
  bg/sidebar/panel/surface tokens: green minimum 8.26:1, blue 7.39:1, violet
  7.00:1, amber 8.07:1. Existing text/status tokens also meet 4.5:1 in this check.

All browser evidence below is **offline synthetic candidate/fixture evidence**.
It is not an authenticated production round trip, Hermes proof, restart of a live
service, or physical Android acceptance. No admissions or provider calls.

Required Studio existing-browser wrapper, admitted task `command#issue-97`, own
issue worktree, isolated new contexts/pages only; original tabs/storage untouched,
Chrome left running. Baseline build was captured before production edits. Both
baseline and final candidate identity runners exit 0 (3/3 each), at 1280×720,
360×740 and 360×360 (short keyboard-height simulation). APIs are intercepted;
only synthetic metadata writes are allowed. Final checks cover settings save and
reload, header/list identity, >=44px controls, Cancel keyboard reachability and
focus return, unsent conversation draft retention, no horizontal document
overflow, exactly one synthetic save, and no unexpected requests/page errors.

One preliminary candidate run timed out on an exact label selector; the harness
now selects the combobox's accessible role/name. Existing header regressions then
caught a glyph included in raw project-label text. Decoration moved to CSS-generated
content, preserving the original exact-text assertion. That preliminary header
run was interrupted after diagnosing the repeated assertion failure; it is not
counted as passing evidence.

Existing `header-layout.spec.ts` regressions: **28/28 pass**, final wrapped
runner exit 0. Coverage includes selected/reloaded project/history at 320, 360,
390, 430 and 1280px, idle/running/failed lifecycle feedback, plus short-height
navigation/keyboard reachability. Executed an ephemeral copy changing only the
browser fixture to connect through Studio; assertions and API fixtures were
unchanged. Temporary copies were removed after the run. No independent browser
launch or original-page access.

Screenshots (all visibly synthetic):

| Viewport | Before list / details | Candidate list / details / settings / header |
| --- | --- | --- |
| 1280×720 | [list](issue-97/1280x720-SYNTHETIC-before-list.png), [details](issue-97/1280x720-SYNTHETIC-before-details.png) | [list](issue-97/1280x720-SYNTHETIC-after-list.png), [details](issue-97/1280x720-SYNTHETIC-after-details.png), [settings](issue-97/1280x720-SYNTHETIC-after-settings.png), [header](issue-97/1280x720-SYNTHETIC-after-header.png) |
| 360×740 | [list](issue-97/360x740-SYNTHETIC-before-list.png), [details](issue-97/360x740-SYNTHETIC-before-details.png) | [list](issue-97/360x740-SYNTHETIC-after-list.png), [details](issue-97/360x740-SYNTHETIC-after-details.png), [settings](issue-97/360x740-SYNTHETIC-after-settings.png), [header](issue-97/360x740-SYNTHETIC-after-header.png) |
| 360×360 | [list](issue-97/360x360-SYNTHETIC-before-list.png), [details](issue-97/360x360-SYNTHETIC-before-details.png) | [list](issue-97/360x360-SYNTHETIC-after-list.png), [details](issue-97/360x360-SYNTHETIC-after-details.png), [settings](issue-97/360x360-SYNTHETIC-after-settings.png), [header](issue-97/360x360-SYNTHETIC-after-header.png) |

Rollback compatibility: existing projects load without identity metadata. Once
new fields have been saved, older binaries with strict pre-P11 room schemas cannot
read them. Lead release/rollback must retain an identity-aware reader or use the
existing approved metadata recovery procedure; no live store was touched here.
Sol owns exact-head review, merge, recoverable release/rollback and authenticated
acceptance. **Phone check pending**: on Pixel, choose glyph/accent, save/reopen,
rename/archive/restore, inspect list/header/roster labels, then verify keyboard
scroll, Cancel/focus and retained unsent chat draft. Deletion remains disabled.
