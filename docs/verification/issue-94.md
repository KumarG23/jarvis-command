# P9.5 candidate evidence — issue #94

The project-chat header now opens the existing ProjectRooms lead/thread roster directly. It retains the same attach, split and validated reply-link behavior. Roster status comes from existing observed Command runs; historical/external activity remains explicitly unknown. No unread/completion badge is added because there is no verified unread protocol for this button.

The MASTER_PLAN amendment records only the exact [owner reopening](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6689706582) for P9.5/P10.4. Existing acceptance/deferred history stands. P10.4 source dispatch follows the accepted amendment; its proxy operations and paid-route proof remain lead responsibilities. No runtime, access, provider or spending controls changed here.

## Local validation (2026-11-06)

- Regression against unchanged base App: the new entry test fails because the Threads button is absent. Candidate passes four new tests: project-only visibility, unknown/running/completed roster facts, keyboard focus/return, archived roster, external-session read-only behavior, draft retention and no run admissions.
- 54 focused tests pass across ProjectThreadsEntry, ProjectRooms, PaneThreadLinks, ConcurrentThreads and ConcurrentDrafts. Existing admission/reload/lost-ACK/recovery implementation and accepted P9 live evidence are reused, not re-certified.
- Web typecheck, scoped ESLint and production web build pass; existing bundle-size advisory remains.
- Seven real Chromium candidate fixture checks pass: desktop Chrome 1280×720; Android/Pixel emulation 320/360/390/430×740 and 320/430×360. Threads is keyboard-operable and at least 44×44 px, opens/focuses the existing roster, Escape returns focus, archived/unknown facts remain visible, selection and the validated reply link open the same external read-only thread, and returning/reloading retains the lead draft. Header/viewport overflow and full button/composer/send bounds pass, including focused input in the short viewport. No run/session creation or provider call occurs; the only fixture mutations are existing explicit project attachment operations.
- Studio's existing-browser wrapper serialized the run; only new isolated task contexts were used and closed. Original pages/storage were untouched and Chrome stayed running. APIs were intercepted with labelled synthetic fixtures. These screenshots are **offline candidate evidence**, not authenticated readback, production acceptance or a physical Android test.

[Desktop header](issue-94/SYNTHETIC-header-1280-720.png) · [390 px header](issue-94/SYNTHETIC-header-390-740.png) · [320 px short keyboard viewport](issue-94/SYNTHETIC-header-320-360.png) · [same existing roster](issue-94/SYNTHETIC-roster-320-360.png)

## Remaining acceptance

Source built/tested only. Sol owns exact-head review, gated merge, recoverable app-only release/rollback and authenticated live acceptance. Physical **phone check pending**: open a project chat, focus the composer with the Android keyboard open, tap Threads, open a thread, return to the lead and confirm the draft; dismiss/reopen the keyboard and check header/composer reachability. Existing Hermes delegation discovery beyond P9 membership remains unavailable; no new contract is claimed.

The private parent policy/product-note paths were permission-denied and the referenced subagent-driven-development skill was unavailable. Repository policy and explicit issue/plan boundaries governed this contained UI change.
