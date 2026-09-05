# Durable command audit storage (source-only Deploy6)

The read-only v0.1 baseline remains unchanged: `app.compose.yaml` has no audit mount,
`app.env.example` explicitly sets `COMMAND_MODE=disabled`, and no command credential
is supplied. This slice does not enable commands, install anything, or authorize a
release. The future exact public origin is `https://command.sharma-house.com`;
the distinct command bridge is `http://127.0.0.1:18643` with a separately generated
command-proxy key, never the read key or unrestricted Hermes key.

## Provisioning contract

The approved future location is `/var/lib/jarvis-command/audit/events.jsonl`.
Every ancestor through `/` must be root:root, with no group/world write or special
mode bits. The already provisioned `/var/lib/jarvis-command` is the explicit trusted
root. The helper never creates that root. The `audit` leaf is exactly
10001:10001 mode 0700; `events.jsonl` is a single-link regular file, exactly
10001:10001 mode 0600. Do not mount the entire privileged parent.

With the app stopped and after separate deployment authorization, the future
operator invokes `python3 deploy/prepare-audit-storage.py prepare --trusted-root
/var/lib/jarvis-command --path /var/lib/jarvis-command/audit/events.jsonl` as root,
then repeats with `verify`. These commands are documentation, not executed host
provisioning. The helper opens every component with descriptor-relative no-follow
operations, bounds file reads to 16 MiB, syncs new objects and parent directories,
and checks descriptor/path identity on readback. Existing bytes, inode, ownership
and modes are never repaired, replaced, truncated, chmodded or chowned. Interrupted
creation can leave an invalid new object: fail closed and investigate, never force
it green. Stop all writers while preparing/verifying; do not run concurrent helper
instances. This is not a transactional installer or a lock against privileged
host administrators. The helper validates storage metadata and returns a digest;
the emitted application validates the ledger schema, hash chain and run mappings.

`app-command-storage.compose.yaml` is a storage-only override: a narrow persistent
read-write directory bind for the app alone, long syntax with
`create_host_path: false`. Missing sources must be rejected, not created by Docker.
JWKS, public association files, application code and the root filesystem remain
read-only. No command proxy or other service receives audit access. This mount is
neither tmpfs nor the container writable layer.

The old `validated-compose-up.sh` and its app/read-proxy/command-proxy CLI remain
unchanged. The dedicated opt-in source launcher `supervised-command-app.py` accepts
only `[--monitor|--cleanup]` and a systemd-supplied 32-hex `INVOCATION_ID`;
the eventual installed invocation is exactly
`/usr/local/libexec/jarvis-command-supervised-command-app --monitor`.
It fixes the Compose set to `/srv/jarvis-command/compose.yaml` plus
`/srv/jarvis-command/app-command-storage.compose.yaml`, project
`jarvis-command-supervised-<fresh random 32-hex token>`, release metadata `/etc/jarvis-command/release.env`,
and app environment `/etc/jarvis-command/app.env`. Ambient COMPOSE_* inputs and
additional arguments are rejected. The storage override body must match the exact
narrow reviewed definition (comments/blank lines may vary). Effective JSON is
captured privately in memory, never logged; literal, unique KEY=value environment
entries only, no shell/dotenv expansion, quoting or evaluation. Installed inputs
and their ancestors must be trusted root-owned non-writable-by-others paths;
environment files are single-link mode 0600, descriptor-opened without symlinks.

Before any start it refuses ANY existing fixed-name container (running or stopped)
without adopting, stopping or deleting it, and executes only
`/usr/local/libexec/jarvis-command-prepare-audit-storage verify --trusted-root
/var/lib/jarvis-command --path /var/lib/jarvis-command/audit/events.jsonl`.
It never invokes prepare, repairs metadata, or replaces a missing ledger. The
future transaction must serialize launches/config writes, stop and quiesce ALL
writers, install trusted helper/launcher/config bytes, explicitly prepare initial
storage once, and install the opt-in `jarvis-command-app-command-storage.conf`
drop-in only after approval. The helper is metadata-only; the app validates the
chain. Existing v0.1 install/release/cutover scripts are NOT that transaction.

