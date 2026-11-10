# P13 new-output/read convergence — issue #144

## 2026-11-10 attempt

PR #158's accepted enabled-defaults proof remains unchanged in the [existing
receipt](verification/issue-144-defaults-live.json). This phase did not repeat
that run or alter its preference/read evidence.

The existing Studio browser-QA wrapper was invoked once for
`command#issue-144`. Its configured loopback CDP preflight failed with
`configured browser unavailable at the loopback CDP endpoint`. The wrapper
checks CDP before starting its child command, so the automation did not start.
No task-owned page was created and no Command/BFF request, session/run lookup,
read POST, or inference was sent. No external request or capture was produced.
The bounded attempt counts are in the [sanitized receipt](verification/issue-144-convergence-live.json).

Consequently this phase establishes no new-output unread interval, second-view
read convergence, reload persistence, or viewport acceptance. No new run intent
was persisted, and no marker or preference was changed. The configured browser
endpoint must be available before that acceptance can be observed; no browser
launch, restart, profile replacement, endpoint substitution, or credential
operation was attempted. The physical phone check remains pending.

The separately reviewed #159 read-marker source correction remains unmerged and
unreleased; this note makes no claim that it is present in the deployed app.
