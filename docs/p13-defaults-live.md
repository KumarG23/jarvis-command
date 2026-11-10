# P13 enabled saved-default acceptance — issue #144

## Released source

PR154's picker and PR157's writer activation were reviewed, gate-merged, and
included in app-only release source `da662edc408e10a53ea62515ae718e517fc0d1fd`.
The lead's build reference `sha256:44c227a1e4fe069a83f8e7fc55bd4ca4852244de0f5c5be14f5c35525ec20953`
is distinct from the healthy deployed pin
`sha256:6d75d5a01f61e584f3f55d43d6a37d64f651f572d8f1a3c1bc9ec5e74f1d51f9`.
Rollback `release-app-1794260052449091341` retains the compatible reader pin
`sha256:48f0adf2c03ed0d1e7ec71975c0586d3ac5b3e611f02f1ac90150a94ba764774` with
the current ledger. These are lead release attestations; this worker did not
operate a service or proxy.

## Protected defaults and one run

The preserved exact session was revalidated through its supported GET as
Command-owned before history. Its global thread target was `{scope: "thread",
projectId: null}`. Protected reads returned the strict no-store response with
`writesAvailable: true`; the original preference was null at revision 0.

Through the released picker, the existing approved `openai-codex/gpt-6-luna`
choice at requested low effort was saved at revision 1, cleared at revision 2,
re-saved at revision 3, and restored to null at revision 4. Each mutation used a
distinct UI-generated request UUID persisted privately before forwarding, with
an exact target/revision response and protected readback. The first harness
stopped after the revision-3 mutation had already returned 200 because its
readback wait raced the UI response observer. A later exact protected GET
confirmed revision 3 and the saved choice; no mutation was replayed. The final
clear restored the original null choice and an independent read confirmed
revision 4.

With explicit “Use saved defaults” opt-in and no prompt `inference` override,
one synthetic message was submitted through the existing run path. Its actual
browser-generated request identity and exact defaults envelope were written to
private git metadata before forwarding. Exact lookup and run status recovered
the same request/run after reload; no retry or second admission occurred. The
run completed with requested and executed provider/model/effort both
`openai-codex` / `gpt-6-luna` / `low`, `exact: true`, `fallbackUsed: false`,
and one API call. `routeSource` remains **unknown**. The output hash and request
identity hash are in the sanitized receipt; no run-to-message join is claimed.

Canonical history contained seven records with their absolute positions intact;
the latest eligible assistant was position 6. The UI's native read POST passed
the exact message-id/position and visible, focused, clipped, hit-tested guard
and returned 200. A subsequent protected thread-state GET matched that exact
canonical marker and reported `unread: false`. This read-state evidence is
separate from the run receipt.

## UI, captures, and request accounting

At 1280×720, 360×740 and 360×360, the selected chat rendered seven history
records and a truthful `Idle` label; the harmless unsent draft survived the
viewport changes, the model selector received focus and Escape restored focus,
and input/Send hit testing succeeded. At short height the composer is close to
the lower viewport edge; a 44×44 Send target was hit-tested, with normal
composer/timeline scrolling available. Three masked captures were visually
inspected and are retained at
[`docs/verification/issue-144-defaults-captures/`](verification/issue-144-defaults-captures/).
Their hashes and the bounded viewport assertions are in the
[receipt](verification/issue-144-defaults-live.json).

Across six wrapped invocations, the guard observed **108 GET and 19 POST
attempts**: **59 GET and 19 POST forwarded**, **49 GET and 0 POST blocked before
egress**, and **0 external requests**. Forwarded POSTs were 13 defaults reads,
four preference set/clear mutations, one defaults-mode run, and one eligible
latest-read marker. There were no forwarded presence or other mutations. The
first recovery invocation observed one forwarded GET without its response
before page closure; three later status-only UI diagnostics counted attempts and
egress but did not collect response statuses. The captured responses were HTTP
200. These are wrapper-observed request counts, not server audit-ledger totals;
server audit totals are unknown.

## Remaining P13/P14 acceptance

This proves one protected thread-default round trip and one exact same-run
requested/executed tuple. It does not prove route-source attribution beyond
`unknown`, defaults across actors/devices/projects, Threads/project behavior,
new-output races, service restart, or a physical phone. Whole P13 remains
incomplete; **phone check pending**. P14 remains app-released as an unavailable
shell with production Studio source `null`, no connection and no crew-data
acceptance. Dashboard cutover and approved transport remain unresolved. Earlier
bridge and #111 receipts remain unchanged and separate.
