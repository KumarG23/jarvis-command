# Runtime recovery WIP checkpoint — not deployed

Neal requested preservation and GitHub handoff only. ChatGPT/Codex leads product/frontend; Jarvis retains Hermes runtime integration and deployment. Overlapping Jarvis UI work is paused.

This branch `handoff/runtime-recovery-wip` preserves previously uncommitted deployment work from `/home/neal/code/jarvis-command`, previously on `feat/v0.2-live-room` at exact base `9d4819431efb5ce4749495e6fbfa6c80d19f74b9`. No merge, deployment, implementation or test rerun was performed for checkpointing. Treat all recovery modifications as unfinished WIP, not release-approved code. Do not fold this branch into the frontend checkpoint blindly.

Tracked modifications:
- deploy/android-association-release.test.mjs
- deploy/android-packaging.test.mjs
- deploy/app-cutover.test.mjs
- deploy/cutover-app.sh
- deploy/install-android-association.sh
- deploy/release-android-association.sh
- deploy/release-app.sh
- docs/deployment/v0.1.md

Previously untracked additions:
- deploy/bundle-recovery-script.py
- deploy/recovery-fixture.mjs
- deploy/recovery-helper.test.mjs
- deploy/recovery-ownership-probe.py
- deploy/recovery-root-cases.mjs
- deploy/trusted-recovery-directory.sh

Checkpoint-only addition: docs/runtime-handoff.md.

Existing WIP targets trusted recovery-directory validation, pinned directory operations, bundled helpers for standalone transfer, rollback/snapshot cleanup, and associated test fixtures. This handoff does not establish test completeness or live recovery acceptance. Preserve original state and use Jarvis's existing deployment lane for any future integration. The frontend starting branch is `feat/room-workspace-usability`; see its `docs/frontend-handoff.md`.
