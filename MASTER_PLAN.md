# Jarvis Command 2.0 — The AI Cockpit
## Dev Studio implementation blueprint

**Status:** Proposed product and engineering specification — not implemented, merged, or deployed.  
**Prepared:** October 23, 2026.  
**Primary repository:** `KumarG23/jarvis-command`  
**Starting-point candidate:** `release/gpt6-sol-luna` (not `main`, which is an older read-only prototype).  
**Runtime authority:** Existing Hermes/Jarvis installation; never create a second Jarvis brain, independent memory store, or duplicate autonomous agent coordinator.

---

## 1. Product contract and priorities

### Mission
Build the app Neal opens dozens of times a day to talk with Jarvis and his specialized agents from Android and desktop. The interface combines **ChatGPT's comfortable conversation flow**, **Claude's contextual document/artifact workspace**, and **Hermes CLI's honest live activity and usage visibility**. It must feel cohesive rather than a terminal skin or systems dashboard. Jarvis is the default entry point; specialized agents are first-class, and native Hermes agent-to-agent conversations are available in shared rooms when supported.

**North star:** Chat first. CLI-grade visibility. Complexity on demand. Real Hermes state only.

### Product principles, in strict priority order
1. Working, reliable chat beats infrastructure refactors, animations, feature count, and dashboard widgets.
2. Never present a clickable feature as finished unless its production round trip works with the real Hermes server.
3. Preserve existing authorization, credential isolation, approval/audit, and recovery boundaries; do **not** start a general security-platform rewrite. Scope a security change only to a concrete changed boundary and regression risk.
4. Expose **facts**: actual run state, events, model/effort, usage and artifacts, including truthful unavailable states. No fake thinking text, invented token/cost values, made-up tool traces, or simulated results in production.
5. Reuse Hermes profiles, sessions, runs, group-room authority, and Bot Mode where verified. A UI should not become another session/memory/orchestration authority.
6. Mobile and desktop are equally important. An app that works on desktop but fails with the Android keyboard, lock screen, or network transitions is incomplete.
7. Limit automatic agent activity. No new Kanban scheduler, speculative backlog worker, auto-task replenishment, or unbounded multi-bot loops.
8. Deliver small vertical slices with real-device acceptance before expanding the scope.

### Explicit non-goals in the initial releases
- No IDE or browser workbench, arbitrary system-administration console, generic public API proxy, or native Android rewrite at the outset.
- No replacement for Dev Studio's own GitHub issues/PRs and existing Sol lead/timer processes.
- No homemade LLM reasoning transcript. Reasoning-token usage is **not** access to a model's private chain of thought.
- No multi-provider orchestration platform unless the existing Hermes contracts demand one.
- No new plugin framework, automatic coding agents or routine generator simply to make the app "extensible."

## 2. Starting evidence and verification caveats

The observed `main` source is a secure **read-only v0.1** (the composer and most controls are intentionally disabled). Do not build new work on top of `main` by accident.

The `release/gpt6-sol-luna` tree instead contains significant features: `LiveRoom`, `useLiveTurn`, `TurnView`, `SessionContextMeter`, `SessionLifecycleControls`, a curated per-run model/effort roster, the Fastify BFF and command proxy, project rooms, and `ArtifactStudio`. Its status documentation records a September 22, 2026 production release, but **the presently running deployment has not been verified**. Some features may be coded but broken or not activated on the live server. The user reports previous defects in token counts, artifacts, overall UI, and general functionality; treat those as unclosed acceptance failures until real proofs exist.

Relevant existing files:
- `apps/web/src/App.tsx`, `LiveRoom.tsx`, `TurnView.tsx`, `useLiveTurn.ts`, `SessionContextMeter.tsx`, `SessionLifecycleControls.tsx`, `ArtifactStudio.tsx`, `ProjectRooms.tsx`, `styles.css`
- `apps/server/src/live-room-routes.ts`, `live-room-service.ts`, `artifact-routes.ts`, `artifact-store.ts`
- `apps/command-proxy/src/app.ts`; `packages/contracts/src/contracts.ts`
- `docs/project-status.md`, `docs/artifact-studio.md` on `release/gpt6-sol-luna`
- Android TWA at `apps/android`, pointing to `https://command.sharma-house.com/`.

