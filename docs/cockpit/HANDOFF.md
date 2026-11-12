# Project cockpit — handoff

Keep this short and current. A new conversation (Claude, Jarvis or Neal) reads it to resume the cockpit work.

- **Direction:** [MASTER_PLAN.md §0.0](../../MASTER_PLAN.md). The finish line is that Command completely replaces Discord and is better than it (Neal, 2026-11-11). Full cockpit plan: [Jarvis Command project cockpit plan](https://claude.ai/artifact/638FmFCYYVRhQEdQDswB74).
- **Branch:** `cockpit/session-host` (PR #177) on top of `release/gpt6-sol-luna`. `main` is obsolete.
- **Coordination:** Jarvis comments on the current cockpit PR with `@claude-cockpit`. Issue #178 is the status mailbox. Neal does not relay routine tickets.
- **Owners:** Claude owns Command source. Jarvis owns Hermes integration, homelab qualification and deploys. Neal owns logins, spending, Cloudflare Access, deletion and product decisions.

## Topology (live, 2026-11-11)

| Piece | Where | How it runs |
| --- | --- | --- |
| Command BFF + web | VM118 (`cockpit-dev`) | **System** unit `jarvis-command.service`, `User=cockpit`. The old user unit is masked. See [DEPLOY-VM118.md](DEPLOY-VM118.md). |
| Session host + agent CLIs | VM118 | User service `cockpit-session-host`. Main API on 127.0.0.1:8650; MCP on the LAN at 8651, reachable from the Dell only. |
| Public ingress | Cloudflare tunnel connector on VM118 | Existing hostname, Access policy unchanged. |
| Hermes (Jarvis Prime, `project-lead` profile) | The Dell | Default route `openai-codex/gpt-6.1-sol`, medium. Anthropic API routes off. |
| Command proxy | The Dell, immutable container | Image built from `9a10948`. Advertised-subscription and OpenRouter `:free` routes on, Anthropic off. See [UPGRADE-COMMAND-PROXY.md](UPGRADE-COMMAND-PROXY.md). |
| VM113 | Retired | Data originals kept until Neal approves deletion. |

## Built and deployed so far

States mean: **built** = source with tests; **deployed** = running on VM118/Dell; **accepted** = exercised for real by Neal or Jarvis.

| Slice | State | Evidence |
| --- | --- | --- |
| Session host (tmux PTYs, ownership, worktrees, diff/check, MCP tools) | deployed | Jarvis, PR #177 comments 6803171736 and 6803980369. Hermes connects and discovers the 12 tools, configured for `project-lead` only. `run_check` was re-enabled after the ownership-gate regressions passed. |
| BFF relay + web Terminals pane | deployed, **accepted on phone with Claude Code** | Built in `19a9543`. Part of the VM118 web build since `be38a9f`. On 2026-11-12 Neal started a Claude Code session on his Android phone: he accepted the folder-trust prompt with the key bar, sent a message, and the reply streamed back under his subscription login. |
| Lead chat on VM118 | deployed, **one real chat accepted** | Neal's chat completed after the system-unit repair (Jarvis, comment 6809584673; audit has `run.completed`). |
| Model routing: subscription catalog, Sol 6.1 default, definite refusals | deployed | `9a10948`. Jarvis read-only check: Inherit resolves to Sol 6.1/medium with source `command` (comment 6807882442). |
| Storage reason codes in logs | built, not deployed | `1fb7363`. Ships with the next functional deploy. |

## Remaining work

Ordered by dependency. Each line gives the state, the owner and the next concrete action. Earlier receipts for P6.1–P14.1 are kept in MASTER_PLAN §11.

1. **Chat acceptance on desktop and phone.** Picker, history, streaming, run receipt, retry and recovery. State: deployed, partly accepted. Owner: Jarvis/Neal exercise it, Claude fixes. Next: authenticated desktop + phone pass that records the receipt route.
2. **Terminals acceptance.** In the browser: Shell, `echo hi`, Hand to lead, Take over, Stop; then check `cockpit-audit.jsonl`. State: deployed. Owner: Jarvis or Neal. Next: run [DEPLOY-VM118.md](DEPLOY-VM118.md) §7.3–7.4.
3. **Official CLI qualification on VM118.** Claude Code, Codex, agy (already logged in), Gemini, OpenCode as real interactive sessions. State: **Claude Code, Codex and agy accepted** (Neal, phone, 2026-11-12). Codex ran on GPT-6.1-Sol medium under his ChatGPT login, and agy 1.5.6 on Gemini 4 Argon under Google AI Pro. agy ignored the create-form prompt passed with `--prompt-interactive`; since `5fb5099` the session host types it once the screen settles. Gemini and OpenCode not yet exercised. Owner: Neal logs in himself through a Terminals shell (owner-only); Claude fixes adapters. Next: start each kind once and report what the adapters need.
4. **Lead chat runs as the project lead with project continuity.**
   - The BFF sends Hermes `/p/project-lead/v1/runs` a stable `session_id` per project and server-built `instructions`: goal, instructions, decisions, artifacts, and session/worktree lineage.
   - State: built in `9254ff7` behind `PROJECT_CONTEXT_MODE=enabled`. Project chats send the saved project context as run `instructions` on the existing Command session, which is Prime's continuity. Jarvis confirmed `instructions` and `session_id` from the installed source. Not deployed.
   - Open: Prime has no cockpit MCP tools, because they are configured on `project-lead` only. The choice is to add them to Prime, or to route project chats to `project-lead`.
   - Owner: Claude (source), Jarvis (profile).
5. **Lead drives terminals end to end.** From the project lead chat: create a session, send, read output, `run_check`, and show tool approvals and results in Command. State: MCP deployed; the Command UI for lead tool calls and approvals is unverified. Owner: Claude (UI), Jarvis (profile). Next: depends on item 4.
6. **agy conversation-ID capture** for lineage and resume. State: built in `dcf1072`. It reads agy's per-directory cache for sessions with their own worktree, and resume uses `--conversation <id>`. Not deployed. Owner: Claude; Jarvis deploys.
7. **Discord parity inventory.** List every Prime capability used through Discord (commands, attachments/images, voice, reactions, notifications, scheduled or proactive messages, multi-channel) and map each to Command: present, gap or better. State: not started. Owner: Jarvis lists the Discord surface, Claude maps the gaps and adds them here. Next: Jarvis posts the list on the cockpit PR.
8. **P13 thread status, unread, per-thread model.** State: source merged and now on VM118. Convergence, reload, restart and phone acceptance outstanding (MASTER_PLAN §11). Owner: Claude; acceptance Jarvis/Neal.
9. **P12 reactions and P6.1 reply notifications.** State: source merged and on VM118 behind disabled flags. The exact-message binding (#166, Hermes PR1) is unmerged and installed support is unknown. Owner: Jarvis (Hermes source and install), then Claude (enable and verify). VAPID/egress/push enablement is an owner boundary.
10. **P9.6 delete projects and recovery.** State: retained-snapshot recovery merged; deletion enablement and contents recovery outstanding. Owner: Claude. Live deletion needs Neal.
11. **P10.5 OpenRouter free routes.** State: deployed, `:free` only. Owner: Jarvis/Neal accept it in the picker. **P10.4 Anthropic:** disabled by owner decision (2026-11-11), not a gap.
12. **P14 Studio crew view and P14.1 steering.** State: blocked. They depend on Dev Studio's shared projection (Studio #93), and Dev Studio is paused. Owner: Neal decides whether to resume Studio or retarget the view onto cockpit sessions.
13. **Ops follow-ups.** Dev/build `npm audit` (20 advisories, none high or critical); port the containerized release pipeline to VM118 (optional); VM113 deletion (Neal only).

## Verified facts

- tmux 3.4: `set -g window-size manual` crashes on detached start, so the cockpit uses `latest` plus explicit `resize-window`. tmux rewrites tabs in `-F` formats to `_`.
- A BFF user unit with `PrivateTmp=yes` runs in a user namespace where `/` and `/home` appear owned by UID 65534. The storage validators correctly refuse that, so the BFF runs as a system unit.
- xterm.js style tags conflict with the CSP (`style-src 'self'`). `Cockpit.tsx` turns them into inert elements and mirrors their text into a constructable stylesheet. xterm's replies to terminal queries go to the viewer's own read-only tmux client as `report` frames, never into the agent.
- agy 1.5.5 on cockpit-dev: `--prompt-interactive`, `--conversation <id>`, `--continue`; settings in `~/.gemini/antigravity-cli/settings.json`. Neal prefers agy over Gemini for Google workers.
- Rollback: the BFF must stay at or after `a4f978e` once dynamic model ids are in the ledger. See [DEPLOY-VM118.md](DEPLOY-VM118.md) §8.

## Turning the cockpit on (Command BFF)

Set `COCKPIT_MODE=enabled`, `SESSION_HOST_BASE_URL=http://127.0.0.1:8650` and `SESSION_HOST_KEY` (the session host's value). This also needs `COMMAND_MODE=enabled`. Bootstrap then advertises `project_cockpit`, and a **Terminals** button appears in a project's header. Routes are under `/api/cockpit/*`, and writes are audited to `cockpit-audit.jsonl`.