Before CREATE, the effective Compose allowlist enforces the production host-network
UID policy, capabilities, security options, exact resource/tmpfs/FD limits and
immutable process inheritance. Normalized null command/entrypoint and numeric
Compose values are supported; escape siblings and process/health overrides refuse.
After CREATE and durable owned-ID persistence, actual hardening, networks, mounts
and image process metadata are checked BEFORE START. Entrypoint, Cmd, working
directory and healthcheck must equal local immutable image inspection; environment
must equal image defaults overlaid only by the exact app environment. The same
static checks run during every starting-health poll (without accepting READY until
healthy), before READY, and throughout monitoring.
Monitoring checks those same identities and source bytes, not just Compose text.
It never runs the quiescent ledger helper against the active writer. systemd READY
means liveness plus validated configuration, NOT ongoing command readiness.
The app remains runtime ledger integrity/admission authority. This supervisor is
NOT ready for installation. No manual production Compose bypass.

The source drop-in provisions root-owned mode-0700 persistent
`/var/lib/jarvis-command-supervisor` (never mounted into the app). A no-follow,
single-link mode-0600 empty `lock` uses nonblocking flock before any helper or
Compose operation. The lock spans monitoring/cleanup and is CLOEXEC, never passed
to children. A competing invocation refuses without cleanup. Host root/config
writers are outside this cooperative lock; the transaction still excludes them.

The bounded, strict-schema mode-0600 `ownership.json` records systemd invocation,
fresh random project token, immutable image and initially null container ID. Writes
use exclusive `ownership.next`, fsync, rename and directory fsync. Compose CREATE
only runs after this intent is durable; it cannot start a command-capable writer.
Discovery must match the fresh project token, service, image and full container ID.
The exact ID is durably saved BEFORE `docker start <ID>`. Monitoring and cleanup
inspect that ID, never fall back to the name, and recheck token/image/ID. Existing
stopped containers are left for the separately authorized transaction to remove.

ExecStopPost invokes `--cleanup` under the same systemd INVOCATION_ID and lock.
Missing record is a no-op; malformed, unsafe, foreign-invocation or identity-mismatch
records refuse without a stop. Stop failure retains the record and returns failure.
Successful stop is not finality: cleanup re-verifies the exact ID, then removes it
with `docker rm --force <ID>` (no volume removal). A successful full-ID daemon
listing must prove absence before clearing/syncing ownership. Inspect failure is
never interpreted as absence. An already deleted durable ID can be acknowledged
by that same successful listing on repeated same-invocation cleanup. Removal or
daemon failure retains ownership. A late start after stop does not bypass removal.
One-shot success
retains the record and requires same-invocation cleanup; it is not an install path.

Crash recovery with a null ID queries ONLY the fresh project token. Exactly one
candidate must verify token/service/image/full ID and stopped state before its ID
is persisted and removed. No fixed-name fallback or adoption is permitted. Empty
or ambiguous discovery retains intent: inflight create may still materialize.
This unresolved window is BLOCKING, not fully cleaned or restartable.

After authenticating committed same-invocation ownership under the lock, cleanup
discards a partial `ownership.next` only through a no-follow, bounded, trusted,
single-link mode-0600 descriptor and matching path identity. It never promotes
uncommitted bytes. A partial write without valid committed ownership remains an
operator-reconciliation blocker. Host root writers remain outside this lock.

The lifecycle repair has private stateful launcher/subprocess evidence, including
SIGKILL and delayed-start injection. Parent verification subsequently exercised a
real disposable Docker/Type=notify lifecycle with a synthetic helper/payload in
an executable private /var/lib fixture (/run is noexec). This is not an authenticated
app chain. See deploy-6-lifecycle/PARENT-VERIFICATION.json and parent-runtime.
The hardening slice records real sanitized Compose output and immutable app-image
CREATED metadata, never STARTED, with network none and private bind sources.
Pure validator tests explicitly map fixture sources and expected network policy;
production remains host-network-only. Launcher refusal/drift tests use mock Docker.
Host power loss/daemon recovery, ambiguous create and failed-cleanup intervention
remain release blockers. No production acceptance or release completion is claimed.

The repair preserves NOTIFY_SOCKET only for the fixed notifier; Docker/helper
environments remain scrubbed. Real systemd notification/barrier and sanitized
Compose-only merge evidence are recorded in deploy-6-repair, not proof of a live
installed launcher. Timeout cleanup kills the unreaped child's private process
group and bounds pipe draining; deliberately escaped process groups are outside
that teardown guarantee. Final independent review is still mandatory.

Private mock tests exercise launcher behavior only; they never call real Docker.
A separate sanitized fixture checks real Compose merge without starting anything.
Deploy5 actual-image/JWT/storage/replacement evidence remains applicable and is
not replaced by mocked claims. Full proxy/container/browser and installed supervisor
restart acceptance remain outstanding. No host files/services were installed.

## Docker OOM metadata contract

