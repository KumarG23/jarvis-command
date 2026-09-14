# Jarvis Command — current branch handoff

## Current policy (2026-09-08)

Follow `../AGENTS.md` and `/home/neal/AGENTS.md`. Build first, validate proportionately; one owner, coherent batch, focused tests and applicable type/lint/build, concise self-review. Classify the change, not the repository. Name a concrete failure risk before broader testing or independent review. No mandatory whole-candidate approval, repeated full gates, source-read receipts or parent reviewer audits. Preserve identity/MFA, authorization, isolation, audit and recovery.

## Branch and product state

This checkout is `feat/room-workspace-usability`. Preserve all implementation WIP, including the pre-existing `AGENTS.md` edit. Latest recorded production checkpoint is project rooms `584c3fc6f45dbc60cc8768ecd39c59e92cd219f8`; check live state before operating.

The current candidate adds compact per-prompt model/reasoning controls. The browser can select only Astra, Sol, Terra, Luna, or Grok 4.6 from a sanitized inventory derived from Hermes's live authenticated providers. The command proxy validates availability again before admission, translates the selection to Hermes's native per-run contract, and binds it into the durable request fingerprint. Inherited routing remains the default; inference selection does not alter tools or permissions. Local contract/proxy/server/web tests, lint, typecheck, build, and a credential-safe live inventory probe pass. Feature checkpoint `9e0e23a0f8704d973b74052de4a0a7a88f5f5414` is pushed to `origin/feat/room-workspace-usability`; it is not merged or deployed.

The concise canonical product/state/priorities/issues note is `05 Coding Projects/Jarvis Command/Jarvis Command.md` in the vault. Prepared deployments verify requested artifact/provenance, recovery, health and affected behavior without repeating development review.

## History

[Historical status and recovery references](archive/project-status-before-policy-reset-20260908.md) preserves this branch's former detailed handoff. Consult it only for relevant technical facts, not superseded release/review instructions. Resolve demonstrated defects and outstanding authorization constraints; historical review status alone does not dictate the new engineering workflow.
