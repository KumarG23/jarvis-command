# Project cockpit — handoff

Keep this short and current. It is what a new conversation (Claude, Jarvis or Neal) reads to resume the cockpit work.

- **Direction:** [MASTER_PLAN.md §0.0](../../MASTER_PLAN.md). Full plan with architecture, phases and risks: [Jarvis Command project cockpit plan](https://claude.ai/artifact/638FmFCYYVRhQEdQDswB74).
- **Branch:** work lands on `release/gpt6-sol-luna` by PRs that Neal reviews. `main` is obsolete.
- **Claude ↔ Jarvis channel:** the pinned GitHub issue titled "Cockpit: Claude ↔ Jarvis channel" holds status, commit SHAs and requests between the two sides. Discussion specific to a PR goes on that PR.

## Topology

| Piece | Where | Notes |
| --- | --- | --- |
| Command BFF + web | VM113 | Cloudflare Access in front; relays the terminal WebSocket (not built yet) |
| Hermes (lead chat, project-lead profile) | dedicated Dell PC | repo docs still say VM108; Neal moved it off the Proxmox box |
| Session host + agent CLIs | `cockpit-dev` VM on Proxmox | owned and maintained by Jarvis; `apps/session-host` |

## Status

| Slice | State |
| --- | --- |
| Phase 0: plan amendment, this doc | in the session-host PR |
| Phase 1a: `apps/session-host` (tmux sessions, registry, ownership, WebSocket terminal, MCP lead tools, worktrees, diff/check) | built; 10 tests pass against real tmux and bash in a sandbox; not deployed |
| Phase 1b: BFF WebSocket relay + web terminal thread view (xterm.js, mobile key bar) | next |
| Phase 2: Claude Code live qualification on cockpit-dev, lead profile wired, slice 1 acceptance | after 1b and Jarvis deploy |
| Phase 3+: Codex/Gemini qualification, parallel workers, integration flow | later |

## Facts verified so far

- Session host passes with tmux 3.4 and Node 22 in a sandbox. Note that `set -g window-size manual` in a tmux config crashes tmux 3.4 on detached start, so the cockpit uses `latest` plus explicit `resize-window`. tmux also rewrites tab characters in `-F` formats to `_`.
- cockpit-dev (from Jarvis, 2026-11-11): reachable by IP over SSH, Node 22, ports 8650/8651 free, hostname does not resolve from the Dell yet.
- VM113 app egress only allows its existing loopback services. Connecting it to the session host needs a deliberate network change, which Jarvis owns.

## Not yet verified

- Interactive Claude Code, Codex, Gemini or OpenCode under the cockpit with Neal's real logins.
- Whether the installed Hermes loads MCP servers per profile (Jarvis prompt 2).
- Prompt flags for Gemini (`--prompt-interactive`) and OpenCode (`--prompt`) on the installed versions.
