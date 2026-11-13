# Hermes host admin shell (proposed contract)

Status: built 2026-11-13, not deployed. Neal chose the privilege model: no password for Hermes restarts, a password for every other sudo.

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
- **BFF.** New config `HOST_SHELL_MODE=enabled`, `HOST_SHELL_BASE_URL`, `HOST_SHELL_KEY`, and optionally `HOST_SHELL_NAME` (default "Hermes host"). New routes:
  - `GET /api/host-shell/status`
  - `GET|POST /api/host-shell/sessions` (POST takes only `{requestId, title?, cols?, rows?}`; the kind is always `shell`)
  - `POST /api/host-shell/sessions/:id/interrupt|stop`, plus `/ownership` with `take` or `release` (there's no lead hand-off)
  - `GET /api/host-shell/sessions/:id/terminal` (WebSocket)

  These live inside the existing Access-verified scope, with the same-origin and rate-limit checks. Access isn't changed and nothing new is published to the internet.
- **Web.** The Hermes panel (the "Hermes" status button in the header) has an "Open shell" button that opens the same terminal view project threads use. The Hermes panel was chosen because it is always visible, including when Hermes is down. It shows whether the agent is reachable. If the agent is down, it says so plainly and offers no fallback route.
- **Sessions.** Each tab is a tmux session on the Dell, so it survives a dropped phone connection and can be reattached. There is a small cap, for example 4 sessions.

## Privilege model (Neal decides)

The shell runs as a dedicated non-root login user on the Dell, `command-admin`. How `sudo` behaves is the decision:

1. **Password prompt.** `sudo` asks for that user's password in the terminal, typed by Neal on his phone. No password is stored anywhere. Even a stolen Access session can't become root without the password.
2. **Passwordless for a short list (chosen by Neal, 2026-11-13).** `NOPASSWD` covers only `systemctl restart|start|stop hermes-gateway.service`. Status and logs need no sudo at all. Everything else prompts. This makes the main use, a gateway restart, one command from a phone without typing a password, while every other root action still needs one.
3. **Passwordless sudo.** Convenient, but anyone holding an Access session to Command is root on the Dell.

## Audit and logs

- `host-shell-audit.jsonl` (next to the audit ledger, mode 0600) records session create, stop and interrupt, and terminal attach and detach: actor fingerprint, session id and time.
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

## Setup on the Dell (Jarvis)

Do not deploy until the source is on VM118 and these steps are reviewed. Never post the key on GitHub.

1. **User.** Create `command-admin`: a normal login user, not root, with a password Neal sets himself (Jarvis doesn't choose or store it). Add it to the groups needed to read Hermes logs, for example `systemd-journal`.
2. **sudoers.** Run `visudo -f /etc/sudoers.d/command-admin`, mode 0440:
   ```
   command-admin ALL=(root) NOPASSWD: /usr/bin/systemctl restart hermes-gateway.service, /usr/bin/systemctl start hermes-gateway.service, /usr/bin/systemctl stop hermes-gateway.service
   command-admin ALL=(ALL) ALL
   ```
   - Status and logs need no sudo: `systemctl status hermes-gateway` and `journalctl -u hermes-gateway` work for a member of `systemd-journal`.
   - Don't add `status` or `journalctl` to the NOPASSWD line. Both open a pager, and a pager running as root can start a root shell.
   - Check the path with `command -v systemctl`, and use the actual unit name.
3. **Session host build.** Check out `cockpit/session-host` under `/home/command-admin/jarvis-command`, then run `npm ci && npm run build -w apps/session-host` (or the full build). The host needs `tmux` and Node.
4. **Env** `/home/command-admin/.config/command-host-shell.env`, mode 0600:
   ```
   SESSION_HOST_BIND=<Dell LAN IP>
   SESSION_HOST_PORT=8660
   SESSION_HOST_MCP_PORT=0
   SESSION_HOST_KEY=<new random value, at least 32 characters; different from every other key>
   SESSION_HOST_NAME=<Dell hostname>
   SESSION_HOST_STATE_DIR=/home/command-admin/.local/state/host-shell
   SESSION_HOST_PROJECTS_DIR=/home/command-admin/host-shell
   SESSION_HOST_WORKTREES_DIR=/home/command-admin/host-shell-worktrees
   SESSION_HOST_SHELL=/bin/bash
   ```
5. **Unit** `/etc/systemd/system/command-host-shell.service`. It's a system unit, deliberately with no dependency on `hermes-gateway`:
   ```
   [Unit]
   Description=Command host shell (session host, shells only)
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=command-admin
   Group=command-admin
   WorkingDirectory=/home/command-admin/jarvis-command/apps/session-host
   EnvironmentFile=/home/command-admin/.config/command-host-shell.env
   ExecStart=/usr/bin/env node dist/index.js
   Restart=always
   RestartSec=2
   KillMode=process

   [Install]
   WantedBy=multi-user.target
   ```
   `KillMode=process` keeps the tmux server, and so the open shells, alive across a restart of this unit. `NoNewPrivileges` is deliberately off, because `sudo` must work inside the shell.
6. **Firewall.** The Dell uses nftables (iptables-nft). firewalld isn't present, and UFW is inactive. Its INPUT policy is accept, so add an explicit nftables rule:
   - accept TCP 8660 from VM118's address
   - drop TCP 8660 from everything else, including the Tailscale interface

   Make the rule persistent. Before enabling the BFF side, verify both: VM118 can connect, and another LAN host or tailnet peer is refused.
7. **BFF on VM118** (`command.env`, then `sudo systemctl restart jarvis-command`):
   ```
   HOST_SHELL_MODE=enabled
   HOST_SHELL_BASE_URL=http://<Dell LAN IP>:8660
   HOST_SHELL_KEY=<same value as the Dell's SESSION_HOST_KEY above>
   HOST_SHELL_NAME=Hermes host
   ```
   The BFF refuses to start if `HOST_SHELL_KEY` equals its own `SESSION_HOST_KEY`.
8. Run the acceptance steps above, then hand to Neal for the phone checks: open, restart the gateway, reconnect.

