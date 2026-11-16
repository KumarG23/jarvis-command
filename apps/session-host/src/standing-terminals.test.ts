import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadSessionHostConfig, type SessionHostConfig } from './config';
import { buildMcpApp } from './mcp';
import { SessionManager } from './sessions';

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
const MCP_KEY = 'm'.repeat(40);

const waitFor = async <T>(probe: () => Promise<T | undefined> | T | undefined, timeoutMs = 10_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};

// A stand-in Codex CLI: answers the login preflight, then echoes every line it is sent.
const FAKE_CODEX = `#!/bin/sh
case "$1" in login) echo "Logged in using ChatGPT"; exit 0;; esac
echo "CODEX READY"
while IFS= read -r line; do
  echo "codex got:$line"
  [ "$line" = quit ] && exit 3
done
`;

// A stand-in for Codex's composer: like the real TUI, an Enter that arrives within 50ms of other
// input counts as part of a paste burst and becomes a newline instead of submitting.
const BURSTY_CODEX = `#!/usr/bin/env python3
import os, sys, time, tty
if len(sys.argv) > 1 and sys.argv[1] == 'login':
    print('Logged in using ChatGPT'); sys.exit(0)
tty.setraw(0)
def out(text):
    os.write(1, text.encode())
out('\\x1b[?2004hCODEX READY\\r\\n> ')
buf, last, paste = '', 0.0, False
while True:
    data = os.read(0, 4096).decode(errors='replace')
    if not data: break
    now = time.monotonic()
    while data:
        if data.startswith('\\x1b[200~'): paste, data = True, data[6:]; continue
        if data.startswith('\\x1b[201~'): paste, data = False, data[6:]; continue
        ch, data = data[0], data[1:]
        if ch == '\\r' and not paste and now - last >= 0.05:
            out('\\r\\nsubmitted:' + buf.replace('\\n', '|') + '\\r\\n> '); buf = ''
        else:
            buf += '\\n' if ch in '\\r\\n' else ch
            out(ch if ch not in '\\r\\n' else '\\r\\n  ')
        last = now
`;
const hasPython = spawnSync('python3', ['-V']).status === 0;

