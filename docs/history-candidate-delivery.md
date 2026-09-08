# Isolated candidate delivery — 2026-09-08

## Delivered scope

Source checkpoints only; no production merge/replacement or public candidate deployment.
Frontend source remains `635efbd2c4a2f5dc3511115c9f68ab10d1012e4a`.
Runtime source checkpoint: `f4ea2ac32e2dbc3820ea1b3e0a7e32f8ade7a275`, local branch `integration/persisted-history-binding`.
Command implementation, tests, launchers and the acceptance reports are checkpointed together on `integration/chat-first-history-binding`; obtain its exact checkpoint with `git rev-parse HEAD` at delivery (the final operator report records the hash).

Runtime remotes were inspected: `origin` is NousResearch/hermes-agent, `fork` is KumarG23/hermes-agent. This branch has no configured tracking/push provenance. Runtime was therefore committed locally only; no upstream or fork push was attempted. Command's existing remote integration branch was verified at `67702cf32dd83228eea823dbff2c28bf86b7e9ac` before the authorized fast-forward push.

All changed/untracked paths in both candidate worktrees were inventoried and inspected; they belong to the documented history-binding, sandbox, attended-approval and acceptance work. No runtime state, browser assertions, auth files, provider tokens, fixture contents or generated credential files are committed. Non-working test-only key constants remain in regression tests. No other worktree was changed.

## Acceptance evidence consumed and completed

`history-candidate-attended-acceptance.md` is the latest independent scoped review and genuine browser approve-once/deny result; earlier blocked reports remain historical evidence, not the current verdict. Previously successful 241 focused runtime tests, four receipt/boundary tests, eight real-Docker lifecycle cases, browser active reload, metadata/BFF restart and applicable typechecks were consumed without repeating broad gates.

Completed the missing full runtime-process restart check: started the same previously stopped `jc-history-candidate-runtime` with the reviewed source and original candidate home. Authenticated BFF readback after restart exactly matched both previously recorded complete run statuses, the full authoritative history, legacy status shape and fixture effects:

- `jcr_66d01ad5d37a7ace6877f3bf46c9bf9e`: user `15`, assistant `18`, completed, approval null, approved directory absent.
- `jcr_fe26797bf600940a89e863a77b70b815`: user `19`, assistant `22`, completed, approval null, denied directory retained.
- Both retain session `jc_3bde5abdb8244baba51518f8851ff6ef`.
- The actual configured `candidate_fixture` terminal handler returned `restart-sandbox-ok`, exit 0, after asserting no control auth, API key, broker socket or Docker socket inside the command sandbox. No new model run or approval admission was made.

Private evidence: `/home/neal/code/jarvis-command-candidate-state/delivery-runtime-restart.json`, plus existing `approval-final-readback.json`, `approval-acceptance.json`, `browser-acceptance.json`, `metadata-acceptance.json` and `post-bff-restart-status.json`. One harmless import probe initially used an underscore module name for a hyphenated script and failed; the successful readback loaded the actual file with `runpy`, with no replay.

Afterward runtime verified `Running=false`, PID 0, restart `no`; owned broker `hermes-heavy-20260908-175503-3669865.service` verified inactive/PID 0. Broker socket/quarantine latch and all tool containers absent. Existing BFF `hermes-heavy-20260908-171012-3614494.service` remains unchanged. No production policy/config/firewall changes, provider calls or fallback.

## Runnable local artifact

- Frontend directory: `/home/neal/code/jarvis-command-integration/apps/web/dist` (preview base `/api/preview/chat-first/`, no candidate service worker). All 15 files were fetched through the authenticated local BFF and matched exact disk SHA-256 values; restart bootstrap was online.
- Portable frontend archive: `/home/neal/code/jarvis-command-candidate-state/history-candidate-frontend.tar.gz`, SHA-256 `ff6f48fb1b5289c5d7af963ac00956c7ed54ebf5ca4dcedfc86df6b7a290b709`. Only compiled static files, no state/credentials. Final shutdown evidence is `delivery-cleanup.json`.
- Main JS: `assets/index-BGnjRguv.js`, SHA-256 `135039c7367e93a351080d311848549870307d3fb795dbb3d20dc25b6e9822d2`.
- Index SHA-256: `efcb0fd78178da6439a115cbbb651f62e3795cc58a2dd75b444bd8e040087acd`.
- Sorted compact JSON artifact-map SHA-256: `7d3438eaf498f91bcdfb10eb7fc741e030d6b855d0c1845c4fd4bf8e8961861f`; full map in private `delivery-artifact-hashes.json`.
- Existing pinned interpreter image: `sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038`. Runtime source is a read-only bind, not baked into that image.
- Local-only URL: `http://127.0.0.1:18744/api/preview/chat-first/`. The BFF uses a local signed fixture identity, not real Access. Never forward this listener publicly.

