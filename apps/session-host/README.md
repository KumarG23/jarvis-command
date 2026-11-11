# Cockpit session host

Runs the project cockpit's working sessions on the execution host (`cockpit-dev`): official agent CLIs (Claude Code, Codex, Gemini CLI, OpenCode) and plain shells, each in a real terminal owned by tmux. The Command BFF relays the browser terminal to it, and the Hermes project lead drives it through MCP tools.

Status: slice 1, part 1. Built and tested in a sandbox with real tmux and bash. No real subscription CLI has been qualified on cockpit-dev yet.

## How it works

- Each session is one tmux session on a private socket (`$SESSION_HOST_STATE_DIR/tmux.sock`), started from an argv array with no shell parsing. tmux keeps the agent alive when the browser, the BFF or this service restarts. After a host reboot, sessions show as `lost` and are never relaunched automatically.
- `sessions.json` in the state dir records the project, request ID, kind, working directory, branch, native session ID and state of each session.
- Viewers attach read-only (`tmux attach -r` in a node-pty). All typing goes through one input gate that enforces ownership: `human`, `lead` or `none`. Neal can always take over. The lead can type only into sessions it started or that Neal handed to it.
- When given a repository, coding sessions get their own `git worktree` on branch `cockpit/<session id>` under `$SESSION_HOST_WORKTREES_DIR/<project>/`. Existing checkouts, branches and dirty work are never touched or removed.
- Provider API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` and similar) and `SESSION_HOST_*` are removed from worker environments. A subscription CLI therefore can't quietly fall back to paid API billing, and a worker can't call this service as Neal. Claude Code and Codex launches are refused only if the CLI is logged in with an API key. A logged-out CLI shows its own official login flow in the terminal.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SESSION_HOST_KEY` | required, 32+ chars | Bearer key for the main API. Only the Command BFF holds it. |
| `SESSION_HOST_MCP_KEY` | required unless MCP is off | Bearer key for the MCP listener. Only the Hermes project-lead profile holds it. Must differ from `SESSION_HOST_KEY`. |
| `SESSION_HOST_BIND` | `127.0.0.1` | Listen address for both listeners. Use the LAN IP or `0.0.0.0` if the Command BFF and Hermes connect from other machines. |
| `SESSION_HOST_PORT` | `8650` | Main API and terminal WebSocket. |
| `SESSION_HOST_MCP_PORT` | `8651` | MCP endpoint at `POST /mcp`. `0` disables it. |
| `SESSION_HOST_NAME` | hostname | Shown to Neal as where code runs. |
| `SESSION_HOST_STATE_DIR` | `~/.local/state/cockpit` | Registry and tmux socket. |
| `SESSION_HOST_PROJECTS_DIR` | `~/projects` | Per-project dirs and clones. |
| `SESSION_HOST_WORKTREES_DIR` | `~/worktrees` | Per-session worktrees. |
| `SESSION_HOST_SHELL` | `$SHELL` or `/bin/bash` | Shell for `shell` sessions. |
| `SESSION_HOST_QUALIFIED` | empty | Comma-separated kinds Neal has tested on this host, e.g. `claude,codex`. Unqualified kinds still launch; they're just labeled unqualified. |

Generate keys with `openssl rand -hex 32`.

## Install on cockpit-dev

```sh
# as the cockpit user, from a checkout of this repository at the reviewed commit
npm ci
npm run build -w @jarvis-command/session-host
# then install deploy/cockpit-session-host.service (edit paths and the env file), and:
systemctl --user daemon-reload && systemctl --user enable --now cockpit-session-host
loginctl enable-linger cockpit   # keep user services running after logout
```

node-pty compiles a native module during `npm ci`, so `build-essential` and `python3` are needed. Stopping or restarting the service only detaches viewers; agent processes stay in tmux.

## API (main listener, `Authorization: Bearer $SESSION_HOST_KEY`)

Every session route requires `projectId`. A session in another project returns 404.

- `GET /v1/health` (no auth)
- `GET /v1/adapters` lists CLIs with availability, version, billing route and qualification
- `GET /v1/sessions?projectId=`
- `POST /v1/sessions` with `{requestId, projectId, title, kind, repository?, worktree?, initialInput?, cols?, rows?}`. A repeated `requestId` returns the same session with status 200 and never launches a second one.
- `GET /v1/sessions/:id?projectId=`
- `POST /v1/sessions/:id/input` with `{projectId, data, submit?}`, acting as Neal
- `POST /v1/sessions/:id/ownership` with `{projectId, action: take | hand_to_lead | release}`
- `POST /v1/sessions/:id/interrupt` and `/stop` with `{projectId}`
- `GET /v1/sessions/:id/tail?projectId=&lines=`, `GET /v1/sessions/:id/diff?projectId=`
- `POST /v1/sessions/:id/check` with `{projectId, command, timeoutSeconds?}`
- `GET /v1/sessions/:id/terminal?projectId=&cols=&rows=` (WebSocket). Binary frames carry terminal output. Text frames are JSON: from the client `{type:"input",data}`, `{type:"resize",cols,rows}` or `{type:"report",data}` (a terminal query reply, written to this viewer's read-only tmux client only), and from the server `{type:"session"}`, `{type:"input_refused",reason}` or `{type:"closed",reason}`.

Contracts live in `packages/contracts/src/cockpit.ts`.

## MCP (lead listener, `Authorization: Bearer $SESSION_HOST_MCP_KEY`)

This is Streamable HTTP at `POST /mcp` with JSON responses. The tools are: `list_adapters`, `list_sessions`, `create_session`, `get_session`, `read_tail`, `send_input`, `take_input`, `release_input`, `interrupt`, `stop_session`, `get_diff` and `run_check`. Every call acts as the lead.

## Tests

`npm test -w @jarvis-command/session-host` runs real tmux and bash sessions and is skipped when tmux isn't installed. The tests cover idempotent admission, cross-project 404s, launch failure, exit status, stop, lost-after-kill, survival across a service restart, ownership races, worktree isolation with diff and check, the WebSocket terminal and auth.
