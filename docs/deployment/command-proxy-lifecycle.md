# Local command-proxy supervisor and egress proposal

Source-only v0.2 slice. Nothing here installs, enables, reserves a port, changes a
credential, or authorizes release. `COMMAND_MODE` remains disabled in default and
live deployment. The v0.1 release scripts are deliberately unchanged and do not
install this component or preserve its new image key through a release transaction.

## Proposed local definitions

- `deploy/command-proxy.compose.yaml`: immutable
  `JARVIS_COMMAND_COMMAND_PROXY_IMAGE=sha256:<64 lowercase hex>` in a protected
  `/etc/jarvis-command/release.env`; exactly one value, no tag or digest alias.
  Host network, UID:GID 10003:10003, read-only root, all capabilities dropped,
  no-new-privileges, bounded tmpfs/PIDs/memory/CPU/files, no Docker restart policy.
- Runtime environment: `/etc/jarvis-command/command-proxy.env`, from the example,
  protected root:root 0600 using the existing secure-env-file boundary in a future
  installation transaction. Required explicit values: `HOST=127.0.0.1`, `PORT=8647`,
  `HERMES_API_BASE_URL=http://127.0.0.1:8642`, distinct high-entropy
  `COMMAND_PROXY_KEY`, and the server-only `HERMES_API_KEY`; never reuse the read
  proxy/BFF key as the command key or use the upstream key as a BFF credential.
  `MAX_STREAM_SECONDS=1800` is explicit. All checked-in key values are placeholders.
- Port 8647 is a template choice, not installed or reserved. Parent read-only `ss`
  inspection on 2026-09-05 found 8642–8646 occupied and 8647 absent. Recheck before
  installation. Never select 8644: the wildcard webhook owns it. The application
  source-config default is intentionally unchanged; the deployment env overrides it.
- `jarvis-command-command-proxy.service`: future compose destination
  `/srv/jarvis-command-command-proxy/compose.yaml`; Type=notify runs the existing
  validated-compose-up monitor with the new `command-proxy` component. Startup,
  image/health verification, continuous checks, signal cleanup and stop verification
  use the same fail-closed path as read-proxy. Only systemd restarts the container.
  Requires/After/BindsTo/PartOf tie it to egress; reverse stop ordering protects
  credential-bearing processes. ExecStopPost is a second cleanup attempt.

## Mandatory future ordering (not installation automation)

1. Keep command services stopped and command mode disabled. Verify all prerequisites
   and inspect the exact installed policy; an old active egress unit does NOT prove
   UID 10003 is protected. Do not merely start an already-active old policy unit.
2. Apply and read back the reviewed new table before starting any credential-bearing
   command container. Atomic replacement is a single nft batch deleting/recreating
   only `inet jarvis_command_egress`. Preserve unrelated Docker/Tailscale rules.
   New outbound app UID 10001 TCP destinations are loopback 3000/18642/18643;
   read UID 10002 remains loopback 8642/8643; command UID 10003 is loopback 8642/8647
   only, then reject (IPv6, UDP and other destinations are not new-flow exceptions).
   The existing established/related allowance remains for return traffic. It is
   not revocation of previously established flows: stop credential-bearing services
   before first applying the new policy, never retrofit it around an unguarded one.
3. Only after verifying installed policy and protected explicit env/image values may
   the future transaction start the supervised container and verify readiness.
4. Rollback: stop and verify ALL affected credential-bearing services/containers
   before replacing/removing their policy. A stop failure must block policy removal.
   Egress service stopping intentionally leaves the nft table in place; do not add
   an ExecStop that deletes it. Keep the stock nftables dormant/global-mutation
   guards, egress startup preflight, and AF_UNIX AF_NETLINK restrictions unchanged.
   External orchestration owns ordering: never invoke recursive systemctl stop/start
   from an egress ExecStart/ExecStop dependency chain (deadlock risk).

## Evidence and remaining integration

Mocked behavioral tests exercise the real guarded runner without calling Docker;
unit syntax verification uses a disposable systemd root, not installed units.
`verify-command-egress-isolated.py` is a manual fixture ONLY for a NEW `unshare
--net` namespace. It refuses the passed parent namespace, checks real nft parsing,
atomic replacement/failure retention and a UID/address/port connection matrix,
then removes its own tables; namespace teardown is kernel-owned on process exit.
Never invoke nft apply/check on the host for these tests. Failed namespace privilege
is a blocker, not permission to test the host policy.

The [dual SSH bridge source proposal](dual-ssh-bridge.md) now defines both restrictions
and the second forward to app-side 18643; no live installation is claimed.
Still required: transactional installation of that pair; audit directory ownership/mount/durability; app environment command enablement;
full transactional v0.2 release integration and rollback; authenticated container
chain and desktop/mobile browser verification; installed service/reboot/egress
verification; complete exact-candidate Sol review after all amendments and explicit
release authorization. Earlier packaging/shutdown smoke is not any of those gates.
