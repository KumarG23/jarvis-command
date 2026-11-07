<!-- dev-studio:auto -->
# Issue #96 browser candidate fixture

Status: unavailable for full acceptance. This is offline candidate evidence only.

The Studio wrapper accepted the prepared local endpoint/profile configuration and ran the issue-owned fixture with task `command#issue-96`. The wrapper acquired its lock and the Playwright test created a new context. A first, limited fixture run passed the Free label, catalog Use action, provider-default effort state, and viewport checks at 1280×720, 360×740, and 360×360. That run did not exercise send or draft/error behavior and did not assert that model inventory had loaded.

The stricter fixture now validates its synthetic bootstrap payload against `CommandBootstrapSchema`, waits for bootstrap and model inventory, simulates one inventory 429, checks draft retention, and checks one exact synthetic run request. On three subsequent wrapper runs, the isolated page rendered **Command unavailable**; no model-options inventory loaded, so no send or draft/error acceptance ran. The Playwright runner timed out once at 30 seconds and twice at 90 seconds. The final error context contained the unavailable screen. No conclusion about production behavior follows from this fixture state.

Each run used only a new Playwright context owned by this task and closed that context. The original browser tabs and storage were not inspected or changed; Chrome was left running. The wrapper lock was respected. No authenticated readback, provider call, live API mutation, proxy operation, or physical-phone check occurred.

Source checks in PR #109 and this candidate browser state are separate. The full desktop/mobile candidate fixture, live route proof, and physical-phone acceptance remain unverified.
