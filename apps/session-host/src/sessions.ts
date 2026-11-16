import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pty from 'node-pty';
import type {
  CockpitActor, CockpitKind, CockpitOwner, CockpitSession, CockpitSessionCreate, CockpitState,
} from '@jarvis-command/contracts';
import { ADAPTERS } from './adapters';
import type { SessionHostConfig } from './config';
import { Registry } from './registry';
import { redact, stripControl } from './redact';
import { Tmux, workerEnvironment } from './tmux';
import { diffWorkspace, prepareWorkspace, runCheck, WorkspaceError } from './workspace';

export class NotFoundError extends Error {}
export class ConflictError extends Error {
  constructor(message: string, readonly code: string, readonly owner?: CockpitOwner) { super(message); }
}

const LIVE: ReadonlySet<CockpitState> = new Set(['connecting', 'running', 'waiting_for_input', 'unknown']);
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// How much of a standing terminal's text is kept on disk, and how often it is refreshed.
const TRANSCRIPT_LINES = 3_000;
const SNAPSHOT_EVERY_MS = 30_000;

export type AgentOpenResult = {
  session: CockpitSession;
  // existing: it was already running. started: first terminal for this agent in the project.
  // reopened: it had stopped, exited or crashed, and was started again with its earlier output above.
  opened: 'existing' | 'started' | 'reopened';
  delivered: boolean;
  note: string | null;
};

// Claude Code keeps each conversation as ~/.claude/projects/<dir>/<session id>.jsonl. Resuming an id
// it never saved makes the CLI exit, so resume only when the file is there.
function claudeConversationExists(env: NodeJS.ProcessEnv, id: string) {
  if (!env.HOME) return false;
  const root = join(env.HOME, '.claude', 'projects');
  try {
    return readdirSync(root).some(dir => existsSync(join(root, dir, `${id}.jsonl`)));
  } catch { return false; }
}

export class SessionManager extends EventEmitter {
  readonly registry: Registry;
  readonly tmux: Tmux;
  readonly env: NodeJS.ProcessEnv;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly inputChains = new Map<string, Promise<unknown>>();
  private timer: NodeJS.Timeout | null = null;
  private readonly snapshots = new Map<string, { at: number; text: string }>();
  // Pause between pasting a message into an agent CLI and pressing Enter.
  submitDelayMs = 600;

  constructor(readonly config: SessionHostConfig, env: NodeJS.ProcessEnv = process.env) {
    super();
    this.setMaxListeners(0);
    mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    mkdirSync(config.projectsDir, { recursive: true });
    mkdirSync(config.worktreesDir, { recursive: true });
    this.env = workerEnvironment(env);
    this.registry = new Registry(config.stateDir);
    this.tmux = new Tmux(config.stateDir, this.env);
  }

