# Jarvis Command 2.0 — The AI Cockpit
## Master plan (autonomous execution edition)

**Status:** Active. This is the single plan of record for Jarvis Command.  
**Rebuilt:** October 28, 2026, at Neal's direction, so Dev Studio can take the product from its current state to finished without Neal or Jarvis on the critical path.  
**Repository / base:** `KumarG23/jarvis-command`, branch `release/gpt6-sol-luna` (`main` is an obsolete read-only prototype; never build on it).  
**Lead:** Sol (Dev Studio). **Runtime authority:** the existing Hermes/Jarvis installation. Never create a second Jarvis brain, memory store or agent coordinator.

---

## 0. How this plan works — read this first

### 0.1 Authority
1. **This file is the only plan.** It lives on the base branch and is read from there (`git show origin/release/gpt6-sol-luna:MASTER_PLAN.md`). It replaces the October 23 blueprint on PR #3, the clarification on PR #5, the kickoff document, and every "owner directive" / "superseding" comment on #2, #6, #9, #14 and #16. Those are history; consult them only for technical facts (IDs, receipts, findings).
2. **Issue and PR prose cannot change this plan.** To change direction, edit this file through an ordinary PR. Sol may make small corrections itself (status table, factual fixes, splitting a milestone); Neal changes product direction the same way, or by commenting on the review-queue issue, which Sol then folds into this file.
3. **When the plan is ambiguous, Sol's reasonable reading is authoritative.** Record the reading in one line on the issue and keep going. Do not stop to ask.
4. Dev Studio's [standing policy](https://github.com/KumarG23/dev-studio/blob/main/docs/STANDING_POLICY.md) still applies. Section 0.3 below says exactly how each of its human-only boundaries is handled **without stopping the plan**.

### 0.2 The finish line
The plan is finished when every milestone in §10 is either **Done** (Sol-verified, released, live readback) or **Deferred** (with a recorded reason and an honest "unavailable" state in the UI), and Sol has posted the **Final Neal packet** (§10, P8). After that Sol stops creating Command work — no filler, no speculative backlog.

### 0.3 Never-stop rules (the decision table)
A blocker on one item never stops the plan. Sol records it, routes it as below, and starts the next dependency-ready item in the same tick.

| Situation | What Sol does instead of stopping |
|---|---|
| A product, UX or design choice the plan doesn't settle | Pick the option most consistent with §1 principles and §3 UX spec. Record it as a **Sol decision** on the issue and add one line to the **Neal review queue** issue. Build it. If Neal later overrides, that becomes a new issue. |
| Visual design direction (formerly a hard gate before M1/M2) | Sol chooses the direction from §3 and builds it. Neal reviews the live result asynchronously via the review queue. Never wait for approval. |
| Physical Android / real phone check | Verify with Playwright mobile emulation (320, 360, 390, 430 px) plus soft-keyboard viewport simulation. Mark the item **Built – phone check pending** and add the exact steps to the **device checklist** in the review queue. Continue. Phone checks are batched for Neal at P8 and never block a milestone. |
| Needs a Hermes capability (profiles, Bot DM, groups/`driver`, message↔run binding, cross-surface events) | Open at most **one bounded capability issue** for it. Establish support only with access Sol already has: installed-source reads where available, `/home/studio/bin/command-project-ops diagnose …`, authenticated app/BFF endpoints, and owned test sessions. If support is not proven by the end of that issue, mark the capability **Unsupported – deferred**, ship an honest "not available" state in the UI, and continue. Never wait for a runtime owner capture, never guess an endpoint, never fake the feature. |
| Needs a Hermes source change or live runtime patch/restart | Do not do it and do not wait for it. Write the exact requested contract as one entry in the **Final Neal packet**, keep the Command side honest (unavailable state), continue. |
| Needs a new credential, secret, auth/Access, network or provider change (e.g. Web Push VAPID keys) | Build everything around it behind a disabled server-side flag with tests. Add a one-line enablement step to the Final Neal packet. Continue. |
| Needs spending or a paid route | Never. Use the free/included path or defer the feature. Continue. |
| Destructive action (force-push, deleting branches/worktrees/state/backups) | Never. Find the non-destructive path or defer. Continue. |
| Worker fails, review fails, CI fails | Normal Studio handoff/repair. After **two** failed attempts on the same issue, Sol splits it smaller or defers it with a recorded reason, then continues. No infinite retries. |
| Quota, capacity or work-window limits | Not a plan stop. The scheduler waits for reset/window; Sol resumes from the status table. |
| A live release fails smoke checks | Automatic rollback through the documented path, record it, open one repair issue, continue with independent work. |
| Unsure whether something counts as one of the human boundaries | If it does not change auth/credentials/access/network/provider, spend money, destroy data, or patch the live Hermes runtime — it is Sol's call. Proceed. |