The installed Docker 29.7.2 / API 1.55 daemon uses Linux cgroup v2 and reports
`OomKillDisable: false` in `docker info` (capability unsupported, not container
configuration). Upstream Moby commit `6a43e3d` explains the observed CREATE=false
to START=null transition:

- [daemon_unix.go](https://github.com/moby/moby/blob/6a43e3d/daemon/daemon_unix.go#L366-L369)
  defaults the CREATE pointer to false. Its resource verification at lines 447–453
  clears that pointer when the capability is unsupported.
- [start.go](https://github.com/moby/moby/blob/6a43e3d/daemon/start.go#L63-L69)
  reruns container settings verification at START.
- [cgroup2_linux.go](https://github.com/moby/moby/blob/6a43e3d/pkg/sysinfo/cgroup2_linux.go#L83-L87)
  explicitly reports OOM-killer disabling unsupported on cgroup v2.

The supervisor still requires literal false before START. Post-START null is
accepted only when a fresh bounded query to the same scrubbed Docker endpoint
reports exact `OSType=linux`, `CgroupVersion="2"`, `OomKillDisable=false`.
Every null-bearing health/READY/monitor check requalifies that platform; absent
keys, true, malformed values and mismatched/unknown platforms fail closed.
Literal false remains valid. No other HostConfig field is normalized.

The isolated supervised-app harness passed with the unchanged source-bound app
image: health/READY, missing/invalid JWT with zero upstream mutations, durable
authenticated admission, SIGKILL/ExecStopPost, second invocation replay with the
same publicRunId and ledger inode and one total upstream admission, normal second
cleanup, damaged admission and corrupt/missing startup denial. It also exercised
live CREATED resource mismatch and unsafe effective Compose refusal. Exact owned
container, unit, PID and private fixture absence was read back. Evidence is under
`deploy-6-oom-contract/live-1` in the parent evidence directory. This is a real app
with a synthetic isolated bridge, not production/proxy/browser acceptance or an
independent approval. The verifier itself was unchanged for this run.

## Capacity, backups and rollback

The existing ledger has a 16 MiB maximum. Admission fails closed at saturation;
monitor capacity and arrange operator intervention BEFORE it fills. No blind
logrotate, truncation, deletion, or ad-hoc compaction. A valid prefix is not proof
that it is the latest ledger. The hash chain alone cannot detect rollback to an
older valid prefix.

Although prompts, outputs and credentials are excluded, actor fingerprints,
session/run identifiers, timing and actions are sensitive operational metadata.
Keep backups private, encrypted, access-controlled and integrity-checked; preserve
ownership/modes and capture a quiescent latest ledger. Retention and future
migration require explicit review of replay/idempotency semantics.

Application rollback MUST retain the latest durable ledger. Never overwrite it
with the app release's old snapshot: stale mappings can re-admit completed actions.
If an older app cannot safely read the current ledger, keep commands disabled and
reconcile; do not downgrade the ledger to make startup pass. Corruption likewise
requires trusted reconciliation, not automatic restoration/truncation.

## Local verification and remaining gates

`node --test deploy/audit-storage.test.mjs` exercises source contracts and root-only
private `/run/jc-audit-test-*` fixtures; passwordless sudo is a local test prerequisite.
It does not touch host `/var/lib/jarvis-command`, accounts, firewall or services.
`verify-audit-storage-image.py --parent-image-evidence <deploy2-image-evidence>
--evidence <new-private-evidence-directory>` runs as root solely for disposable
fixture ownership and cleanup. It refuses stale image inputs rather than silently
rebuilding/installing. Rebuild using the existing allowlisted app/read image verifier
if inputs change. Its synthetic JWT/bridge fixture runs in `--network none`; the
actual app shares only that isolated container network namespace. No published
ports or host networking. Docker runs host-side, so no `unshare net` assumptions.

The app uses its unchanged emitted production entrypoint, real JWT verification,
real HTTP client and existing ledger. The bridge is synthetic, not the actual
command proxy or Hermes; this is NOT the full proxy/container/browser chain. Local
evidence records image/mount identity, replacement/restart mapping, duplicate
admission counts, permission denial, corruption/missing-bind startup denial, and
cleanup. Liveness `/api/health` is not command readiness: a live ledger permission
fault denies authenticated mutations, whereas corrupt startup exits entirely.

Remaining: transactional v0.2 Compose/environment/helper integration; real proxy
and authenticated browser container chain; capacity/recovery operating procedure;
complete exact-candidate Sol review; deployed hash match; public Access positive
and negative paths; desktop/mobile browser/network/console acceptance; host egress,
loopback isolation and reboot/restart recovery; canonical vault update/push under
release authorization. No independent deployment approval exists for this slice.
