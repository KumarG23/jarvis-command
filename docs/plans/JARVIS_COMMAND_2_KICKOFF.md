# Jarvis Command 2.0 — Dev Studio Kickoff

We are reviving Jarvis Command as **The AI Cockpit**, a mobile-first and desktop-excellent interface combining the conversation experience of ChatGPT, Claude-style artifacts, and Hermes CLI's live activity and usage visibility.

Jarvis will be the primary assistant, with direct access to our specialized agents and genuine native Hermes agent-to-agent collaboration.

The attached development blueprint is the product specification. Read it in full and use it to guide implementation.

**Important: Execute M0 discovery and the narrowly scoped confirmed-baseline repair exception in `MASTER_PLAN.md` only. Do not begin M1+ implementation or the full redesign.**

## Initial assignment — M0

Inspect `KumarG23/jarvis-command`, particularly `release/gpt6-sol-luna`, and the connected Hermes runtime.

Determine which version is currently deployed, which existing features work end-to-end, which are broken, and which require additional backend support.

Pay particular attention to:

- Live chat, streaming, session history, and reconnect behavior.
- Token counts, context usage, and execution receipts.
- Per-prompt model and reasoning-effort controls.
- Artifact creation, previews, storage, and persistence.
- Hermes profile discovery and canonical Bot Chats.
- Native agent messaging and group-chat driver capabilities.
- Existing Android and desktop UI limitations.

Deliver a verified feature matrix identifying what works, what is broken, and what is unsupported, with precise source references and reproduction steps.

Also prepare a visual direction for the three key experiences: primary chat, expandable Activity/Usage inspector, and agents/collaboration rooms.

## Engineering instructions

Maintain the current Dev Studio workflow with Sol as team lead. Do not reinstate Kanban automation, create unnecessary background jobs, modify existing timers, or initiate speculative work.

Retain existing authentication, credential isolation, permissions, audit logging, and deployment protections. Do not spend time redesigning security unless a specific required change introduces a demonstrated risk.

Prioritize working product behavior over infrastructure complexity. Use one implementation owner per coherent task and focused validation appropriate to the changes.

Do not invent token metrics, model reasoning, agent activity, or unsupported functionality.

Discovery itself does not merge, deploy or alter production infrastructure. A separately owned, confirmed existing UI defect may follow the normal branch/test/PR/lead-review path under the M0 baseline-repair exception; that is not permission to auto-merge, deploy, change production boundaries or start subsequent milestones.

## Completion

Return the verified current state, specific capability blockers, visual recommendations, and an implementation-ready breakdown of M1 and M2.

**Success means we know exactly what exists, what works, and how to build the experience correctly—not that we have generated another enormous unfinished project.**