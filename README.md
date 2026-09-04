# Jarvis Command

A private, Hermes-native browser/PWA command environment for Neal and Jarvis.

The product is deliberately **not** a generic Internet proxy for Hermes. The first release is a read-only command room: responsive shell, Cloudflare Access identity verification, sanitized Hermes health/capability/session summaries, and disabled future controls that do not pretend to work.

Durable product decisions live in the canonical Obsidian note `05 Coding Projects/Jarvis Command/Jarvis Command.md`.

## Workspace

- `apps/web` — React/Vite/PWA command interface
- `apps/server` — same-origin Fastify BFF and Cloudflare Access authorization boundary
- `apps/read-proxy` — loopback-only Hermes route allowlist with a separate read credential
- `packages/contracts` — shared strict Zod wire contracts
- `deploy` — hardened Compose and systemd definitions
- `docs/plans` — implementation plans

## Trust boundary

```text
Browser
  -> Cloudflare Access + Tunnel
  -> VM 113 loopback Fastify BFF
  -> reverse SSH forward on VM 113 loopback
  -> Hermes-host loopback read proxy
  -> official Hermes API on 127.0.0.1:8642
```

The reverse forward is intentional: VM 113 holds no SSH credential that can initiate a connection into the Hermes host. The BFF receives only the read-proxy credential. The read proxy holds the unrestricted Hermes API key on the Hermes host, accepts only three explicit `GET` routes, denies automatic `HEAD`, constrains session query parameters, injects the upstream key, limits response size, and emits generic failures. Browser DTOs omit message previews, email addresses, and persistent Access subjects.

The BFF verifies Access assertions from a read-only, file-backed JWKS cache refreshed atomically by a hardened host timer. It reloads the file for each assertion, so key rotation needs neither BFF Internet egress nor an application restart. Both containers use host networking only to reach loopback peers. Fixed non-root UIDs, nftables egress allowlists, read-only roots, dropped capabilities, resource ceilings, and a deployment guard that rejects anything except an exact local `sha256:` image ID constrain that exception. Docker restart policies are disabled. Egress-bound systemd units own recovery, restart with—and recover after—their nftables boundary, clean interrupted activation, and continuously fail closed if the verified container stops, changes identity, or becomes unhealthy.

Credential environment files are opened and copied from one validated, no-follow file descriptor. App artifacts and credentials move only through private unpredictable staging directories with checksums and signal-safe cleanup; no privileged install or executable cutover consumes a predictable shared `/tmp` source.

## Commands

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm audit --audit-level=high --omit=dev
```

Local development:

```bash
npm run dev
```

Production deployment and rollback are documented in `docs/deployment/v0.1.md`. Never commit deployment `.env` files, API keys, Access assertions, tunnel credentials, or SSH private keys.
