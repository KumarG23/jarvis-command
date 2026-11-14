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
9. **Phone header on one row.** Menu, title, Threads and icon actions (project details, Terminals, Hermes dot).
   The model picker moves into the composer as a small chip on phones.
10. **Phone drawer scrolls as one list** instead of two small boxes, so all recent chats are reachable.
11. **Quieter composer.** "Project context included" no longer shows a character count until 80% of the limit.
12. **Approval and stop prompts are cards** with real buttons ("Jarvis wants to run this", "Stop this reply?");
    request/run/session IDs are under a Details toggle.

## Next, in priority order

1. **Streaming/working state.** The run inspector during a live reply still shows a lot of status text; aim for
   ChatGPT's single "Thinking…" line with expandable steps. Needs a live Hermes run to tune properly.
2. **Empty state copy.** "YOUR SPACE TO THINK & BUILD / Choose a chat or start a new one" could just be a focused
   composer with a few suggested prompts (homelab check, reminders), like ChatGPT.
3. **Terminal tab names.** Tabs show the title only; a small agent icon (Claude/Codex/agy) would make a row of
   workers easier to scan.
4. **Consistent icon buttons.** Header buttons mix outlined pills, plain icons and text buttons. One button style
   with one height would look more finished.
5. **Light polish:** project names wrap in the sidebar, the user bubble is very large for short messages, and the
   "Development preview" bar is fine locally but worth confirming it never shows in production.
