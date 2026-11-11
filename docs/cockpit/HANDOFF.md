# Project cockpit — handoff

Keep this short and current. It is what a new conversation (Claude, Jarvis or Neal) reads to resume the cockpit work.

- **Direction:** [MASTER_PLAN.md §0.0](../../MASTER_PLAN.md). Full plan with architecture, phases and risks: [Jarvis Command project cockpit plan](https://claude.ai/artifact/638FmFCYYVRhQEdQDswB74).
- **Branch:** work lands on `release/gpt6-sol-luna` by PRs that Neal reviews. `main` is obsolete.
- **Claude ↔ Jarvis channel:** the pinned GitHub issue titled "Cockpit: Claude ↔ Jarvis channel" holds status, commit SHAs and requests between the two sides. Discussion specific to a PR goes on that PR.

## Topology

| Piece | Where | Notes |
| --- | --- | --- |
| Command BFF + web | VM118, beside the session host (VM113 retired) | Cloudflare Access in front; relays the terminal WebSocket to the session host on loopback. Deploy steps: [DEPLOY-VM118.md](DEPLOY-VM118.md) |
| Jarvis / Hermes (lead chat, project-lead profile) | its own dedicated Dell PC | older repo docs still say VM108 |
| Session host + agent CLIs | VM118 (`cockpit-dev`) on Proxmox | owned and maintained by Jarvis; `apps/session-host` |

## Status

| Slice | State |
| --- | --- |
| Phase 0: plan amendment, this doc | in the session-host PR |
| Phase 1a: `apps/session-host` (tmux sessions, registry, ownership, WebSocket terminal, MCP lead tools, worktrees, diff/check) | built; 10 tests pass against real tmux and bash in a sandbox; not deployed |
| Phase 1b: BFF WebSocket relay + web terminal thread view (xterm.js, mobile key bar) | built; BFF tests plus a browser check (desktop and iPhone 13) against a real session host in a sandbox; not deployed |
| Phase 2: Claude Code live qualification on cockpit-dev, lead profile wired, slice 1 acceptance | after 1b and Jarvis deploy |
| Phase 3+: Codex/Gemini qualification, parallel workers, integration flow | later |

## Facts verified so far

- Session host passes with tmux 3.4 and Node 22 in a sandbox. Note that `set -g window-size manual` in a tmux config crashes tmux 3.4 on detached start, so the cockpit uses `latest` plus explicit `resize-window`. tmux also rewrites tab characters in `-F` formats to `_`.
- cockpit-dev (from Jarvis, 2026-11-11): reachable by IP over SSH, Node 22, ports 8650/8651 free, hostname does not resolve from the Dell yet.
- VM113 is retired (Neal, 2026-11-11). Older deployment docs that describe it are history. The BFF runs on VM118 and reaches the session host on 127.0.0.1:8650. MCP binds separately (`SESSION_HOST_MCP_BIND`) for the Dell lead.

## Turning the cockpit on (Command BFF)

Set `COCKPIT_MODE=enabled`, `SESSION_HOST_BASE_URL` (for example `http://127.0.0.1:8650` if the BFF runs on VM118) and `SESSION_HOST_KEY` (the same value as the session host's). This also needs `COMMAND_MODE=enabled`. Bootstrap then advertises `project_cockpit`, and a **Terminals** button appears in a project's header. Routes live under `/api/cockpit/*`, and writes are audited to `cockpit-audit.jsonl` next to the command audit log.

- xterm.js writes its CSS into `<style>` tags, which the app's CSP (`style-src 'self'`) blocks. `Cockpit.tsx` turns those tags into inert elements and mirrors their text into a constructable stylesheet, so the CSP stays as it is.
- xterm's replies to tmux's terminal queries (device attributes, colours, cursor position) are sent as `report` frames to the viewer's own read-only tmux client. They are never typed into the agent.

## Not yet verified

- Interactive Claude Code, Codex, Gemini or OpenCode under the cockpit with Neal's real logins.
- Whether the installed Hermes loads MCP servers per profile (Jarvis prompt 2).
- Prompt flags for Gemini (`--prompt-interactive`) and OpenCode (`--prompt`) on the installed versions.