Hermes grounding:
- API server (`gateway/platforms/api_server.py` in `KumarG23/hermes-agent`) supports persisted sessions, Runs API and structured progress/usage.
- Hermes profile routing and Bot Mode expose persistent personalities, separate memories and agent-to-agent messages.
- **Important:** Hermes group-chat APIs have capability-dependent semantics. Some authenticated canonical WebSocket surfaces expose `groups.list`, `.state`, `.log`, `.create`, etc., while advertising `driver:false` and **not** accepting group send/turn controls. A production team-room implementation **must first prove `groups.capabilities`, the exact supported transport, and a real send/receive round trip** on the user's currently installed Hermes version. Bot Mode marketing/docs alone are not sufficient.
- Headless Bot-to-bot `message_agent` requires canonical session title `Bot Chat`, Bot-Mode-managed profile metadata, and the enabled protocol; ordinary chats do not automatically gain that tool. Verify real profiles/aliases rather than assuming a Discord bot identity is a Hermes profile.

References:
- https://github.com/KumarG23/jarvis-command/tree/release/gpt6-sol-luna
- https://github.com/KumarG23/jarvis-command/blob/release/gpt6-sol-luna/docs/project-status.md
- https://github.com/KumarG23/jarvis-command/blob/release/gpt6-sol-luna/docs/artifact-studio.md
- https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode
- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals

## 3. UX specification: "polished chat with a live terminal heartbeat"

### Personality and visual language
- Default dark theme, with a later accessible light option. Neutral graphite surfaces, warm off-white text, restrained emerald/teal operational accents. No full-screen sci-fi dashboard, persistent CPU charts, glows, or busy triple-panel phone layout.
- Typography optimized for extended reading, clear monospace for code/CLI details, consistent vertical rhythm and 44–48 px minimum touch targets.
- Jarvis has a recognizable identity but stays understated. Specialized agents can have avatars, friendly titles, brief roles and distinct personality cues; do not hardwire personality into app prompts when the Hermes profile is authoritative.
- Use real event-based micro-animations; no indefinitely pulsing fake progress state or fabricated elapsed work.

### Mobile phone layout

```
┌──────────────────────────────────────────┐
│ ≡   Jarvis ▾     Sol · High    ● Online  │
│                     Context 42k / 128k   │
├──────────────────────────────────────────┤
│                 CHAT TRANSCRIPT          │
│ User: Can Scout check this approach?     │
│                                          │
│ Jarvis: I'll ask Scout to review it.     │
│                                          │
│ ◌ Deliberating · 12s                      │
│ ▸ Activity · Scout running · 2 tools     │
│                                          │
│ Jarvis: Here's what we found...          │
│ ▸ Usage · 8.4k in / 1.2k out · 2 calls   │
│                                          │
├──────────────────────────────────────────┤
│ ＋  Message Jarvis…             🎙   ↑     │
└──────────────────────────────────────────┘
```

- Top header: current chat/agent selector, small truthful connection indicator, compact current model and effort chip, optional context chip. Tap reveals model/effort sheet. Current *requested* settings and last *executed* route must not be confused.
- Conversation: messages front-and-center, accessible Markdown/code/tables, copy controls, nested tool summaries collapsed by default; no raw JSON in normal chat.
- Working state: one clear evolving line such as `Deliberating`, `Calling tool`, `Waiting for Scout`, `Waiting for your approval`, `Writing reply` or `Reconnecting`. The line follows actual state/events and elapsed clock, not invented model text.
- Tap working line to expand **Activity**: chronological structured events, tool names, completed/failed duration, named agent handoffs, model-run/usage receipts and provider-generated brief summaries only where explicitly available. **Never claim to show private hidden reasoning.**
- Fixed composer: multiline input, attachment, voice-input placeholder until implemented, send/stop/steer appropriate to run state, persisted draft, focus and scroll retention during Android soft keyboard.
- Drawer or compact tab navigation: Chats, Agents, Rooms, Projects, Artifacts, Notifications. Do not use six permanently visible tabs on narrow screens; choose a responsive priority set with overflow/drawer.
- Approval as an actionable, identity-bound card with exact command target, details and one-time approve/deny. No approval by implication.

### Desktop / work-browser layout
- Left navigation (resizable/collapsible): new chat, search, recent chats, agents, rooms and projects. No wall of analytics.
- Center: same authoritative conversation components as mobile, optimized line length ~680–860 px, rich keyboard/hover interactions and Markdown/code readability.
- Right contextual pane closed by default: Activity, Usage, Artifact, Project context, or Approval detail. Never steal chat width until opened.
- Keyboard conveniences: `Ctrl/Cmd+K` search/command palette, `Ctrl/Cmd+Enter` configurable send, `Esc` close pane, accessible navigation, no destructive shortcuts.
- At work in Edge/Chrome, session restoration and reauthentication must not lose a typed draft; handle constrained viewport height, split screen and browser notifications honestly.

