import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import * as pty from 'node-pty';
import type {
  CockpitActor, CockpitOwner, CockpitSession, CockpitSessionCreate, CockpitState,
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

export class SessionManager extends EventEmitter {
  readonly registry: Registry;
  readonly tmux: Tmux;
  readonly env: NodeJS.ProcessEnv;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly inputChains = new Map<string, Promise<unknown>>();
  private timer: NodeJS.Timeout | null = null;

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
    }
    await this.discoverNativeIds();
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
          await this.tmux.sendBytes(id, input.initialInput);
          await this.tmux.sendKey(id, 'Enter');
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
  private async typeWhenReady(id: string, text: string, settleMs = 1_200, limitMs = 30_000) {
    const creator = this.registry.get(id)?.owner;
    const started = Date.now();
    let last = '', stableSince = Date.now();
    try {
      while (Date.now() - started < limitMs) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const session = this.registry.get(id);
        if (!session || !LIVE.has(session.state) || session.owner !== creator) return;
        const screen = (await this.tmux.capture(id, 0)).trim();
        if (screen !== last) { last = screen; stableSince = Date.now(); continue; }
        if (screen && Date.now() - stableSince >= settleMs) break;
      }
      const session = this.registry.get(id);
      if (!session || !LIVE.has(session.state) || session.owner !== creator) return;
      await this.tmux.sendBytes(id, text);
      await this.tmux.sendKey(id, 'Enter');
    } catch { /* the session ended; nothing to type into */ }
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
      await this.tmux.sendBytes(id, data);
      if (submit) await this.tmux.sendKey(id, 'Enter');
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
    await this.tmux.kill(id);
    return this.update(session, { state: 'stopped', pid: null });
  }

  // Closes a terminal tab for good: stops the process if it still runs and forgets the record.
  // The worktree (and any commits in it) stays on disk.
  async closeSession(id: string, projectId: string) {
    const session = this.get(id, projectId);
    await this.tmux.kill(id).catch(() => undefined);
    this.registry.remove(session.id);
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
