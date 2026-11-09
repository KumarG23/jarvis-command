# P13 compatible-reader release bridge (#152)

Source and synthetic proof only; this is a release prerequisite, not P13 completion.
PR151 combined head `fefef5efe0b0cb027bb68a8aa104ffa723dc57cc` passed
validate42684100710 and gate-merged as `01b56e114924f11ac99796dfde7d53b9aab643f8`.
It is not deployed functionality. The reported deployed baseline remains cbb0e9e4….

## Required release order (lead owned)

1. Review and release this compatible reader with `ROUTING_WRITES_AVAILABLE=false`
   in `apps/server/src/routing-write-state.ts`. Verify affected protected readback,
   legacy admissions and recovery, and the truthful unavailable response for new
   default/frozen admissions. Establish and retain this exact compatible image as
   the recoverable rollback target before enabling any new-format writer.
2. Admit a later ordinary reviewed source increment that activates that same
   source constant, plus its scoped writer validation. Release only with the
   verified compatible bridge available as rollback. No runtime environment flag
   or operator flag flip is provided by this change.

A rollback after activation must use the compatible reader and the **current**
ledger. Pre-PR151 strict binaries cannot read new records. Never reset, trim,
restore an earlier ledger, discard pending identities or roll back to that old
reader to make the service start: that can lose admission dedupe and execute twice.
No worker build publication, deployment, live service or ledger operation occurred.

## Guard and availability contract

The bounded existing defaults read/set response adds `writesAvailable`, derived
from the same source constant as the write guard. Missing means false in the typed
response schema. Supported readback is not writable defaults, eligibility, execution
or a Hermes capability. Future UI must require an explicit true before offering
new preferences or defaults-mode admissions; the server guard remains authoritative.

New set/clear operations and new routing-bearing run envelopes return HTTP503
`routing_writes_unavailable` with an explanation, before preference mutation, run
lineage, reaction/image/send claims or upstream admission. Legacy envelopes retain
existing behavior and never implicitly inherit saved defaults. UUID conflicts remain
conflicts. Existing protected identity/origin/rate/storage boundaries are unchanged.

Committed default UUIDs can return their original immutable replay receipt, after
current target access checks, without changing a later preference. Pending frozen
runs recover only with their original envelope, UUID, public run and upstream key,
within the existing 23-hour window and current ownership/membership/eligibility.
Their frozen tuple is never re-resolved. Required existing run lineage may append;
accepted runs recover status without another admission or inventory dependency.
Removed frozen routes, changed envelopes and expired pending admissions still refuse.
Read/replay does not evict or rewrite existing ledger bytes or store raw prompts.

## Focused evidence and remaining proof

`routing-bridge.test.ts` runs the actual source-disabled production path against
synthetic upstreams. New-format fixtures are persisted using PR151's real ledger
writer, then closed/reopened by the bridge; the pre-change f37537d checked-in fixture
covers both pending and accepted old records. Regressions cover byte preservation,
no claims/new admissions, actor-isolated readback, immutable replay after edits,
same-key lost-ACK recovery and second restart, changed envelope, route/membership/
ownership removal, retention expiry and unchanged legacy admissions. The existing
PR151 writer-contract tests retain a test-only module mock for the later source
writer stage; there is no production injection or environment override.

Validation: 51 server tests (10 production bridge regressions plus 41 retained
writer-contract cases) and 12 routing contract tests passed. Server/contracts
typechecks, scoped ESLint, server build and diff whitespace checks passed.

Reuse unchanged accepted PR151 audit/service/reaction/room/integration evidence
(146 server and 53 contract tests); only changed suites and applicable checks run
here. This note makes no authenticated browser/live/provider/inference claim.
Selector UI, source activation, protected desktop/mobile acceptance, installed
full-tuple requested/executed effort proof, native binding and release/rollback
verification remain separate. Sol-dev #111's native/WIP is exited/preserved and UI
follows this bridge. Whole P13 remains incomplete; phone check pending.
