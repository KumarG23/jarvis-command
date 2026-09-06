# Access callback / installed PWA recovery

Status: local candidate only. Base `6a7db872f8a6c8c14fab2901f1132720a4420674`, branch `fix/access-callback-recovery`. No deployment, credentials, live configuration, or real user authentication was exercised. Independent full-candidate Sol review and real user login acceptance remain required.

## Root cause and minimal change

The approved built Workbox worker excludes `/api` from SPA navigation fallback but not Cloudflare's `/cdn-cgi` namespace. With an installed controller, a local callback navigation (including login/logout siblings) receives the precached `index.html` without reaching the network. Origin health/no-error logs cannot detect an edge request that never arrives. This reproduces the reported failure mechanism, not a capture of the user's actual callback.

The candidate reserves both exact namespaces with pathname boundaries (slash, query separator or end; `/cdn-cgi-extra` and `/apiculture` remain ordinary app routes). No JWT, approved identity, Access, or MFA controls change.

The failure UI distinguishes sign-in required, denied access, connection failure, service failure, and invalid bootstrap schema. It never displays response bodies or exception details. Bootstrap redirects are not followed inside fetch. The explicit `Sign in again` button unregisters only the same-origin root `/sw.js` registration and then replaces the top-level location with fixed `/api/auth/recover`. It does not clear pending-work storage or unrelated caches. This protected API entry validates the existing Access assertion and issues a no-store 303 to `/`, ignoring caller-selected return targets. No Hermes call is made by that entry.

Unregister is important: merely navigating the old worker's excluded `/api` route can still return to an intercepted edge callback. Browser tests prove unregister followed by top-level navigation escapes that old controller even while new worker downloads are denied. An app shell accidentally executed on an edge pathname strips query/fragment/history state to `/` before React mounts or bootstrap runs, and shows recovery rather than the Command room. It never replays a callback URL.

## One-time user recovery / honest limitations

New JavaScript cannot repair an old cached shell that cannot fetch new bytes behind expired Access. The regression deliberately distinguishes:

1. Old shell and old worker trapping a local callback.
2. New worker fetched byte-for-byte from the candidate, activated, and subsequent callbacks reaching the local network.
3. Current recovery UI supplied by a TEST-ONLY network shell while the OLD controller remains active and worker update requests are blocked. Clicking recovery escapes. `/api/local-current-shell` exists only in the local fixture, never in the BFF.
4. Old worker serving the current shell at a callback: current code discards the sensitive location and suppresses bootstrap.

Until new bytes are reachable, use a fresh Incognito window and type the site root, then authenticate normally. For the installed Chrome/PWA profile: close all Command tabs/windows, clear storage/site data for this site only in Chrome's site settings, then open the site root and authenticate again. Clearing site data removes cookies/offline files and locally saved pending-work identifiers; do not blindly resend uncertain previous commands. Incognito does not repair the installed profile. If multiple tabs re-register the worker or browser unregister is refused, close the other tabs and use this manual remedy. Never copy, screenshot, log, replay, or share the callback query. Do not navigate back to it.

## Local verification

Evidence lives outside the candidate at `/home/neal/backups/jarvis-command/access-callback-repair/`; `IMPLEMENTATION-RESULT.json` is the exact receipt. `red-routing.log` shows both viewport failures against the built base. Subsequent RED/GREEN receipts cover the recovery entry/button, failure classification and callback-location guard. `base-web-dist` is the preserved approved-source build, not modified legacy WIP.

With explicit Node22 PATH, first build the current web app, then run:

    ACCESS_OLD_WEB_DIST=/absolute/preserved/base-web-dist npx playwright test -c e2e/access-callback.config.ts

The fixture binds a random loopback port, uses real HTTP and real installed built workers (no Playwright navigation interception), and stores pathname-only network observations. Use only harmless local callback values. Supply the old build for upgrade/recovery gates; without it those tests explicitly skip and are not upgrade evidence. Build an old artifact from the exact base in an isolated directory if regenerating evidence; never inspect/reuse another WIP lane.

Full gates: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` with the old-artifact variable. The separate `e2e/integration.config.ts` suite uses synthetic local upstream/JWT fixtures, not real Cloudflare or Hermes acceptance. Record its result separately. Existing suite skips and Node experimental warnings are not callback regression failures.

## Proposed reviewed app-only operation — NOT executed

Read [single-user-v0.2.md](single-user-v0.2.md) for fixed host custody, immutable identity, supervisor/storage and public acceptance requirements, and [app-read-proxy-packaging.md](app-read-proxy-packaging.md) for image provenance. Do NOT rerun the original v0.2 installer, the parked transactional lane, or its rollback for this frontend/BFF image-only fix. Do not rebuild/restart the command or read proxy.

After complete exact-candidate Sol approval and an authorized maintenance window:

1. Recheck reviewed full source manifest plus the app image's source map/immutable ID. Save and hash that exact local image archive; transfer it to fresh private staging on the existing app host. Load and read back the exact image ID. No rebuild on the destination.
2. Privately capture the existing app image ID and `/etc/jarvis-command/release.env` bytes/owner/mode, active unit/drop-in/supervisor and Compose hashes, mount inventory, audit metadata, enablement, health and loopback listeners. Save the old immutable app image for rollback. Do not log environment values or touch retained prior stage/backup roots. Confirm no in-flight consequential work.
3. Stop only `jarvis-command-app.service`. Preserve the existing release environment's every other value, replacing only `JARVIS_COMMAND_APP_IMAGE` with the reviewed new immutable ID, retaining its original ownership/mode via private atomic replacement. Read back exact changed intent without printing credentials. Start only the app service through its EXISTING reviewed storage supervisor. No daemon reload is needed because unit/helper/Compose bytes do not change.
4. Verify active/healthy status, actual container image ID, artifact hashes (including built `sw.js` and shell), unchanged service configuration/mounts/audit, and loopback-only listener. Confirm unchanged unauthenticated Access gate. Have Neal test normal login and the previously affected installed profile using the remedy above at desktop/phone widths; inspect console/network without retaining callback material. Do not declare authenticated success until Neal reaches the real Command room. No real Hermes task is needed to accept this login repair.
5. If startup, identity or login regresses: stop only the app, restore the exact saved release environment, start through the existing supervisor with the previous immutable image, and read back image/health/configuration/listener equality. Keep the audit ledger and pending work intact. Server rollback cannot restore a browser worker already unregistered/updated; old bytes reintroduce the callback bug, so the manual clean-profile remedy may still be necessary. Preserve evidence and report rollback limits.

These are proposed operator steps for review, not a tested production cutover or authorization to mutate production. Canonical vault updates/push and authenticated public acceptance belong to the parent release lane.