### Core information hierarchy
1. Who am I talking to and what did they say?
2. Are they working, waiting, done or blocked?
3. What can I do next (reply, approve, steer, open output)?
4. What model/effort is in effect, and what did this run cost in tokens/context?
5. What did the tools/agents do? (expand on demand)
6. What advanced details do I need? (inspector)

## 4. Five distinct user workflows

### A. Ordinary Jarvis conversation
Launch app → last Jarvis chat opens → enter message → server admits exactly one Hermes run → streamed answer appears → after completion, canonical history and usage receipt reconcile → reopen Android/desktop and see one durable answer. User can copy text, open links/files, expand real activity and see model/effort/usage.

### B. Direct specialist chat
Open Agents → choose Scout/Sentinel/storyteller → route to *that actual Hermes profile* and durable canonical chat where appropriate → resume own history, tools, memory and model. Returning to Jarvis leaves the specialist's state intact. The roster comes from authenticated profile discovery; never make an agent appear functional just because a hardcoded card exists.

### C. Jarvis delegates to a teammate
In Jarvis' canonical Bot Chat, user can `@Scout` or explicitly ask Jarvis to consult Scout. Hermes actually dispatches the inter-agent message; UI shows `Jarvis → Scout` dispatch, queued/working/returned/failed status and the attributed reply when supported. **Queued does not mean delivered.** Unknown outcome must not be automatically resent. No copied persona simulating Scout's answer.

### D. Shared AI-team discussion
New Room → pick 2–6 existing Hermes profiles → ask a question and @mention members → see distinct attributed turns and optional thread focus → Jarvis and the team can address one another and escalate with `@user`. Surface bounded rounds/turn limits, Stop, member failures, awaiting-approval, and durable transcripts. The user's app disappearing must not cause duplicate model runs. Rooms must require verified native writable driver capability, not merely group-list metadata.

### E. Producing a usable artifact
In chat use `Create artifact` or `Save response`, or attach a real image/file. Server records an immutable artifact ID/version/checksum, links it to the authenticated chat/project, and returns a stable resource. Preview relevant types safely, revise text into a new version, download, close/reopen app and get the same bytes. Automatically ingesting arbitrary files produced by tools is a separate feature and only advertised after a verified Hermes artifact event/ownership path exists.

## 5. Truthful activity, thinking and usage (P0-level requirements)

### Activity line and inspector
- Drive from existing events such as `message.delta`, `tool.started/completed`, `subagent.start/complete`, `approval.request/responded`, run states and terminal status.
- UI state machine: `idle → admitting → deliberating → tool_running / agent_waiting / approval_waiting / responding → completed | failed | interrupted`. `reconnecting` is a transport overlay, not proof the model restarted.
- When the provider is quiet and the run remains active, display `Working…` with elapsed time and last verified event. Don't invent "Searching the web" if no search tool event exists.
- Expand Activity to show sanitized tool progress and **public process explanations**, not raw private chain of thought. If a provider supplies an explicit safe summary, label it `Model-provided summary`; otherwise only event-derived descriptions appear.
- Collapse ordinary successful tool calls by default; auto-surface errors, approvals and useful agent handoffs.
- Preserve a persisted event cursor or recompute from authoritative run status/history after disconnect; never reapply streamed deltas twice. When evidence is lost, say `Some live activity was unavailable` rather than reconstructing fictional steps.

### Token and context accounting
- Existing branch already has `LiveRunUsage`, `SessionContextMeter`, and `ExecutionReceipt`. Audit and repair before replacing. Distinguish **tokens for this run** from **tokens occupying the session context window**.
- Display `input`, `output`, `total`, optional `reasoning`, `cache read/write`, API calls, throughput/latency, context used/limit, and executed model/effort, *only from the authoritative receipt for that exact run/session*.
- During an in-flight run, show verified cumulative counters if Hermes provides them; otherwise `Usage available when run finishes` instead of a rapidly changing fabricated estimate.
- When unknown: `—` and explanatory tooltip; never zero. For estimates, explicitly label `Estimated` and identify calculation source; no estimate silently becomes exact.
- Cost is optional: absent unless provider billing facts or a clearly labeled, dated pricing estimate can be calculated. Never conflate free/OAuth usage limits with monetary cost.
- Context indicator displays both used/limit and percentage, never percentage alone without denominator accessible. If a context limit is not reported, show `Context unavailable`.
- Executed model/effort receipt supersedes requested selection for historic run label. Report changed/unsupported selection visibly rather than silently falling back.

