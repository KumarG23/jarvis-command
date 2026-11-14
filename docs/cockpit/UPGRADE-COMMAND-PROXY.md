# Upgrading the command proxy on the Dell

The command proxy runs on the Dell as an immutable container
(`jarvis-command-command-proxy`, compose at `/srv/jarvis-command-command-proxy/compose.yaml`,
env at `/etc/jarvis-command/command-proxy.env`, image id in `/etc/jarvis-command/release.env`).
A new proxy release means building a new image from the source commit and pointing
`JARVIS_COMMAND_COMMAND_PROXY_IMAGE` at it. Secrets, ports and the loopback forwarders stay as they are.

## 1. Build the image from the exact commit

```sh
git -C <checkout> fetch origin cockpit/session-host && git -C <checkout> checkout <SHA>
cd <checkout>
docker build -f Dockerfile.command-proxy -t jarvis-command-command-proxy:<SHA> .
docker image inspect --format '{{.Id}}' jarvis-command-command-proxy:<SHA>   # sha256:...
```

Optional local acceptance check, which never touches live services:
`python3 deploy/verify-command-proxy-image.py --evidence <dir>`.

## 2. Settings (`/etc/jarvis-command/command-proxy.env`)

Keep every existing key. Add or change only these non-spending switches:

```
COMMAND_ADVERTISED_SUBSCRIPTION_ROUTES=true    # all advertised Codex/xAI subscription models
COMMAND_OPENROUTER_FREE_ROUTES_ENABLED=true    # only authenticated OpenRouter ids ending in :free
COMMAND_ANTHROPIC_ROUTES_ENABLED=false         # may be API-billed: Neal decides
```

## 3. Switch and restart

1. Back up `/etc/jarvis-command/release.env`.
2. Set `JARVIS_COMMAND_COMMAND_PROXY_IMAGE=<new sha256 id>`.
3. Run `systemctl restart jarvis-command-command-proxy`.
4. Rollback: restore the backup and restart again. The old image stays on disk.

## 4. Check without spending

Call `GET /api/model/options` on the proxy with the command proxy key as a Bearer token. Read the key from the env file on the box; never paste it anywhere.
- Expect the subscription models (for example `gpt-6.1-sol`) with `eligible: true` and `selectable: true`.
- Anthropic entries stay `eligible: false`.

Stored route ids from the old proxy still parse, because the curated list is unchanged.
A send with an unavailable model now returns `422 routing_refused`, and the BFF log line `routing refused` carries a fixed `reason` code.
