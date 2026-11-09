# P13 status/unread: accepted source and authenticated scope

## Current authenticated readback (November 9)

PR145's read-target repair and PR148's saved-session recovery are reviewed,
gate-merged and app-only released. PR148 validates the saved canonical identity
through the existing exact GET before history; bootstrap remains bounded and its
original omission cause is unknown. The recovery uses no guessed identity, expanded
roster or project hint. Initial project inventory and the retained-chat adapter own
navigation; late selection, project, draft and unmount guards remain source-tested.
The recovery source/candidate evidence is distinct from the live result below.

Sol's PR148 release record says build `sha256:f85ccfa1…` differs from the healthy
running/active app pin `sha256:cbb0e9e44d46e152a30d4fc5ee31691903d1542eec9374db274f90aab04ed2fa`;
rollback `release-app-1794247473897753628` restores prior pin `sha256:26c03f64…`.
A wrapped health GET returned200. Source review and release authority remain Sol's;
no service or proxy operation occurred in this acceptance.

Using only the preserved #111 owned identity, the exact session GET returned200 and
verified Command ownership before history. Complete canonical records stayed at
positions0/1/2: user internal notification, ordinary assistant and system setup.
Before UI view, unread was true and durable last-read pointed at excluded setup2.
The actual focused, visible, positive, final-page-clipped and hit-tested latest
assistant1 view issued one exact read POST. It returned200 with latest and last-read
both at assistant1 and unread=false. Thread-state GET, reload GET and independent
owned-page GET all retained that exact canonical marker. No new session, inference,
message, project mutation or historical run/message join was used.

The deployed UI passed at1280×720, 360×740 and short360×360: truthful Idle label,
latest history reach, unsent draft retention/restoration, model picker and Escape
focus, Studio unavailable state, Back/Escape return and focus, and input/Send
reachability. At short height the actual latest-message marker was brought into view
by normal timeline scrolling. Six named sanitized chat/Studio captures were visually
inspected; names and SHA-256 values are in [the refreshed receipt](verification/issue-144-live.json).
The original #111 receipt and previous API-only #144 receipt remain separate.

Across five wrapper invocations, the wrapper observed 207 GET and 3 POST attempts.
Native wrapper diagnostics recorded 95 API attempts blocked before egress: 23 on the
initial invocation and 18 on each of four follow-ups. This includes one blocked
notification-reconciliation POST, leaving 94 blocked GETs; 113 GETs and two read
POSTs were forwarded to the backend. The forwarded POSTs were the successful
assistant read and one post-clear stale setup attempt. The stale attempt's response
status was not retained because the harness incorrectly expected a 409 error body to
echo `lastRead`. It was not retried; later GETs reobserved assistant1/unread=false.
Thus there were no forwarded run admissions, presence calls, external requests or
other mutations. The earlier API-only stale POST returned409 before the assistant
was read. This limitation is explicit in the receipt.

P13 remains incomplete for saved defaults, exact route/effort proof, project/Threads,
cross-device new-output race, restart and physical phone acceptance. P14 consumer142
and shell146 are app-released, but production Studio source is null, the view is
unconnected and no crew-data acceptance exists. Dashboard cutover and the approved
narrow transport remain unresolved in [packet6743791366](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6743791366)
and [packet6745632752](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6745632752).
Whole P13/P14 remain incomplete; phone check pending.

## Saved-session candidate evidence (isolated, November 9)

The existing Studio SOURCE `tools/browser_qa.py run` wrapper at source revision
`301bdfb0ce82c8dbffb16b5babd8d93209febac4` ran from this issue worktree with task
`command#issue-111`, around the existing Playwright command and
`e2e/saved-session-recovery.config.ts`. Coordinates/profile remain private. Only new
task-owned synthetic contexts were used; the pre-navigation egress guard and existing
no-proxy candidate preview prevented live forwarding. Original tabs/login/storage
were untouched; shared Chrome stayed running.