describe.skipIf(!hasTmux)('standing agent terminals (real tmux)', () => {
  let root: string;
  let manager: SessionManager;
  let mcp: FastifyInstance;

  const makeConfig = (extra: Record<string, string> = {}): SessionHostConfig => loadSessionHostConfig({
    SESSION_HOST_KEY: 'k'.repeat(40), SESSION_HOST_MCP_KEY: MCP_KEY, SESSION_HOST_PORT: '0', SESSION_HOST_MCP_PORT: '0',
    SESSION_HOST_STATE_DIR: join(root, 'state'), SESSION_HOST_PROJECTS_DIR: join(root, 'projects'),
    SESSION_HOST_WORKTREES_DIR: join(root, 'worktrees'), SESSION_HOST_SHELL: '/bin/bash', SESSION_HOST_NAME: 'test-host',
    SESSION_HOST_REFRESH_MS: '250', HOME: root, PATH: process.env.PATH ?? '', ...extra,
  });
  const start = async (extra: Record<string, string> = {}) => {
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'codex'), FAKE_CODEX, { mode: 0o755 });
    manager = new SessionManager(makeConfig(extra), { HOME: root, HISTFILE: '/dev/null', PATH: `${bin}:${process.env.PATH ?? ''}` });
    mcp = buildMcpApp(manager);
    await mcp.ready();
  };

  const call = async (name: string, args: Record<string, unknown>) => {
    const response = (await mcp.inject({
      method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${MCP_KEY}` },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    })).json<{ result?: { content?: { text: string }[]; isError?: boolean } }>();
    const text = response.result?.content?.[0]?.text ?? '';
    return { isError: response.result?.isError === true, text, json: () => JSON.parse(text) as { opened: string; taskSent: boolean; note?: string; session: { id: string; state: string; standing: boolean; owner: string } } };
  };
  const tailHas = (id: string, needle: string) => waitFor(async () => {
    const text = await manager.tail(id, 'proj1', 400);
    return text.includes(needle) ? text : undefined;
  });

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cockpit-standing-')); });
  afterEach(async () => {
    manager.stop();
    await mcp.close();
    spawnSync('tmux', ['-S', join(root, 'state', 'tmux.sock'), 'kill-server']);
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* leftover temp dir */ }
  });

  it('sends every task to one Codex terminal per project instead of opening new ones', async () => {
    await start();
    const first = (await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'task one' })).json();
    expect(first).toMatchObject({ opened: 'started', taskSent: true, session: { standing: true, owner: 'lead', state: 'running' } });
    await tailHas(first.session.id, 'codex got:task one');

    // A per-task create_session (the old habit) lands in the same terminal.
    const second = (await call('create_session', { projectId: 'proj1', requestId: 'lead-task-0002', title: 'Fix bug 12', kind: 'codex', task: 'task two' })).json();
    expect(second).toMatchObject({ opened: 'existing', taskSent: true, session: { id: first.session.id } });
    const text = await tailHas(first.session.id, 'codex got:task two');
    expect(text.indexOf('task one')).toBeLessThan(text.indexOf('task two'));

    // Multi-line tasks arrive whole, in order.
    await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'line A\nline B' });
    await tailHas(first.session.id, 'codex got:line B');

    expect(manager.list('proj1').filter(session => session.kind === 'codex')).toHaveLength(1);
    // Only an explicit request opens a parallel terminal.
    const extra = (await call('create_session', { projectId: 'proj1', requestId: 'lead-task-0003', title: 'Parallel', kind: 'codex', separate: true })).json();
    expect(extra.session.id).not.toBe(first.session.id);
    // Other projects get their own.
    const other = (await call('open_agent', { projectId: 'proj2', kind: 'codex' })).json();
    expect(other.session.id).not.toBe(first.session.id);
  }, 30_000);

  it('never lets the lead stop it, and reopens it with its history after a stop, an exit or a close', async () => {
    await start();
    const { session } = (await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'remember-me' })).json();
    await tailHas(session.id, 'codex got:remember-me');

    const refused = await call('stop_session', { projectId: 'proj1', sessionId: session.id });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('only Neal closes it');

    // Neal stops it: the next task restarts the same terminal and shows the earlier output above.
    await manager.stopSession(session.id, 'proj1', 'human');
    const reopened = (await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'after-stop' })).json();
    expect(reopened).toMatchObject({ opened: 'reopened', taskSent: true, session: { id: session.id, state: 'running' } });
    let text = await tailHas(session.id, 'codex got:after-stop');
    expect(text).toContain('codex got:remember-me');
    expect(text).toContain('Codex reopened');

    // The CLI exits on its own: the pane is restarted in place with its scrollback.
    await manager.input(session.id, 'proj1', 'lead', 'quit', true);
    await waitFor(async () => { await manager.refresh(); return manager.get(session.id, 'proj1').state === 'exited' || undefined; });
    await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'after-exit' });
    text = await tailHas(session.id, 'codex got:after-exit');
    expect(text).toContain('codex got:remember-me');

    // Neal closes the tab: a new terminal opens next time, still showing what came before.
    await manager.closeSession(session.id, 'proj1');
    expect(existsSync(manager.transcriptPath('proj1', 'codex'))).toBe(true);
    const fresh = (await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'after-close' })).json();
    expect(fresh.session.id).not.toBe(session.id);
    text = await tailHas(fresh.session.id, 'codex got:after-close');
    expect(text).toContain('codex got:after-exit');
  }, 40_000);

  it.skipIf(!hasPython)('submits a task to a Codex-style composer with one call, no extra Enter needed', async () => {
    await start();
    writeFileSync(join(root, 'bin', 'codex'), BURSTY_CODEX, { mode: 0o755 });
    const first = (await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'short task' })).json();
    expect(first.taskSent).toBe(true);
    await tailHas(first.session.id, 'submitted:short task');
    await call('send_input', { projectId: 'proj1', sessionId: first.session.id, text: 'second task' });
    await tailHas(first.session.id, 'submitted:second task');
    await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'line one\nline two' });
    await tailHas(first.session.id, 'submitted:line one|line two');
  }, 30_000);

  it('does not type over Neal while he has input', async () => {
    await start();
    const { session } = (await call('open_agent', { projectId: 'proj1', kind: 'codex' })).json();
    manager.ownership(session.id, 'proj1', 'human', 'take');
    const result = (await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'not now' })).json();
    expect(result).toMatchObject({ taskSent: false, session: { id: session.id, owner: 'human' } });
    expect(result.note).toContain('Neal has input');
  }, 20_000);

  it('stops a terminal after the idle limit and keeps its text for the reopen', async () => {
    await start({ SESSION_HOST_IDLE_HOURS: '0.0005' }); // 1.8 seconds
    const { session } = (await call('open_agent', { projectId: 'proj1', kind: 'codex', task: 'idle-test' })).json();
    await tailHas(session.id, 'codex got:idle-test');
    await waitFor(async () => { await manager.refresh(); return manager.get(session.id, 'proj1').state === 'stopped' || undefined; }, 15_000);
    expect(readFileSync(manager.transcriptPath('proj1', 'codex'), 'utf8')).toContain('codex got:idle-test');
    expect((await manager.tmux.panes())?.has(session.id)).toBeFalsy();
  }, 25_000);
});
