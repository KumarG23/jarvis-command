# App/read-proxy image packaging (local verification only)

Both Dockerfiles include every locked workspace manifest for `npm ci`, including
command-proxy, without copying unrelated application source. Only the selected
server production dependency closure is installed in the runtime stage. The BFF
build includes source-only contracts; the emitted server starts without workspace
links. Runtime application files are root-owned; the processes use 10001:10001
and 10002:10002. Application maps and package managers are excluded; locked
third-party dependency maps are permitted. Default production loopback settings
and authentication policy are unchanged. Health uses the configured port and a
four-second abort bound.

Run from this repository, choosing a NEW evidence directory:

    PATH=/home/neal/.local/bin:/usr/local/bin:/usr/bin:/bin \
      python3 deploy/verify-app-read-proxy-images.py --evidence /absolute/new/evidence

Use the heavy-job runner when launched from Hermes. The verifier builds from
extension/path-allowlisted temporary contexts, labels images with the SHA256 of
their sorted source-hash manifest, and runs immutable image IDs. Each container
has its own network-none namespace, no published ports, read-only rootfs, all
capabilities dropped, no-new-privileges, and explicit memory/CPU/PID limits.
Only a synthetic public RSA JWKS is mounted read-only for the BFF; no private key
is saved. No development authentication or real Hermes endpoint is used.

Evidence includes build logs, image/container inspections, runtime path and
package inventories, application artifact hashes, actual health/static-shell and
unauthenticated route results, immutable health-command execution, source
rechecks, and verified fixture cleanup. PASS and SUCCESS.json are written only
after cleanup succeeds. Evidence directories cannot be reused, preventing stale
success receipts. Images and unique local tags are retained for parent inspection.
The safety unit tests run through the normal packaging test glob.

This is NOT a full container-chain test or release approval. Commands are disabled
for this BFF packaging smoke. Read/command service topology, authenticated JWKS
acceptance, upstream calls, egress, audit mounts, restart/rollback integration,
public-browser acceptance and production cutover are separate gates. The prior
command-proxy verifier and its historical evidence are unchanged. Final exact
changed-candidate independent Sol review is still mandatory.
