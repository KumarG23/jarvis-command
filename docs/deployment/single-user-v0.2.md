# Single-user v0.2 — VM108 ↔ VM113 only

This is a new, fixed-target integration over the existing components, NOT the parked transactional installer. Do not use `release-app.sh`, `install-app-release.sh`, or the parked recovery path for this cutover. This candidate is local/unreviewed until the parent records complete exact-candidate Sol approval. No command here authorizes deployment before that review. Never alter Access/JWKS/MFA to obtain a green acceptance result.

## Artifact and scope

The implementation receipt is `/home/neal/backups/jarvis-command/single-user-release/IMPLEMENTATION-RESULT.json`. It binds the complete source manifest, archive, immutable image IDs, gate logs and remaining limits. Amendments invalidate review. Build inputs are separately bound in `app-images/app-source-sha256.json` and `command-image/image-source-sha256.json`; those mappings must still match the reviewed source. Use the saved images, not a rebuild or a mutable tag.

VM108 is the current Hermes host (its live LAN IP was 192.168.6.46 during implementation; do not assume the old .67 address). VM113 is `neal@192.168.6.113`. SSH always uses `/home/neal/.ssh/jarvis_homelab_ed25519` with `IdentitiesOnly=yes`, `BatchMode=yes`, `StrictHostKeyChecking=yes`. The existing reverse bridge's destination remains VM113. Hermes API/read proxy and the read proxy key are unchanged. Command proxy binds explicitly to 127.0.0.1:8647, never its source default 8644. No gateway, Docker, stock nftables, or read-proxy restart is required.

Only the existing owned `inet jarvis_command_egress` table is atomically reloaded. The app and command proxy are stopped before their credentials/policy change. Audit preparation is an explicit one-time operation; reboot/supervisor only verifies it. The existing `.well-known` mount and Android association files remain untouched.

## Parent preparation AFTER exact review

Run in a bounded maintenance window. No concurrent operator/config changes. Keep both SSH sessions open. Abort on any failed preflight. There is no hostile-race or host-loss transaction guarantee: normal command failures are handled, snapshots are retained, and recovery after host loss requires the operator to inspect the recorded state. Do not claim the parked concern is fixed.

1. Recheck HEAD, complete manifest hashes and review verdict. On VM108, save the two exact images using `docker image save -o app-image.tar APP_SHA256_ID` and `docker image save -o command-image.tar COMMAND_SHA256_ID` (IDs from the receipt). Hash both archives. Images contain no deployment credentials. Transfer source archive, its manifest/checksum file, app image and their expected hashes to VM113 over the fixed SSH connection. Do not copy Hermes credentials to the browser or app VM.
2. On EACH host, require `/var/lib/jarvis-command-v02-stage` and `/var/lib/jarvis-command-v02-backup` to be absent. Create the fixed staging directory root:root 0700 beneath root-owned `/var/lib`. Install the archive into that directory root:root 0600. Verify the archive against the independently reviewed hash BEFORE extraction. Extract into `stage/source` as root (`--no-same-owner`), then verify every source byte with the provided `source.sha256` from inside `stage/source`. This is trusted reviewed source, not an arbitrary uploaded archive. Check all stage ancestors are root-owned and not group/world writable. Keep the stage private; do not chmod it to make transfer easier.
3. Install/load app image only on VM113 and command image only on VM108; verify `docker image inspect --format '{{.Id}}' ID` equals the receipt. Create root-owned 0600 `stage/app-image.txt` on VM113 and `stage/hermes-image.txt` on VM108 containing their respective immutable IDs. Keep archives and their hashes in private staging.
4. Generate ONE new command key with `openssl rand -hex 32`, directly into root-private `stage/command.key` on VM108 (umask 077). Transfer those bytes over the fixed authenticated SSH connection directly to the root-private stage on VM113, mode 0600; do not place the key in argv, shell history, logs or a user-readable upload directory. Verify equality by a private comparison over SSH, without printing the value. `prepare()` rejects reuse of existing credentials and preserves the read key and Access values. Upstream bearer is read locally from existing VM108 `read-proxy.env` and never copied to VM113.
5. Before ANY production mutation, create root-owned 0600 baseline tar snapshots inside each private stage, preserving owners/modes, of the exact existing `/etc/jarvis-command`, owned `/srv/jarvis-command*` deployment directories, owned service units/drop-ins and bridge policy. Enumerate the actual fixed paths first; do not archive secrets into the evidence directory. Record `systemctl is-enabled` and `is-active` for app/bridge/egress/read proxy. Save `nft list table inet jarvis_command_egress` and the Docker inspect of the current app privately. Save its exact v0.1 image with `docker image save`; the app preflight also saves it as `stage/baseline-app-image.tar`. Do not prune the old image. These baseline archives are retained, not automatically deleted.

`stage` below means `/var/lib/jarvis-command-v02-stage`. All following host commands are root commands from that verified private stage. Never execute the script with sudo from a mutable user worktree.

## Prepare the existing bridge and durable storage (VM113)

Record the existing `/var/lib/jarvis-bridge/.ssh/authorized_keys` and optional `/etc/ssh/sshd_config.d/60-jarvis-bridge.conf` in a separate private `bridge-baseline.tar`; record whether the latter was absent. Transfer ONLY the existing public key `/etc/jarvis-command/bridge_to_app_ed25519.pub` from VM108 into VM113's private stage. Do not generate or replace the bridge private key.

