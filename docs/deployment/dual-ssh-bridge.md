# Restricted dual reverse SSH bridge — source proposal

Not installed, enabled, independently reviewed, or approved for release. App command
mode stays disabled. This supersedes the v0.1 single-listener provisioning description
for the amended source candidate only; it does not describe a live cutover.

## Exact path and identity custody

The Hermes-host unit opens only these VM 113 reverse listeners:

- `127.0.0.1:18642` -> Hermes `127.0.0.1:8643` (read proxy, unchanged).
- `127.0.0.1:18643` -> Hermes `127.0.0.1:8647` (command proxy proposal).

8647 is a template, not a reservation. Recheck occupancy before installation; the
parent preflight found 8642–8646 occupied. Do not use the occupied webhook port 8644.
The command-proxy application source default is still 8644; the explicit deployment
environment must override it to 8647. No source-default migration is claimed here.

The dedicated private identity stays on Hermes only, never VM 113, an app container,
a browser, or an evidence archive. Only its public key goes to VM 113. Pin VM 113's
host public key through an authenticated independent channel in the isolated
`app_known_hosts` file. The unit ignores ambient SSH config, selects only the explicit
identity, uses BatchMode/strict host verification, exits on forward setup failure,
and has bounded keepalives. `-NT` requests no session and no PTY.

Both server restrictions are required: the account-specific `Match User jarvis-bridge`
permits remote TCP forwarding only and exactly the two numeric loopback listeners;
the rendered authorized key uses `restrict,port-forwarding` with the same two
`permitlisten` options. Local TCP/Unix-socket forwarding, sessions, PTY, agent, X11,
user RC and password/interactive authentication stay denied. No default-user SSH
policy is changed. Never add a wildcard or dynamic forward to the unit.

SSH remote-listener restrictions do not constrain the destination chosen by the
client on Hermes, nor distinguish a malicious remote dynamic forward using an
allowed listener. Private-key custody and the exact trusted source unit remain
critical. `PermitOpen none` denies server-side local-forward destinations; it does
not pin reverse-forward targets. This is not a substitute for the proxy or UID
network boundaries.

## Key input and future transaction

Ship `install-bridge-account.sh`, `render-bridge-key.py`, and
`sshd-jarvis-bridge.conf` together. The renderer accepts a single canonical OpenSSH
Ed25519 type/blob with an optional printable ASCII comment and terminal LF. It
checks canonical base64 and the complete SSH wire type/32-byte length, rejects
embedded options, control bytes, multiline/extra keys and oversized input, discards
comments, and emits only the fixed restrictions. It reads a bounded regular file
without following its final symlink. Validation completes before any mutation.

The installer is NOT transactional: account creation, authorized_keys replacement,
config installation, validation and reload are still sequential. A later failure can
leave partially changed files/account state; parent-directory trust and atomic
rollback integration are outstanding. Do not run it as a standalone v0.2 cutover.

A future authorized transaction must keep app commands disabled, snapshot existing
bridge policy/key metadata/service state, deploy BOTH restrictions together, stage
and validate effective sshd config, read back exact key options and files, then
activate the matching Hermes unit without interrupting unrelated SSH connections.
Verify both actual loopback listeners and synthetic readbacks, unauthorized-port and
nonloopback denial, authenticated session/local-forward denial and bad-key denial
before app command enablement. A timeout on idle `ssh -L` alone proves nothing:
exercise its direct-tcpip channel (e.g. `ssh -W`) and require administrative denial.
Failure must roll back the complete pair and service state, not widen policy.

UID egress remains the parent source definition: new outbound UID 10001 only to
127.0.0.1:3000/18642/18643, UID 10003 only to 127.0.0.1:8642/8647. Neither the unit
nor this document enables command mode or installs that policy.

## Disposable verification

`node --test deploy/bridge-security.test.mjs` checks the exact definitions and runs
installer behavior on a rewritten PRIVATE copy with all mutators mocked. It never
executes the original installer's absolute writes, useradd, sshd or reload commands.

`verify-bridge-isolated.py` is a manual privileged fixture, not installation tooling.
Run only in NEW network, mount and PID namespaces:

```bash
sudo -n unshare --mount --net --pid --fork --mount-proc -- \
  python3 deploy/verify-bridge-isolated.py \
  --parent-net "$(readlink /proc/self/ns/net)" \
  --parent-mnt "$(readlink /proc/self/ns/mnt)" --user "$(id -un)"
```

It refuses parent net/mount namespaces, makes mount propagation private, mounts a
private tmpfs over /run, and generates fresh fixture keys there. Network namespace
isolation alone does NOT isolate files/accounts. No useradd, installer, host nft or
host SSH reload is ever invoked. StrictModes remains enabled (world-writable /tmp
ancestors are unsuitable for authorized_keys); private /run avoids that failure.
It tests unchanged production Match User policy with `sshd -t/-T`, then substitutes
the current NSS user ONLY in its disposable config for actual authentication.
No account install or real jarvis-bridge account lifecycle is proven. Publickey
verification stays real, passwords disabled. Logs include positive synthetic
canaries and negative SSH replies; owned processes are reaped and fixture keys
removed, and anonymous namespaces disappear on exit. Full authenticated application
container chain, storage, transaction, final Sol exact-candidate review and release
acceptance remain parent work.