### Model and effort controls
- Keep current per-run settings from the advanced branch: `Inherit` default, supported provider/model pairs from authenticated Hermes inventory, and only valid effort levels for the chosen route.
- Persist chosen override per chat/agent in application preference storage, but do not mutate the global Hermes config without an explicit separate action. Ensure desktop and phone agree, with one documented precedence rule.
- Show exact executed model and requested vs executed mismatch in receipts. Unsupported effort should be disabled with explanation, not accepted and ignored.
- Validate exact inference choice again server-side before admitting the run; no generic model proxy, no silent fallback.

## 6. Technical boundaries and proposed contracts

### Architecture
```
Android TWA / PWA + Desktop browser
   │ HTTPS, Cloudflare Access, existing login
   ▼
Jarvis Command BFF (Fastify; identity + narrow typed operations)
   ├── Existing read/command proxy → Hermes Runs/Sessions/Usage
   ├── Proposed narrow profile/room adapter → verified Hermes capability-specific transport
   ├── Existing artifact store → immutable artifact versions
   └── Proposed notification outbox/Web Push service → subscribed device/browser

Hermes stays the authority for inference, tools, persona, profile memory,
canonical sessions, room turn driver and agent-to-agent delivery.
```

Do not expose upstream API keys to browser, expose arbitrary profile selectors, reuse an admin dashboard bearer to grant unrestricted controls, or change production auth just to make a demo work. Keep server-side identity checks, `Cloudflare Access` verification, audit ledgers, immutable release/rollback and existing bridge restrictions. New boundaries get narrow tests; unchanged infrastructure should not be repeatedly redesigned.

### Suggested frontend/BFF DTO contracts (proposals; reconcile with existing Zod types)

```
AgentCard {
  agentId: string; profileId: string; connectionId?: string;
  title: string; description?: string; avatarUrl?: string;
  online: boolean | null; canonicalSessionId: string | null;
  capabilities: { chat: boolean; messageAgent: boolean; group: boolean };
}

ActivityItem {
  eventId: string; runId: string; sessionId: string;
  timestamp: string; kind: 'phase'|'tool'|'subagent'|'approval'|'error'|'notice';
  state: 'started'|'completed'|'failed'|'pending'|'unknown';
  title: string; details?: string; source: 'hermes'|'command';
}

UsageView {
  runId: string; sessionId: string; observedAt: string;
  inputTokens?: number; outputTokens?: number; totalTokens?: number;
  reasoningTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number;
  contextUsedTokens?: number; contextLimitTokens?: number;
  apiCalls?: number; latencyMs?: number;
  requestedRoute?: { model: string; effort?: string };
  executedRoute?: { model: string; effort?: string };
  accuracy: 'authoritative'|'estimated'|'unavailable';
}

GroupCapability {
  available: boolean; readable: boolean; writable: boolean;
  driver: boolean; supportedActions: string[];
  reasonWhenUnavailable?: string;
}

NotificationItem {
  id: string; type: 'run-completed'|'run-failed'|'approval'|'agent-reply'|'mention'|'room-needs-user';
  occurredAt: string; chatOrRoomId: string; runId?: string;
  title: string; shortBody: string; readAt?: string;
}
```

DTO fields are *not* a requirement to add duplicate storage. Prefer projections of existing server types and exact Hermes IDs/cursors; add storage only for Command-specific preferences, push subscriptions, device notification receipts, and UI-owned artifacts.

### Conversation and recovery invariants
- A user send has a client-generated idempotency key; replaying HTTP after a drop never creates a second inference run.
- Same-session concurrent admissions must serialize or present an explicit queued state. Distinct sessions/profiles can work independently.
- Completions belong to exact authenticated session and public run ID; no cross-chat leaks.
- One message in durable Hermes history maps to one rendered message, including repeated identical answers. Never dedupe by text content.
- On reload, verify pending run status and canonical history first; never blindly resubmit stored user text.
- On provider/transport errors, preserve the draft and distinguish `not admitted`, `admitted but unknown`, `failed`, and `completed`. Unknown is not grounds for a retry.
- Edits to project/room metadata must retain unsaved drafts on failure and verify authoritative readback after save.

