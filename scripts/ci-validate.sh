#!/usr/bin/env bash
# Unprivileged source validation. The PR workflow and local runs execute this
# same script, so a local pass is the executable equivalent of the hosted check.
# Assumes `npm ci` has already run. Needs no secrets, network services or Hermes.
set -u
cd "$(dirname "$0")/.."

failed=()
run() {
  local name=$1; shift
  echo "::group::$name"
  echo "+ $*"
  "$@"
  local code=$?
  echo "::endgroup::"
  echo "[$name] exit=$code"
  [ "$code" -eq 0 ] || failed+=("$name(exit=$code)")
}

run typecheck npm run typecheck
run lint npm run lint
run build npm run build
run workspace-tests npm run test --workspaces --if-present

# Focused web/CSS regression from issue #7. It lives on the #7 branch, so on a
# base without it the stage reports itself as skipped rather than passing.
header_config=e2e/header-layout.config.ts
if [ -f "$header_config" ]; then
  run header-layout npx playwright test --config "$header_config"
else
  echo "[header-layout] SKIPPED: $header_config not present on this base"
fi

run turn-recovery npx playwright test --config e2e/turn-recovery.config.ts

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "OK: all executed stages exited 0"
