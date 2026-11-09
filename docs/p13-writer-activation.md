# P13 source writer activation (#156)

This increment activates the existing `ROUTING_WRITES_AVAILABLE` source constant
for new preference set/clear and defaults-mode admissions. The bounded typed
`writesAvailable` read/set fact follows that same constant. Existing authorization,
eligibility/model lock, no fallback, revision CAS, UUID, quota/readiness and legacy
contracts are unchanged. No runtime flag or new endpoint is introduced.

**Source activated does not mean reviewed, merged, deployed or live verified.**
This delivery is local build and synthetic persisted-ledger proof only. PR154's
picker/candidate acceptance is separately owned; no web/browser/live operation or
build publication is part of #156. Whole P13 remains incomplete.

## Lead review and recoverable release

Before merge/release, independently review the exact source guard and frozen
recovery at the submitted head. Retain the verified PR153 compatible-reader app
image `sha256:48f0adf2c03ed0d1e7ec71975c0586d3ac5b3e611f02f1ac90150a94ba764774`
as rollback, together with the **current ledger** after release. PR155/#144 records
its accepted protected bridge readback. This is the healthy deployed pin, distinct
from the historical build reference and the bridge release's older rollback.

Pre-PR151 binaries are forbidden rollback targets. Never restore/reset/trim the
ledger or discard pending identities: an old reader can fail to open new records,
and lost admission identities can cause duplicate execution. The compatible
reader must keep saved defaults readable and committed frozen requests recoverable
while refusing new preference/defaults-mode identities.

After PR154 acceptance, separately admit the lead's protected live readback:

- Verify the exact owned target; perform reversible set/read/clear with exact
  revisions and UUIDs, zero preference-caused admissions and persisted readback.
- If safe and explicitly authorized, perform one defaults-mode round trip in the
  owned session. Recover the original frozen route, UUID, public run and upstream
  key after uncertain admission/default edits; never repost an uncertain new run.
- Verify the integrated UI on desktop and 360px separately from offline fixtures.
  Physical Android remains **phone check pending**.

Full installed requested/executed tuple, route/native binding, live recovery and
phone acceptance remain incomplete; requested settings are not executed evidence.

## Focused offline evidence

The writer suite uses the actual active guard, synthetic upstreams and persisted
ledgers, with no writer-stage mock. A first-failing typed availability regression
returned false before activation. It now covers true read/set/clear, restart,
actor/thread/project isolation, CAS/immutable UUID replay, zero preference run
admissions, exact precedence/no fallback, frozen lost-ACK/second-restart recovery,
removed route/target and changed-envelope refusal, legacy recovery and absence of
raw prompts/credentials in the ledger. Existing writer-contract assertions remain.

`routing-bridge.test.ts` explicitly isolates the historical PR153 disabled stage
with a test-only module fixture. All ten unavailable/replay/recovery/legacy cases
and their assertions remain; this is historical compatible rollback evidence,
not the active production availability claim. No production override is added.

Validation: 52 focused server tests and 12 routing contract tests pass; server
typecheck, scoped ESLint, server build and diff whitespace checks pass. Unchanged
accepted PR151 audit/service/interaction evidence is reused. No browser smoke test,
authenticated readback, provider call, service operation or CI polling occurred.
