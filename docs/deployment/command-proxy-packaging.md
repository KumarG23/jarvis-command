# Command-proxy local packaging verification

This is deployment integration slice 1, not a production release or approval. It changes no Compose, systemd, firewall, tunnel, SSH, or live configuration.

## Reproduce

From the repository root, use Node 22.22.3 explicitly in the heavy runner and an unused evidence directory:

```sh
/usr/local/bin/hermes-heavy-run -- /usr/bin/env PATH=/home/neal/.local/bin:/usr/local/bin:/usr/bin:/bin node --test deploy/command-proxy-process.test.mjs deploy/command-proxy-packaging.test.mjs
/usr/local/bin/hermes-heavy-run -- /usr/bin/env PATH=/home/neal/.local/bin:/usr/local/bin:/usr/bin:/bin python3 deploy/verify-command-proxy-image.py --evidence /absolute/path/to/new-evidence
```

The process tests rebuild and execute the emitted ESM entrypoint, not TypeScript via a loader. They use synthetic credentials, ephemeral loopback sockets, and a synthetic SSE upstream. Both SIGTERM and SIGINT must exit normally with code zero, reclaim both SSE transports, and finish within 2.5 seconds after signalling. Occupied-port and invalid-configuration startup must exit one without raw configuration/error details. Existing proxy SSE lifecycle tests separately exercise cancellation, stalled readers, stream-slot reclamation, and app.close.

The image verifier sends an allowlisted temporary build context: the root lock/manifests, every workspace manifest, proxy build configuration/source, and contracts source. No working-tree-wide copy or credential file is sent. It builds the pinned Node 22.22.3 base into a unique local tag, records source SHA256s and the resulting immutable image ID, then runs exactly that ID. The only application runtime payloads are the bundled entrypoint (contracts included) and separately installed production dependencies. Application source maps, sibling applications, workspace links, npm/yarn/Corepack, and build tooling are excluded from runtime. Third-party source maps shipped in locked production dependency tarballs are retained; the inventory probe distinguishes these from application maps and still excludes environment files across the entire payload.

The disposable container has a fresh network-none namespace, read-only filesystem, no mounts or published ports, dropped capabilities, no-new-privileges, and CPU/memory/PID limits. All probes execute inside that namespace. A random high test port is unoccupied because this newly created namespace has no other process/listener. The runtime image requires an explicit PORT; it intentionally does not choose the real command-proxy listener. The existing source default is unchanged. A synthetic unavailable loopback upstream is sufficient for unauthenticated protected-route denial; the process tests supply the actual synthetic SSE upstream.

The verifier records image/container inspect, UID/GID 10003, runtime file/package inventory, loopback listener, effective security restrictions, health, protected-route denial under NODE_ENV=production, normal SIGTERM container exit, and exact-name cleanup. It retains the built image/tag for the parent. It does not prune images, stop other containers, or create a Docker network. On failure inspect the recorded logs; do not call a partial build a pass. Use a new evidence directory for retries so earlier failure evidence is preserved.

## Limits and next gates

Container liveness is not proof of host firewall/egress policy, reverse-forward restrictions, Cloudflare Access/JWKS, durable upstream idempotency, live Hermes acceptance, production restart/reboot recovery, or browser behavior. Network-none is fixture isolation, not the deployment topology.

The proposed source-default port 8644 can conflict with Hermes webhooks. Real listener preflight, production port selection, packaging integration into system services, reverse tunnel, audit storage, rollback, and production acceptance remain separate authorized work. Existing app/read-proxy Dockerfiles are outside this slice and still need complete workspace-input inspection before their later v0.2 builds.

Any source amendment invalidates the earlier candidate approval. The parent must run final gates and obtain fresh independent review of the complete exact candidate; no deploy/commit/push is authorized by this note.