Three cases passed: desktop1280×720, Pixel-emulated360×740 and short360×360.
Each withheld exact metadata until the hint/no-history boundary was checked, then
proved recovery, authorized history readiness, per-session draft/input/Send reach,
reload persistence, Studio unavailable/Back/Escape/focus and navigation to B's separate
draft. Labels remain honest Unknown in this fixture; accepted status-state/read-view
fixtures are reused rather than represented as new live proof. Full clipping-ancestor
and pointer-hit checks cover history, input, Send and Studio return. At short height,
history/Studio content deliberately scroll internally; not all content fits at once.
All six captures below were visually inspected for clipping/overlap and useful reach.

Per case, the assertion/attachment interval recorded **2 exact metadata GETs, 3 history
GETs and 8 synthetic presence POSTs**. It recorded zero non-presence mutations, zero
run admissions, zero blocked external attempts, zero unexpected API paths and zero
page errors. Counts describe intercepted candidate requests through the final assertion,
not server audit totals or teardown keepalives. No read POST was needed: the synthetic
thread-state has unknown latest/unread. This does not certify actual read suppression,
authenticated output/readback, native background focus, live restart or physical phone.

Named inspected files under `test-results/saved-session-recovery/` (SHA-256):

| Capture | SHA-256 |
|---|---|
| SYNTHETIC-recovered-1280x720.png | `2ef06a39e8ae9e9e1dcfcf03704e08cdeef10e3c98c98b87878a3b4d265615b3` |
| SYNTHETIC-recovery-Studio-1280x720.png | `8c4a8633e6ec78993d1fad18ca8fc385198a797383934b6cf86b860e7d38c2f9` |
| SYNTHETIC-recovered-360x360.png | `067f3801d5a796b640efd1afa4fb88ecc515b165c1f0fb3226b537044b42732f` |
| SYNTHETIC-recovery-Studio-360x360.png | `02914b911864b3ae347824663024269c5e5e2805586f6cb132ca676429f26c2d` |
| SYNTHETIC-recovered-360x740.png | `9fa3e1dba17850d88214ca8ee69cfa4a2b73f7c864fdf5c1b371ca05d34f3290` |
| SYNTHETIC-recovery-Studio-360x740.png | `d626045e74eac5bd0da3c3d551bd5e39814d428badd73a48a259885343d2b62a` |

## Historical PR130 release and original authenticated scope


