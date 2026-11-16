import { existsSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { exec } from './exec';

export class WorkspaceError extends Error {}

const git = async (cwd: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs = 120_000) => {
  const result = await exec(['git', ...args], { cwd, env, timeoutMs });
  if (result.code !== 0) throw new WorkspaceError(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim().slice(0, 400)}`);
  return result.stdout;
};

function repoName(repository: string) {
  const name = basename(repository.replace(/[/:]+$/, '')).replace(/\.git$/, '').replace(/[^A-Za-z0-9._-]/g, '-');
  if (!name || name === '.' || name === '..') throw new WorkspaceError('Cannot derive a directory name from the repository');
  return name;
}

export type Workspace = { cwd: string; repository: string | null; branch: string | null; worktree: boolean };

// Resolves where a session runs. With a repository, coding sessions get their own git
// worktree and branch so concurrent agents never share a checkout. Existing checkouts,
// branches and dirty work are never modified or removed.
export async function prepareWorkspace(options: {
  projectsDir: string; worktreesDir: string; projectId: string; sessionId: string;
  repository?: string | undefined; worktree: boolean; env: NodeJS.ProcessEnv;
}): Promise<Workspace> {
  const projectDir = join(options.projectsDir, options.projectId);
  mkdirSync(projectDir, { recursive: true });
  if (!options.repository) return { cwd: projectDir, repository: null, branch: null, worktree: false };

  let checkout: string;
  if (isAbsolute(options.repository)) {
    checkout = options.repository;
    if (!existsSync(checkout)) throw new WorkspaceError(`Repository path ${checkout} does not exist on this host`);
  } else {
    checkout = join(projectDir, repoName(options.repository));
    if (!existsSync(checkout)) {
      await git(projectDir, ['clone', '--', options.repository, checkout], options.env, 600_000);
    }
  }
  const top = (await git(checkout, ['rev-parse', '--show-toplevel'], options.env)).trim();
  const current = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD'], options.env)).trim();
  if (!options.worktree) return { cwd: top, repository: options.repository, branch: current === 'HEAD' ? null : current, worktree: false };

  const branch = `cockpit/${options.sessionId}`;
  const path = join(options.worktreesDir, options.projectId, options.sessionId);
  mkdirSync(join(options.worktreesDir, options.projectId), { recursive: true });
  if (!existsSync(path)) await git(top, ['worktree', 'add', '-b', branch, path, 'HEAD'], options.env);
  return { cwd: path, repository: options.repository, branch, worktree: true };
}

export type DiffResult = {
  head: string | null; branch: string | null; status: string; stat: string; patch: string;
  untracked: string[]; truncated: boolean;
};

export async function diffWorkspace(cwd: string, env: NodeJS.ProcessEnv, maxBytes = 200_000): Promise<DiffResult> {
  const inside = await exec(['git', 'rev-parse', '--is-inside-work-tree'], { cwd, env, timeoutMs: 10_000 });
  if (inside.code !== 0) throw new WorkspaceError('This session is not in a git repository');
  const run = (args: string[]) => exec(['git', ...args], { cwd, env, timeoutMs: 60_000, maxBytes });
  const [head, branch, status, stat, patch, untracked] = await Promise.all([
    run(['rev-parse', 'HEAD']), run(['rev-parse', '--abbrev-ref', 'HEAD']), run(['status', '--porcelain=v1']),
    run(['diff', 'HEAD', '--stat']), run(['diff', 'HEAD']), run(['ls-files', '--others', '--exclude-standard']),
  ]);
  return {
    head: head.code === 0 ? head.stdout.trim() : null,
    branch: branch.code === 0 ? branch.stdout.trim() : null,
    status: status.stdout,
    stat: stat.stdout,
    patch: patch.stdout,
    untracked: untracked.stdout.split('\n').filter(Boolean).slice(0, 500),
    truncated: patch.truncated,
  };
}

export async function runCheck(cwd: string, command: string, env: NodeJS.ProcessEnv, timeoutMs: number) {
  const started = Date.now();
  const result = await exec(['bash', '-lc', command], { cwd, env, timeoutMs, maxBytes: 64_000 });
  return {
    command,
    exitCode: result.code,
    timedOut: result.timedOut,
    durationMs: Date.now() - started,
    output: `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`.slice(-64_000),
    truncated: result.truncated,
  };
}
