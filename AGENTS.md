# Jarvis Command Engineering Policy

## Proportionate engineering — current 2026-09-08

Build first. Validate proportionately. Classify the CHANGE, not the repository. Follow the risk tiers in `/home/neal/AGENTS.md` and `subagent-driven-development`.

One capable implementation owner is the default. Ordinary UI/features/refactors/fixes use relevant inspection, coherent implementation, focused tests, applicable typecheck/lint/build and concise self-review. Stop when the requested result is delivered; no automatic independent reviewer, full suite, repository reread, whole-candidate approval or evidence package.

Contained backend/schema/integration/downtime risk merits stronger self-review and relevant regression checks. Changed auth/MFA/authorization/credentials, privilege/network boundaries, destructive/data-loss operations or consequential command permissions should get scoped independent review. Name the concrete failure risk before escalating source reading, tests, reasoning or delegation. Sol review is an escalation mechanism, not a release stage; no automatic Astra+Sol/high-max pairing.

Reuse successful unchanged worker tests. No parent re-running gates or auditing reviewer read receipts without a concrete reliability concern. Repairs require checking changed behavior and affected interactions, not renewed entire-candidate certification. Preserve all WIP and explicit authorization restrictions. Retired-provider and no-silent-engineering-fallback decisions remain.

## Product boundary

Jarvis Command is a Hermes-native browser/PWA command environment, not a cosmetic Discord clone. Jarvis Prime and the existing Hermes gateway remain the canonical brain, session store, tools, skills, and memory authority. Do not create a second drifting Jarvis instance.

The canonical product note is:

`/home/neal/obsidian-vault/05 Coding Projects/Jarvis Command/Jarvis Command.md`

Read it before architecture or scope changes.

## Engineering rules

- Read before editing. Keep diffs scoped.
- Test changed behavior; use a failing regression test for reproducible bugs when practical.
- Prefer vertical tracer bullets over horizontal scaffolding sprawl.
- Browser clients never receive Hermes bearer credentials, Cloudflare tunnel credentials, model-provider credentials, or unrestricted proxy access.
- The BFF exposes explicit, narrow operations; never ship a generic pass-through proxy to Hermes.
- Cloudflare Access is an outer gate. The BFF must validate Access JWT signature, issuer, audience, expiry, and approved identity before protected API work.
- Consequential commands need explicit approval, complete target/payload visibility, audit records, and server-side authorization.
- Never expose the Hermes API listener or application origin directly to the LAN or Internet. Use the dedicated restricted server-to-server path.
- Preserve Hermes prompt caching and session continuity. Use stable public Hermes API contracts; do not scrape private files or mutate the Hermes database.
- Treat tool calls, approvals, artifacts, tasks, and memory as typed events—not decorative chat strings.
- Mobile is a focused supervision/chat surface; desktop owns the dense multi-pane command center.
- No fake success data in production. Sample/demo data must be visibly labeled and isolated from live paths.
- No secrets in source control, logs, browser storage, screenshots, or chat.

## Deployment and completion

For a prepared committed build: verify requested commit/artifact/version and provenance, establish rollback, deploy through the existing recoverable path, smoke-test affected service/UI behavior and report. Source review is warranted only for uncertain provenance, a new security concern, deployment trust-boundary changes or explicit user request.

Preserve Access/MFA, server-side authorization and identity, credential isolation, narrow proxies, network restrictions, consequential approval/audit and restart/rollback protections. Exercise changed UI at relevant desktop/mobile widths; repeat broader auth/lifecycle checks only for changed boundaries or a concrete concern. No mandatory full suite or exact-candidate independent release review. Record built/deployed/verified status truthfully and keep current documentation short; historical evidence does not govern future work.