Run the existing reviewed helper:

```sh
python3 source/deploy/render-bridge-key.py bridge_to_app_ed25519.pub >/dev/null
bash source/deploy/install-bridge-account.sh "$PWD/bridge_to_app_ed25519.pub"
/usr/sbin/sshd -t
/usr/sbin/sshd -T -C user=jarvis-bridge,host=localhost,addr=192.168.6.46
```

Read back exact authorized-key bytes against renderer output and the sshd config against reviewed source. Effective policy must be remote-only forwarding, two loopback PermitListen targets 18642/18643, MaxSessions=0, no password/PTY/agent/X11/streamlocal/local forwarding. If this preparation fails, restore only the recorded bridge files (remove the newly introduced fixed sshd file if previously absent), test sshd, reload `ssh.service`, verify the old read bridge. Do not proceed.

Prepare storage with the old app stopped, then restore read-only service while the command path is prepared:

```sh
systemctl stop jarvis-command-app.service
python3 source/deploy/prepare-audit-storage.py prepare --trusted-root /var/lib/jarvis-command --path /var/lib/jarvis-command/audit/events.jsonl
python3 source/deploy/prepare-audit-storage.py verify --trusted-root /var/lib/jarvis-command --path /var/lib/jarvis-command/audit/events.jsonl
systemctl start jarvis-command-app.service
```

Run the final `start` even if preparation fails, then abort. Require root:root0755 trusted root, audit UID/GID10001 mode0700 and ledger10001:10001 mode0600. Never repair/delete an existing ledger. No audit chain is claimed from the metadata helper; the application validates it on startup.

## Fixed host cutover

First VM108, then VM113:

```sh
# VM108 — only after bridge policy is installed and :8647 is confirmed free.
python3 source/deploy/single-user-release.py apply hermes --ack REVIEWED_SINGLE_USER_V02
# VM113 — must see authenticated command readiness through :18643 first.
python3 source/deploy/single-user-release.py apply app --ack REVIEWED_SINGLE_USER_V02
```

The script preserves the old config bytes/owners/modes in fixed root-private `/var/lib/jarvis-command-v02-backup`, installs and reads back exact source bytes, changes no Android mount, uses the tested app supervisor and validated proxy launcher, verifies immutable runtime identity and liveness, and rolls back on ordinary cutover failure. A preflight failure occurs before stopping/replacing the app. A rollback failure remains nonzero and retains the snapshot; inspect rather than claiming restoration. Do not rerun apply over an existing backup.

If VM113 fails, its local transaction restores v0.1. Then run the VM108 rollback below and restore the recorded VM113 bridge policy. If VM108 fails, its local transaction restores its prior bridge/config and leaves the read-only app untouched. Restore the bridge policy preparation on VM113 too. Keep credentials and audit retained privately for diagnosis; do not erase an admitted audit history.

After BOTH succeed, explicitly enable `jarvis-command-command-proxy.service` on VM108 and read back `is-enabled`, `is-active`. Existing app/bridge/egress enablement must remain unchanged. Inspect listeners on both hosts: 3000/18642/18643 only 127.0.0.1 on VM113; API8642/read8643/command8647 only loopback on VM108. Check actual container users, image IDs, mounts and host-network policy against the existing verified component definitions. Never restart stock nftables or Docker to test recovery.

## Real rollback

Quiesce the app first. For a completed v0.2 cutover, run VM113 rollback BEFORE removing command egress/bridge:

```sh
# VM113
python3 source/deploy/single-user-release.py rollback app --ack REVIEWED_SINGLE_USER_V02
# VM108 (disable only the newly enabled command proxy, if enabled)
systemctl disable jarvis-command-command-proxy.service
python3 source/deploy/single-user-release.py rollback hermes --ack REVIEWED_SINGLE_USER_V02
```

Restore the exact VM113 bridge files from its private bridge snapshot, `sshd -t`, reload ssh, and verify the single read listener and old read-only public app. Compare installed bytes, old image ID, original modes/owners, enablement and owned nft table with recorded baseline. Runtime table and disk file must agree; if the pre-cutover live table differed from its file, use the recorded table in an atomic delete+recreate batch affecting ONLY `inet jarvis_command_egress`, while relevant credential-bearing containers are confirmed stopped. Do not feed the baseline tar into a generic privileged recovery path. Preserve all snapshots.

## Parent acceptance, not simulated acceptance

An unauthenticated public request must still redirect to unchanged Access login. Neal must log in/MFA; there is no authenticated browser session available to this worker. At desktop and phone widths: create a Command session, send a harmless real message, see streamed answer/tool activity, copy the answer, reload and confirm the same run identity; exercise once/deny/stop/steer with explicit visible synthetic task targets. Continue on external sessions must stay disabled. Inspect console/network failures, service worker/API exclusion and actual persisted audit without logging secret content. Exercise service restart and recheck identity, ledger and loopback listeners. Public positive/negative Access/server identity checks and physical Pixel remain parent gates. Update/push canon only in the parent lane.

Local evidence proves synthetic browser/API chains and isolated cutover file/service fixtures, not a live public message or real systemd/SSH pair cutover. Do not conflate them.
