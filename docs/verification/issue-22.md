# Issue #22 — desktop requested model/effort and current-run usage

Scope: current [#2 owner continuation](https://github.com/KumarG23/jarvis-command/issues/2#issuecomment-6471508194), #22 studio-plan evidence; full `MASTER_PLAN.md` and kickoff read on `origin/docs/jarvis-command-v2-plan` (unmerged #3), particularly §§5–6, 10/M3, 11/JC2-005 and 12. This is partial desktop M3 acceptance. #14/#16 are complete and reused; #6's latest-session receipt remains separate; #9's historical message/run join is unavailable. Proposed #21 remains unmerged at inspection and does not widen this task. Base: `release/gpt6-sol-luna`, `eddae248349735202f9994562ff4f051a354967a`.

Repository AGENTS.md read. Host access denied `/home/neal/AGENTS.md` and the canonical vault product note; no architecture/scope expansion or access workaround. The referenced `subagent-driven-development` skill was not available in the installed skill catalog or inspected local skill locations. One implementation owner; no delegated agents or services.

## Behavior and precedence

- Requested model/effort is browser-local, per session, under the existing application/preview storage namespace. A current tab's explicit selection wins in that tab; another tab/device does not synchronize it. On reload, the last successfully saved browser preference is read and checked against current inventory. New chats default to Inherit. No messages, credentials or run payloads enter preference storage; Hermes/global settings are untouched.
- Corrupt/unreadable preferences require an explicit choice. Unavailable model/effort remains visible with a reason; it never silently becomes Inherit. Blocked writes retain the choice in the tab and explain reload limits.
- Model changes retain a mutually offered effort, otherwise choose offered medium or the first offered effort. Every explicit send performs a fresh, no-cache, schema-validated inventory GET before the existing server admission/revalidation. Failed/invalid/removed inventory preserves the draft; retry is user initiated, one bounded 10-second read at a time. No automatic admission or resend. Chat/context changes or a recovered draft edit during preflight cancel that send.
- Current/recovered exact-run usage renders even without execution metadata. Supplied zero remains zero; missing optional facts remain unavailable. Route classification is shared by receipt and inspector: fallback, established non-null mismatch, exact, or verification unavailable. `exact=false` or a missing executed field does not establish a mismatch. Existing latest-session labeling and historical binding restrictions remain.

## Validation

Regressions first reproduced all eight initial composer/receipt failures before implementation, including Sol xhigh → Luna, shared session state, missing preflight, false mismatch and hidden counters.

- Focused web: 214 tests across inference controls (22), live turn, TurnView, saved receipt, environment namespace, reload recovery and cache. Web typecheck and scoped eslint passed.
- Local production web build passed; existing Vite large-chunk warning remains. No contract/backend source changed; accepted unchanged server inventory/model-lock/admission checks are reused rather than recertified.
- `npx playwright test -c e2e/turn-recovery.config.ts`: two tests passed. New visibly synthetic fixture verifies two-chat switch/reload, Sol xhigh → Luna medium, fresh inventory removal with zero admissions and retained draft, explicit retry, one valid admission and counters without execution metadata. Desktop 1280×720 and narrow 390×844 controls are in viewport with no horizontal overflow. Existing lost-ACK/mid-run reload still has one admission and one canonical answer. Both browser tests run in existing PR CI.

## Actual authenticated browser and same-task backend readback

Inspected the installed readiness helper and discovered its current dedicated CDP listener; protected reads returned 200. Used an isolated context, existing legitimate authentication only in memory, blocked service workers and all non-GET APIs for this context. Original browser tabs/profile/storage were preserved. Candidate built static assets were supplied by page-scoped interception; genuine owned sessions were seeded into the isolated bootstrap recents, and an existing exact recovery identity was seeded only in that tab. This is an authenticated candidate preview, not an unmodified production UI or deployment.

Reused #14's owned session `jc_f12d26d280cc4d39b3fd71b48afb82b5`, request `55c5c427-cd43-4810-96dd-4c689ad5ad75`, run `jcr_490e7bd18ba35e754da9bfb3a8629ce2`. Real GET status and canonical history confirmed the same completed task and five unique retained rows. The UI's current recovered-run receipt matched 33,821 input / 41 output / 33,862 total; 2 API calls; supplied 0 reasoning, 16,768 cache read, 0 cache write. Context separately matched 16,940 / 500,000. Executed `openai-codex/gpt-6.1-sol`, medium, wire-attributed effort; requested overrides null, route source unknown, exact false, fallback false. Both receipt and inspector said route verification unavailable, with no mismatch claim.

Then selected a **future requested preference** `openai-codex/gpt-6-sol` / xhigh from real authenticated inventory, switched to the second owned #14 session `jc_c2498e733c2c4696bf7fe5378f830986`, chose a different preference, and reloaded both. Each restored its own choice. This preference is not the executed route of the retained task, nor independently verified per-route effort support. No new messages/inference or admission requests occurred (zero POSTs). No historical message/run join was inferred. Desktop 1280×720 and narrow 390×844 had no horizontal overflow; cropped captures were inspected.

[Sanitized readback](issue-22/authenticated-readback.json), [current recovered run](issue-22/authenticated-current-run.png), [desktop requested controls](issue-22/authenticated-requested-1280.png), [narrow requested controls](issue-22/authenticated-requested-390.png).

## Delivery boundary

Source implemented and locally built/tested; self-review complete. Exact-head Sol review/hosted CI, source merge, published artifact, deployment and candidate live execution acceptance are reported separately on the PR. Worker did not merge, publish, deploy, restart/patch Hermes or change auth, credentials, network, providers, paid-route controls or audit/admission contracts. No new paid route or inference.

Sol owns normal exact-head review and recoverable app release with artifact provenance, retained rollback receipt and actual desktop/backend requested-versus-executed readback for the same new owned task. Use an existing approved subscription route, one admission per intent, and report unknown fields honestly. No proxy/schema migration is required. Physical Android is unverified; emulated width is only layout smoke. Discovery/native sessions, WIP, separately owned PRs #3/#5 and shared schedule/capacity remain untouched.
