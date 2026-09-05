# Jarvis Command Engineering Policy

## Ownership

GPT-6 Astra at high reasoning effort owns this project’s architecture and implementation. GPT-5.6 Sol at high effort independently reviews the complete final candidate. Generic engineering delegation is the Sol read-only review lane; use a fresh explicitly selected Astra/high session if implementation needs a separate worker. No routine xhigh/max/ultra and no silent fallback on quota failure. The Astra lead remains responsible for the complete tracked/untracked diff, integration, and real verification evidence.

Use one implementer followed by one finite read-only independent reviewer, concise file-backed handoffs, fresh milestone sessions, focused TDD during implementation, and scripted final gates. Follow the `subagent-driven-development` skill’s `references/efficient-engineering.md`. Preserve every WIP path; reducing orchestration never reduces security or exact-candidate review requirements.

Terra is retired and must not be assigned implementation, review, reconnaissance, tests, documentation, cron, memory, or auxiliary work. Grok may be used only for source-grounded freshness research or fallback work; Luna only for low-risk non-building utilities.

## Product boundary

Jarvis Command is a Hermes-native browser/PWA command environment, not a cosmetic Discord clone. Jarvis Prime and the existing Hermes gateway remain the canonical brain, session store, tools, skills, and memory authority. Do not create a second drifting Jarvis instance.

The canonical product note is:

`/home/neal/obsidian-vault/05 Coding Projects/Jarvis Command/Jarvis Command.md`

Read it before architecture or scope changes.

## Engineering rules

- Read before editing. Keep diffs scoped.
- Use strict RED → GREEN → REFACTOR for production behavior.
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

## Release gates

A release is not complete until:

1. Focused and full automated tests pass.
2. Typecheck, lint, and production build pass without warnings we own.
3. An independent reviewer inspects the complete exact candidate after the final amendment.
4. The deployed artifact hash matches the reviewed candidate.
5. Cloudflare Access positive and negative paths remain enforced.
6. The public PWA is exercised in a real browser at desktop and mobile widths.
7. Browser console and network failures are inspected.
8. The origin remains loopback-only and services recover after restart.
9. Canonical Obsidian documentation is updated and pushed.
