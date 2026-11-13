# Hermes host admin shell (proposed contract)

Status: proposed 2026-11-13. Nothing is built or deployed yet. Neal decides the privilege model before anything is deployed.

## Requirement (Neal, via Jarvis, PR #177 comment 6861825993)

Command gets a standalone admin shell on the **Hermes host (the Dell)**, outside Projects. Neal must be able to use it from his phone or any browser on the ordinary internet, without Tailscale on the client. Its main use is fixing Hermes itself, for example `sudo systemctl restart hermes-gateway.service`. So it must keep working while the Hermes gateway is down or restarting. It is not a project Hermes CLI adapter.

## Shape

```
phone/browser ──Cloudflare Access──▶ BFF (VM118) ──LAN, own key──▶ host-shell agent (Dell) ──▶ tmux + PTY login shell
                                   (unchanged)                    (own systemd unit, not Hermes)
```

- **Agent.** A second instance of `apps/session-host` runs on the Dell as its own systemd unit, `command-host-shell.service`.
  - It never depends on or talks to `hermes-gateway.service`, the Hermes API or the command proxy. Restarting or breaking Hermes leaves it running.
  - Only the qualified `shell` adapter is enabled (`SESSION_HOST_QUALIFIED=shell`). The MCP listener is off, and there are no projects, worktrees or CLIs.
  - It binds to the Dell LAN address. The Dell firewall allows only VM118, as with the existing session-host port.
- **Credential isolation.** The agent has its own key (`HOST_SHELL_KEY`), separate from `SESSION_HOST_KEY`, the scheduled-runs keys and every Hermes key.
  - The key lives only in the BFF env file and a 0600 file on the Dell.
  - The browser never sees it; the BFF relays as it does for project terminals today.
- **BFF.** New config `HOST_SHELL_MODE=enabled`, `HOST_SHELL_BASE_URL`, `HOST_SHELL_KEY`. New routes:
  - `GET /api/host-shell/status`
  - `GET|POST /api/host-shell/sessions`
  - `DELETE /api/host-shell/sessions/:id`
  - `GET /api/host-shell/sessions/:id/terminal` (WebSocket)

  These live inside the existing Access-verified scope, with the same-origin and rate-limit checks. Access isn't changed and nothing new is published to the internet.
- **Web.** A "Hermes host" entry in the sidebar, outside Projects, opens the same terminal view project threads use. It shows whether the agent is reachable. If the agent is down, it says so plainly and offers no fallback route.
- **Sessions.** Each tab is a tmux session on the Dell, so it survives a dropped phone connection and can be reattached. There is a small cap, for example 4 sessions.

## Privilege model (Neal decides)

The shell runs as a dedicated non-root login user on the Dell, `command-admin`. How `sudo` behaves is the decision:

1. **Password prompt.** `sudo` asks for that user's password in the terminal, typed by Neal on his phone. No password is stored anywhere. Even a stolen Access session can't become root without the password.
2. **Passwordless for a short list (recommended).** `NOPASSWD` covers only `systemctl restart|status hermes-gateway.service` and `journalctl -u hermes-gateway`. Everything else prompts. This makes the main use, a gateway restart, one command from a phone without typing a password, while every other root action still needs one.
3. **Passwordless sudo.** Convenient, but anyone holding an Access session to Command is root on the Dell.

## Audit and logs

- The BFF audit ledger records session open, close and resize events: actor fingerprint, session id and time.
- Keystrokes and terminal output are never logged by the BFF or the agent.
- tmux scrollback stays on the Dell only.

## Acceptance

1. With Hermes running, open the shell from the phone over mobile data, then run `whoami`, `hostname` and `systemctl status hermes-gateway`.
2. Run `sudo systemctl restart hermes-gateway.service`. The shell stays connected through the restart, and Hermes comes back.
3. With `hermes-gateway` stopped, the shell still opens and can start it again.
4. Drop the phone's connection mid-command, reconnect, and the same session reattaches.
5. A request without Access gets 401/403. The agent port isn't reachable from anything except VM118.

## Not in scope

- SSH published to the internet, client Tailscale, or any change to Cloudflare Access.
- Root login, stored sudo passwords, or reuse of the Hermes or session-host keys.