To resume the already-approved fixture runtime from the Command worktree, start `/usr/local/bin/hermes-heavy-run -- /usr/bin/python3 scripts/candidate-fixture-broker.py`, record the new exact service handle, verify its socket and absent quarantine, then `docker start jc-history-candidate-runtime`. Use the existing BFF; do not rerun completed admission harnesses. If the BFF is stopped later, its local-only launcher is `/home/neal/.local/bin/node --import tsx e2e/history-candidate-stack.ts` under the heavy runner. This regenerates only the local fixture JWT, never an edge credential. Runtime manual approvals, terminal-only toolset, Astra/Codex and no fallback must remain exact.

## Read-only public infrastructure findings

VM113's live `/etc/cloudflared/config.yml` has exactly the existing `command.sharma-house.com` preview-path route to `127.0.0.1:3001`, the remaining hostname route to `127.0.0.1:3000`, then HTTP 404. The tunnel is active; `jarvis-command-preview.service` is active and explicitly describes the existing-backend preview. No candidate origin listener/route is configured there. Both user/root account-scoped Cloudflare certificates are absent. Only the tunnel-specific credential exists; its bytes were not read/copied. Public auth settings confirm team `nealflix.cloudflareaccess.com` and the existing approved-identity hash. Cloudflare dashboard/application inventory and MFA effective state were not freshly inspected; a production Access configuration is not proof of a new candidate application.

The old public URL `https://command.sharma-house.com/api/preview/chat-first/` still shares production absolute `/api`; it cannot activate this BFF without changing production. Do not use Referer routing, the existing static route, or an edge tunnel directly to local fixture-JWT port 18744.

## Smallest proposed protected endpoint — NOT APPLIED

Proposed URL: `https://candidate-command.sharma-house.com/api/preview/chat-first/`.
Use a separate candidate-only tunnel on the candidate host, not a change to VM113's production tunnel/SSH bridges/firewall. Provision a self-hosted Access application for exactly `candidate-command.sharma-house.com` first. Allow only the same individually approved Neal identity as production, require application-specific independent MFA, no Bypass/Everyone/wildcards, no global policy changes. Verify effective Access policy in the dashboard before adding DNS or ingress. Obtain that application's real audience; do not reuse the production audience or local test signer.

Proposed dedicated connector configuration (values in angle brackets require authorized Cloudflare provisioning; not deployable defaults):

```yaml
tunnel: <NEW_CANDIDATE_TUNNEL_UUID>
credentials-file: /etc/jarvis-command-candidate/cloudflared.json
no-autoupdate: true
ingress:
  - hostname: candidate-command.sharma-house.com
    service: http://127.0.0.1:18745
    originRequest:
      connectTimeout: 10s
      httpHostHeader: candidate-command.sharma-house.com
  - service: http_status:404
```

Use a separate production-mode candidate BFF on loopback 18745, preserving the compiled preview static prefix and absolute `/api` within this distinct origin. It must not run `history-candidate-stack.ts`'s local JWT generator. Proposed nonsecret BFF config:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=18745
AUTH_MODE=cloudflare
CF_ACCESS_TEAM_DOMAIN=nealflix.cloudflareaccess.com
CF_ACCESS_AUD=<NEW_CANDIDATE_ACCESS_APPLICATION_AUDIENCE>
CF_ACCESS_EMAIL_SHA256=432856cfc61485cf2aa5541935a11cc288fcefb6fcb884b09e66745926772995
CF_ACCESS_JWKS_FILE=/var/lib/jarvis-command-candidate/cloudflare-jwks/certs.json
PUBLIC_ORIGIN=https://candidate-command.sharma-house.com
HERMES_API_BASE_URL=http://127.0.0.1:18742
HERMES_COMMAND_API_BASE_URL=http://127.0.0.1:18743
COMMAND_MODE=enabled
COMMAND_AUDIT_LOG_PATH=/home/neal/code/jarvis-command-candidate-state/public-bff/audit.jsonl
WEB_DIST_DIR=/home/neal/code/jarvis-command-integration/apps/web/dist
```

`HERMES_READ_PROXY_KEY` and `HERMES_COMMAND_PROXY_KEY` must come from candidate-only private service credential files, remain distinct and match the candidate proxies. Current local launcher holds these randomly generated keys only in memory; do not extract process environments or copy production files. A scoped candidate launcher delta must persist/provision those keys and start the dedicated BFF with real JWKS validation, not fixture signing. Keep separate public-candidate audit/project storage; never share the production audit or use local fixture-owner records as real identity authorization. Runtime/broker and command sandbox remain the reviewed fixture-only boundary. Only public signing keys may be fetched; no production credential file belongs in the web root or command sandbox.

Concrete blocker: there is no verified candidate Access application/audience, candidate tunnel credential/route, or real-Access candidate BFF launcher. Establishing these is a new public trust/routing boundary requiring scoped review and authorized provisioning, not permission to reuse the existing production route or expose the local fixture signer. Nothing in this proposal was installed. Following that scoped delta, require real user-visible Access/MFA, unauthorized denial, exact public asset/API identity, local-test-JWT rejection, and fixture-only manual command acceptance before reporting a public candidate live.
