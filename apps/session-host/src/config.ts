import { homedir, hostname } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { CockpitKindSchema, type CockpitKind } from '@jarvis-command/contracts';

const flag = z.enum(['true', 'false', '1', '0']).transform(value => value === 'true' || value === '1');

const EnvironmentSchema = z.object({
  SESSION_HOST_BIND: z.string().min(1).default('127.0.0.1'),
  // Lets the main API stay on loopback for a same-host BFF while MCP listens for the lead's machine.
  SESSION_HOST_MCP_BIND: z.string().min(1).optional(),
  SESSION_HOST_PORT: z.coerce.number().int().min(0).max(65_535).default(8650),
  // 0 disables the MCP listener.
  SESSION_HOST_MCP_PORT: z.coerce.number().int().min(0).max(65_535).default(8651),
  SESSION_HOST_KEY: z.string().min(32),
  SESSION_HOST_MCP_KEY: z.string().min(32).optional(),
  SESSION_HOST_NAME: z.string().min(1).max(120).optional(),
  SESSION_HOST_STATE_DIR: z.string().optional(),
  SESSION_HOST_PROJECTS_DIR: z.string().optional(),
  SESSION_HOST_WORKTREES_DIR: z.string().optional(),
  SESSION_HOST_SHELL: z.string().optional(),
  // Comma-separated kinds Neal has qualified on this host (e.g. "claude,codex").
  SESSION_HOST_QUALIFIED: z.string().default(''),
  // Comma-separated kinds started without permission prompts (claude, codex, agy). Neal runs his agents
  // unattended; set it empty to bring the CLIs' own prompts back.
  SESSION_HOST_AUTONOMOUS: z.string().default('claude,codex,agy'),
  SESSION_HOST_REFRESH_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  SESSION_HOST_TRUST_PROXY: flag.default(false),
});

export type SessionHostConfig = Readonly<{
  bind: string;
  mcpBind: string;
  port: number;
  mcpPort: number;
  key: string;
  mcpKey: string | null;
  hostName: string;
  stateDir: string;
  projectsDir: string;
  worktreesDir: string;
  shell: string;
  qualified: ReadonlySet<CockpitKind>;
  autonomous: ReadonlySet<CockpitKind>;
  refreshMs: number;
}>;

function absolute(name: string, value: string | undefined, fallback: string) {
  const resolved = value ?? fallback;
  if (!isAbsolute(resolved)) throw new Error(`${name} must be an absolute path`);
  return resolved;
}

export function loadSessionHostConfig(environment: NodeJS.ProcessEnv): SessionHostConfig {
  const parsed = EnvironmentSchema.parse(environment);
  if (parsed.SESSION_HOST_MCP_PORT !== 0 && !parsed.SESSION_HOST_MCP_KEY) {
    throw new Error('SESSION_HOST_MCP_KEY is required unless SESSION_HOST_MCP_PORT=0');
  }
  if (parsed.SESSION_HOST_MCP_KEY && parsed.SESSION_HOST_MCP_KEY === parsed.SESSION_HOST_KEY) {
    // The lead must not be able to act as the human through the main API.
    throw new Error('SESSION_HOST_MCP_KEY must differ from SESSION_HOST_KEY');
  }
  const home = homedir();
  const qualified = new Set<CockpitKind>(['shell']);
  for (const item of parsed.SESSION_HOST_QUALIFIED.split(',').map(value => value.trim()).filter(Boolean)) {
    qualified.add(CockpitKindSchema.parse(item));
  }
  const autonomous = new Set<CockpitKind>();
  for (const item of parsed.SESSION_HOST_AUTONOMOUS.split(',').map(value => value.trim()).filter(Boolean)) {
    const kind = CockpitKindSchema.parse(item);
    if (kind !== 'claude' && kind !== 'codex' && kind !== 'agy') throw new Error(`SESSION_HOST_AUTONOMOUS supports claude, codex and agy, not ${kind}`);
    autonomous.add(kind);
  }
  return Object.freeze({
    bind: parsed.SESSION_HOST_BIND,
    mcpBind: parsed.SESSION_HOST_MCP_BIND ?? parsed.SESSION_HOST_BIND,
    port: parsed.SESSION_HOST_PORT,
    mcpPort: parsed.SESSION_HOST_MCP_PORT,
    key: parsed.SESSION_HOST_KEY,
    mcpKey: parsed.SESSION_HOST_MCP_KEY ?? null,
    hostName: parsed.SESSION_HOST_NAME ?? hostname(),
    stateDir: absolute('SESSION_HOST_STATE_DIR', parsed.SESSION_HOST_STATE_DIR, join(home, '.local', 'state', 'cockpit')),
    projectsDir: absolute('SESSION_HOST_PROJECTS_DIR', parsed.SESSION_HOST_PROJECTS_DIR, join(home, 'projects')),
    worktreesDir: absolute('SESSION_HOST_WORKTREES_DIR', parsed.SESSION_HOST_WORKTREES_DIR, join(home, 'worktrees')),
    shell: parsed.SESSION_HOST_SHELL ?? environment.SHELL ?? '/bin/bash',
    qualified,
    autonomous,
    refreshMs: parsed.SESSION_HOST_REFRESH_MS,
  });
}