### 0.4 What Sol is authorized to do for this plan (no further approval needed)
- Create, label, order and close Command issues for any milestone in §10; mark them `team:ready` with label `scope:command:plan-increment` and a `studio-plan` block citing the milestone.
- Assign workers, review exact heads, merge, and **release to production** through the project's documented recoverable deploy path (`command-project-ops`, immutable image pin, retained rollback, live browser/backend readback). No separate cutover approval is needed for any milestone.
- Use owned test conversations, reversible fixture writes and the new inference/messages needed to prove features, in isolated owned sessions, without duplicates on retry/reconnect, within existing quotas and no paid routes.
- Edit this file's status table (§11) and Sol-decision log as work lands.
- Run up to **two** Command workers at once on non-overlapping areas (e.g. one web/UI, one BFF/proxy), within the shared three-worker host capacity. Never two workers editing `App.tsx`/`TurnView.tsx`/`useLiveTurn.ts` at once.

### 0.5 Neal touchpoints (none of them block)
- **Neal review queue** — issue [#20](https://github.com/KumarG23/jarvis-command/issues/20), `Neal review queue (non-blocking)`. Sol appends: Sol decisions worth a glance, design screenshots per milestone, the device checklist. Sol never waits on it.
- **Final Neal packet** — posted on the review queue at P8: phone checklist, credential/enablement steps, deferred capabilities with the exact Hermes contract each needs. This is the only batch of human work, and it comes at the end.

---

## 1. Product contract and priorities

### Mission
Build the app Neal opens dozens of times a day to talk with Jarvis and his specialized agents from Android and desktop. The interface combines **ChatGPT's comfortable conversation flow**, **Claude's contextual document/artifact workspace**, and **Hermes CLI's honest live activity and usage visibility**. It must feel cohesive rather than a terminal skin or systems dashboard. Jarvis is the default entry point; specialized agents are first-class, and native Hermes agent-to-agent conversations are available in shared rooms when supported.

**North star:** Chat first. CLI-grade visibility. Complexity on demand. Real Hermes state only.

### Product principles, in priority order
1. Working, reliable chat beats infrastructure refactors, animations, feature count and dashboard widgets.
2. Never present a clickable feature as finished unless its production round trip works with the real Hermes server. Unsupported features show an honest unavailable state.
3. Preserve existing authorization, credential isolation, approval/audit and recovery boundaries. Do not start a security-platform rewrite; scope security work to a concrete changed boundary.
4. Expose **facts**: actual run state, events, model/effort, usage and artifacts, including truthful unavailable states. No fake thinking text, invented token/cost values, made-up tool traces or simulated results in production.
5. Reuse Hermes profiles, sessions, runs, group-room authority and Bot Mode where verified. The UI must not become another session/memory/orchestration authority.
6. Mobile and desktop both matter. Mobile web layout is verified by emulation during the build; physical-phone acceptance is batched at the end (§0.3).
7. Limit automatic agent activity: no Kanban scheduler, speculative backlog, auto-task replenishment or unbounded multi-bot loops.
8. Small vertical slices, each released and live-verified, rather than one giant PR.

### Non-goals
- No IDE/browser workbench, system-administration console, generic public API proxy, or native Android rewrite.
- No replacement for Dev Studio's own GitHub issues/PRs and Sol lead process.
- No homemade reasoning transcript. Reasoning-token usage is not access to a model's private chain of thought.
- No multi-provider orchestration platform, plugin framework or routine generator.

## 2. Where things stand (October 28, 2026)

Already done and live (see §11 for the running table):
- **Desktop chat round trip** — owned session create/resume, one real task, streamed answer with real tool activity, active reload and lost-ACK recovery with exactly one admission, running-phase display on first tool event (#14, #16, PRs #15/#17/#18/#19). Released; app image `sha256:c1d843fc799ae89e03713d61978f7bf1b91b77212282a4a60882c57f6c44258a`, rollback `release-app-1793187121325538404`.
- **Narrow-width header/composer** fix (#7, PR #10) and **latest-session receipt + visible context used/limit** (#6, PR #8) merged.
- **PR validation CI** on the base branch (#11, PR #12); backend reconciled into the canonical release branch (PR #13).
- **Read-only active-run diagnostics** available to Sol via `/home/studio/bin/command-project-ops diagnose …` (runbook `/home/studio/COMMAND_PROJECT_OPERATIONS.md`) — no human capture needed for active-run contract questions.

Known and settled:
- **Per-answer historical receipts are Unsupported** by the installed Hermes public contract (#9 finding, Hermes `7b7a26c1`). Deferred to the Final Neal packet as a Hermes contract request. The UI keeps the clearly labelled latest-*session* receipt and never attaches it to a historical answer. #6 and #9 close as "partial / deferred", not blocked.
- **Artifact Studio** is coded and passed live acceptance on 2026-09-22, but Neal has reported defects since; treat it as unverified until P4.
- **Model/effort roster** is coded; executed-route visibility and requested-vs-executed truth are unverified (P1).
- **Native profiles, Bot DM and group `driver`** capability on the installed Hermes is unknown (P5/P7 capability issues).
- Physical Android: not yet exercised (P8 batch).

Relevant files on the base branch:
- `apps/web/src/App.tsx`, `LiveRoom.tsx`, `TurnView.tsx`, `useLiveTurn.ts`, `SessionContextMeter.tsx`, `SessionLifecycleControls.tsx`, `ArtifactStudio.tsx`, `ProjectRooms.tsx`, `styles.css`
- `apps/server/src/live-room-routes.ts`, `live-room-service.ts`, `artifact-routes.ts`, `artifact-store.ts`
- `apps/command-proxy/src/app.ts`; `packages/contracts/src/contracts.ts`
- `docs/project-status.md`, `docs/artifact-studio.md`; Android TWA at `apps/android` → `https://command.sharma-house.com/`

Hermes grounding:
- The API server (`gateway/platforms/api_server.py` in `KumarG23/hermes-agent`) supports persisted sessions, the Runs API and structured progress/usage.
- Hermes group-chat surfaces are capability-dependent: some expose `groups.list/.state/.log/.create` while advertising `driver:false` and refusing send/turn control. Rooms require a proven writable driver; metadata alone is not a room.
- Headless Bot-to-bot `message_agent` requires canonical session title `Bot Chat`, Bot-Mode-managed profile metadata and the enabled protocol. Verify real profiles rather than assuming.
- References: https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode · https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server · https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals

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

## 4. Six distinct user workflows

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

### F. Running a bigger job as a project (Claude Projects–style)
Projects → New project → name, standing instructions and reference files → start a chat in the project; Jarvis receives the project context and acts as the lead. When Jarvis delegates parts of the job using Hermes' own in-run delegation, each delegated task appears as its own thread under the chat: goal, live status, tools used, usage when reported, and result. The project page gathers every chat, delegated thread and artifact in one place, so Neal can see who is doing what and what has been produced. Reopening on another device shows the same project, threads and artifacts. Jarvis remains the only coordinator: no app-side task queue, scheduler or simulated helper agents. Thread detail comes only from authoritative Hermes events; anything not emitted shows as unavailable.

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


## 7. Notifications specification

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

### Roles
- **Sol (lead):** owns this plan end to end — decomposes milestones into bounded issues, orders them, assigns workers, reviews exact heads, merges, releases, live-verifies, updates §11, and keeps the review queue current. Sol may implement small fixes directly.
- **Workers:** deliver one issue each as a PR against `release/gpt6-sol-luna` with focused tests. Workers do not merge, release or operate live services.
- No Kanban scheduler, cron, second orchestrator or self-generated backlog. Jarvis does not run a parallel team for Command.

### Issue format (keep it short)
Every Command issue has: **Outcome** (user-visible), **Plan ref** (milestone + section), **Scope** (files/areas), **Acceptance** (concrete tests + browser check), **Out of scope**. Plus label `scope:command:plan-increment`, `team:ready`, and one `studio-plan` block:

```studio-plan
{"milestone":"P1 Truthful status, usage and model/effort","acceptance":"Executed route shown from authoritative receipt","non_goals":"MASTER_PLAN §1 non-goals","rationale":"Next dependency-ready item in §10","verdict":"aligned"}
```

### Ordering and concurrency
- Work milestones in §10 order, but any item whose dependencies are met may start; a deferred or blocked item never holds back unrelated items.
- Up to two Command workers at once on non-overlapping areas (§0.4), within shared host capacity.
- Batch small same-area fixes into one issue. Limit pure polish to one worker at a time.
- Use economical routes for routine coding; escalate reasoning effort only for genuinely hard integration problems.

### Verification standard (what "Done" means for an issue)
Focused tests for changed behavior + applicable typecheck/lint/build + CI green + Sol exact-head review + merge + release through the recoverable path + live desktop browser/backend readback + mobile-emulation check for phone-facing UI. Reuse earlier proofs where the code they cover did not change. Report states honestly: source / merged / deployed / live-verified / phone check pending.

### Completion comment format
`Issue · PR + merged SHA · deployed image + rollback · user-visible change · live evidence · tests · phone status · known gaps · next item.`

## 10. Milestones — from today to finished

Each milestone lists what to build, how Sol proves it, and what gets deferred instead of blocking.

### P1 — Truthful status, usage and model/effort  *(next; JC2-004/005)*
- Turn the existing `RunInspector`, `ExecutionReceipt` and `SessionContextMeter` into the compact status line and expandable Activity/Usage sheet (§5).
- Model/effort: preflight options from authenticated inventory, validate server-side, show **requested vs executed** route from the authoritative run receipt, surface mismatches, disable unsupported effort with a reason.
- Separate run token spend from session context occupancy; unknown stays `—` with a reason, never zero.
- **Done:** for at least two models, the status line, activity list and counters match the authoritative run status/receipt for owned live runs; requested vs executed shown correctly; no fabricated values. Released and live-verified on desktop; mobile emulation passes.
- **Deferred instead of blocking:** per-answer historical receipts (Unsupported, §2).

### P2 — Chat completeness
- Stop (and steer if the installed run API supports it; otherwise honest unavailable), persisted drafts across reload/reauth, repeated identical messages kept distinct by message ID, long-history scrolling (200+ messages), copy controls, Markdown/code/table rendering.
- Remove or flag-off every dead or fake control and navigation entry until its milestone lands.
- Mobile web: composer stays visible and usable at 320–430 px with simulated soft-keyboard viewport; correct back behavior in the PWA.
- **Done:** new chat, 10 distinct and repeated-text messages, reload mid-run, BFF restart, network drop before ACK — yields exactly one admission per send and identical canonical history on reopen. Released and live-verified.
- **Deferred instead of blocking:** physical-phone keyboard behavior → device checklist.

### P3 — Design foundation and responsive shell
- Sol picks the visual direction from §3 (dark graphite, warm text, restrained emerald/teal, chat-first) and records it as a Sol decision with screenshots on the review queue.
- Build tokens and components (message blocks, code, activity line, agent chip, composer, drawers/overlays); mobile-first chat shell; desktop left nav + centered chat + closed-by-default right pane. Apply them to the live screens incrementally — no big-bang rewrite.
- **Done:** 320–430 px emulated and 1280×720+ desktop pass with keyboard navigation, long code and scrolling; no horizontal overflow; no visible demo data. Released and live-verified.
- **Never a gate:** Neal's opinion of the look. Overrides become later issues.

### P4 — Artifact reliability  *(JC2-010)*
- Audit the existing Artifact Studio against §8 with real owned runs before replacing anything; fix create/save/upload/download/preview/versioning/links.
- Desktop side pane and mobile full-screen viewer share the same saved data; HTML/SVG stay sandboxed.
- **Done:** v1 → v2 → service restart keeps exact bytes/checksums on desktop and mobile emulation; failure and permission cases pass. Released and live-verified.
- **Deferred instead of blocking:** automatic capture of arbitrary Hermes tool outputs (needs a Hermes event/ownership contract → Final Neal packet).

### P4.5 — Projects workspace (Jarvis as lead, delegated threads, shared artifacts)
Neal's request (2026-10-28): a Claude Projects–style workspace for bigger jobs (§4F). Builds on the existing `ProjectRooms`, P1's activity events and P4's artifact store.
- **Capability issue first (one, bounded):** on owned project runs, establish what the installed Hermes actually emits when Jarvis delegates inside a run (`subagent.*` or equivalent events: task identity, parent run, goal text, tool events, status, result, usage), and whether project instructions/files can be supplied through the existing supported run/session contract. Existing access only (§0.3).
- **Project basics:** create/rename/archive a project with standing instructions and reference files (stored by Command, Command-owned data only); chats started in a project carry that context into their Hermes runs through the supported contract; project list and project page on desktop and mobile.
- **Delegated threads:** under each project chat turn, every delegated task is a collapsible thread with goal, live status, tool activity, usage when reported and final result, driven by the run's real events and recovered after reload/reconnect without duplication. A project-level view lists all delegated threads across its chats with status filters.
- **Project artifacts:** one panel per project collecting artifacts saved from its chats and threads (P4 store, same immutability/versioning/sandbox rules).
- **Done:** create a project, run an owned task where Jarvis delegates at least two sub-tasks, watch both threads live, reload mid-run and see the same threads, then open the project page and find the chat, threads and saved artifacts; desktop live-verified, mobile emulation passes. Released.
- **Deferred instead of blocking:** if in-run delegation events are not emitted or lack task identity, ship projects with instructions, chats and artifacts, show delegated work as "detail not available from Hermes", and add the exact missing event contract to the Final Neal packet. Named-persona delegation stays with P5's Bot Mode contract. No app-side orchestrator, task queue or fake threads.

### P5 — Agents: direct chats and delegation  *(JC2-006/007)*
- **Capability issue first (one, bounded):** what profile discovery, per-profile canonical sessions and `message_agent` the installed Hermes actually supports, using only existing access (§0.3).
- If profile discovery and per-profile sessions are supported: Agents list from real profiles; direct chats open that profile's own session/memory/model; returning to Jarvis leaves both intact.
- If `message_agent` from Jarvis's Bot Chat is supported: show `Jarvis → Scout` dispatch with queued/settled/failed states and the attributed reply; unknown delivery is never auto-resent.
- **Done:** whatever is supported works end to end live; whatever is not is visibly unavailable with the reason. Released and live-verified.
- **Deferred instead of blocking:** any unsupported part → Final Neal packet with the exact Hermes contract needed.

### P6 — Notifications and inbox  *(JC2-008)*
- Durable server-side notification events (run finished/failed, approval needed, agent reply, `@user`), one ID per event, deduped across retries/reconnects; in-app unread inbox; category preferences.
- Full Web Push path (service worker, subscription store, sender, deep links that re-check authorization, private-safe lock-screen text) built and tested **behind a disabled flag**.
- **Done:** in-app inbox works live for app-originated events with no duplicates; push path passes tests against a local test key. Released and live-verified.
- **Deferred instead of blocking:** production VAPID key provisioning and enabling the flag → one step in the Final Neal packet. Cross-surface (CLI/Discord) completions only if an authoritative Hermes event source is proven; otherwise Final Neal packet.

### P7 — Collaboration rooms  *(JC2-009; capability-gated)*
- **Capability issue first (one, bounded):** prove `groups.capabilities`, transport and `driver:true` with send/stop on the installed Hermes, using existing access only.
- If supported: authenticated narrow adapter over native room list/create/log/turn; roster, attribution, @mentions, bounded rounds, stop/hold, user attention, durable transcripts, no duplicate turns after disconnect. Reuse the native driver; no new round-robin engine.
- If only metadata (`driver:false`) or unsupported: Rooms entry shows "not available on this Hermes" with the reason. **P7 is then recorded as Deferred, which counts as finished for this plan.**

### P8 — Field polish, release and the Final Neal packet  *(JC2-011)*
- Fix real performance/visual bugs, accessibility (large font, high contrast), low bandwidth, large histories and reconnect edge cases found during P1–P7.
- Verify Android TWA signing and Digital Asset Links are intact; release through the recoverable path with provenance and rollback.
- Post the **Final Neal packet** on the review queue: (1) physical Android checklist covering every "phone check pending" item, (2) one-line enablement steps for flagged features (e.g. VAPID), (3) each deferred capability with the exact Hermes contract it needs, (4) Sol decisions Neal may want to revisit.
- **Done:** desktop daily-use scenarios pass live; no dead navigation, demo data or false metrics; known limitations documented in `docs/project-status.md`; packet posted. The plan is then complete. Phone results Neal reports afterwards become ordinary bug issues.

## 11. Status table (Sol keeps this current)

| Item | State | Evidence / note |
|---|---|---|
| Desktop chat round trip, reload, lost-ACK (#14/#16) | Done, live | PR #19 `eddae248`; app `sha256:c1d843fc…` |
| Narrow header/composer (#7) | Done, live; phone check pending | PR #10; included in current app; narrow-width proof reused in #24 |
| Latest-session receipt + context denominator (#6) | Partial, live; remainder deferred | PR #8; #6 closed partial/deferred; per-answer receipt remains unsupported |
| Historical message↔run binding (#9) | Deferred — Unsupported | Hermes `7b7a26c1` public contract lacks the pair; Final Neal packet |
| M0 capability matrix (#2) | Superseded by this plan | Findings kept as history; capability checks now live in P5/P7 |
| P1 Truthful status/usage/model-effort | Done, live; phone check pending | #22/#24, PRs #23/#25; merged `df2f68bb`, app `sha256:1dd938e3…`; [production Sol/Luna readback and rollback](https://github.com/KumarG23/jarvis-command/issues/24#issuecomment-6473022817); 320–430 px emulation passed; §5 observation-age follow-through in #26 |
| P2 Chat completeness | Done, live; phone check pending | #26 / PR #29 reviewed/merged `181ec679`; app `sha256:ae8c6ad0…`, rollback `release-app-1793203037845731887`; [ten live admissions/pairs, draft/format/copy, reload/lost-ACK and restart readback](https://github.com/KumarG23/jarvis-command/issues/26#issuecomment-6474024278); 320–430 px and short viewport passed. Steer queued/stop acknowledged; consumption/cancellation not claimed. |
| P3 Design and shell | Done, live; phone check pending | #31 / PR #36 merged `813fc71f`; app `sha256:d2cf8292…`, rollback `release-app-1793205299552716473`; [Sol release/readback](https://github.com/KumarG23/jarvis-command/issues/31#issuecomment-6474818294), desktop/320–430 px and short height, picker/unavailable panels/Back/focus/draft; no new inference. |
| P4 Artifacts | Repairs merged; live release rolled back, #44 pending | #34 audit accepted; #37/#38 (PRs #40/#39) and #42 (PR #43) merged. Owned lost-ACK recovery and immutable downloads passed; image CSP smoke failed and Sol rolled back (`release-app-1793206324840892261`). #44 repairs preview under unchanged policy; remaining released checks pending. P4 not Done. |
| P4.5 Projects workspace | Built for review — unreleased; phone check pending | #41 adds bounded ordinary-input instructions, archive/restore, real chats and P4 reference index. Synthetic desktop/320–430 px + short-height proof; Sol live context/artifact acceptance and release pending. #35 delegation detail/non-image transport remain Unsupported — deferred. |
| P5 Agents | Capability Unsupported — deferred; unavailable UI live | Accepted #28 reused in #31 / PR #36; verified profile/Bot contract unavailable, run-only diagnose available; native/private support elsewhere unknown. [Unavailable UI released/live-verified](https://github.com/KumarG23/jarvis-command/issues/31#issuecomment-6474818294); phone check pending. |
| P6 Notifications | Not started | — |
| P7 Rooms | Capability Unsupported — deferred; unavailable UI live | Accepted #30 reused in #31 / PR #36; native writable transport/driver/send-stop unproven through existing access. Exact contract on #20; Projects separate. [Unavailable UI released/live-verified](https://github.com/KumarG23/jarvis-command/issues/31#issuecomment-6474818294); phone check pending. |
| P8 Polish, release, Final Neal packet | Not started | — |

## 12. Acceptance matrix and proof requirements

Rows that depend on a deferred capability or a Final-Neal-packet step are verified when that dependency exists; they do not hold a milestone open.

| Scenario | Required evidence |
|---|---|
| Android Pixel, app cold-start and soft keyboard open *(Final Neal packet; emulation during build)* | Composer stays visible, enter/send multiline input, no jump/overlap, correct back behavior |
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
| Notification when screen locked/app closed *(after VAPID enablement)* | One push with private-safe content, deep-link reauthorization, no duplicate |
| User disables notifications | No push; content still available in app |
| Artifact v1 → v2 → restart | Exact bytes/checksum/version preserved on mobile and desktop; sandboxed HTML |
| Approval after expired auth or stale run | Refused safely, action visibly still pending/expired, never silently applied |
| Service restart or auth expiry | Honest reconnect/login and exact pending-run recovery, draft preserved |

### Definition of Done for every feature
**Working code + real Hermes round trip + focused tests + released through the recoverable path + live desktop verification + mobile-emulation check for phone-facing UI + no false or unsupported UI + a short proof comment.** Physical-phone verification is tracked separately as "phone check pending" and collected in the Final Neal packet; it does not hold a milestone open.
