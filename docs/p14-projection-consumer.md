# P14 Studio projection consumer (#141)

Plan: [MASTER_PLAN.md §0.2, §10 P14, §11](../MASTER_PLAN.md). Producer: Studio `studio.projection` v1,
`KumarG23/dev-studio` PR #94 merged as `6339856aae28f03cddcd2996b5c1c4ec770388d7`
(`dashboard/projection.py`, `current.py`, `server.py`, `docs/verification/issue-93.md`).

## State: source slice only — disabled, isolated, **not** integrated

| Piece | State |
| --- | --- |
| Strict v1 decoder, `StudioProjectionView`, transport seam, fixtures | Source + tests in this PR |
| Shell wiring (`App.tsx` Studio destination) | **Not done.** Serialized under #141 after #111 ownership is released |
| Transport from Command to Studio | **Unresolved.** No approved path is proven; none is implemented or enabled |
| Production | Disabled. The view takes `source: null` and issues no request and shows "disabled" |
| Authenticated desktop/mobile readback, physical phone | Pending (separate gates) |
| Browser captures | Pending: no browser configuration was reachable from this worktree (see Evidence) |

P14 as a whole is **not** done: it needs a supported production round trip, protected desktop/mobile readback and a
recoverable release.

## Layout (all new files; no shared-shell, `App.tsx`, `styles.css`, e2e fixture or #111 file touched)

- `apps/web/src/studio-projection/studioProjection.ts` — types and `decodeStudioProjection`.
- `studioProjectionSource.ts` — `ProjectionSource` seam (fixtures only), `readBoundedText`.
- `presentation.ts` — labels, formatters, freshness classification.
- `StudioProjectionView.tsx` / `.css` — overview → project → work detail.
- `fixtures/golden.projection.json` + `fixtures/generate_golden.py` — the **real producer code** at the pinned SHA run over
  invented inputs (all titles `SYNTHETIC`, repos `Example/*`). The decoder is tested against genuine producer output.
- `candidate-main.tsx` + `apps/web/studio-projection-candidate.html` — dev-server-only harness (not a build input; the
  production build does not contain it). `?fixture=healthy|disabled|loading|unreachable|malformed|version|lastknown`,
  `&age=<seconds>` pins the viewer clock after the fixture's `observed_at`.
- `e2e/studio-projection.{config,spec}.ts` — wrapper-run Playwright (desktop 1280×720, 360×740, short 360×360).

## Decoder rules (version 1)

Rejection is whole-document and typed (`not_json`, `oversized`, `unsupported_version`, `producer_unavailable`,
`malformed`); the message is bounded to 200 chars and names the first offending path. Nothing is repaired.

- **Exact fields.** Every object has a closed key set (unknown *and* missing keys reject, including `__proto__`); unknown
  `version` rejects before anything else is read; `read_only` must be `true` and `method` `GET`.
- **Bounds.** ≤16 projects, ≤100 work items per project, ≤20 PRs/item, ≤5 dependencies, ≤10 merged records, ≤30 plan
  statuses, string caps per field (title 140, goal 240, status 300, …), counted in code points; control, bidi, zero-width,
  line-separator and lone-surrogate characters reject.
- **Byte bound: 4 MiB** (`STUDIO_PROJECTION_MAX_BYTES`). The accepted sample is ~66 KB for 4 projects; a producer at its own
  ceilings (16×100 items) is ~2 MB (asserted by a test), so 4 MiB is a consumer safety bound ≈ 60× the sample — not a
  producer limit, and not the older 64 KiB recommendation. Larger bodies are rejected as `oversized` and **never truncated**
  into counts. `readBoundedText` enforces the same bound on a streamed body and `Content-Length`.
- **Dates.** ISO-8601 with a zone, real calendar days, years 2000–2100. `age_seconds` must agree with its timestamp and
  `observed_at` (±2 s); `stale` must agree with a 24 h age.
- **Links/identity.** the producer's canonical first issue/PR link is mandatory (an empty list rejects); ids are `owner/repo#N` and must equal repo+number; issue/PR/merged URLs must equal the rebuilt
  `https://github.com/<repo>/…` URL; check links must be path-only `https://github.com` URLs whose repo is registered
  (a repo named by the document itself; in a per-project scoped document any well-formed slug, because other repos cannot
  be known). Dependencies must name a registered repo. Hrefs are re-checked at render, with `rel="noopener noreferrer"`.
- **Consistency.** Lane counts sum to `open_issues` and match the work items (≥ when `truncated`); `sessions`/`running`
  agree with the row; session presence agrees with the observation; blocker presence agrees with lane/state; GitHub /
  worker / plan source status agrees with `counts`, `sessions`, `plan.state` and the `errors` entries; top-level `errors`
  equal the flattened project errors; `totals` equal the project sums **or are `null` when any project's figure is unknown**,
  with `coverage` consistent. A total that hides unknown coverage as a number rejects.