### Native Hermes Bot/Groups capability spike
1. Pin actual installed Hermes commit and runtime mode(s): `api_server` vs dashboard/serve and enabled profiles.
2. Query available profile discovery, canonical Bot Chat mappings, group capabilities and transport on a test instance matching production.
3. Prove a **direct** user-to-Scout turn in its existing profile/session, without falling back to Jarvis.
4. Prove real `message_agent` from Jarvis's canonical Bot Chat → Scout → attributed result; confirm prerequisites and `queued` vs `settled` semantics. If not available, document exact missing backend feature rather than adding a spoofed integration.
5. Prove group create/list/log; separately require `driver:true` and exact send/stop/approval methods before attempting a usable room UI. The canonical WebSocket may offer metadata-only `driver:false`. If unsupported, create one narrow adapter issue with a clear test contract, or defer multi-agent rooms. Do not turn a metadata-only endpoint into a fake working chat.
6. Verify room state survives app disconnect/restart and identical turns are not replayed; preserve existing 3-round/10-message server cap and stop semantics.

## 7. Notifications specification (required for usable phone release)

### Triggers
Opt-in notifications for: direct replies to the user, a run/task that the user started finishing/failing, a command approval needing action, a teammate `@user` escalation, room mention/needs-attention, and explicitly selected persistent job completions. Do not spam every tool event, token update, Bot-to-bot chat line, or Sol timer tick.

### Implementation path
- First prove standards-based **Web Push** with existing PWA/service worker and Android TWA plus desktop Chrome/Edge using a secured VAPID sender and server-side subscription store. Verify behavior when app is closed/Android screen locked, after a phone/browser restart, on Wi-Fi and cellular, and with browser notification permission denied.
- If Android TWA cannot reliably deliver those pushes in the actual signed installation, create a tightly scoped native Android notification receiver as a separate compatibility decision. Do not build a whole Kotlin app as a speculative prerequisite.
- Provide notification preferences by category, optional quiet mode, unread inbox and per-device registration/revocation.
- The server emits one durable notification ID per meaningful event; dedupe across retries and avoid double delivery on every SSE reconnect. Deep links identify the exact chat/room/approval and recheck current authorization/status before offering an action.
- Push body must be privacy-conscious and safe on a work lock screen. Default generic preview for private content; actionable details display only after re-authentication in the app. No remote approval directly from an unauthenticated push notification.
- Completions originating in Hermes CLI/Discord/other native paths require an authoritative gateway event/hook/receipt source; app-local run events alone are insufficient. Verify this explicitly before claiming cross-surface notifications.

## 8. Reliable artifacts specification

Start with the existing `ArtifactStudio` and run a real functional audit. A working artifact is not just a preview tile. Required round trip:
1. User asks Jarvis to create a Markdown or code artifact, or saves an actual model response.
2. Exact run completes; server writes the artifact with immutable ID, version, checksum and scoped permissions.
3. Mobile and desktop can open the same artifact, copy/download the bytes and see the exact version.
4. Edit creates v2 and does not mutate v1; reopen after service restart to verify persistence.
5. PDF/image/code/HTML preview types render appropriately. HTML/SVG stay isolated in sandbox; untrusted content cannot execute against the authenticated app origin.
6. Save failure is honest and recoverable; orphaned/duplicate artifacts and wrong-session attachments are rejected.

Do **not** claim every arbitrary Hermes tool output is automatically captured. That requires a separately proven resource/event ingestion path and ownership mapping.

## 9. Dev Studio execution discipline

The team already works through GitHub issues/PRs with Sol as lead/reviewer. Keep the current functioning workflow and timer **unchanged**. Kanban automation was previously tabled because it created needless work and burned usage; do not reactivate or recreate it.

### Roles
- **Sol lead:** break this exact approved specification into bounded GitHub issues, maintain dependencies, reconcile PRs, review material integration risks, present short updates to the user. No periodic exploratory jobs outside the defined active scope.
- **Frontend owner:** owns visual components and responsive tests for one vertical slice at a time. Separate UI branch/worktree; no overlapping major edits to `App.tsx`/`TurnView.tsx` by concurrent workers.
- **Hermes/backend owner:** owns the API/adapter work only when the frontend requires a verified real transport contract. Use existing session/proxy code; no credentials passed to UI workers.
- **Test/QA worker:** optional, for a defined reproducible contract, fixture, regression or screenshot comparison—never a free-form repository audit.

### Usage discipline
- Start with **one active implementation issue** by default; allow at most one non-overlapping backend contract issue alongside a frontend issue when the dependency makes that efficient.
- Use economical model/routes for simple coding and test updates. Escalate to Sol/high reasoning only for ambiguity, a difficult integration defect or genuinely consequential changed boundary; no max-effort default for every issue.
- Reuse existing passing tests where unchanged. Each PR runs focused tests, related typecheck/lint/build and affected-device smoke tests; whole-repo suite at milestone/release gates or where risk justifies it.
- No speculative issue generation or self-triggered follow-up work. Work only approved milestone issues and report blockers succinctly rather than endlessly retrying.
- Sol does not autonomously merge/deploy a milestone that changes production without the existing authorization and release policy; the user sees a reviewable preview first.
- WIP preserved. Never force-reset branches, clobber untracked files, weaken auth, merge `main` blindly, or restart production Hermes to satisfy a frontend test.

