# Deploying Command + the cockpit on VM118

VM113 is retired (Neal, 2026-11-11). The Command web app and BFF (`apps/server`) now run on VM118 (`cockpit-dev`), next to the session host. Hermes and the project-lead profile stay on the Dell. Jarvis owns this deploy. Changes to the Cloudflare Access policy or logins, spending, and data deletion still go to Neal.

```
browser → Cloudflare Access → tunnel connector on VM118 → BFF 127.0.0.1:3000
BFF → session host 127.0.0.1:8650 (SESSION_HOST_KEY)
BFF → Hermes read/command proxies on the Dell (18642 / 18643, as before)
Dell project-lead → VM118 LAN :8651 MCP (SESSION_HOST_MCP_KEY)
```

## 1. Session host binds

```
SESSION_HOST_BIND=127.0.0.1          # main API, BFF only, same host
SESSION_HOST_MCP_BIND=<VM118 LAN IP> # MCP for the Dell lead
```

With this, 8650 is no longer reachable from the LAN, so no firewall rule is needed for it. Keep 8651 open to the Dell only.

## 2. Build (one checkout serves both)

```sh
npm ci
npm run build    # builds the server, web (apps/web/dist) and session host
```

## 3. BFF environment (`~/.config/cockpit/command.env`, mode 0600)

Start from `deploy/app.env.example` and reuse the values from VM113's `/etc/jarvis-command/app.env`: Access team domain, AUD, email hash, read and command proxy keys, and `PUBLIC_ORIGIN`. Then add:

```
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
WEB_DIST_DIR=<checkout>/apps/web/dist
COMMAND_MODE=enabled
COMMAND_AUDIT_LOG_PATH=<data>/audit/events.jsonl
ARTIFACTS_MODE=enabled
ARTIFACT_STORAGE_PATH=<data>/artifacts
COCKPIT_MODE=enabled
COMMAND_DEFAULT_INFERENCE=openai-codex/gpt-6.1-sol/medium   # used when no prompt, thread or project default is saved
SESSION_HOST_BASE_URL=http://127.0.0.1:8650
SESSION_HOST_KEY=<same value as the session host's SESSION_HOST_KEY; never the MCP key>
CF_ACCESS_JWKS_FILE=<path refreshed by the JWKS timer>
```

The BFF verifies the Access JWT against a local JWKS file. Install the refresh job on VM118 from `deploy/jarvis-command-jwks.{service,timer}` and `deploy/refresh-cloudflare-jwks.sh`, adjusting paths.

## 4. Data to carry over from VM113

VM113's app is stopped, so a copy now is consistent. Copy these and **keep the originals until Neal approves deleting VM113**:

- `/var/lib/jarvis-command/audit/` holds `events.jsonl`, `project-rooms.json` (projects and threads), notification, reaction and push state. The new `cockpit-audit.jsonl` also lands here.
- `/var/lib/jarvis-command/artifacts/` holds the artifact store.

Preserve file modes: directories are 0700 and files 0600, owned by the user that runs the BFF. The project-room store refuses to start on a directory that's open to group or other.

## 5. Run

Run the BFF as a **system** unit that runs as the `cockpit` user: `/etc/systemd/system/jarvis-command.service`. The session host stays a `--user` service.

```
[Unit]
Description=Jarvis Command BFF
After=network-online.target
Wants=network-online.target

[Service]
User=cockpit
Group=cockpit
WorkingDirectory=/home/cockpit/jarvis-command/apps/server
EnvironmentFile=/home/cockpit/.config/cockpit/command.env
ExecStart=/usr/bin/env node dist/index.js
Restart=on-failure
PrivateTmp=yes
PrivateUsers=no
NoNewPrivileges=yes
UMask=0027

[Install]
WantedBy=multi-user.target
```

Don't run the BFF as a user unit. In a user manager, `PrivateTmp` puts the process in a user namespace. There, `/` and `/home` appear owned by the overflow UID 65534, so the strict storage checks refuse to start with `unsafe_ancestor_directory`. That is correct: never treat UID 65534 as a trusted owner, and never loosen the validators to work around it.

The old user unit `~/.config/systemd/user/jarvis-command.service` is masked on VM118. Leave it masked, and deploy by restarting the system unit: `sudo systemctl restart jarvis-command`.

The containerized release pipeline in `deploy/` (compose, supervisor, nftables egress) was built for VM113. It can be adapted later.

## 6. Upstreams and ingress

- **Hermes proxies:** the BFF expects `HERMES_API_BASE_URL` / `HERMES_COMMAND_API_BASE_URL` on loopback 18642/18643. Previously the Dell's reverse SSH bridge (`deploy/jarvis-command-bridge.service`) opened those on VM113. Point that bridge at VM118, or set the two URLs to wherever the proxies are reachable.
- **Public origin:** run a Cloudflare tunnel connector on VM118 to `http://127.0.0.1:3000` for the existing hostname, with the Access application unchanged. Any change to the Access policy itself goes to Neal first.

## 7. Smoke check

1. `curl -s 127.0.0.1:3000/api/health` returns `ok`.
2. Without an Access JWT, `curl -s 127.0.0.1:3000/api/cockpit/status` returns 401. In the browser through Access it returns `{"enabled":true}`.
3. Open a project and click **Terminals**. Start a Shell, type `echo hi`, and confirm the output. Then try Hand to lead, Take over and Stop.
4. `cockpit-audit.jsonl` shows the session create and stop with the Access subject.

## 8. Rollback baseline

Commit `a4f978e` widened the Codex/xAI model id contract from a fixed list to a shape check. That is what lets the BFF read dynamic ids such as `gpt-6.1-sol`. Once the ledger holds a run or a saved default with such an id:

- **Safe rollback:** any commit at or after `a4f978e`. Prefer `9a10948` or later, which also understands `routing_refused` and `COMMAND_DEFAULT_INFERENCE`.
- **Not safe:** `490589d` or anything older. Its strict reader rejects the new frozen routing records, and the audit store refuses to load.
- **Before new admissions:** if the ledger has no dynamic ids yet, an older rollback is fine.
- **If an older build is truly required:** roll forward with a fix instead of editing the ledger. Never strip or rewrite audit records.

Rolling back the command proxy is independent of the BFF. An older proxy image simply stops offering the dynamic ids, and sends that use them are refused with `model_not_offered`.
