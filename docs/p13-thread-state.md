# P13 source and outstanding proof

Shared labelled status is derived from fresh actor-bound Command run observations
and canonical saved-message/read identities. No observed Command run means Unknown.
Queued/running means Working; waiting approval, failed or interrupted needs attention;
verified terminal completion/cancellation permits Idle only when unread is known false.
Unread is independent of completion. Observations expire after 60 seconds. Retained
supervisors expose typed verified facts; reconnect text does not alter lifecycle.

The existing narrow authenticated session routes now include GET `thread-state` and
POST `read`. POST accepts only a canonical message id and zero-based position and
revalidates that exact latest row. The browser reports it only from a fully visible
bottom-of-message marker in a visible, focused, clipped conversation pane after the
last history page loads. Reads do not submit runs or change notification readAt.
Actor fingerprints and per-session read positions persist in a separate private
atomic file on the existing mount. Readers from earlier releases never open it.
Monotonic positions prevent stale devices from regressing a read; newer output has
an independent identity and stays unread. UI response merging also preserves newer
tails/reads when response delivery is reversed or timestamps tie.

Bounds: 4096 actor/session markers, 1 MiB file, 50 observed chats per client,
two active server observations, at most ten 100-row oldest-first history pages,
and an eight-second traversal budget checked between existing bounded source reads.
No tail within those bounds means unread Unknown and read refused. Overflow or
storage failure does not evict a newer marker or claim success. Polling occurs every
30 seconds only while the document is visible; ordinary focus refreshes share the
same in-flight guard and existing server rate limits. A lower or changed canonical
position is never treated as permission to clear newer output.

## Routing capability disposition

Existing independent P9 explicit prompt selection, per-browser per-session preference,
effort eligibility checks, proxy `require_model_lock: true` and applicable run receipts
are preserved. They are not a historical answer/run join. This change does not enable
new provider routes or treat a requested route as executed evidence.

Saved thread/project defaults and delegated binding remain unavailable. The permitted
proxy status helper reports the relocated proxy unreachable through that tool, so no
current installed advertised/authenticated/approved exact-route proof was obtained.
Final Neal packet prerequisite: verify the installed independent session's exact
eligible route lock/no fallback through existing authorized access and an owned run;
for native delegation additionally provide a supported exact authorized
thread-to-session route binding and attributable execution receipt. Only after that
proof may defaults resolve prompt → thread → project → Command for the next run.
No endpoint, route inheritance, provider enablement, family mark, or historical receipt
association is invented here. Existing model selection remains available separately.

## Evidence disposition

Focused source tests cover every status, staleness, urgency/recency, response ordering,
latest-marker visibility/focus, exact pagination, actor separation/denial, restart,
bounds, cross-device stale clears and new output during clear, and zero run admission.
Relevant typechecks, scoped lint, web/server builds are recorded in the PR.

Candidate browser acceptance is **deferred after two failed attempts**, both through
the Studio source wrapper in this issue's own worktree and task-owned synthetic
contexts. Attempt 1 supplied a null required session timestamp and failed bootstrap.
Attempt 2 tried to fill the composer before loading the final history page enabled it;
all three viewports stopped there. There are no candidate acceptance images to inspect,
no proven viewport/hit reach, and no browser smoke-test claim. The corrected fixture
is retained but not run a third time. Preview teardown reported local presence proxy
connection refusal; that is not authenticated BFF/live evidence. Original tabs/storage
and Chrome were retained. The lead must split or defer residual visual acceptance;
this source assignment does not grant another browser attempt or release authority.

Unreleased. Authenticated readback belongs to Sol after recoverable release. Physical
Android remains **phone check pending**. On phone, check status labels/urgency,
short-height scrolling, background/foreground, actual latest-page view and a second
device receiving newer output after an older device clears. No notification delivery
or delegated-route execution is claimed.