### Required issue template
Every GitHub issue contains: **User-visible outcome; Existing behavior and failing proof; Scope / exact target components; Confirmed upstream contract; Dependencies; Explicit exclusions; Implementation owner; Concrete acceptance tests; Browser/phone test scenario; Expected evidence; Definition of Done.** A task lacking these is not ready for assignment.

### PR / completion report format
`Issue; source branch + commit; affected files; user-visible behavior; evidence from real Hermes; focused tests; Android + desktop verification; known gaps; cost/usage impact; rollback plan (if deployed); next approved issue.`

## 10. Milestone plan — execute sequentially, no giant single PR

### M0 — Discovery & honest baseline (must go first)
- Compare live production release SHA/config with `release/gpt6-sol-luna` and other relevant branches, without modifying production.
- Record the exact reachable APIs for session chat, runs/events/usage, models/effort, profiles, Bot DM, group capability, artifacts and notifications.
- Exercise existing features from desktop and real Android: a chat, reload, model change, token receipt, context meter and artifact save/open.
- Produce a concise **feature truth matrix**: `Working live / Broken live / Coded but unverified / Unsupported / Deferred`, with a reproducer and source for every claim.
- Deliver first 3-screen visual direction (chat, activity/usage inspector, group/agents). Verify it supports a narrow phone and desktop.
- **Done:** no more assumptions about which branch is live, which controls work, or whether group send is possible. No deployment from discovery.

### M0 baseline-repair exception (confirmed existing defects only)
M0 discovery may remain open for physical Android, Neal's visual/product direction, or native profile/Bot/group contracts. Those gates block their *dependent acceptance and new M1+ product work*, not repair of an already confirmed baseline regression on the existing Command UI. Sol may open a small, separately owned `team:ready` bug issue for each coherent, evidenced repair and use the ordinary issue → branch on `release/gpt6-sol-luna` → focused tests → PR/CI → lead review workflow without seeking repeated approval for each ordinary fix. Keep the M0 discovery owner and its evidence intact; do not mark M0 or phone acceptance complete because a regression was repaired. Record the repair's actual built/merged/deployed state and remaining acceptance gates in the coherent handoff.