  // Serializes admission and state writes so duplicate requests cannot race into two launches.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.refresh().catch(() => undefined); }, this.config.refreshMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private update(stale: CockpitSession, patch: Partial<CockpitSession>) {
    // Merge onto the latest record so a concurrent ownership change is never overwritten.
    const session = this.registry.get(stale.id) ?? stale;
    const stamp = now();
    const stateChanged = patch.state !== undefined && patch.state !== session.state;
    const next = this.registry.put({ ...session, ...patch, updatedAt: stamp, stateAt: stateChanged ? stamp : session.stateAt });
    this.emit('session', next);
    return next;
  }

  // Reconciles every live record with what tmux reports. Never relaunches anything.
  async refresh() {
    const panes = await this.tmux.panes();
    for (const session of this.registry.all()) {
      if (!LIVE.has(session.state) || session.state === 'connecting') continue;
      if (panes === null) {
        if (session.state !== 'unknown') this.update(session, { state: 'unknown' });
        continue;
      }
      const pane = panes.get(session.id);
      if (!pane) {
        this.update(session, { state: 'lost', pid: null });
      } else if (pane.dead) {
        this.update(session, { state: 'exited', exitCode: pane.status, pid: null });
      } else if (session.state === 'unknown' || session.pid !== pane.pid) {
        this.update(session, { state: 'running', pid: pane.pid });
      }
      if (session.standing && pane) await this.standingUpkeep(session, pane.dead, pane.activity);
    }
    await this.discoverNativeIds();
  }

  // Keeps a copy of each standing terminal's text on disk, so its history survives a crash, a host
  // reboot or Neal closing the tab, and stops one that has been quiet for longer than the idle limit.
  private async standingUpkeep(session: CockpitSession, dead: boolean, activity: number | null) {
    const last = this.snapshots.get(session.id);
    if (!last || Date.now() - last.at >= SNAPSHOT_EVERY_MS) await this.snapshot(session);
    const idleMs = this.config.idleStopMs;
    if (dead || !idleMs || activity === null || session.owner === 'human') return;
    if (Date.now() - activity * 1_000 < idleMs) return;
    const current = this.registry.get(session.id);
    if (!current || !LIVE.has(current.state)) return;
    await this.snapshot(current, true);
    await this.tmux.kill(current.id).catch(() => undefined);
    this.update(current, { state: 'stopped', pid: null });
  }

  transcriptPath(projectId: string, kind: CockpitKind) {
    return join(this.config.stateDir, 'transcripts', projectId, `${kind}.txt`);
  }

  // Saves the terminal's plain text (no colours) for the project's standing terminal of that agent.
  private async snapshot(session: CockpitSession, force = false) {
    const raw = await this.tmux.capture(session.id, TRANSCRIPT_LINES).catch(() => null);
    const stamp = Date.now();
    if (raw === null) return;
    const lines = raw.split('\n').map(line => line.trimEnd());
    while (lines.length && !lines.at(-1)) lines.pop();
    const text = lines.join('\n');
    const last = this.snapshots.get(session.id);
    this.snapshots.set(session.id, { at: stamp, text });
    if (!text.trim() || (!force && last?.text === text)) return;
    const path = this.transcriptPath(session.projectId, session.kind);
    mkdirSync(join(this.config.stateDir, 'transcripts', session.projectId), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${text}\n`, { mode: 0o600 });
  }

  // Records a CLI-chosen native id (agy's conversation) once the CLI has written it.
  private async discoverNativeIds() {
    for (const session of this.registry.all()) {
      const discover = ADAPTERS[session.kind].discoverNativeSessionId;
      if (!discover || session.nativeSessionId || !session.worktree || session.state === 'failed') continue;
      const nativeSessionId = await discover(session.cwd, this.env).catch(() => null);
      if (nativeSessionId && !this.registry.get(session.id)?.nativeSessionId) this.update(session, { nativeSessionId });
    }
  }

  list(projectId: string) {
    return this.registry.all().filter(session => session.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  get(id: string, projectId: string) {
    const session = this.registry.get(id);
    // A session in another project is indistinguishable from a missing one.
    if (!session || session.projectId !== projectId) throw new NotFoundError('Session not found');
    return session;
  }

  async create(input: CockpitSessionCreate, actor: CockpitActor): Promise<{ session: CockpitSession; created: boolean }> {
    return this.serial(async () => {
      const existing = this.registry.findByRequest(input.projectId, input.requestId);
      if (existing) {
        if (existing.kind !== input.kind || existing.title !== input.title) {
          throw new ConflictError('This request id was already used for a different session', 'request_conflict');
        }
        return { session: existing, created: false };
      }
      const adapter = ADAPTERS[input.kind];
      const id = `cs_${randomBytes(12).toString('hex')}`;
      const stamp = now();
      let session = this.registry.put({
        id, requestId: input.requestId, projectId: input.projectId, title: input.title, kind: input.kind,
        createdBy: actor, owner: actor, state: 'connecting', host: this.config.hostName, cwd: this.config.projectsDir,
        repository: input.repository ?? null, branch: null, worktree: false, nativeSessionId: null, pid: null,
        exitCode: null, failure: null, billing: adapter.billing, createdAt: stamp, updatedAt: stamp, stateAt: stamp,
      });
      this.emit('session', session);
      try {
        const workspace = await prepareWorkspace({
          projectsDir: this.config.projectsDir, worktreesDir: this.config.worktreesDir,
          projectId: input.projectId, sessionId: id, repository: input.repository,
          worktree: input.worktree ?? Boolean(input.repository), env: this.env,
        });
        session = this.update(session, { cwd: workspace.cwd, branch: workspace.branch, worktree: workspace.worktree });
        const refusal = adapter.preflight ? await adapter.preflight(workspace.cwd, this.env) : null;
        if (refusal) return { session: this.update(session, { state: 'failed', failure: refusal }), created: true };
        const nativeSessionId = adapter.assignNativeSessionId?.() ?? null;
        const prompt = adapter.promptViaArgv ? input.initialInput : undefined;
        const argv = adapter.argv({ shell: this.config.shell, prompt, nativeSessionId: nativeSessionId ?? undefined, autonomous: this.config.autonomous.has(input.kind) });
        await this.tmux.newSession(id, {
          cwd: workspace.cwd, argv, cols: input.cols ?? 120, rows: input.rows ?? 32,
          env: { COCKPIT_SESSION_ID: id, COCKPIT_PROJECT_ID: input.projectId },
        });
        const pane = (await this.tmux.panes())?.get(id);
        session = this.update(session, {
          state: pane && !pane.dead ? 'running' : pane?.dead ? 'exited' : 'unknown',
          pid: pane && !pane.dead ? pane.pid : null, exitCode: pane?.dead ? pane.status : null, nativeSessionId,
        });
        if (input.initialInput && adapter.promptWhenReady) {
          void this.typeWhenReady(id, input.initialInput);
        } else if (input.initialInput && !adapter.promptViaArgv) {
          await this.typeMessage(id, input.kind, input.initialInput, true);
        }
        return { session, created: true };
      } catch (error) {
        const failure = error instanceof WorkspaceError || error instanceof Error ? error.message : 'Launch failed';
        return { session: this.update(session, { state: 'failed', failure: failure.slice(0, 500) }), created: true };
      }
    });
  }

  // Waits until the TUI has drawn something and stopped changing (or 30s pass), then types the
  // first message as its creator. Skips it if someone else took input in the meantime.
  private async typeWhenReady(id: string, text: string) {
    const creator = this.registry.get(id)?.owner;
    try {
      if (!await this.settled(id, creator)) return;
      const kind = this.registry.get(id)?.kind ?? 'shell';
      await this.typeMessage(id, kind, text, true);
    } catch { /* the session ended; nothing to type into */ }
  }

  // Agent TUIs (Codex in particular) treat a fast burst of keystrokes followed straight away by
  // Enter as a paste and put a newline in the composer instead of submitting. So a message to an
  // agent goes in as one bracketed paste, Enter follows after a pause, and if the text still sits
  // in the composer a moment later, Enter is pressed once more (an Enter on an empty composer is a no-op).
  private async typeMessage(id: string, kind: CockpitKind, text: string, submit: boolean) {
    const agent = kind !== 'shell';
    const pasted = agent || text.includes('\n') || text.length > 1_000;
    if (pasted) await this.tmux.paste(id, text);
    else await this.tmux.sendBytes(id, text);
    if (!submit) return;
    if (pasted) await sleep(agent ? this.submitDelayMs : 250);
    await this.tmux.sendKey(id, 'Enter');
    if (!agent) return;
    await sleep(this.submitDelayMs * 2);
    if (await this.stillInComposer(id, text)) await this.tmux.sendKey(id, 'Enter');
  }

  // True when the end of the text still shows on the last few lines of the screen, where the
  // agent's composer is, meaning the Enter was taken as a newline rather than a submit.
  private async stillInComposer(id: string, text: string) {
    const lastLine = text.trim().split('\n').at(-1)?.trim() ?? '';
    const needle = lastLine.slice(-24);
    if (!needle) return false;
    const screen = await this.tmux.capture(id, 0).catch(() => '');
    // The composer sits at the bottom, under at most a couple of footer lines.
    return stripControl(screen).split('\n').map(line => line.trim()).filter(Boolean).slice(-4).some(line => line.includes(needle));
  }

  // Waits until the screen has drawn something and stopped changing (or the limit passes).
  // False when the session ended or its input owner changed meanwhile.
  private async settled(id: string, owner: CockpitOwner | undefined, settleMs = 1_200, limitMs = 30_000) {
    const started = Date.now();
    let last = '', stableSince = Date.now();
    while (Date.now() - started < limitMs) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const session = this.registry.get(id);
      if (!session || !LIVE.has(session.state) || session.owner !== owner) return false;
      const screen = (await this.tmux.capture(id, 0)).trim();
      if (screen !== last) { last = screen; stableSince = Date.now(); continue; }
      if (screen && Date.now() - stableSince >= settleMs) break;
    }
    const session = this.registry.get(id);
    return Boolean(session && LIVE.has(session.state) && session.owner === owner);
  }

  private standingFor(projectId: string, kind: CockpitKind) {
    return this.registry.all()
      .filter(session => session.projectId === projectId && session.kind === kind && session.standing)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  // The project's one long-lived terminal for an agent CLI. Opens it the first time, reuses it while
  // it runs, and starts it again (with its earlier output shown above) after it stopped or crashed.
  // A task is pasted into it as the next message.
  async openAgent(input: { projectId: string; kind: CockpitKind; task?: string | undefined; repository?: string | undefined; cols?: number | undefined; rows?: number | undefined }, actor: CockpitActor): Promise<AgentOpenResult> {
    const { session: opened, opened: how } = await this.serial(async () => {
      const existing = this.standingFor(input.projectId, input.kind);
      if (existing && LIVE.has(existing.state)) return { session: existing, opened: 'existing' as const };
      if (existing) return { session: await this.launchStanding(existing, input.cols, input.rows), opened: 'reopened' as const };
      const stamp = now();
      const adapter = ADAPTERS[input.kind];
      const id = `cs_${randomBytes(12).toString('hex')}`;
      let session = this.registry.put({
        id, requestId: `agent-${input.kind}-${randomBytes(6).toString('hex')}`, projectId: input.projectId, title: adapter.label,
        kind: input.kind, createdBy: actor, owner: actor, state: 'connecting', host: this.config.hostName, cwd: this.config.projectsDir,
        repository: input.repository ?? null, branch: null, worktree: false, nativeSessionId: null, pid: null,
        exitCode: null, failure: null, billing: adapter.billing, standing: true, createdAt: stamp, updatedAt: stamp, stateAt: stamp,
      });
      this.emit('session', session);
      try {
        const workspace = await prepareWorkspace({
          projectsDir: this.config.projectsDir, worktreesDir: this.config.worktreesDir,
          projectId: input.projectId, sessionId: id, repository: input.repository, worktree: false, env: this.env,
        });
        session = this.update(session, { cwd: workspace.cwd, branch: workspace.branch });
      } catch (error) {
        const failure = error instanceof Error ? error.message : 'Launch failed';
        return { session: this.update(session, { state: 'failed', failure: failure.slice(0, 500) }), opened: 'started' as const };
      }
      return { session: await this.launchStanding(session, input.cols, input.rows), opened: 'started' as const };
    });

    let session = opened;
    const result = (delivered: boolean, note: string | null): AgentOpenResult => ({ session: this.registry.get(session.id) ?? session, opened: how, delivered, note });
    if (!LIVE.has(session.state)) return result(false, session.failure ?? `The terminal is ${session.state}.`);
    if (!input.task) return result(false, null);
    if (session.owner === 'none' && actor === 'lead') session = this.ownership(session.id, session.projectId, 'lead', 'take');
    if (session.owner !== actor) {
      return result(false, actor === 'lead' ? 'Neal has input on this terminal, so the task was not sent. Ask him to hand it back, or wait.' : 'The lead has input on this terminal. Take over to type.');
    }
    if (how !== 'existing' && !await this.settled(session.id, actor).catch(() => false)) {
      return result(false, 'The terminal ended or changed hands before it was ready, so the task was not sent.');
    }
    await this.input(session.id, session.projectId, actor, input.task, true);
    return result(true, null);
  }

  // (Re)starts a standing terminal's process: in its old pane when that is still there (the CLI exited),
  // otherwise in a new one. Either way it first prints the saved text of the earlier run.
  private async launchStanding(stale: CockpitSession, cols = 120, rows = 32) {
    let session = this.registry.get(stale.id) ?? stale;
    const adapter = ADAPTERS[session.kind];
    try {
      const refusal = adapter.preflight ? await adapter.preflight(session.cwd, this.env) : null;
      if (refusal) return this.update(session, { state: 'failed', failure: refusal, pid: null });
      const previous = session.nativeSessionId;
      const resume = previous && (session.kind !== 'claude' || claudeConversationExists(this.env, previous)) ? previous : undefined;
      const nativeSessionId = resume ?? adapter.assignNativeSessionId?.() ?? null;
      const argv = adapter.argv({
        shell: this.config.shell, resume, nativeSessionId: resume ? undefined : nativeSessionId ?? undefined,
        autonomous: this.config.autonomous.has(session.kind),
      });
      const pane = (await this.tmux.panes())?.get(session.id);
      // Respawning a pane clears its scrollback, so save the finished run's text first.
      if (pane) await this.snapshot(session, true);
      const transcript = this.transcriptPath(session.projectId, session.kind);
      const reopening = existsSync(transcript);
      const banner = reopening ? `--- ${adapter.label} reopened ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${resume ? ', same conversation' : ''} ---` : '';
      // Prints the earlier output and a divider, then runs the CLI.
      const wrapped = reopening
        ? ['/bin/sh', '-c', 'cat "$1" 2>/dev/null; printf "\\n%s\\n\\n" "$2"; shift 2; exec "$@"', 'cockpit', transcript, banner, ...argv]
        : argv;
      const env = { COCKPIT_SESSION_ID: session.id, COCKPIT_PROJECT_ID: session.projectId };
      if (pane) await this.tmux.respawn(session.id, { cwd: session.cwd, argv: wrapped, env });
      else await this.tmux.newSession(session.id, { cwd: session.cwd, argv: wrapped, cols, rows, env });
      const live = (await this.tmux.panes())?.get(session.id);
      session = this.update(session, {
        state: live && !live.dead ? 'running' : live?.dead ? 'exited' : 'unknown',
        pid: live && !live.dead ? live.pid : null, exitCode: live?.dead ? live.status : null, failure: null, nativeSessionId,
      });
      this.snapshots.set(session.id, { at: Date.now(), text: '' });
      return session;
    } catch (error) {
      const failure = error instanceof Error ? error.message : 'Launch failed';
      return this.update(session, { state: 'failed', failure: failure.slice(0, 500), pid: null });
    }
  }

  private requireLive(session: CockpitSession) {
    if (session.state !== 'running' && session.state !== 'waiting_for_input') {
      throw new ConflictError(`Session is ${session.state}`, 'not_running');
    }
  }

  async input(id: string, projectId: string, actor: CockpitActor, data: string, submit = false) {
    const session = this.get(id, projectId);
    if (session.owner !== actor) {
      throw new ConflictError(
        actor === 'lead' ? 'Neal has input on this session. Ask him to hand it back.' : 'The lead has input on this session. Take over to type.',
        'not_owner', session.owner,
      );
    }
    this.requireLive(session);
    // Per-session ordering: keystrokes from one owner arrive in the order sent.
    const previous = this.inputChains.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      // Re-check ownership at write time so a takeover wins over queued lead input.
      if (this.registry.get(id)?.owner !== actor) throw new ConflictError('Input ownership changed', 'not_owner');
      await this.typeMessage(id, session.kind, data, submit);
    });
    this.inputChains.set(id, next.catch(() => undefined));
    await next;
  }

  // Synchronous on purpose: a takeover never waits behind a slow launch or clone.
  ownership(id: string, projectId: string, actor: CockpitActor, action: 'take' | 'hand_to_lead' | 'release') {
    const session = this.get(id, projectId);
    let owner: CockpitOwner;
    if (actor === 'human') {
      owner = action === 'take' ? 'human' : action === 'hand_to_lead' ? 'lead' : (session.owner === 'human' ? 'none' : session.owner);
    } else if (action === 'take') {
      if (session.owner !== 'none' && session.owner !== 'lead') {
        throw new ConflictError('Neal has input on this session. Only he can hand it to the lead.', 'not_owner', session.owner);
      }
      owner = 'lead';
    } else if (action === 'release') {
      owner = session.owner === 'lead' ? 'none' : session.owner;
    } else {
      throw new ConflictError('Only Neal can hand input to the lead', 'forbidden');
    }
    return owner === session.owner ? session : this.update(session, { owner });
  }

  async interrupt(id: string, projectId: string, actor: CockpitActor) {
    const session = this.get(id, projectId);
    if (actor === 'lead' && session.owner !== 'lead') throw new ConflictError('The lead does not have input on this session', 'not_owner', session.owner);
    this.requireLive(session);
    await this.tmux.sendKey(id, 'C-c');
  }

  async stopSession(id: string, projectId: string, actor: CockpitActor) {
    const session = this.get(id, projectId);
    if (actor === 'lead' && (session.owner !== 'lead' || session.createdBy !== 'lead')) {
      throw new ConflictError('The lead can only stop sessions it started and still controls', 'not_owner', session.owner);
    }
    if (actor === 'lead' && session.standing) {
      throw new ConflictError(`This is the project's ${session.title} terminal. It stays open between tasks so Neal can see its history; only Neal closes it. Send the next task to it instead.`, 'standing');
    }
    if (session.standing) await this.snapshot(session, true);
    await this.tmux.kill(id);
    return this.update(session, { state: 'stopped', pid: null });
  }

  // Closes a terminal tab for good: stops the process if it still runs and forgets the record.
  // The worktree (and any commits in it) stays on disk.
  async closeSession(id: string, projectId: string) {
    const session = this.get(id, projectId);
    if (session.standing) await this.snapshot(session, true);
    await this.tmux.kill(id).catch(() => undefined);
    this.registry.remove(session.id);
    this.snapshots.delete(session.id);
    return { id: session.id };
  }

  async resize(id: string, projectId: string, cols: number, rows: number) {
    this.get(id, projectId);
    await this.tmux.resize(id, cols, rows);
  }

  async tail(id: string, projectId: string, lines = 80) {
    this.get(id, projectId);
    const bounded = Math.min(Math.max(lines, 1), 400);
    const raw = await this.tmux.capture(id, bounded).catch(() => '');
    const text = redact(stripControl(raw)).split('\n').map(line => line.trimEnd());
    while (text.length && !text.at(-1)) text.pop();
    return text.slice(-bounded).join('\n').slice(-20_000);
  }

  async diff(id: string, projectId: string) {
    const session = this.get(id, projectId);
    return diffWorkspace(session.cwd, this.env);
  }

  // A check runs a command in the session's working directory, so it follows the same
  // ownership line as typing: the lead may run one only while it holds input, or on a
  // session it started that nobody holds. Neal (human) always may. Finished sessions are
  // allowed on purpose: verifying a worktree after its agent exits is the integration step.
  async check(id: string, projectId: string, actor: CockpitActor, command: string, timeoutSeconds = 600) {
    const session = this.get(id, projectId);
    if (actor === 'lead' && !(session.owner === 'lead' || (session.owner === 'none' && session.createdBy === 'lead'))) {
      throw new ConflictError(session.owner === 'human' ? 'Neal has input on this session. The lead cannot run checks in it until he hands it back.' : 'The lead can only run checks in sessions it controls', 'not_owner', session.owner);
    }
    const result = await runCheck(session.cwd, command, this.env, Math.min(Math.max(timeoutSeconds, 1), 3_600) * 1_000);
    return { ...result, output: redact(result.output) };
  }

  // Viewers attach read-only; their keystrokes go through input() so ownership applies.
  attach(id: string, projectId: string, cols: number, rows: number) {
    this.get(id, projectId);
    const [command, ...args] = this.tmux.attachArgv(id);
    return pty.spawn(command ?? 'tmux', args, { name: 'xterm-256color', cols, rows, cwd: this.config.stateDir, env: this.env as Record<string, string> });
  }
}
