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

States mean: **built** = source with tests; **deployed** = running on VM118/Dell; **accepted** = exercised for real by Neal or Jarvis. Everything up to `9726999` is built; everything up to `abe7bbc` is deployed (Jarvis, PR #177 comment 6862684459).

| Slice | State | Evidence |
| --- | --- | --- |
| Session host (tmux PTYs, ownership, worktrees, diff/check, MCP tools) | deployed | Jarvis, comments 6803171736 and 6803980369. 12 MCP tools discovered. |
| BFF relay + web Terminals pane | **accepted** (phone, Claude Code, Codex, agy) | Neal, 2026-11-12. |
| Lead chat on VM118 | **accepted** | Neal's chats complete on Sol 6.1 medium (comment 6809584673). |
| Model routing: subscription catalog, Sol 6.1 default | deployed | `9a10948`; comment 6807882442. |
| Project chats on main Jarvis (`default` profile) with the cockpit MCP | **accepted** | Jarvis added the MCP (comment 6811720990). Neal, phone, 2026-11-12: Jarvis listed the Test project's terminals, and a live Proxmox/TrueNAS check ran from a Command chat. |
| Project context as run `instructions` (`PROJECT_CONTEXT_MODE`) | deployed | `9254ff7`, enabled per Jarvis (comment 6862829544). Not separately accepted. |
| Phone push: run/reply alerts, tap opens the chat, high urgency, test button | **accepted** | Tap routing (Neal, 2026-11-12). Locked-phone test alert after `abe7bbc` (Neal, 2026-11-13). Other categories not individually checked. |
| Hermes cron/reminder deliveries into Command (`POST /v1/deliveries`) | **accepted** for the native gateway path | After Neal's gateway restart, Jarvis's native job reached Command as one inbox item (2026-11-13). Existing Discord cron destinations are unchanged. |
| Hermes host admin shell ([HOST-SHELL.md](HOST-SHELL.md)) | deployed, **gateway restart accepted** | Jarvis commissioning, comment 6862684459. Neal restarted `hermes-gateway` from the shell on his phone; the shell stayed up and the gateway came back with a new PID (comment 6862829544). Not yet checked: opening a new shell while the gateway is down. |
| Storage reason codes in logs; agy conversation-ID capture (`dcf1072`) | deployed | In `abe7bbc`. agy resume not yet exercised. |
| Read notifications dimmed; read items clear their phone alert | built | `9726999`, web only. Awaiting deploy. |

## Remaining work

Ordered by Discord-replacement value. Each line gives the state, owner and next action. Earlier receipts for P6.1–P14.1 are in MASTER_PLAN §11.

1. **Homelab chat and reminders end to end from Command (next slice).** In a normal Command chat Neal asks Jarvis for a homelab action, then says "remind me in N minutes …". Pass when the reminder arrives as a Command delivery (inbox, phone alert, card in that chat), not in Discord. Includes one tool call that naturally asks for approval, if one occurs. Owner: Neal exercises, Jarvis confirms Hermes routes the reminder to the `command` platform, Claude fixes. Open questions: does a reminder created from a Command chat default to Command delivery, or does Hermes need `deliver=command:<chat>` set by the chat?
2. **Selective Discord cron migration.** Jarvis lists Neal's Discord cron/reminder jobs; Neal approves each one individually; Jarvis moves that job's destination to Command (`home` or a named chat). No bulk migration.
3. **Lead drives terminals end to end.** From a project chat: create a session, send, read output, `run_check`, with tool calls and results visible in Command. MCP is deployed and listing works; create/drive/read/check is unaccepted. Owner: Neal/Jarvis exercise, Claude fixes the UI. Follow-up from earlier receipts: "Route verification unavailable" and "Activity incomplete" on Hermes tool runs.
4. **Chat and Terminals acceptance gaps.** Receipt route, retry/recovery; Hand to lead, Take over, Stop, audit check ([DEPLOY-VM118.md](DEPLOY-VM118.md) §7.3–7.4).
5. **CLI qualification:** Gemini and OpenCode not yet exercised. Neal logs in himself through a Terminals shell.
6. **Host shell remaining check:** with `hermes-gateway` stopped, open a new shell and start it again.
7. **P13 thread status, unread, per-thread model:** deployed; convergence/reload/phone acceptance outstanding.
8. **P12 reactions:** behind a disabled flag; needs Hermes #166 (exact-message binding). Owner: Jarvis, then Claude.
9. **Project deletion (P9.6):** Neal wants to remove old test projects himself. "Delete project only" unlinks chats and files (they stay as standalone items) after a retained snapshot. Runtime needs `PROJECT_DELETION_MODE=enabled` and artifact storage on (`ARTIFACTS_MODE=enabled`, `ARTIFACT_STORAGE_PATH`). Since the deletion-check fix, linked chats that Hermes no longer has no longer block it, and failures show a visible message. Contents deletion stays unavailable.
10. **P10.5 OpenRouter free routes:** deployed; accept in the picker. P10.4 Anthropic is off by owner decision.
11. **P14 Studio crew view:** blocked; Dev Studio is paused. Neal decides whether to resume Studio or retarget the view.
12. **Ops:** `npm audit` (no high/critical), optional release pipeline on VM118, VM113 deletion (Neal only).

## Verified facts

- tmux 3.4: `set -g window-size manual` crashes on detached start, so the cockpit uses `latest` plus explicit `resize-window`. tmux rewrites tabs in `-F` formats to `_`.
- A BFF user unit with `PrivateTmp=yes` runs in a user namespace where `/` and `/home` appear owned by UID 65534. The storage validators correctly refuse that, so the BFF runs as a system unit.
- xterm.js style tags conflict with the CSP (`style-src 'self'`). `Cockpit.tsx` turns them into inert elements and mirrors their text into a constructable stylesheet. xterm's replies to terminal queries go to the viewer's own read-only tmux client as `report` frames, never into the agent.
- agy 1.5.5 on cockpit-dev: `--prompt-interactive`, `--conversation <id>`, `--continue`; settings in `~/.gemini/antigravity-cli/settings.json`. Neal prefers agy over Gemini for Google workers.
- Rollback: the BFF must stay at or after `a4f978e` once dynamic model ids are in the ledger. See [DEPLOY-VM118.md](DEPLOY-VM118.md) §8.

## Turning the cockpit on (Command BFF)

Set `COCKPIT_MODE=enabled`, `SESSION_HOST_BASE_URL=http://127.0.0.1:8650` and `SESSION_HOST_KEY` (the session host's value). This also needs `COMMAND_MODE=enabled`. Bootstrap then advertises `project_cockpit`, and a **Terminals** button appears in a project's header. Routes are under `/api/cockpit/*`, and writes are audited to `cockpit-audit.jsonl`.
