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
13. **Big messages.** The message limit is 200,000 characters (about 30,000 words), up from 16,000.
14. **Files both ways.** The paperclip takes any file. Small text files go into the message; anything else
    (PDF, zip, images, big logs) uploads to the artifact store and Jarvis gets its path and a fetch command.
    Jarvis sends files back with `deploy/scripts/command-file.sh`; images show inline in the chat and other
    files as download cards. See "Files" in `docs/cockpit/SCHEDULED-RUNS.md`.
15. **New-chat screen.** "What are we working on?" with four starters (Homelab check, Set a reminder, Schedule a
    job, Help me plan). A starter opens a new chat with its prompt in the message box and the cursor at the end.
    An empty chat says "Nothing here yet. Ask Jarvis anything." instead of "No saved messages in session history yet."
16. **One header button style.** On wider screens the header is one row and every control (model, Threads, project
    details, Terminals, Hermes) is the same 36px outlined button, with a 44px touch target. The "Second conversation"
    picker is a quiet right-aligned row.
17. **Agent badges on terminal tabs.** CC (Claude Code), CX (Codex), AG (Antigravity), a terminal icon for shells,
    each with its status dot in the corner.

## Next, in priority order

1. **Streaming/working state.** The run inspector during a live reply still shows a lot of status text; aim for
   ChatGPT's single "Thinking…" line with expandable steps. Needs a live Hermes run to tune properly.
2. **Light polish:** project names wrap in the sidebar, the user bubble is very large for short messages, and the
   "Development preview" bar is fine locally but worth confirming it never shows in production.
3. **e2e:** `header-layout` sidebar test at 1280x720 reports the project row as clipped (also on the base branch).
