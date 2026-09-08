import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';

// Work Mode forwards these explicit Vite flags to the workspace root. Keep the
// ordinary development command intact; the supervised preview is synthetic.
const args = process.argv.slice(2);
const preview = args.includes('--strictPort') && args.includes('4173');
const children = [];
function run(command, argv) {
  const child = spawn(command, argv, { stdio: 'inherit' });
  children.push(child);
  child.once('error', error => { console.error(error.message); shutdown(1); });
  child.once('exit', code => shutdown(code ?? 0));
}
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.once('SIGTERM', () => shutdown());
process.once('SIGINT', () => shutdown());
if (preview) {
  console.log('Starting SYNTHETIC design preview. No Hermes connection.');
  run(process.execPath, ['--import', 'tsx', 'e2e/chat-first-preview.ts']);
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts', ...args]);
} else {
  run('npm', ['run', 'dev', '-w', '@jarvis-command/server']);
  run('npm', ['run', 'dev', '-w', '@jarvis-command/web', '--', ...args]);
}