Initial repair candidates are the observed completed-history/reload receipt omission and hover-only context denominator, and the 360 px header that clips the composer (see JC2-001's live browser delta). Reuse the existing completed fixture and authoritative receipts; no new inference, message, artifact mutation, invented field, stale-run backfill, or unsupported model claim is implied. At accessible desktop and narrow emulated widths, prove restored behavior with real-browser evidence and focused regression tests; physical Android keyboard/device behavior remains a separate acceptance gate. A candidate fix is not a live deployment. Keep PR #4's runtime/proxy repair separately owned and do not merge it by implication.

This exception does **not** authorize the M1 responsive-shell redesign, M3 Activity/Usage inspector, new Bot/group delivery, broader V2 implementation, new production/auth/network/provider changes, a service restart/deployment outside the normal separately authorized release path, or altered Studio timers/roster/capacity policy. Neal still chooses the visual direction before broad UI work; runtime owner supplies native contracts without guessed APIs. Sol chooses a capable owner per issue and may leave capacity idle rather than forcing unrelated workers.

### M1 — Design foundation & responsive shell
- Create cohesive tokens/components: chat typography, message blocks, code syntax/copy, activity line, agent chip, composer, accessible drawers and overlays.
- Implement mobile-first chat shell; desktop left nav + central chat + optional right pane. No unnecessary product dashboard chrome.
- Build a realistic preview with clearly labeled synthetic data; user can inspect Android and desktop layouts before API features are added. No pretend live-state in production.
- **Done:** design approved by user; 320–430 px phones and 1280+ desktop work with keyboard, long code and scrolling.

### M2 — Real chat vertical slice
- Wire one Jarvis session end to end against actual Hermes: send, stream, tool activity, stop, persistence, reload, reauth, reconnect and exact-history reconciliation.
- Preserve drafts and pending run state. Chat must never duplicate responses or silently retry a previously admitted run.
- Move old unsupported/fake navigation behind disabled feature flags or remove it until functional.
- **Done:** create chat, send 10 distinct and repeated-text messages, switch phone networks, reload mid-run, restart test app service, read same exact history, no duplicate model admission. Verify Android and desktop.

### M3 — Live activity + token/context truth + model/effort
- Turn existing `RunInspector`, `ExecutionReceipt` and `SessionContextMeter` into the compact status line and expandable Activity/Usage sheet.
- Validate exact run receipts including cache/reasoning token fields and account for null/unavailable. Separate context occupancy from token spend.
- Preserve and polish existing per-run model/effort controls; preflight options and verify *executed* route; meaningful mismatch warnings.
- **Done:** activity and counters match authoritative run status/API for multiple models; no fabricated thoughts or costs; model settings visibly affect real execution or show a supported error.

### M4 — Agents: persistent direct chats + mentions
- Discover real Hermes profiles, titles, avatars, capabilities and canonical Bot Chat sessions. Map Jarvis primary; list Scout/Sentinel/other actual profiles.
- Direct chat opens agent's **own** memory/session/model, not a Jarvis session with a different avatar.
- Implement mention picker where native delivery supports it; demonstrate Jarvis → Scout → Jarvis round trip with accurate queued/settled/error states.
- **Done:** agent sessions remain distinct after switching devices; real bot message has source attribution; failure/unknown delivery never triggers auto-resend.

### M5 — Push notifications + inbox
- Add durable category-filtered notification events, per-device subscription control, standards-based Web Push pilot and app inbox.
- Test push from app-owned completion, approval and at least one CLI/Discord-origin completion if authoritative cross-surface event source is available.
- Verify lock-screen, app closed, phone reboot, Wi-Fi→cellular, expired auth, duplicate event/reconnect, denied permission and desktop browser.
- **Done:** action-required notification arrives once and navigates to authorized exact run/room; private contents aren't exposed on lock screen; unsupported sources are labeled honestly.

### M6 — Collaboration rooms (capability-gated)
- After M0's group capability proof, connect Hermes native room list/create/log/turn controls through an authenticated narrow adapter. Reuse native member sessions and driver; **do not implement a new round-robin engine.**
- Implement participant roster, thread attribution, @mentions, bounded turns, stop/hold, user attention, errors and room notifications.
- Keep native bounds on rounds/messages; avoid spontaneous unrequested agent chatter. Track usage for each actual member turn when receipts exist.
- **Done:** Jarvis and Scout have a real two-way discussion on user's Hermes, a third agent can contribute, user can intervene, stop holds activity, logs persist after Android/desktop disconnect without duplicate turns. If the gateway only offers `driver:false`, M6 stops with documented blocker and must not be marked done.

### M7 — Artifact reliability
- Audit current store before replacement, fix Create/Save/upload/download/preview/versioning/links in real full chain.
- Wire artifact library into chat and project context. Make desktop side pane and mobile full-screen viewer share the same saved data.
- **Done:** exact artifact checksum and versions are stable across client/device/app restart; deliberate failure/permission cases pass; unsafe preview is sandboxed.

### M8 — Polish, field QA and release
- Address actual performance/visual bugs, a11y, low bandwidth, large histories, offline/reconnect and high-contrast/large-font use.
- Keep native TWA unless a proven phone limitation requires a limited native bridge. Verify signing/app links before release.
- Release via the existing recoverable deployment path, with actual source+artifact identity, smoke checks and rollback. **No production cutover until user authorizes it.**
- **Done:** Android and desktop daily-use scenarios pass, no dead navigation, no visible demo data, no false usage metrics, and known limitations clearly documented.

## 11. Priority GitHub issues to create from this spec

| Issue | Result | Milestone / dependency | Suggested owner |
|---|---|---|---|
| JC2-001 | Verify live branch and core capability truth matrix | M0 | Lead + runtime owner |
| JC2-002 | Design tokens and chat/Activity/Agents screen preview | M1, after 001 | Frontend |
| JC2-003 | Durable chat + mobile composer + no-duplicate recovery | M2, after 002 | Frontend/backend pair |
| JC2-004 | Compact accurate run status & expandable inspector | M3, after 003 | Frontend |
| JC2-005 | Exact usage/context and model/effort receipt reconciliation | M3, after 003 | Backend + frontend |
| JC2-006 | Profile discovery and canonical direct agent chats | M4, after 001/003 | Backend + frontend |
| JC2-007 | Hermes Bot DM and group `driver` capability spike | M4/M6, after 001 | Runtime owner |
| JC2-008 | Notification event source, inbox, Android/desktop push proof | M5, after 003 | Backend + frontend |
| JC2-009 | Group chat UI over proven writable Hermes driver | M6, after 007 | Backend + frontend |
| JC2-010 | Artifact end-to-end persistence and version smoke | M7, after 003 | Artifact owner |
| JC2-011 | Physical-device acceptance and recoverable release | M8, after relevant milestones | QA + lead |

**No auto-assignment for all issues simultaneously.** Start with JC2-001, and only enable subsequent work when dependencies and user-approved visual direction are satisfied. These issue IDs are *suggested labels*, not claims that GitHub issues were created.

## 12. Acceptance matrix and proof requirements

| Scenario | Required evidence |
|---|---|
| Android Pixel, app cold-start and soft keyboard open | Composer stays visible, enter/send multiline input, no jump/overlap, correct back behavior |
| Desktop Edge/Chrome at work | Chat, model picker, code blocks, inspector and split window usable at 1280×720 and normal desktop |
| Long output, code, tables, 200+ message history | Correct streaming, accessible scrolling/virtualization, copy and format preserved |
| Network drops after sending but before HTTP acknowledgment | One canonical run at most; recovered status or explicitly unknown, no silent retry |
| Reload while model is working | Same run resumes/polls, no duplicate response or tool execution |
| Repeated identical model responses | Both retained as separate messages with exact stored message IDs |
| Model/effort selection changes | Requested selection is validated, actual executed selection/usage inspected, mismatch surfaced |
| Usage unavailable or context unknown | Honest em dash + reason; no fabricated 0 tokens or context percentage |
| Bot DM from Jarvis to Scout | Actual target profile receives, delivery phases not conflated, response attributed |
| Room user closes Android app | Native driver finishes without re-drive, correct durable transcript on reopening |
| Room driver unsupported | UI visibly unavailable, no spoofed group conversation/turns |
| Notification when screen locked/app closed | One push with private-safe content, deep-link reauthorization, no duplicate |
| User disables notifications | No push; content still available in app |
| Artifact v1 → v2 → restart | Exact bytes/checksum/version preserved on mobile and desktop; sandboxed HTML |
| Approval after expired auth or stale run | Refused safely, action visibly still pending/expired, never silently applied |
| Service restart or auth expiry | Honest reconnect/login and exact pending-run recovery, draft preserved |

### Definition of Done for every feature
**Working code + actual Hermes round trip + narrow tests + desktop verification + physical Android verification (when feature is phone-facing) + no false/unsupported UI + concise proof.** A mock screenshot, green unit tests or code branch alone does not count as complete.

## 13. Kickoff message to Dev Studio / Jarvis / Sol

> We are building **Jarvis Command 2.0: The AI Cockpit**, a mobile-first but desktop-excellent ChatGPT/Claude/Hermes CLI hybrid. Jarvis is default; actual Hermes agents each have durable direct chats; collaboration rooms use native Hermes Bot Mode when real driver capabilities exist. Working functionality wins over security hardening or infrastructure refactoring. Preserve all current auth/credential/approval/audit boundaries. Do not run the former Kanban process, change Sol's existing timer, auto-generate jobs, or begin a new bot orchestration framework.
>
> Read the attached full specification. **Do M0 / JC2-001 first**: verify the currently deployed SHA and active capabilities, identify the correct advanced branch (`release/gpt6-sol-luna` candidate; `main` is obsolete), perform safe end-to-end checks of chat, usage/context, effort/model and Artifact Studio, and probe Hermes native profile/Bot/group capabilities including whether its group transport actually supports sending (`driver:true`). Return a concise feature truth matrix with reproducers and the three proposed UI screens. Discovery itself makes no production edit or deployment; the narrow confirmed-baseline repair exception above permits separately owned ordinary bug fixes while M0's unrelated gates remain open. Do not claim group chat ready if only metadata endpoints work.
>
> After M0, use one owner per coherent issue, separate worktrees, focused verification and a real physical phone test for mobile features. No dead controls; no fabricated token values, thinking text, tool events or costs. Show a small, genuinely working product improvement at the end of every milestone. Ask for review of the visual direction before a broad UI rewrite.

## 14. Approval gates and next action

**First requested output from Dev Studio:** JC2-001 verification report + feature truth matrix + 3 visual directions (conversation, expandable Activity, agents/groups). That is a complete, independently valuable first task. The user chooses a design direction before new M1/M2 product work; confirmed existing UI regressions may proceed under the M0 baseline-repair exception without treating physical Android, native Bot/group evidence or design approval as a global stop. No secrets, privilege changes, production route changes, broad Git resets, worktree deletions, auto-merge, or public deployment are authorized by this spec.
