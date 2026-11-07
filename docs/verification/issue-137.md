# Issue #137 — P14 authenticated readback (partial)

Scope: authenticated readback of the deployed honest-unavailable Studio destination (PR #133, merged `0e9e6b03`). Docs only; no source, service or config change.

## Outcome: partial

- Ran through the existing Studio browser wrapper (task `command#issue-137`) against the configured browser's existing authenticated context, in task-owned pages only. No credentials, cookies or storage were exported; no new authentication.
- Authoritative identity check: an authenticated `GET /api/bootstrap` (HTTP 200) did **not** list the supplied owned proof session. Per the task rule the readback stopped there: no substitute session, no project lookup, no history read, no Studio entry/destination interaction.
- Two authenticated runs were used (the first produced no captured output; the second confirmed the absence). The budget is exhausted; no third attempt. Whether the bootstrap roster is truncated, or the proof session was removed, was not investigated further.
- Consequently **not proven** in production: global entry, unavailable reason, drawer/Return/Escape/Back focus and reach at 1280×720, 360×740 and 360×360, draft/selection retention, and zero Studio requests. Those remain candidate (synthetic) evidence from #132/#133 only.
- API traffic during the runs: one authenticated read-only bootstrap GET per run; zero writes, zero inference/provider/reaction/push/preference/run/session/project mutations, zero Studio reads. No reply-presence calls were made.
- Housekeeping: the first run's Node process outlived the wrapper timeout and was terminated; a task-created page may remain open in the browser (original tabs and storage untouched, Chrome left running).
- Physical phone check: pending.

## Follow-up needed (lead)

A fresh owned proof session on the deployed app, or confirmation of the existing one's roster visibility, is required before desktop/360px authenticated acceptance can be recorded.
