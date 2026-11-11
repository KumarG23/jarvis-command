import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CockpitAdapter, CockpitKind } from '@jarvis-command/contracts';
import { exec } from './exec';

// One entry per supported CLI. Each runs the official binary interactively under its own
// login; the cockpit never supplies credentials. Prompt flags are per-CLI and are only
// trusted once that adapter is qualified on the host (SESSION_HOST_QUALIFIED).
export type AdapterDefinition = {
  kind: CockpitKind;
  label: string;
  binary: (shell: string) => string;
  billing: string;
  argv: (options: { shell: string; prompt?: string | undefined; resume?: string | undefined; nativeSessionId?: string | undefined }) => string[];
  // Generates a native session id up front when the CLI accepts one, so lineage is known before launch.
  assignNativeSessionId?: () => string;
  // Shells read the first message from the keyboard; CLIs take it as an argument.
  promptViaArgv: boolean;
  // Refuses a launch that would bill a paid API instead of the subscription. Login is not
  // required: a logged-out CLI shows its own official login flow in the terminal.
  preflight?: (cwd: string, env: NodeJS.ProcessEnv) => Promise<string | null>;
  note: string | null;
};

const claudePreflight = async (cwd: string, env: NodeJS.ProcessEnv) => {
  const result = await exec(['claude', 'auth', 'status'], { cwd, env, timeoutMs: 15_000 });
  if (result.code !== 0) return null; // logged out or older CLI: the interactive login handles it
  try {
    const status = JSON.parse(result.stdout) as { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown };
    if (status.loggedIn === true && typeof status.authMethod === 'string' && /api.?key/i.test(status.authMethod)) {
      return 'Claude Code is logged in with an API key, which bills the API. Log in with your Claude subscription (claude.ai) instead.';
    }
    if (status.loggedIn === true && typeof status.apiProvider === 'string' && status.apiProvider !== 'firstParty') {
      return `Claude Code is routed to ${status.apiProvider}, not your Claude subscription.`;
    }
  } catch {
    // Unrecognized output: do not block the launch on a parser.
  }
  return null;
};

const codexPreflight = async (cwd: string, env: NodeJS.ProcessEnv) => {
  const result = await exec(['codex', 'login', 'status'], { cwd, env, timeoutMs: 15_000 });
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0 && /api key/i.test(text) && !/chatgpt/i.test(text)) {
    return 'Codex is logged in with an API key, which bills the API. Run `codex login` with your ChatGPT account instead.';
  }
  return null;
};

// agy bills the Gemini API only when a Google API key is supplied. Keys are stripped from the
// worker environment, so the remaining route is a key written into agy's own settings file.
const agyPreflight = async (_cwd: string, env: NodeJS.ProcessEnv) => {
  const home = env.HOME;
  if (!home) return null;
  let text: string;
  try { text = await readFile(join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'); } catch { return null; }
  if (/AIza[0-9A-Za-z_-]{35}/.test(text)) {
    return 'agy has a Google API key in ~/.gemini/antigravity-cli/settings.json, which bills the Gemini API. Remove it and use your Google account login instead.';
  }
  return null;
};

// agy can also spend paid AI credits once the subscription quota runs out. The read-only
// `/config` command in print mode starts no agent turn and uses no quota (verified in Dev
// Studio's launcher), so it is safe to run before every launch.
const agyCreditsPreflight = async (cwd: string, env: NodeJS.ProcessEnv) => {
  const result = await exec(['agy', '--output-format', 'json', '-p', '/config'], { cwd, env, timeoutMs: 20_000 });
  if (result.code !== 0) return null; // logged out or older CLI: the interactive login handles it
  try {
    const payload = JSON.parse(result.stdout) as { status?: unknown; command?: { data?: { config?: Record<string, unknown> } } };
    const config = payload.command?.data?.config;
    if (payload.status !== 'SUCCESS' || !config || typeof config !== 'object') return null;
    if (config.useG1Credits === true || config.useAiCredits === true || config.use_ai_credits === true) {
      return 'agy is set to spend paid AI credits when your plan runs out. Turn that off in agy (/config, credits: Never) first.';
    }
  } catch {
    // Unrecognized output: do not block the launch on a parser.
  }
  return null;
};

export const ADAPTERS: Record<CockpitKind, AdapterDefinition> = {
  shell: {
    kind: 'shell', label: 'Shell', binary: shell => shell, billing: 'No model usage',
    argv: ({ shell }) => [shell, '-l'], promptViaArgv: false, note: null,
  },
  claude: {
    kind: 'claude', label: 'Claude Code', binary: () => 'claude', billing: 'Claude subscription (official Claude Code CLI)',
    argv: ({ prompt, resume, nativeSessionId }) => ['claude',
      ...(resume ? ['--resume', resume] : nativeSessionId ? ['--session-id', nativeSessionId] : []),
      ...(prompt ? [prompt] : [])],
    assignNativeSessionId: () => randomUUID(),
    promptViaArgv: true, preflight: claudePreflight, note: null,
  },
  codex: {
    kind: 'codex', label: 'Codex', binary: () => 'codex', billing: 'ChatGPT subscription (official Codex CLI)',
    argv: ({ prompt, resume }) => (resume ? ['codex', 'resume', resume] : ['codex', ...(prompt ? [prompt] : [])]),
    promptViaArgv: true, preflight: codexPreflight, note: null,
  },
  agy: {
    kind: 'agy', label: 'Antigravity (agy)', binary: () => 'agy', billing: 'Google account (official Antigravity CLI)',
    argv: ({ prompt, resume }) => ['agy', ...(resume ? ['--conversation', resume] : []), ...(prompt ? ['--prompt-interactive', prompt] : [])],
    promptViaArgv: true, preflight: async (cwd, env) => await agyPreflight(cwd, env) ?? await agyCreditsPreflight(cwd, env),
    note: 'Conversation IDs are not captured yet; resume by ID once lineage is wired.',
  },
  gemini: {
    kind: 'gemini', label: 'Gemini CLI', binary: () => 'gemini', billing: 'Google account (official Gemini CLI)',
    argv: ({ prompt }) => ['gemini', ...(prompt ? ['--prompt-interactive', prompt] : [])],
    promptViaArgv: true, note: 'Resume is not wired yet.',
  },
  opencode: {
    kind: 'opencode', label: 'OpenCode', binary: () => 'opencode', billing: 'Per OpenCode provider configuration',
    argv: ({ prompt }) => ['opencode', ...(prompt ? ['--prompt', prompt] : [])],
    promptViaArgv: true, note: 'Billing depends on the provider OpenCode is configured with.',
  },
};

export async function describeAdapters(shell: string, qualified: ReadonlySet<CockpitKind>, env: NodeJS.ProcessEnv): Promise<CockpitAdapter[]> {
  return Promise.all(Object.values(ADAPTERS).map(async (adapter) => {
    const binary = adapter.binary(shell);
    const result = adapter.kind === 'shell'
      ? await exec([binary, '-c', 'echo "$BASH_VERSION"'], { env, timeoutMs: 5_000 })
      : await exec([binary, '--version'], { env, timeoutMs: 10_000 });
    const available = result.code === 0;
    const version = available ? (result.stdout.trim().split('\n')[0] ?? '').slice(0, 120) || null : null;
    return {
      kind: adapter.kind,
      label: adapter.label,
      available,
      version,
      billing: adapter.billing,
      qualified: qualified.has(adapter.kind),
      note: available ? adapter.note : `${binary} is not installed on this host.`,
    };
  }));
}
