import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from './exec';

// Variables that must never reach a worker process. Provider API keys are stripped so a
// subscription CLI cannot silently fall back to paid API billing; the host's own keys are
// stripped so a worker cannot call the session host as the human.
const STRIPPED = [
  /^SESSION_HOST_/,
  /^ANTHROPIC_API_KEY$/, /^ANTHROPIC_AUTH_TOKEN$/, /^CLAUDE_CODE_OAUTH_TOKEN$/,
  /^OPENAI_API_KEY$/, /^CODEX_API_KEY$/,
  /^GEMINI_API_KEY$/, /^GOOGLE_API_KEY$/, /^GOOGLE_GENAI_API_KEY$/,
  /^OPENROUTER_API_KEY$/,
  /^TMUX$/, /^TMUX_PANE$/,
];

export function workerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || STRIPPED.some(pattern => pattern.test(name))) continue;
    result[name] = value;
  }
  result.TERM = 'xterm-256color';
  result.COLORTERM = 'truecolor';
  return result;
}

export type PaneInfo = { name: string; pid: number | null; dead: boolean; status: number | null };

const CONFIG = [
  // Keep a finished process's last screen and exit status until the cockpit stops it.
  'set -g remain-on-exit on',
  'set -g exit-empty off',
  'set -g status off',
  'set -g history-limit 50000',
  'set -g default-terminal tmux-256color',
  // Windows switch to manual sizing on the first resize-window; the cockpit sizes them explicitly.
  'set -g window-size latest',
  'set -g aggressive-resize off',
  'set -sg escape-time 0',
  'set -g mouse off',
  'set -g allow-rename off',
  'set -g set-titles off',
  // The cockpit owns lifecycle; no prefix key for read-only viewers to fight over.
  'set -g prefix None',
  'unbind -a',
  '',
].join('\n');

export class Tmux {
  readonly socket: string;
  readonly configPath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(stateDir: string, env: NodeJS.ProcessEnv = workerEnvironment()) {
    this.socket = join(stateDir, 'tmux.sock');
    this.configPath = join(stateDir, 'tmux.conf');
    this.env = env;
    writeFileSync(this.configPath, CONFIG, { mode: 0o600 });
  }

  private async run(args: readonly string[], input?: string) {
    const options: Parameters<typeof exec>[1] = { env: this.env, timeoutMs: 15_000 };
    if (input !== undefined) options.input = input;
    return exec(['tmux', '-S', this.socket, '-f', this.configPath, ...args], options);
  }

  private async must(args: readonly string[], input?: string) {
    const result = await this.run(args, input);
    if (result.code !== 0) throw new Error(`tmux ${args[0]} failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
    return result.stdout;
  }

  attachArgv(name: string) {
    return ['tmux', '-S', this.socket, '-f', this.configPath, 'attach-session', '-r', '-t', `=${name}`];
  }

  get environment() { return this.env; }

  async newSession(name: string, options: { cwd: string; argv: readonly string[]; env: Record<string, string>; cols: number; rows: number }) {
    const envArgs = Object.entries(options.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
    // With more than one word after `--`, tmux executes argv directly with no shell parsing.
    // A single word would go through `sh -c`, so wrap it in env to keep direct execution.
    const argv = options.argv.length === 1 ? ['/usr/bin/env', ...options.argv] : options.argv;
    await this.must(['new-session', '-d', '-s', name, '-x', String(options.cols), '-y', String(options.rows),
      '-c', options.cwd, ...envArgs, '--', ...argv]);
  }

  async panes(): Promise<Map<string, PaneInfo> | null> {
    const result = await this.run(['list-panes', '-a', '-F', '#{session_name}|#{pane_pid}|#{pane_dead}|#{pane_dead_status}']);
    if (result.code !== 0) {
      const message = `${result.stderr}${result.stdout}`;
      if (/no server running|error connecting|No such file or directory/i.test(message)) return new Map();
      return null; // unknown
    }
    const panes = new Map<string, PaneInfo>();
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      const [name = '', pid, dead, status] = line.split('|');
      if (panes.has(name)) continue; // one pane per cockpit session
      panes.set(name, {
        name,
        pid: pid && /^\d+$/.test(pid) ? Number(pid) : null,
        dead: dead === '1',
        status: status && /^-?\d+$/.test(status) ? Number(status) : null,
      });
    }
    return panes;
  }

  async sendBytes(name: string, data: string) {
    const bytes = Buffer.from(data, 'utf8');
    for (let offset = 0; offset < bytes.length; offset += 256) {
      const hex = [...bytes.subarray(offset, offset + 256)].map(byte => byte.toString(16).padStart(2, '0'));
      await this.must(['send-keys', '-t', `=${name}:`, '-H', ...hex]);
    }
  }

  async sendKey(name: string, key: 'C-c' | 'Enter' | 'Escape') {
    await this.must(['send-keys', '-t', `=${name}:`, key]);
  }

  async capture(name: string, lines: number) {
    return this.must(['capture-pane', '-p', '-J', '-S', `-${lines}`, '-t', `=${name}:`]);
  }

  async resize(name: string, cols: number, rows: number) {
    await this.must(['resize-window', '-t', `=${name}:`, '-x', String(cols), '-y', String(rows)]);
  }

  async kill(name: string) {
    const result = await this.run(['kill-session', '-t', `=${name}`]);
    if (result.code !== 0 && !/can't find session|no server running|error connecting/i.test(result.stderr)) {
      throw new Error(`tmux kill-session failed: ${result.stderr.trim().slice(0, 300)}`);
    }
  }
}
