import { execFileSync } from 'node:child_process';

// Runs before workers even on direct Playwright invocation; never use stale dist.
// Invoke this suite through hermes-heavy-run, which also isolates this child build.
export default function setup() {
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: process.cwd() });
}
