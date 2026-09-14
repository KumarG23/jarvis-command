# Chat-first integration fixes

Continuation of PR #1 on `codex/chat-first-shell`, based on
`ed096c230459a0bb7ad071f3ff243e6f8ec8299b` and Hermes's integration report
<https://github.com/KumarG23/jarvis-command/pull/1#issuecomment-5590552520>.
Codex owns frontend/contracts/tests; Hermes owns backend integration and deployment.
Runtime-recovery WIP remains separate. This follow-up does not merge or deploy.

## Implemented

- Preview sign-in navigates to the preview's clean path without looking up or
  unregistering the root worker. Production recovery retains exact worker scope
  and script validation. The existing callback entrypoint still discards callback
  query/fragment/state and normalizes its path before rendering recovery.
- Preview pending-run identity, selected chat and selected project use distinct
  session-storage keys. Existing production keys and identity-only records are
  preserved. This isolates browser state, not live data or backend writes.
- `JARVIS_PREVIEW_BASE=/api/preview/chat-first/` sets the Vite base and disables
  the PWA plugin together. Use this flag, not an ad-hoc source patch or only
  `--base`. Root builds retain PWA behavior.
- A 404 on project metadata Save explains either unavailable server editing or a
  missing project, retains the draft, and offers the existing explicit project
  reload. It does not infer capability from a 404 or automatically retry a write.
- The frontend accepts an optional authoritative saved-message binding on run
  status and uses exact message IDs to reconcile recovered output. Missing,
  foreign-session, reordered, ambiguous, truncated or differing output remains
  visible. Older identical replies are preserved; no global text deduplication.
- The real-chain browser suite uses sidebar navigation, New chat, activity
  disclosure and scoped stopping status. Upstream fixture streams are destroyed
  before downstream servers close, avoiding a shutdown dependency deadlock.

## Hermes backend contract: required before duplicate-reply acceptance

This commit implements the consumer and shared schema, **not the producer**.
The old backend remains compatible, but the confirmed recovered duplicate is
not fixed against that backend until the following contract is implemented.

New frontend status reads send `x-jarvis-history-binding: 1` on
`GET /api/live/runs/:publicRunId`. For those opted-in reads only, the BFF may add:

```json
{
  "historyBinding": {
    "userMessageId": "exact-public-history-user-id",
    "assistantMessageId": "exact-public-history-final-answer-id"
  }
}
```

These IDs must be the exact IDs returned by the existing session-messages BFF
projection, bound authoritatively to the authenticated public run and session.
They identify the submitted user message and the saved final assistant message
whose content equals terminal `output`. The UI checks roles, ordering, session,
identity verification and content consistency, and waits for complete history
before discarding local output. On a partial page it omits only the exact saved
echo and retains local output.

- Keep existing identity/authorization checks. Do not expose private upstream run
  IDs or add generic upstream access.
- Do not synthesize the binding from latest-message position, text equality,
  timestamps alone, or private database scraping. Establish it through a supported
  runtime contract. If that contract does not exist, report the smallest needed
  runtime change before claiming the duplicate fixed.
- Omit `historyBinding` when unavailable; do not return null or guessed IDs.
- Responses without the opt-in header must retain their old shape: older clients
  use strict schemas. The header negotiates representation, never authorization.
- Resolve terminal-status/history persistence ordering. The frontend stops normal
  supervision at terminal status, so an indefinitely missing binding or a final
  history read that precedes persistence does not satisfy acceptance. Prove the
  completion handoff with actual Hermes, including a reload during the run.
- Include tests for old/new clients, wrong run/session, missing binding, repeated
  identical replies, partial history, and authoritative final-message IDs.

Also include the existing `POST /api/rooms/:roomId` endpoint from the candidate
backend. Verify exact metadata readback while preserving chat membership and
selection. A frontend-only update against the old backend will still return 404.

## Validation in this follow-up

- 215 distinct focused web tests passed across App, LiveTurn, ReloadRecovery,
  LiveRoom, ProjectRooms, timeline and appEnvironment (overlapping runs counted once).
- 24 focused shared-contract tests and one real-BFF/proxy open-stream cleanup
  regression passed. The cleanup test denies the fixture approval, leaves its
  event stream open, and completes teardown within the ten-second test budget.
- Web/contracts typechecks and lint of changed code passed.
- Root PWA and isolated preview builds passed; preview HTML uses the path prefix
  and has no worker registration/manifest link, and no worker is generated.
- The adapted six-case desktop/phone real-chain browser suite was discovered
  successfully, **not browser-executed here**. Hermes must run it. The dedicated
  cleanup regression is not a substitute for those UI cases or live approvals.
- Scoped source review of preview sign-in/storage separation found no outstanding
  defect; no whole-candidate approval is claimed.

Neal reports successful live test messages and good appearance on his physical
phone, using a private browser. Count that as user-provided phone/layout evidence;
ask only about keyboard-open visibility if it was not part of that check.

## Hermes continuation

1. Fetch `codex/chat-first-shell`; record its exact new HEAD. Read this document.
   Keep UI work paused and runtime-recovery WIP separate.
2. In an isolated integration branch/worktree, implement the opt-in status binding
   above and include the existing metadata-edit endpoint. Preserve the old-client
   response shape. Do not guess history ownership if the upstream API lacks it.
3. Run focused backend checks plus:
   `npx vitest run e2e/real-chain-cleanup.test.ts --environment node` and
   `npx playwright test --config e2e/integration.config.ts`.
   Reuse the prior workspace results unless the backend changes affect them.
4. Build the authenticated preview with
   `JARVIS_PREVIEW_BASE=/api/preview/chat-first/ npm run build -w @jarvis-command/web`.
   Prepare a compatible candidate backend through the existing isolated/recoverable
   preview process. If this requires changing the production backend, report the
   concrete cutover plan first; do not silently change production to make preview pass.
5. Verify public build/version identity, project edit readback, active reload then
   completion with one answer, preservation of repeated identical older replies,
   and a genuine Hermes approval/denial round-trip using a harmless owned fixture.
   Verify preview sign-in leaves an existing root worker registered and production
   pending identity untouched. Use a disposable browser profile for that test.
6. Return exact source and backend commits, preview URL, focused results and any
   remaining failures. No merge or production replacement yet.
