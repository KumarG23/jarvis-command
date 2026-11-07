# P14 Studio unavailable destination (#132)

Scope: the honest unavailable slice of MASTER_PLAN §10 P14 only. Live Studio
crew data and Phase 2 remain **Unsupported — Deferred** (see
`docs/p14-studio-capability.md` on the #131 report branch when merged).

## What shipped

- A top-level **Studio crew** entry in the existing main navigation (desktop
  sidebar, phone drawer), separate from project Threads and independent of the
  selected project.
- A clearly titled unavailable view with a plain-language reason and a return
  to chat. It uses existing shell styles and one existing icon; there are no
  crew rows, counts, model marks or activity claims.
- No Studio read, write or polling path: no endpoint, adapter, schema,
  transport, backend route, credential, exporter, relay or control form was
  added. Opening the view issues no request other than the existing
  reply-presence clear when a chat stops being visible.
- The chat stays mounted and independently supervised. Selected chat/project,
  unsent text, in-memory image attachments, pending artifact/recovery state and
  exactly-one-admission behavior are unchanged. Hidden chats are not reported
  as visibly focused to reply-presence.
- Escape, phone Back and the visible return control restore the same chat and
  draft; focus returns to the Studio entry (desktop) or the navigation opener
  (phone). Closing Studio's phone drawer with Close, Escape, the scrim or Back
  returns focus to Studio's own visible opener (never the hidden chat opener)
  and leaves Studio open.

## Evidence states

- **Source:** repaired implementation commit
  `c7dc9cffbf9f66bfc840c312dc7a8c2fe511a821`, on the accepted base merge
  `8cee0265eb4c9a08dd79286b3645646b1b850b80` (PR #131). The ordinary merge
  preserves its docs and all P12/P13 dispositions.
- **Focused tests:** `apps/web/src/StudioDestination.test.tsx` (5 tests) covers
  the global destination, zero Studio requests/actions, draft/selection and
  in-memory image retention, project independence, focus/Escape/Back, visible
  Studio drawer-opener focus for Close/Escape/scrim/Back without dismissing
  Studio, and the presence clear. Full web suite `36 files / 539 tests` passed
  at the same source; web typecheck, changed-file lint and web build passed.
- **Browser candidate (fixture only):** synthetic Playwright spec run through
  the existing Studio source wrapper, task `command#issue-132`, connected to
  the already-configured browser. The final corrected run passed all three
  viewports (1280×720, 360×740, 360×360): global entry, unavailable text, focus
  and hit reach, no clipping/overlap, retained owned-chat draft, Escape and
  return, zero Studio requests/mutations, and phone drawer dismissal focus for
  Close, Escape, scrim and Back. One earlier probe run failed only because the
  synthetic scrim click targeted the drawer-covered centre; the corrected spec
  clicks the exposed strip. That used 1 of 2 permitted failed attempts.
  Sanitized screenshots were inspected.
- **Authenticated production readback:** not performed and not claimed. The
  browser run used isolated synthetic routes, not a live session, and does not
  prove deployment, Access, or live server behavior.
- **Physical phone:** pending; emulation is not device acceptance.
- **Release:** none. Sol owns exact-head review, merge and the recoverable
  Command release/rollback.
