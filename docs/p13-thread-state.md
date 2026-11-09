# P13 status/unread candidate and routing prerequisites

Current scope: status/unread source plus isolated candidate acceptance under the
November 9 reopening (MASTER_PLAN §0.2). PR130 remains unmerged/unreleased; this is
not P13 Done. Delayed-run repair d61e288 was source-reviewed in review 6707363347.
Accepted release b7b20b9 was ordinarily merged, preserving the Studio destination,
focus/presence behavior, P12 partial readback, and the current plan authority.

Shared status uses bounded actor-authorized server snapshots and canonical read
identities. Retained run A cannot override the latest session observation for run B:
no local overlay is permitted without authoritative latest-run identity. Retained
cards label their own run separately. Run absence/transport text does not imply Idle;
stale facts expire to Unknown after 60 seconds. Reads are independent of completion.

GET thread-state and POST read use existing authentication/session guards. A read
revalidates the exact latest canonical message and position and never submits a run.
The browser requires final-page readiness, foreground/focus, full clipped marker
intersection and a real hit. Separate private atomic actor/session markers advance
monotonically, survive restart, and preserve newer output across stale-device clears
and reversed response delivery. Earlier rollback readers do not open this file.
Bounds remain 4096 markers/1 MiB, 50 chats per client, two server observations, ten
100-row history pages, and an eight-second traversal budget checked between bounded
source calls. Unknown tail means unknown unread/refused clear, never guessed success.

## Candidate evidence (synthetic, not authenticated live proof)

Existing Studio source wrapper revision 347b642a4b6bbd2119a04211054490e1e68e0b01,
run from this issue worktree with task command#issue-111 around the existing
Playwright command/config. Endpoint/profile stay private. Task-owned contexts only;
original tabs/login/storage retained, shared Chrome left running. The candidate
preview explicitly disables proxy fallback and rejects escaped API calls with 503,
including teardown keepalives. A direct unmatched-API probe verifies that guard.

The two November 7 fixture failures are historical. Recovery first confirmed valid
session timestamps and final-page readiness, then fixed the preview working directory.
Playwright's target focus emulation kept background pages visible even after a
separate CDP override; negative hidden/unfocused states therefore use explicitly
labelled, temporary fixture getters. Native getters are restored before proving
real intersection/hit geometry and the read POST. This does not prove native OS/tab
background behavior, authenticated focus suppression, or a physical keyboard.

Ten candidate cases cover 1280×720/360 and each of 320/360/390/430×740/360, with
mobile UA/touch emulation and short-height keyboard simulation. They verify:
- Final-page completion, hidden or unfocused state, and an offscreen latest marker
  cause zero read POSTs. Actual focused marker view causes exactly one strict read.
- Shared labelled Idle/Unread/Needs you/Working/Unknown; urgency ordering; project
  summary; CSS Working animation and reduced-motion static state; Recent chats labels.
- Full clipping-ancestor bounds and actual hits after deliberate internal scrolling;
  reachable input and 44 px Send; retained draft and Threads/navigation focus return.
- No run admission or unexpected write. Read/presence POSTs are intercepted fixtures.

A first matrix found one scroll-edge label reach failure at 430×360; explicit centered
scrolling plus clipping/hit checks repaired that harness path. A suspected text cut passed normal-height checks, but the stricter full matrix
reproduced it at 1280×360, where the outer sidebar scrollbar narrows the row.
The label-bounds regression failed before repair and passes with independently
truncated titles and wrapping status text; no run/transport behavior changed.

Named captures per case: SYNTHETIC-header-WxH.png, SYNTHETIC-roster-WxH.png,
SYNTHETIC-roster-tail-WxH.png and SYNTHETIC-chat-list-WxH.png, beneath
`test-results/thread-status/feedback-final/`. Inspected capture names/hashes and
fixture/build source hashes are in [the candidate receipt](verification/issue-111-candidate.json).
Short-height surfaces use deliberate internal scrolling; a single capture does not
claim all rows fit simultaneously. Focused merge tests retain the delayed A/B repair
and Studio interactions; unchanged accepted backend/read/reaction tests are reused.

## PR feedback repair (November 9)