- **Provenance.** `owner.configured` is configuration; `owner.executed.state` must be `unknown` (any other value
  rejects — v1 never reports an executed route). The UI prints "Executed route: unknown" and never labels a configured
  model as what ran. Progress is `plan_checklist` (literal counts), `plan_milestones` (verbatim statuses, no completion) or
  `unknown` with a reason; there is no percentage field and the UI never computes one.

## UI semantics

Overview: five stage tiles (Needs attention, Building, Checking, Review, Ready to test) from `totals`, showing **Unknown**
(never 0) when coverage is incomplete, plus one card per project (goal, current/ambiguous milestone, progress statement,
per-stage counts, dispatch pause, latest event with source and age). Project: facts, plan-reported status verbatim with
source, stage sections (other states under "Other states"), recently merged with scheduler-release state (a merge alone is never shown as release or deployment), unlinked PRs. Work detail: milestone, update age, process observation ("process presence is not progress"),
configured owner + unknown executed route, blocker (reason, owner, next action, qualified dependency links), then
separate Checks / Review / Merged / Scheduler release / Ready-to-test evidence and allowlisted links.

States: **disabled** (no transport), **loading**, **unreachable / HTTP / not_json / oversized / unsupported version /
producer unavailable / malformed** (no data shown), **partial** (coverage, errors, truncation), freshness **current**
(within `fresh_for_seconds`) / **aging** / **stale** (> `stale_after_seconds`) / **clock mismatch**. A snapshot is never
called live ("point-in-time snapshot, not a live feed"). After a failed refresh the previous snapshot stays visible only
under a "Last known data" label and a banner that it is **not current**. HTTP 503 with a valid document (the producer's
"no project online" case) is decoded and shown as partial; other non-200 statuses are errors.

Polling: the view reads once when `active` becomes true, cancels on deactivation, and (only if `refreshMs` is given, ≥30 s)
polls while active and the document is visible, never overlapping reads. Hidden/unfocused views make no request, and a document hidden at activation reads when it becomes visible. Data is keyed to its source: removing or replacing the source clears the snapshot, failure and drill-down.

## Transport — what is actually established

From Command source only (nothing probed, no endpoint invented):

- `apps/read-proxy` is Hermes-only: fixed GET routes `/_health`, `/health/detailed`, `/v1/capabilities`, `/api/sessions`,
  upstream pinned to an uncredentialed `127.0.0.1` Hermes origin with `HERMES_API_KEY`. It has no Studio route or upstream.
- `apps/command-proxy` and `apps/server` have no Studio configuration.
- Studio's `server.py` serves `GET /api/studio/v1/projection[/<project>]` on loopback behind its own device gate;
  Studio's own doc says whether and how Command reaches it "is not decided here". Loopback reachability on the Studio host
  is not a Command transport, and the producer's PR proves neither a dashboard deployment nor a relay.

**Therefore no approved transport exists and none is added.** `ProjectionSource` accepts only fixtures; there is no URL
parameter, forwarding or `fetch` in this code.

### Smallest exact contract needed (for the lead / Jarvis-runtime owner — not performed here)

1. A *fixed*, GET-only Command-server route (e.g. `GET /api/studio/projection`, no query string, no path parameter, no
   forwarding) that, after the existing Cloudflare Access + approved-identity check, returns the body of Studio's
   `GET /api/studio/v1/projection` verbatim with status 200/503 and `Cache-Control: no-store`.
2. An approved server-to-server path from VM113 to that single Studio route (fixed origin + path, no credentials in
   the browser, no listener exposed to LAN/Internet, no generic proxy). This is the new network/auth boundary and needs a
   lead/owner decision.
3. A server-side response cap of `STUDIO_PROJECTION_MAX_BYTES`, a per-actor rate bound, and the same closed-GET method
   allowlist. The browser decoder here is then the second, independent validation.
4. After that, wiring is: a `ProjectionSource` that GETs that one route with `readBoundedText`, and mounting
   `StudioProjectionView` in the Studio destination with `active` bound to its visibility (serialized after #111).

## Evidence

- Source tests: `studioProjection.test.ts` (decoder against real producer output: unknown version/field, hostile text, bad
  dates, unregistered/non-GitHub links, id/count/total/age conflicts, oversized, full-capacity 16×100 document, scoped
  document), `StudioProjectionView.test.tsx` (states, drill-down, focus/Escape, link allowlist, inert markup, no polling
  while hidden), `studioProjectionSource.test.ts`.
- Candidate browser proof (fixtures only): `e2e/studio-projection.spec.ts` ran through the Studio browser wrapper
  (task `command#issue-141`) in task-owned contexts at 1280×720, 360×740 and 360×360: 6/6 passed (keyboard
  overview → project → detail → Escape/Back with focus return, ≥44px targets, no horizontal overflow, and the disabled,
  loading, unreachable, malformed, unsupported-version, stale and last-known states). A context-level egress guard aborts
  (never forwards) any non-harness request and the spec asserts none was attempted. Named captures were inspected
  (phone overview, 360×360 detail, desktop last-known). Observation: at 360×360 the status banners occupy most of the first
  screen; content is reachable by scroll, unclipped. This is fixture evidence only — not authenticated readback.
- Not claimed: authenticated readback, protected production, physical phone, any live Studio data.