November 9 source13be0f4 was [independently accepted](https://github.com/KumarG23/jarvis-command/pull/130#issuecomment-6743755037),
passed hosted exact-head gate42642969282, and merged as
fcbd5de5ba934d3c07ab01632486b23bf6da83b7. The lead's [release record](https://github.com/KumarG23/jarvis-command/issues/111#issuecomment-6743854477)
attests healthy app-only deployed pin `sha256:f6c6c3e0b077c5a29ae683776fc428f31d94443f8741f4e9dc49f7ca3d4bb336`,
distinct from build reference `sha256:1752e61424455bbd42f7cfcbf3d18abe2fdcf8423758941d9f8fbc80f8b89ba9`.
Rollback `release-app-1794237821439543083` restores6531b270…. No proxy was changed.
This worker observed authenticated health/bootstrap200 and exercised the deployed
UI/APIs; it did not inspect/restart services or independently attest the image pin.
Whole P13 remains incomplete; phone check pending.

## Authenticated owned-session evidence (November 9)

One visibly labelled TEST session was created once through supported POST sessions.
Its exact successful response was durably recorded in private own git metadata,
then canonical GET proved that exact session's Command ownership before history.
No identifier was inferred from counts/titles. An initial read-only probe used the
wrong identity label and stopped before creation; the corrected public schema is
`cloudflare-access`. No uncertain create or run was retried.

The advertised default was ineligible, so it was not inherited. The single admitted
setup message explicitly selected existing included `openai-codex/gpt-6-luna`,
currently advertised/authenticated/eligible/selectable, with minimal effort and
existing model-lock/no-fallback controls. Exact request lookup matched its accepted
public run. It completed with one reported provider API call and no observed tool
events. Same-run receipt: provider/model matched, requested `minimal`, executed
wire-reported `low`, `exact=true`, `fallbackUsed=false`, route source unknown.
**This is not exact effort/full-tuple proof.** The UI correctly warns that the
requested route changed. That acceptance check stopped; no retry, reroute, provider
change or paid fallback was attempted. Lead/installed-contract owner must reconcile
offered effort, wire effort and exact-receipt semantics through a separately scoped
prerequisite; do not hide the discrepancy or silently translate executed evidence.

Initial empty history was Unknown, unread=false. The server subsequently reported
Working; completed canonical output remained unread before any UI view. The deployed
header then showed Unread. Exactly one focused, native-visible, fully clipped and
hit-tested latest marker view caused POST read200; canonical GET matched the exact
latest identity/position. Header became Idle. Server readback, UI reload and an
independent task page retained the clear; a deliberately older canonical marker
POST returned409 without regressing it. UI viewing/navigation admitted zero runs.

**Canonical-tail limit:** this installed history has three records; the tail at
position2 is a `session_meta` projected as a system “Session setup record (not a chat
message).” The assistant reply precedes it. This proves the returned canonical-tail
protocol, not assistant-answer-specific unread binding. No historical message/run
join or latest-session receipt association was inferred. Lead must retain this
semantic distinction when deciding whether setup metadata qualifies as the chat
read tail; any contract/source change needs separate ownership/admission.

Authenticated1280×720,360×740 and360×360 checks passed: labelled Idle, compact headers
73/119px under existing limits, clipped pointer hits for input/44px Send, reachable
canonical assistant text, read-only model/effort fields with deliberate picker scrolling,
Escape focus return, retained same-page draft through Studio Back/Escape and reload,
and honest Studio unavailable navigation. No project fixture mutation was admitted:
project summaries/Threads live acceptance is not claimed. Needs you was not forced;
Working was observed through server facts, not a live animated-label capture.
Physical background/keyboard/two-device race, cross-actor denial and live restart
acceptance remain separate from accepted source/candidate tests.

All browser commands used the own-worktree Studio SOURCE wrapper/task
`command#issue-111`, source6339856aae28f03cddcd2996b5c1c4ec770388d7, existing authenticated
context and new task pages only. No cookies/credentials were read/exported. Original
tabs/storage and Chrome were preserved. Unrelated inbox/project/artifact reads were
blocked only on task pages; actual own-session API responses were not mocked or
rewritten. Private recents are masked in captures. Consequently this does not accept
inbox/presence or project behavior. No visibility/focus getters were spoofed.

Browser-observed forwarded API requests (not server audit totals):59GET, one session create POST, one setup-run POST, two read
POSTs (one view200, one stale409), zero presence/other mutation POSTs. Sixteen
unrelated task-page GETs were blocked before forwarding. The setup inference is
counted separately from status/read actions. Full category counts, bounded proof,
release attribution and12 inspected capture hashes are in [the live receipt](verification/issue-111-live.json).
Exact identities/responses remain in private own git metadata
`issue-111-live-acceptance.json`; use that supported binding, never guess or resend.
Named sanitized captures under `test-results/issue-111-live/` are
`AUTHENTICATED-{status-chat,studio,history,picker}-{1280x720,360x740,360x360}.png`.

## Implemented source contract

Shared status uses bounded actor-authorized server snapshots and canonical read
identities. Retained run A cannot override the latest session observation for run B:
no local overlay is permitted without authoritative latest-run identity. Retained
cards label their own run separately. Run absence/transport text does not imply Idle;
stale facts expire to Unknown after 60 seconds. Reads are independent of completion.

GET thread-state and POST read use existing authentication/session guards. A read
revalidates the exact latest canonical message and position and never submits a run.
The browser requires final-page readiness, foreground/focus, full clipped marker
intersection and a real hit. Separate private atomic actor/session markers normally
advance monotonically and survive restart. The issue #144 exact excluded-marker
correction is the only permitted lower-position replacement; newer valid reads remain
protected across stale-device clears and reversed response delivery. Earlier rollback
readers do not open this file.
Bounds remain 4096 markers/1 MiB, 50 chats per client, two server observations, ten
100-row history pages, and an eight-second traversal budget checked between bounded
source calls. Unknown tail means unknown unread/refused clear, never guessed success.

## Latest-chat read-target repair (issue #144)

Read targeting now uses the shared typed predicate `isChatReadMessage`: only user/assistant
records with no `toolName` or `displayKind` qualify, and empty assistant activity is
excluded because the transcript hides it. System/setup, tool, internal notification,
display-only and hidden empty assistant records remain in their original canonical
transcript positions; neither server traversal nor the browser compacts them. The
browser records each loaded message's absolute page offset and only places the existing
visible/focused/clipped/hit-tested marker on the latest eligible message once the final
history page is loaded.

GET reports the latest eligible canonical identity and leaves durable state untouched.
Before a view, a pre-repair marker that exactly matches an excluded record in the
complete current history remains preserved and does not credit an earlier answer. A
viewed eligible latest message may replace that higher metadata marker through a
serialized exact-marker compare-and-swap; unmatched/future markers and newer stored
reads are preserved. This is an explicit semantic correction, not a store reset or
actor/session migration. Partial/denied/external histories still cannot write. Focused
source tests cover trailing metadata across pages, empty/non-chat histories, restart,
stale/concurrent reads and the exact correction condition. **Wrapped offline candidate
proof, November 9:** the existing isolated P13 fixture passed 1280×720, 360×740 and
360×360. Scrolling the trailing display-only metadata produced zero read POSTs; viewing
the assistant at canonical position49 produced exactly
`{ messageId: "assistant:49", position: 49 }`, with zero run admission. All12 named
`SYNTHETIC-{header,roster,roster-tail,chat-list}-{1280x720,360x740,360x360}.png` captures
were inspected under `test-results/thread-status/`. These are offline fixture evidence
only. Authenticated post-repair readback, live restart/race acceptance and physical
phone check remain separate; no live readback is claimed.

## Accepted candidate evidence (historical source phase; synthetic)

Existing Studio source wrapper revision 347b642a4b6bbd2119a04211054490e1e68e0b01,
run from this issue worktree with task command#issue-111 around the existing
Playwright command/config. Endpoint/profile stay private. Task-owned contexts only;
original tabs/login/storage retained, shared Chrome left running. The candidate
preview explicitly disables proxy fallback and rejects escaped API calls with 503,
including teardown keepalives. A direct unmatched-API probe verified that guard in the source phase.

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
fixture/build source hashes are in [the historical candidate receipt](verification/issue-111-candidate.json). Its runtime-status fields describe the pre-gate handoff, not the later release/live evidence above.
Short-height surfaces use deliberate internal scrolling; a single capture does not
claim all rows fit simultaneously. Focused merge tests retain the delayed A/B repair
and Studio interactions; unchanged accepted backend/read/reaction tests are reused.

## PR feedback repair (November 9)

Hosted validate [42635904835](https://github.com/KumarG23/jarvis-command/actions/runs/42635904835)
failed at 469f788: legacy fixtures rejected the new GET, retained-run expectations
claimed unverified session activity, and the added status strip inflated project
headers to 141 px mobile / 119.5 px desktop. That older run remains failed. The repaired13be0f4 later passed exact-head hosted
gate42642969282 before the lead merged/released it; source-phase local checks below
are separate from that gate and the authenticated evidence above.

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

Source-phase focused checks: 34 affected web cases (including delayed A/B), one server
roster/bootstrap case, 46 affected browser fixture cases, and ten P13 status/read
cases pass. The 18-case project/history compact matrix and ten sidebar keyboard/reach cases pass under the original
limits. Web typecheck, scoped lint and build pass; accepted unchanged gates are
reused. All 40 final P13 captures plus desktop/mobile requested-picker captures
were inspected.

Affected synthetic suites use fresh contexts through the same issue-111 wrapper
when locally admitted; CI retains its ordinary isolated browser. Their previews
now share the fail-closed, no-proxy candidate server. Named final captures and
focused outcomes are recorded in the candidate receipt. Earlier unchanged
backend/store/reaction gates are reused. Those local source checks were not full workspace/hosted certification. Later
gate/release and scoped authenticated evidence are recorded above; phone remains
pending. No candidate suites were rerun during this acceptance/docs phase.

## Smallest routing prerequisite for lead admission

Source check: ProjectRoomCreateSchema/ProjectThreadSchema are strict and have no saved
routing-default fields. inferencePreference.ts saves only a browser-local per-session
next-run request. Existing run admission fingerprints inference; the command proxy
validates offered eligibility and sends require_model_lock. The source phase made no
installed-route claim. The later single owned setup call above provides applicable
same-run receipt evidence, with the minimal-versus-low effort discrepancy still
unresolved; it does not close exact per-thread routing or durable defaults.

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

Sol owns further review, recoverable release/rollback and separately admitted live
work. The exact newly recovered owned identity is retained privately; no further
message/create or provider action is granted by this evidence. Never substitute a
private chat or replay an uncertain admission.
Phone check pending: real background/foreground and second-device output/read races,
Pixel cold start/keyboard, labels/scroll/focus and input/Send reachability. Candidate
fixtures supply neither authenticated backend round trips nor physical acceptance.

## Earlier PR147 API-only authenticated readback (#144; November 9)

This is the historical partial receipt, preserved unchanged in `verification/issue-144-api-only.json`; the post-recovery UI result is recorded above.

Source/candidate repair `698d6328455fef7069b61e50a89001db394234c3` was accepted,
hosted validate `42653292447` passed, and the pinned gate merged it as
`dcc3a28bddc9e93be13519dbb3c6c074c7e32493`. Sol's app-only release attests healthy
deployed pin `sha256:26c03f64ad513fa90d22c20c22edf7c87a2577b5071983a809f5b8b87b09f829`,
distinct build reference `sha256:d5da7c5bb10b2a445793fd26bc48892c48afe10043a0eb306b4c3b9fa5e01543`,
and retained rollback `release-app-1794241762657504542`. A wrapped authenticated
health GET returned200.

Using only the preserved #111 identity, supported `GET /api/live/sessions/{owned}`
returned200 and confirmed exact ID plus Command ownership before history access.
Thread-state and canonical messages GETs returned200 and complete history. Hash-only
records preserve positions: user internal notification0, ordinary assistant1, and
system setup2. Latest is the eligible assistant at1; durable last-read still points
to excluded setup2, so unread remains true. No message content, title, or historical
run/message join was read or inferred. A single exact stale setup2 read POST returned
409; subsequent GET confirmed latest assistant1, last-read setup2 and unread=true
were unchanged. This is API-contract evidence, not an assistant-view acceptance.

At that time the bootstrap omission prevented selection; no substitute was used and
no assistant-view POST or UI capture was made. PR148 later added exact saved-session
recovery through the existing verified GET, and the post-recovery UI acceptance above
uses that released path. The omission cause remains unknown. Candidate3-viewport
captures and accepted PR145 checks remain separate from production UI proof.

The three wrapped invocation counts and stale setup response remain in the preserved
API-only receipt. That earlier run made no successful read write and captured no UI.
The refreshed receipt records the separate post-recovery result; the original #111
receipt remains unchanged. Whole P13 remains incomplete for defaults/routing,
project/Threads, race/restart and phone acceptance.
