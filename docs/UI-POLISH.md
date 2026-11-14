# Jarvis Command UI polish list

Review of 2026-11-14, from running the app locally at phone (390×664) and desktop (1440×900) sizes.
Goal: feel as finished as the Claude app, ChatGPT and Discord. Phone first, because that is where Neal uses it.

## Done in this pass

1. **Terminal tabs can be closed.** Each tab has an ×. An ended session closes at once; a running one asks
   "Stop and close?" first. Ended sessions also get a Close button in the toolbar. The session host forgets the
   record (`POST /v1/sessions/:id/close`); any worktree stays on disk. Tabs no longer jump to the front when their
   state changes, and the "Terminals" title no longer wraps to "Terminal / s" on phones.
2. **Dead sidebar entries hidden.** Studio crew, Agents and Collaboration rooms always said "Unavailable" and took
   about a third of the sidebar. They are hidden (`SHOW_STUDIO_ENTRY` in `App.tsx` brings Studio back).
3. **No "Unknown"/"Idle" badges.** Quiet chats show nothing, like Claude/Discord. Only Working, Needs you and
   Unread show in the sidebar and header. The Threads panel and project details still show every state.
4. **Debug text removed from the chat.** "Latest saved session receipt · Individual message association
   unavailable", "Saved receipt unavailable" and the "Connection & recovery details" essay under the composer
   are gone. A receipt still shows when Hermes actually has one.
5. **Message actions are one quiet row.** Copy and a react icon sit under each message (dimmed until hover on
   desktop) instead of a green "Reactions" text link plus a separate copy row.
6. **Short timestamps.** "12:00 PM", "Yesterday 3:42 PM", "Nov 12, 3:42 PM" instead of "11/14/2026, 12:00:00 PM".
   The full time is in the tooltip.
7. **Header decluttered.** The context meter only appears once Hermes reports usage. The model chip says
   "Default model" instead of "Inherit" (and drops the "Requested ·" prefix on phones). The "Second conversation"
   picker only shows on wide screens and only when the project has another chat.
8. **Chat titles get their full width.** Row actions (add to project, delete) take no space until hover on
   desktop, and on phones only show on the open chat.

## Next, in priority order

1. **Phone header is still two rows.** Breadcrumb, model chip, Threads, project-details, Terminals and the Hermes
   dot compete for 390px. Proposal: one row with title + a single "⋯" menu holding Terminals, project details,
   model and Hermes status; Threads becomes a tab or swipe.
2. **Sidebar on phones scrolls in two tiny boxes.** Projects and Recent chats each get their own scroll area, so
   only 2–3 recent chats are visible. One scrolling list (Claude/ChatGPT style) would show far more.
3. **Composer.** "Project context included · 1690 / 16000 characters" sits above every project message. It could
   become a small chip that only expands on tap, and the character count could appear only near the limit.
4. **Streaming/working state.** Check the live-turn view (tool steps, approvals, stop) against ChatGPT's single
   "Thinking…" line with expandable steps.
5. **Empty state copy.** "YOUR SPACE TO THINK & BUILD / Choose a chat or start a new one" could just be a focused
   composer with a few suggested prompts (homelab check, reminders), like ChatGPT.
6. **Terminal tab names.** Tabs show the title only; a small agent icon (Claude/Codex/agy) would make a row of
   workers easier to scan.
7. **Consistent icon buttons.** Header buttons mix outlined pills, plain icons and text buttons. One button style
   with one height would look more finished.
8. **Light polish:** project names wrap in the sidebar, the user bubble is very large for short messages, and the
   "Development preview" bar is fine locally but worth confirming it never shows in production.