Hosted validate [42635904835](https://github.com/KumarG23/jarvis-command/actions/runs/42635904835)
failed at 469f788: legacy fixtures rejected the new GET, retained-run expectations
claimed unverified session activity, and the added status strip inflated project
headers to 141 px mobile / 119.5 px desktop. That run remains failed; local checks
below do not certify a new hosted run.

The shared synthetic read seam serves only explicitly listed canonical fixture
session IDs and a query-free GET thread-state. It returns schema-valid Unknown
with no history/read assertion. POST read/run and all other requests retain each
fixture's existing guards; no global API swallow or fallback. Legacy no-run and
retained-card expectations now assert Unknown, separate retained status and exact
read-only navigation. No runtime status/auth/read implementation changed.

Project status text shares the desktop identity row. Mobile uses the old spare
header padding for its labelled strip; the health button follows the new top edge.
The unchanged compact limits remain 120 px mobile / 100 px desktop; the project
matrix measures 119 / 99 px. Unscoped chat status follows the original flex controls,
keeping the requested-route picker clear of the sidebar. The existing click and
non-overlap regressions caught both layout defects before repair. The inventory
retry fixture reopens the picker through its real control after focused-button
replacement; short-height Send deliberately centers in its scrolling footer with
the original strict viewport assertion. No force-click or relaxed bounds.

Current focused checks: 34 affected web cases (including delayed A/B), one server
roster/bootstrap case, 46 affected browser fixture cases, and ten P13 status/read
cases pass. The 18-case project/history compact matrix and ten sidebar keyboard/reach cases pass under the original
limits. Web typecheck, scoped lint and build pass; accepted unchanged gates are
reused. All 40 final P13 captures plus desktop/mobile requested-picker captures
were inspected.

Affected synthetic suites use fresh contexts through the same issue-111 wrapper
when locally admitted; CI retains its ordinary isolated browser. Their previews
now share the fail-closed, no-proxy candidate server. Named final captures and
focused outcomes are recorded in the candidate receipt. Earlier unchanged
backend/store/reaction gates are reused. Full workspace/hosted CI certification,
authenticated live readback and phone acceptance are not claimed.

## Smallest routing prerequisite for lead admission

Source check: ProjectRoomCreateSchema/ProjectThreadSchema are strict and have no saved
routing-default fields. inferencePreference.ts saves only a browser-local per-session
next-run request. Existing run admission fingerprints inference; the command proxy
validates offered eligibility and sends require_model_lock. This assignment makes no
current installed provider/lock/execution claim and performs no live route call.

**Owning repository: KumarG23/jarvis-command.** Proposed narrow operations (not existing
endpoints): read/set a saved routing default with target scope thread/project,
validated projectId/sessionId, expectedRevision, clientRequestId UUID and nullable
InferenceOverride selection. Use existing approved actor authorization and exact
session ownership/project-membership validation; bounded durable storage and audit;
reject stale revisions, conflicting UUID reuse and ineligible routes. Resolve prompt
→ thread → project → Command only for a newly explicit run. Freeze resolved selection
and source revisions in its existing idempotency/fingerprint record so retries cannot
re-resolve changed defaults or execute twice. No generic proxy or provider enablement.

Execution proof prerequisite: lead-authorized owned independent P9 session/run using
an advertised, authenticated, approved exact tuple; require model lock/no fallback,
then verify that same public run/session's requested/executed provider/model/effort,
exact and fallback fields through the supported receipt, including retry/restart.
Unknown effort/receipt fields remain unknown. An unavailable state is interim, not
completion. If the installed contract fails, lead/Jarvis must identify the owning
Hermes source repository/version and admit that exact backend repair; no runtime
patch or endpoint is presumed here. Native delegation separately needs an authorized
immutable thread/persona↔session binding and its attributable run receipt; it does
not gate Command-owned independent-session defaults. No historical answer/run join.

Sol owns exact-head review, gate merge, recoverable release and authorized live
readback. That readback needs an explicitly admitted owned fixture identity through
supported contracts, never a guessed private chat or replayed uncertain admission.
Phone check pending: real background/foreground and second-device output/read races,
Pixel cold start/keyboard, labels/scroll/focus and input/Send reachability. Candidate
fixtures supply neither authenticated backend round trips nor physical acceptance.
