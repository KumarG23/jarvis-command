# Issue #24 — compact Activity / Usage candidate

Scope: MASTER_PLAN §§0, 3, 5, 10/P1, 11–12, read from `origin/release/gpt6-sol-luna`; clean issue worktree based on #23 merge `c44c547e945394e79cca27f056b17f23660d5429`. Full #24 and linked #23/#8 review history read with explicit repository. Current source confirms studio-plan alignment. Older directives are historical. `/home/neal/AGENTS.md`, the vault product note and the referenced skill path were permission denied; no access workaround or architecture expansion. One implementation owner; no delegation.

One closed native disclosure now combines observed status, Activity and Usage. Keyboard Enter/Space and touch toggle it. Successful tool previews/durations are nested and closed; tool failures, approvals, handoffs, missing activity and route changes/uncertainty are discoverable. Approval controls remain outside the disclosure with unchanged identity/authorization checks. Event labels report facts, rather than infer tool lifetimes or private reasoning. No invented elapsed clock or execution restart on reconnect. Terminal status retains authority.

Exact current-run usage works without optional execution metadata. Unknown counters/route fields use accessible em dashes; supplied zero stays zero. Run spend is labeled separately from session context used/limit/percentage. Latest saved session receipts remain outside individual answers, and recovered output retains the unsupported canonical-link warning. No admission/retry, composer/preference, contract, backend or runtime changes.

## Validation

- 243 focused web tests pass. Regressions cover phase/event projection, terminal/failed tool/approval states, collapse/expand, missing activity, unknown vs zero, route decisions, latest-session separation, unchanged preferences and reload/recovery. Results and exact-head hosted CI are recorded on the PR.
- Web typecheck, scoped ESLint, web build and diff check pass; existing Vite large-chunk warning remains.
- Three configured Playwright tests: preference/preflight, compact inspector, and lost-ACK/mid-run reload (still exactly one admission). Inspector proof covers 1280×720, 320/360/390/430×740 and each width at 360 px height with focused composer as keyboard simulation; Enter/Space, touch, 44 px status target, reachable controls and no horizontal overflow. This suite is included in existing PR validation.

## Owned real-backend proof — candidate assets, not a deployment

Existing authenticated browser access was copied only in memory into isolated contexts; original tabs/profile preserved. Built candidate assets were served by page-scoped interception. Production APIs remained real. One guarded session creation and **exactly one** new admission used the offered included `openai-codex/gpt-6-luna` / medium route; uncertain admission would not have been retried. No paid route, provider/control change or service operation.

| Model | Exact owned public run | Requested / executed | Run input / output / total | Session context |
|---|---|---|---|---|
| Sol (reuse #22 production proof) | `jcr_808144f798b521bd4ecfb28c968ec124` | `openai-codex/gpt-6-sol` / medium, both | 16,868 / 13 / 16,881 | 16,868 / 272,000 |
| Luna (one new candidate turn) | `jcr_4653cef2f96f1b79b3f19b7e3e79413c` | `openai-codex/gpt-6-luna` / medium, both | 16,866 / 11 / 16,877 | 16,866 / 272,000 |

Both authoritative receipts report wire effort, exact=true, fallback=false, one API call and supplied zero reasoning/cache fields; routeSource is `unknown`, not invented. Luna canonical history has one user message and one answer. New turn output is the owned marker `COMMAND_24_LUNA_PROOF`; no tools requested or observed.

Final candidate GET-only readback explicitly restored each **retained exact recovery identity** in isolated sessionStorage, then compared current recovered-run DOM to that run's authenticated status. Zero mutations during readback. This is not a historical message/run join: incomplete activity and unbound recovered output stay labeled, and the composer starts at Inherit independently of executed route. Both models passed 1280/320/360/390/430 px candidate overflow checks. [Sanitized identities, usage and DOM](issue-24/readback.json).

Inspected cropped captures contain owned proof only: [320 closed](issue-24/luna-320-closed.png), [320 Usage](issue-24/luna-320-usage.png), [1280 closed](issue-24/luna-1280-closed.png), [1280 Luna Usage](issue-24/luna-1280-usage.png), [1280 Sol Usage](issue-24/sol-1280-usage.png). Full shell captures are intentionally not committed because they can include unrelated recent-chat titles.

## Remaining Sol release proof

1. Review exact PR head and configured CI; merge into `release/gpt6-sol-luna` through normal lead ownership.
2. Establish current pins/health and rollback, then build/release the merged app through the documented recoverable path; proxies unchanged. Record actual artifact and rollback receipt.
3. Using production assets, read back the two exact owned runs above against the status/Activity/Usage DOM. Complete session/request/run tuples are in `readback.json`. Existing owned runs suffice; no additional model submission is needed for these counters/routes. Confirm historical output remains unbound and missing replay activity remains labeled. Report deployed evidence separately from candidate proof; update §11 to Done only after final released acceptance.
4. **Phone check pending:** physical Android cold start, tap status/Activity/Usage, scroll to all facts, open/close successful tool details, and focus multiline composer with real soft keyboard. Emulation is complete; physical behavior belongs in the Final Neal packet.

Worker did not merge, publish, deploy, restart/patch Hermes, change auth/access/credentials/network/provider/paid-route controls, introduce an orchestrator/job, or alter native sessions. PR feedback remains with this implementation owner; Sol owns exact-head review and release.
