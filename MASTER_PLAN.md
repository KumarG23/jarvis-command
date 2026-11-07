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

**Owner reopening (2026-10-31, [#20](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6546543648), repeated on #61).** Neal explicitly reopened the completed plan for exactly two milestones, **P9 Independent project threads** and **P10 Model catalog** (§10). P1–P8, their evidence and the live baseline stand unchanged; nothing in P1–P8 is reinterpreted and the Final Neal packet stays posted. The finish line applies again once P9 and P10 are each **Done** or **Deferred**; Sol then stops creating Command work. No other new work is admitted by this amendment. Sol folded the decision here per §0.1.2; #63 is the amendment and capability-matrix prerequisite ([matrix](docs/p9-p10-capability-matrix.md)).

**Owner reopening (2026-11-06, [#20 directive 6689706582](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6689706582)).** Neal reopens exactly **P9.5 Threads entry point** (#94) and **P10.4 Anthropic routes in the selector** (#95). P1–P10 accepted/deferred evidence, the posted Final Neal packet and all other boundaries stand. The finish line applies again once both slices are Done or Deferred; no other backlog is admitted. The directive records owner spend/provider authorization for exactly `anthropic/claude-opus-5-5`, `anthropic/claude-sonnet-5-5`, and `anthropic/claude-haiku-5-5` using the existing Hermes-held key. This amendment makes no new spending/access decision and authorizes no worker live provider call, proxy operation or privileged deployment. #95 engineering dispatch follows the accepted merge of this amendment for #94 (separated into documentation-only PR #103).

**Owner reopening addenda (2026-11-06).** Neal additionally reopens **P10.5 OpenRouter free routes** (#96, provider authorization for authenticated advertised `:free` models only, zero spend), **P11 Visual identity** (#97) and **P12 Message reactions** (#98) in [directive 6689850279](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6689850279); **P6.1 Reply notifications** (#99, reply text only, no run-finished/failed alerts, production push enablement for that single category) in [directive 6689899077](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6689899077); and **P9.6 Delete projects** (#100) in [directive 6689916605](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6689916605). Together with P9.5/P10.4, these were the seven reopened slices in that addendum. Its finish line applied once those seven are Done or Deferred; prior Done/Deferred evidence and the posted packet stand. Record the owner queue here without implementing #96–#100 in #94 or granting workers live provider calls, spend/access/credential changes, proxy operations or destructive actions. Per lead sequencing, #95/#96 follow the accepted merge of this amendment with shared selector/proxy ownership; #100 follows #94 with the same ProjectRooms owner; #97/#98 remain staged, and #99 follows #94/#95/#96 independently of #97/#98. No overlapping plan/UI writers.

**Owner reopening addendum (2026-11-06, #20 directives 6692185480, 6692284573 and 6692397060; #111 icon amendment 6692282706).** Neal reopens exactly **P13 Thread status and per-thread model choice** (#111), **P14 Studio crew view (read-only)** (#112), and **P14.1 Studio steering (lead + planner only)** (#113). These explicit queue decisions are folded into this plan under §0.1.2; issue prose alone does not amend it. The prior Done/Deferred evidence and posted Final Neal packet stand. The finish line applies once these three slices are each Done or Deferred in addition to the already recorded plan states. Product order is #111 → #112 → #113; #111's shared `StatusIcon` and model-mark integration follows #97's serialized ownership, while independently ready existing work continues. No multi-model rooms, collaboration-room control, general delegation coordinator, or worker steering is reopened.

P13 uses one accessible shared `StatusIcon` in existing Threads, project/header and chat-list surfaces: purple Idle, blue Unread, red Needs you, and verified Working with the CSS-only yellow/green/white/pink/orange cycle; reduced-motion uses a static icon and text, and unknown is neutral with an Unknown label. State is based only on verified run/session facts. Durable per-actor last-read advances only when the latest message is actually viewed, syncs across devices, and causes no run admission. Per-thread route selection is allowed only if existing Command/Hermes routing can pin and prove the exact route with current approved eligibility; unsupported routing stays honestly unavailable/deferred, with no guessed delegation or silent fallback. Unread notification linkage remains #99.

P14 is a top-level Studio destination, separate from project Threads. It is limited to a read-only, sanitized, schema-validated, size/rate-bounded existing Studio projection: summary first, then bounded redacted activity detail only when supported. No PTY, shell, tmux, attachments, runtime controls, or Studio credentials on VM113. Establish authoritative source and freshness only through access already available. If a Studio-side exporter, relay capability, or other source change is required, record that exact prerequisite in the Final Neal packet; keep the view disabled/unavailable and continue unrelated work.

P14.1 depends on accepted P14 phase 1 and is limited to bounded, confirmed, audited text directives addressed to allowlisted `lead` or `planner` through a proven existing Studio owner-input intake. Show Sent → Seen → Acted/Acknowledged only when each phase is observed; do not claim interruption, add wakes/timers/polling, or send duplicate directives on retry/reconnect. Respect the existing work window. Use an existing sensitive-action confirmation/step-up contract only if proven; otherwise leave steering unavailable and record the prerequisite. Do not invent an intake, relay, step-up or write endpoint; if no suitable intake exists, record the precise Studio-side prerequisite in the Final Neal packet and leave steering unavailable. No GitHub/Studio write credentials on VM113 and no worker changes to auth, access, privilege, credentials, network, provider or spending boundaries. Such changes require lead/owner resolution through the packet before implementation; no actual privileged/live operation or new authority is granted by this reopening.

**Owner-requested roadmap projection (2026-11-03, Studio #67 / Command #92).** Neal's explicit request for per-project checkable `ROADMAP.yaml` artifacts is a bounded documentation exception to this finish line. Command's file projects only §10 acceptance and §11 dispositions, with §12 references; it grants no authority, reopens no milestone, never turns Deferred work into pending implementation, and never replenishes the completed product backlog. This completes only Command's roadmap dependency in Studio #67; QA wiring and service acceptance remain separate. The finish line, Done/Deferred dispositions, and posted Final Neal packet remain in force.

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

### P9 — Independent project threads  *(owner-reopened 2026-10-31; #61)*
Claude-Projects-style: a project has one **lead chat** and any number of **thread chats** the user starts, each an ordinary Hermes session linked to the project in Command metadata (`ProjectRoom.sessionIds`). Contract and gaps: [capability matrix](docs/p9-p10-capability-matrix.md).
- **Invariants.** One run per thread (existing per-session admission guard); stop/steer/approval/recovery are the existing per-run contracts. Threads are not a second brain, task scheduler, auto-spawn loop or delegation system: Command never creates a thread, run or message on its own, never writes into a thread from the lead, and never approves for the user. The lead is a normal project chat that receives a **bounded, read-only roster** as labelled plain text in its own send (the P4.5 context path, exactly once per send, under the 16,000-character input cap) and may emit a **thread link** token. Roster entries are untrusted data, not instructions; roster text is excerpts of stored messages, never an app-generated model summary.
- **Honest status.** Thread status is derived only from runs Command admitted (audit ledger + authenticated run status): `running`, `waiting-approval`, `queued`, `completed`, `failed`, `cancelled`, `idle` (no Command run), else `unknown`. "Blocked" and any state Hermes does not report are not invented. Runs started outside Command and upstream rename/archive are **Unknown** (not consumed by Command); historical message↔run joins are Unsupported (§2, #9); delegated sub-tasks stay as settled in #35.
- **Order.** (0) #63 amendment + matrix → (1) thread model: lead designation and thread metadata (title, archived, createdAt) on the project, create/attach/open threads, no new Hermes endpoint → (2) read-only roster projection + lead context injection → (3) validated thread links (token accepted only if the id is in the project's `sessionIds`; otherwise inert text) → (4) concurrent-thread UI: per-thread indicator, inbox integration, desktop split view, mobile drawer; polling-based because live SSE is capped at four streams → (5) phone checks into the Final Neal packet addendum. (4) edits `App.tsx`/`TurnView.tsx` and must not overlap P10 slice 2.
- **Done:** create a project with a lead and two threads; run both threads concurrently with real Hermes round trips (one admission each, lost-ACK/reload/restart safe); the lead reply built from the roster names both threads and links one, forged/foreign ids render inert; stop and steer one thread without affecting the other; desktop live-verified, 320–430 px emulation passes; released through the recoverable path.
- **Deferred instead of blocking:** any status/summary Hermes cannot supply → "not available"; Hermes-side session metadata/run-listing contract → Final Neal packet addendum. No app-side orchestrator.

### P10 — Model catalog  *(owner-reopened 2026-10-31; #62)*
Neal asked for Haiku, the full OpenAI and Claude lists and OpenRouter `:free` models. Model names in the request are **requests, not availability**.
- **Source of truth for what exists** is the Hermes gateway catalog (`/api/model/options`, `model_options` capability) read server-side. **Advertised and authenticated are necessary, never sufficient.** Selection stays the intersection of the catalog with a Command-side, server-enforced **eligibility allowlist** (today the curated list in `apps/command-proxy/src/app.ts`, `CURATED_INFERENCE_OPTIONS` / `readInferenceOptions`). An entry is selectable only if it is advertised, authenticated **and** on that allowlist as approved free/included. Authentication does not prove an API route is included or that spend is approved; unknown eligibility is **unavailable** with a reason. OpenRouter entries may be proposed only when the advertised id ends in `:free`, and still require an explicit allowlist entry. Expanding what the catalog shows never enables a paid route or fallback; existing provider/paid-route controls are unchanged, `require_model_lock` stays on every override, and any change to the allowlist itself that adds an API-billed family is escalated to the lead, not decided in a slice. No new provider, credential or model-qualification claim; Hermes itself is not changed by workers.
- **Selection** keeps the existing rules: fresh no-cache inventory per send, server-side revalidation before admission, no silent fallback, requested vs executed shown from the run receipt, unknown stays unknown. Effort levels appear only where the catalog or an explicit Command rule supports them; otherwise "provider default".
- **Order.** (0) #63 → (1) catalog read model in the command proxy/BFF (tolerates large catalogs, advertised vs authenticated vs eligible vs selectable as separate fields, a read-only way for Sol to see the raw advertised list) → (2) selector UI for the extended catalog (serialized with P9 slice 4, never concurrent) → (3) live proof: one owned run per entry that is advertised, authenticated **and** approved free/included, executed route compared with requested.
- **Done:** every selectable entry is advertised, authenticated and on the approved allowlist; entries failing any of the three are listed unavailable with the specific reason; no run can use a route outside the allowlist (server test); catalog refresh/failure behaviour is tested and live-read; requested vs executed shown for at least two entries; no credentials in any client payload; no spend or paid fallback introduced; released.
- **Deferred instead of blocking:** families Hermes does not advertise/authenticate, or whose free/included status is unknown → honest unavailable state; the exact Hermes-side catalog/credential enablement and any eligibility decision go to the lead / Final Neal packet addendum and are not performed by a worker.

### P9.5 — Threads entry point (#94)
- Persistent top-right project-chat **Threads** control opens the existing P9 lead/thread roster, including titles, archived threads and truthful verified run status. Reuse attach/split and validated reply links; unknown remains unknown. No second roster, coordinator, spawning, admissions, background activity or unread protocol. A button indicator requires verified existing run events.
- Preserve per-chat drafts, external-session read-only behavior and owned-run recovery. Verify desktop, 320–430 px and short keyboard viewport in Chromium with focused regressions; physical phone check remains pending separately. Sol owns exact-head review, app-only recoverable release and authenticated live acceptance.

### P10.4 — Anthropic routes in the selector (#95)
- Bounded to the three exact Anthropic routes recorded in §0.2; all other advertised entries keep existing eligibility rules. Preserve fresh server admission validation, model lock, identity/session/quota and credential isolation; no fallback or guessed effort levels.
- Source preparation follows #94's accepted amendment. Lead must establish applicable authorization and the documented deployment route before proxy release or the three short owned requested/executed-route proofs. The reported Dell proxy migration and `command-project-ops` refusal are an operations boundary: no old VM108 path, privileged port, Hermes patch/restart or new deploy access is authorized here. If unavailable, record the exact prerequisite and defer honestly per §0.3.

### P10.5 — OpenRouter free routes (#96)
- From the existing authenticated Hermes catalog, expose only advertised OpenRouter ids ending exactly in `:free`, bounded and deterministically ordered, labelled Free. Fresh server-side eligibility, model lock and actor/session/quota controls remain authoritative. Reject paid/lookalike/unadvertised entries; no paid fallback, guessed effort or retry loop. Keep the existing catalog; reuse grouping/search and add small Recent/Pinned affordances only if contained.
- Source follows the accepted amendment and shared #95 selector/proxy ownership. Lead establishes the documented proxy release path and authorization before owned requested/executed-route proof. Rate limits/unavailability stay honest; no worker provider call, credential change or proxy operation is authorized here.

### P11 — Visual identity (#97)
- Presentation slice: restrained semantic status/model/project accents with AA text contrast and non-color labels; user-selectable bounded project icons/colors with deterministic defaults and backward-compatible optional existing project metadata. Reuse save/readback paths; no new store or licensed logo assets.
- Model-family marks derive only from verified executed provider/model on the applicable receipt; unknown stays neutral, with no requested-route substitution or invented historical join. Focused mapping/default tests and desktop/360 px before/after evidence; no runtime/auth change.

### P12 — Message reactions (#98)
- Phase 1: user-toggled emoji chips on durable session/message identities, existing Command-owned persistence, immutable add/remove audit events, bounded validated input and external/read-only disablement. New reaction events enter only the next explicitly admitted run as bounded reaction context, deduplicated with the send's idempotency identity; no automatic run, approval or tool action.
- Phase 2 follows live Phase 1 and stays proposal-only until Sol verifies the explicit allowlisted assistant-output marker with a real owned Hermes run and exact target binding. Validate one bounded emoji, once per run, target that run's user message; malformed markers remain plain text. No Hermes/config patch or guessed historical message/run association. Missing durable identity/binding is recorded as an exact capability prerequisite and honestly deferred per §0.3.
- Verify restart/reload/retry dedupe, exactly-once context, hostile inputs, read-only behavior and desktop/360 px keyboard-open picker. Jarvis-side prompt/skill instruction remains a separate recorded enablement step.

### P13 — Thread status, unread and per-thread model choice  *(owner-reopened 2026-11-06; #111)*
- Reuse the existing P9 Threads, project/header and chat-list surfaces. A single accessible shared `StatusIcon` labels each state so color is never the only signal: Idle purple, Unread blue, Needs you red, verified Working with a CSS-only yellow → green → white → pink → orange cycle. `prefers-reduced-motion` gets a static icon and the text label; unknown/unavailable is neutral **Unknown**. Working, Needs you and Idle derive only from verified run/session facts; reconnecting is a transport overlay. Sort Needs you → Working → Unread → Idle, recent first; project/header summarize the most urgent verified child state. Keep dark-theme AA contrast at 360 px.
- Per-actor last-read is durable server-side, synced across devices, and advances only when the latest message is actually viewed. Reading clears the actor's unread marker and never admits a run. Unread notification linkage remains in #99; no notification delivery work here.
- When a delegated thread is proposed/created, route choice follows prompt → thread default → project default → Command default. Reuse the current selector's route and effort validation and exact executed-route receipt only if existing Command/Hermes contracts prove that per-thread routing can be pinned. Enforce existing advertised/authenticated/approved eligibility, `require_model_lock`, and no fallback; show executed model/effort in the header and roster only from the applicable exact receipt. If routing or receipt binding is unsupported, keep the choice unavailable/deferred and report the exact contract gap. No guessed delegation, new coordinator, multi-model room, or silent inheritance.
- **Order:** after #97's serialized shared identity/model-mark ownership; then #111 before P14 and P14.1. Independently ready existing work continues.
- **Done:** verified state derivation including unknown, cross-device last-read persistence with no admission, shared accessible icons, and exact per-thread route/receipt proof where supported; desktop and 360 px verified. Otherwise document unsupported capabilities and ship honest unavailable states.

### P14 — Studio crew view, read-only  *(owner-reopened 2026-11-06; #112)*
- Studio is a top-level Command destination, separate from project Threads (not a Crew button in the project Threads surface). Build the crew summary from an authoritative, current, existing Studio projection only. Show role, model icon when verified, state icon, current task/link, elapsed time, last verified event, branch/worktree and cooldown/quota state; absent fields say **not reported**. Order attention → working → idle. Mark stale snapshots with age and show unreachable data as unavailable, never as live last-known status.
- Phase 1 is the summary. Refresh and bounded polling run only while visible. Phase 2 may add bounded redacted activity detail only after the summary and only from supported projected events (at most 100 lines or 20 KB, allowlist-first redaction, no raw escape sequences or attachments). All reads use existing actor authorization and a narrow read-only contract with schema, size and rate bounds.
- No PTY, shell, tmux, attachment, runtime control, SSH, Studio/GitHub credentials on VM113, or Command-worker changes to Studio runtime/Dell configuration. Establish source/freshness through access already available. If an exporter, relay capability, or other Studio-side change is needed, specify it in the Final Neal packet; ship disabled/unavailable and continue unrelated work.
- **Done:** authoritative projection contract and source verified; hostile/oversized/malformed input, redaction, authorization, staleness and unavailable states covered; desktop and 360 px verified with no write path or new VM113 credentials.

### P14.1 — Studio steering, lead and planner only  *(owner-reopened 2026-11-06; #113)*
- Follows accepted P14 phase 1. Allow bounded, confirmed, audited text directives to allowlisted `lead` or `planner` only, through a proven existing Studio owner-input intake. No keystrokes, PTY, shell, arbitrary writes, worker/QA steering, quota/pause controls, merge, deploy or spend authority. A directive is advisory under existing Studio policy.
- Report **Sent → Seen → Acted/Acknowledged** only from observed intake/readback evidence; no mid-turn interruption claim. Idempotency prevents duplicates on retry/reconnect. No extra wakeups, timers or idle polling; outside 07:00–17:00 America/New_York, queue it and say it will be read in the next work window. Require explicit confirmation showing target and exact text; use an existing sensitive-action step-up contract only if proven, with no invented step-up endpoint. If the existing intake cannot support the contract, specify the minimal Studio-side prerequisite in the Final Neal packet and leave steering unavailable.
- No GitHub/Studio write credentials on VM113. Auth, access, privilege, credential, network, provider, spend or other security-boundary changes require lead/owner resolution as a prerequisite; this reopening grants no such change and authorizes no worker privileged/live operation.
- **Done:** strict bounded schema, target allowlist, actor authorization/rate limit, durable audit and idempotency; isolated test intake proves one delivery and observed phases; unknown outcomes do not auto-retry; desktop and 360 px verified. If the existing intake is unsupported, record the reason and unavailable state.

### P6.1 — Reply notifications (#99)
- The bounded initial release supersedes P6's run-state category set with one assistant-reply category: one final assistant message, actual executed label, short sanitized reply preview and authorized exact-reply/session deep link. No run-state, failure, approval, tool, reaction or historical-reload alerts; no final assistant text means no push. Deduplicate across reconnect/retry/restart/tabs/devices and best-effort suppress while that session is visibly focused; uncertain visibility never falsely suppresses.
- Owner requests default-on reply text with one opt-out setting (generic reply notice when off), encrypted Web Push, no auth/raw run ids, per-device registration/revocation and expired-subscription pruning. Preserve Access and actor/session boundaries. Production VAPID provisioning/secret handling and single-category enablement remain lead-controlled prerequisites; issue prose authorizes no worker credential/access or live-service change. Reuse the app-only recoverable release path, no proxy change.
- Source/fixture, authenticated live readback and physical Pixel evidence remain separate. Verify background/closed delivery, tap/reconnect/focus/reboot behavior and battery notes; emulation covers layout while physical phone acceptance is pending. Exact final-message identity must be supported, never inferred from latest-session receipts.

### P9.6 — Delete projects (#100)
- Same ProjectRooms owner, after #94: discoverable ≥44 px project deletion controls at desktop/360 px/keyboard height, with repeated explicit deletion without reload. Confirmation names the exact project and linked chat/artifact counts; Cancel is safe default and delete-project-only retains standalone chats/artifacts.
- Optional contents deletion requires fresh server-side authorization/ownership, exact target/payload visibility, a pre-delete store snapshot through existing recovery, and immutable ids-only audit. External/read-only sessions are only unlinked, never deleted; active project runs block deletion. No automatic retry on uncertain response: authoritative readback and idempotent repeated deletion.
- Preserve roster/notification/artifact scopes, current selection, pending attachment recovery and restart consistency. Focused tests and desktop/360 px evidence cover both choices, external unlink, active-run refusal and repeat/current-project deletion. Destructive implementation warrants scoped independent review; actual data deletion or privileged operations are not worker-authorized by this queue entry.

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
| P4 Artifacts | Done, live; association-policy/PDF preview deferred; phone check pending | #34/#37/#38/#42/#44 closed; reviewed PRs #39/#40/#43/#48 released at `014071e4`, app `sha256:4e3af796…`, rollback `release-app-1793209222163523623`; [production preview/exact-byte/restart proof](https://github.com/KumarG23/jarvis-command/issues/44#issuecomment-6476317648). Image renders under unchanged CSP; PDF download-only; HTML/SVG sandboxed; whitespace-preserving immutable v1/v2. Association-policy tightening stays on #20. |
| P4.5 Projects workspace | Done, live; capability details deferred; phone check pending | #41 / reviewed PR #45 `24657e4b`, released with `014071e4`; [production acceptance](https://github.com/KumarG23/jarvis-command/issues/41#issuecomment-6476318118): create/rename/archive/restore, one owned run with instructions included once, canonical reopen and project files/saved response survive restart. Desktop/320–430 px/short-height pass. #35 delegation detail/non-image transport remain Unsupported — deferred with unavailable UI. |
| P5 Agents | Capability Unsupported — deferred; unavailable UI live | Accepted #28 reused in #31 / PR #36; verified profile/Bot contract unavailable, run-only diagnose available; native/private support elsewhere unknown. [Unavailable UI released/live-verified](https://github.com/KumarG23/jarvis-command/issues/31#issuecomment-6474818294); phone check pending. |
| P6 Notifications | Done, live; production push disabled; phone check pending | #56/#57 / PR #59 reviewed head `0242e67c`, merged `11501f72`; app `sha256:671988d3…`, rollback `release-app-1793215438076593182`. [Live/restart acceptance](https://github.com/KumarG23/jarvis-command/pull/59#issuecomment-6478505568): existing owned run/notification reused without another admission; reconcile/open, read/preferences persistence, retained draft and ten desktop/mobile/short-height layouts pass. Full push path passes local-key sender/worker/UI tests and is released disabled; production VAPID/egress/enablement and unsupported cross-surface discovery remain deferred ([steps](docs/web-push.md)). Earlier [failed release/rollback](https://github.com/KumarG23/jarvis-command/pull/50#issuecomment-6478000754) is resolved. |
| P7 Rooms | Capability Unsupported — deferred; unavailable UI live | Accepted #30 reused in #31 / PR #36; native writable transport/driver/send-stop unproven through existing access. Exact contract on #20; Projects separate. [Unavailable UI released/live-verified](https://github.com/KumarG23/jarvis-command/issues/31#issuecomment-6474818294); phone check pending. |
| P8 Polish, release, Final Neal packet | Done, live; packet posted; phone check pending | Accepted daily-use proofs in P1–P4.5/P6 and #52 / PR #54 short-navigation [Tab/scroll/hit-test proof](https://github.com/KumarG23/jarvis-command/issues/52#issuecomment-6477626307) at 1280×360/720, 320×360 and 430×740; emulation covers 320–430 px. Current app `sha256:671988d3…` includes these changes. Served Digital Asset Links matches source; no fresh APK/physical-device claim. [Final Neal packet](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6478521212) posts phone checks, deferred enablement/contracts and Sol decisions; no further feature backlog. |
| P9 Independent project threads | Done, live; phone check pending | PR #89 reviewed at `e622ffcc`, gate-merged as `55d61b8db16a4798429dcf99a79fc8d377c1ef82`. [Accepted roster/link proof](https://github.com/KumarG23/jarvis-command/pull/83#issuecomment-6548794965) and [concurrent release/live acceptance](https://github.com/KumarG23/jarvis-command/pull/89#issuecomment-6558260722). Deployed healthy app: `sha256:5122fa63c3a2db2bf75d138187bd7c6939060bfc70874b805441e41ff05fc63a`; retained rollback `release-app-1793537664585597198` restores verified `a26c2be4…`. Separate release-build reference `f654354c…` is not the deployed image pin. A and B each had one admission; both exact identities recovered after restart/lost-ACK/reload. A was stopped after one targeted steer/stop and cancelled; B completed independently with requested/executed `openai-codex gpt-6-luna` at low effort, two calls, `routeSource` unknown. Seven desktop/mobile layouts passed; no original A replay or historical answer/run join claimed. Earlier failed #86 release and rollback remain [history](https://github.com/KumarG23/jarvis-command/pull/86#issuecomment-6549134509). [P9/P10 Final Neal packet addendum](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6558299788). This row records the original P9 and P10 baseline; later reopened slices are tracked in their own rows below. |
| P10 Model catalog | Done, live; new-family eligibility deferred; phone check pending | #62 closed supported/deferred. [Final release/route proof](https://github.com/KumarG23/jarvis-command/pull/75#issuecomment-6547754852): catalog, selector, six approved routes and restart readback pass at `f394a24`. New advertised families stay honestly unavailable; no allowlist/provider/credential/spend change. [Packet addendum](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6547755528). |
| P10.1 Model catalog read model | Done, live | #62/#66 / PR #67 merged `701cb49`; app `sha256:b136e487…`, command-proxy `sha256:bac7c9d8…`, rollbacks `release-app-1793470786435786845` / `release-command-proxy-1793470813329702679`. [Authorized readback on PR #67](https://github.com/KumarG23/jarvis-command/pull/67#issuecomment-6547368198) 2026-10-31 18:20:43 UTC: 129 advertised / 131 returned, no truncation; six approved Codex entries selectable. Advertised/authenticated families remain ineligible; no spend approval. |
| P10.2 Model catalog selector | Done, live; phone check pending | #71 / PR #72 reviewed `462d5c4`, merged `8de062e`, released with repaired P9 at `f394a24`, app `sha256:35391e56…`. [Actual UI proof](https://github.com/KumarG23/jarvis-command/pull/75#issuecomment-6547754852): Haiku (2), OpenAI API (17), OpenRouter `:free` (4) searchable/inert; six existing Codex Use actions; draft/reload, search/retry reachability and desktop/320–430 px/short viewport pass. |
| P10.3 Requested/executed route proof | Done, live | [Six owned runs and restart readback](https://github.com/KumarG23/jarvis-command/pull/75#issuecomment-6547754852): one admission/API call per selectable Codex entry, matching requested/executed model/provider, wire-confirmed low effort, exact=true, no fallback; six unique request/run ids. Actual UI receipts observed. Three owned chats each retain two user/two assistant messages plus one system message with unique canonical ids. `routeSource` remains unknown; no historical message↔run join claimed. |
| P9.5 Threads entry point | Done, live; phone check pending | #94/#102 closed; amendment #103 merged `8d05e6a`, replacement #104 reviewed combined head `27dc4a1`, green validate `42259761278`, gate-merged `5fb5d4c6`. Actual app `sha256:95611401477359d2bd8ece7be079fef1ecf3d679f148c60fb0304e9141c03ebf`, rollback `release-app-1793985659310670903` restores `5122fa63…`. [Authenticated release/readback](https://github.com/KumarG23/jarvis-command/pull/104#issuecomment-6690969896): existing roster/attach/focus, retained unsent draft after switching/reload, original selection restored, eight desktop/mobile/short-height layouts pass; zero new runs. Build reference `716cf046…` differs from deployed pin. #101 superseded, original branch/WIP/native sessions preserved. |
| P10.4 Anthropic routes in the selector | Source released/live unavailable; enablement and route execution Deferred; phone check pending | #95 / PR #106 reviewed `bacccab8`, green validate `42262758829`, gate-merged `6bf2584`; app source released with #107 at `518b400`. [Authenticated desktop/360px/short-height compatibility and unavailable-state proof](https://github.com/KumarG23/jarvis-command/pull/107#issuecomment-6691840836), six Codex choices unchanged, zero admissions. Three Claude routes stay disabled; Dell proxy release/enablement and three owned executed-route proofs remain [Final Neal packet prerequisites](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6691841208). |
| P10.5 OpenRouter free routes | Deferred — bounded #115 candidate proof exhausted; source PRs preserved, unmerged; live routes unavailable | [#96/#115 disposition](https://github.com/KumarG23/jarvis-command/issues/115#issuecomment-6693113166): #96 and #115 are Deferred after the authorized two wrapped-browser attempts. Source PR #109 at `66a8a251` and draft repair PR [#118](https://github.com/KumarG23/jarvis-command/pull/118) at `33c9ea2` remain unmerged; final retry/send/viewport fixture acceptance is unverified. Initial CI [42270640806](https://github.com/KumarG23/jarvis-command/actions/runs/42270640806) failed an artifact-recovery assertion; the repair did not reproduce it and makes no flakiness claim. No deploy or live free-route proof; current live free routes remain unavailable. |
| P11 Visual identity | Project identity source merged/released/live-accepted; optional executed-model marks Deferred; phone check pending | PR #110 exact head `566bd363`, accepted review and green validate `42281274397`; gate-merged at `10fa3ee`. App-only build reference `278a5915…`; actual deployed healthy immutable app `sha256:28f30500671575b939b3d4a689e651203ea2ddbfe5a010e2098521e35391cb01`. Rollback `release-app-1793994255383408242` restores the compatible reader bridge `0a2881af…`. [Authenticated #97 identity readback](https://github.com/KumarG23/jarvis-command/issues/97#issuecomment-6694001562) exited 0: two isolated metadata writes, authoritative GET + reload restoration, and three viewport layouts; no restart or inference. [#119 service-recreation readback](https://github.com/KumarG23/jarvis-command/issues/99#issuecomment-6694077728) later observed persisted `peak/violet` identity on desktop. Optional model-family marks are **Deferred** after #97 exhausted two bounded attempts ([disposition](https://github.com/KumarG23/jarvis-command/issues/97#issuecomment-6694582617)): draft PR #122 at `3aebe45` is preserved unmerged/unreleased; baseline layouts passed, but candidate desktop proof was partial and corrected V2 fixture plus candidate mobile remain unverified. Existing neutral response makes no model-family claim; full P11 is not Done. |
| P12 Message reactions | Backend deployed disabled; reaction UI source reviewed/merged, candidate accepted; UI release/live proof pending; phone check pending | PR #124 backend is included in healthy deployed app `sha256:95a6823f…` ([release/readback](https://github.com/KumarG23/jarvis-command/pull/120#issuecomment-6696144548)). PR #127 UI exact head `757661940e46cae308e572fee7e5e15391c75c86` was independently reviewed and gate-merged as `7d96c787fabe11007d04b3f0cbe7e54470fcb5b2`; [accepted repair review](https://github.com/KumarG23/jarvis-command/pull/127#issuecomment-6696938526) verifies fixed initial clipping and six strengthened synthetic desktop/360px/short-height cases on final candidate attempt 2/2. Owner exited 0 with clean preserved lineage. `REACTIONS_MODE` remains disabled; new UI is not in the current release, and no authenticated live reaction/mutation proof is claimed. #98 retains the lead-release/readback prerequisite; [packet addendum](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6696991304) records enablement, phase 2 exact target binding Unsupported, and phone checks. |
| P13 Thread status, unread and per-thread model choice | Source implementation prepared; candidate visual acceptance deferred; unreleased; phone check pending | #111 adds shared labelled status, bounded actor/session canonical last-read and no-admission read routes with focused regression checks. Two synthetic wrapped-browser attempts failed in fixture setup (invalid timestamp, then fill before complete history enabled the composer); final corrected fixture and desktop/360px/short-height image/hit acceptance remain unverified. Routing defaults/delegated binding remain unavailable pending installed authenticated exact-route proof; existing explicit next-run selector/receipts stand. No live or phone acceptance. |
| P14 Studio crew view, read-only | Admitted by this plan amendment; staged, not implemented | #112's exact owner direction is recorded in §0.2 and §10; current Command source has no admitted Studio projection or control path. Existing Studio source/exporter freshness remains to be established through allowed access. |
| P14.1 Studio steering, lead + planner only | Admitted by this plan amendment; staged, not implemented | #113's exact owner direction is recorded in §0.2 and §10; an existing authoritative owner-input intake and truthful pickup/readback contract are unproven. No endpoint or authority is inferred. |
| P6.1 Reply notifications | Disabled/unavailable state live-accepted; actual reply delivery Deferred; phone check pending | PR #120 exact combined head `35166ef` was reviewed and gate-merged at `71661a0` after green validate `42296210772`. App build reference `fab393b7…` is distinct from the actual healthy deployed app `sha256:95a6823fb85dfc718949656af98d6b69289fd81deccbcaf6ec7c8febb432498f`; rollback `release-app-1794000567535486711` restores `1999ee42…`. The new [authenticated #99 readback](https://github.com/KumarG23/jarvis-command/issues/99#issuecomment-6696167846) exited 0 on its final bounded attempt: six metadata GETs, default-on reply-text preference left untouched, disabled/unavailable delivery with zero devices/reply items, and desktop/360×740/360×360 layout and focus checks passed. Exactly one owned-session presence POST occurred; there were no inference/provider/push/preference/device/reaction actions. This proves the honest disabled state, not reply delivery. The earlier [#119 bridge readback](https://github.com/KumarG23/jarvis-command/issues/99#issuecomment-6694077728) remains partial; its 360 px/mobile bridge limits are not upgraded by this separate writer-state readback. Real reply generation/delivery is **Unsupported — Deferred**: production `REPLY_EVIDENCE_SOURCE` remains undefined, push is disabled, and the exact-binding plus VAPID/egress/enablement prerequisites are recorded in the [Final Neal packet](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6696236730). No real-push exact-focus acceptance is claimed. Physical Pixel check pending. |
| P9.6 Delete projects | Source released/live unavailable; deletion enablement/contents recovery Deferred; phone check pending | #100 / PR #107 first factory-binding finding fixed and reviewed at `bf00184`, green validate `42264994094`, gate-merged/released `518b400`. Healthy app `sha256:ab3cea6f0ac15b3c8e89a46fb9e65b1e3d05c41d187e9bb5c14733bf2fcd3c0d`; rollback `release-app-1793987772671865899` restores `95611401…`. [Actual authenticated GET/UI proof](https://github.com/KumarG23/jarvis-command/issues/100#issuecomment-6691817311): seven GETs 200; exact counts, both 44px entries, Cancel/focus and disabled choices at desktop/360px/short height; zero mutations/deletions. Preliminary asset-set mismatch cause unproven; final loaded assets matched current HTML. Contents recovery Unsupported; [packet](https://github.com/KumarG23/jarvis-command/issues/20#issuecomment-6691841208). |

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
