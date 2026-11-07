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
  (phone).

## Evidence states

- **Source:** implementation commit `1caa2055e291ef54f9c3208e9313e1d833a51de5`.
- **Focused tests:** `apps/web/src/StudioDestination.test.tsx` (4 tests) covers
  the global destination, zero Studio requests/actions, draft/selection and
  in-memory image retention, project independence, focus/Escape/Back, and the
  presence clear. Full web suite `36 files / 538 tests` passed at the same
  source; web typecheck, changed-file lint and web build passed.
- **Browser candidate (fixture only):** synthetic Playwright spec run through
  the existing Studio source wrapper, task `command#issue-132`, connected to
  the already-configured browser. Attempt 1 of 2 passed all three viewports
  (1280×720, 360×740, 360×360): global entry, unavailable text, focus and hit
  reach, no clipping/overlap, retained owned-chat draft, Escape and return,
  and zero Studio requests/mutations. Sanitized screenshots were inspected.
- **Authenticated production readback:** not performed and not claimed. The
  browser run used isolated synthetic routes, not a live session, and does not
  prove deployment, Access, or live server behavior.
- **Physical phone:** pending; emulation is not device acceptance.
- **Release:** none. Sol owns exact-head review, merge and the recoverable
  Command release/rollback.
