import { spawn } from 'node:child_process';

export type ExecResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean };

// Runs argv directly (no shell). Output is capped so a chatty command cannot exhaust memory.
export function exec(
  argv: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string; maxBytes?: number } = {},
): Promise<ExecResult> {
  const [command, ...args] = argv;
  if (!command) return Promise.reject(new Error('empty command'));
  const maxBytes = options.maxBytes ?? 1_000_000;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const append = (current: string, chunk: Buffer) => {
      if (current.length >= maxBytes) { truncated = true; return current; }
      const next = current + chunk.toString('utf8');
      if (next.length > maxBytes) { truncated = true; return next.slice(0, maxBytes); }
      return next;
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = options.timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeoutMs) : null;
    const finish = (code: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr: error ? `${stderr}${error.message}` : stderr, timedOut, truncated });
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code));
    child.stdin.on('error', () => undefined);
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
