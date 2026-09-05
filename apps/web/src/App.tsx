import { CommandBootstrapSchema, type CommandBootstrap, type SessionSummary } from '@jarvis-command/contracts';
import {
  Activity,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  Command,
  FileText,
  GitBranch,
  Home,
  Layers3,
  LockKeyhole,
  MessageSquare,
  Network,
  Plus,
  Radio,
  ServerCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import './styles.css';
import { LiveRoom } from './LiveRoom';
import { CreateSession } from './CreateSession';
import { useLiveTurn } from './useLiveTurn';
import { TurnComposer, TurnView } from './TurnView';

type LoadBootstrap = () => Promise<CommandBootstrap>;

type AppProps = Readonly<{
  loadBootstrap?: LoadBootstrap;
}>;

export function App({ loadBootstrap = fetchBootstrap }: AppProps) {
  const [bootstrap, setBootstrap] = useState<CommandBootstrap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    loadBootstrap()
      .then((payload) => {
        if (current) {
          setBootstrap(CommandBootstrapSchema.parse(payload));
        }
      })
      .catch(() => {
        if (current) {
          setFailed(true);
        }
      });

    return () => {
      current = false;
    };
  }, [loadBootstrap]);

  if (failed) {
    return <FailureState />;
  }

  if (!bootstrap) {
    return <LoadingState />;
  }

  return <CommandShell bootstrap={bootstrap} />;
}

async function fetchBootstrap(): Promise<CommandBootstrap> {
  const response = await fetch('/api/bootstrap', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('bootstrap_failed');
  }

  return CommandBootstrapSchema.parse(await response.json());
}

function LoadingState() {
  return (
    <main className="boot-screen" aria-label="Jarvis Command is loading">
      <div className="boot-mark" aria-hidden="true">
        <Command size={30} strokeWidth={1.6} />
      </div>
      <p className="boot-kicker">JARVIS COMMAND</p>
      <div className="boot-line"><span /></div>
      <p className="boot-copy">Establishing secure command session…</p>
    </main>
  );
}

function FailureState() {
  return (
    <main className="boot-screen failure-screen">
      <div className="boot-mark danger" aria-hidden="true">
        <ShieldCheck size={30} strokeWidth={1.6} />
      </div>
      <p className="boot-kicker">SECURE SESSION FAILED</p>
      <h1 role="alert">Jarvis Command could not establish the secure session.</h1>
      <p className="boot-copy">Refresh after confirming Cloudflare Access. No upstream details were exposed.</p>
      <button className="primary-button" type="button" onClick={() => window.location.reload()}>
        Retry connection
      </button>
    </main>
  );
}

function CommandShell({ bootstrap }: Readonly<{ bootstrap: CommandBootstrap }>) {
  const live = useLiveTurn();
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [sessions, setSessions] = useState(bootstrap.sessions);
  const recoveredSessionId = live.turn?.intent.input === null ? live.turn.intent.sessionId : null;
  useEffect(() => {
    if (recoveredSessionId) {
      const known = bootstrap.sessions.find((session) => session.id === recoveredSessionId);
      if (known) setSelectedSession(known);
    }
  }, [recoveredSessionId, bootstrap.sessions]);
  const liveEnabled = bootstrap.command.liveRoom.enabled;
  const hermesOnline = bootstrap.hermes.state === 'online';
  const writeAllowed = liveEnabled && hermesOnline && bootstrap.hermes.capabilities.includes('run_events_sse') && selectedSession?.ownership === 'command' && selectedSession.id.startsWith('jc_');
  const hermesReachable = bootstrap.hermes.state !== 'offline';
  const controlPlaneLabel = bootstrap.hermes.state === 'online'
    ? 'Hermes available'
    : bootstrap.hermes.state === 'degraded'
      ? 'Hermes degraded'
      : 'Hermes unavailable';
  const agentLabel = `${bootstrap.hermes.activeAgents} active agent${bootstrap.hermes.activeAgents === 1 ? '' : 's'}`;
  const identityLabel = bootstrap.identity.provider === 'cloudflare-access'
    ? 'Access verified'
    : 'Development identity';
  const identityTitle = bootstrap.identity.provider === 'cloudflare-access'
    ? 'Cloudflare Access identity verified'
    : 'Development identity verified';
  const agentStatus = bootstrap.hermes.state === 'offline'
    ? controlPlaneLabel
    : bootstrap.hermes.gatewayState === 'busy'
      ? 'Mission in progress'
      : bootstrap.hermes.state === 'degraded'
        ? 'Control plane degraded'
        : 'Standing by';

  return (
    <div className="command-shell">
      <WorkspaceRail />
      <RoomSidebar
        sessions={sessions}
        state={bootstrap.hermes.state}
        agentStatus={agentStatus}
        selectedId={selectedSession?.id}
        onSelect={liveEnabled ? setSelectedSession : undefined}
      />

      <main className="command-main">
        <header className="command-header">
          <div className="room-breadcrumb">
            <span>Projects</span>
            <ChevronRight size={13} />
            <strong>Jarvis Command</strong>
          </div>
          <div className="header-actions">
            <span className={`status-pill ${bootstrap.hermes.state}`}>
              <span className="status-dot" />
              {controlPlaneLabel}
            </span>
            <div className="operator-avatar" title={identityTitle} aria-label="Authenticated operator">
              NS
            </div>
          </div>
        </header>

        <section className="context-ribbon" aria-label="Mission context">
          <span className="context-label">CONFIG SNAPSHOT</span>
          <ContextChip icon={<Sparkles size={14} />} label={bootstrap.hermes.model ?? 'Model not reported'} tone="violet" />
          <ContextChip icon={<Network size={14} />} label={bootstrap.hermes.provider ?? 'Provider not reported'} />
          <span className="context-spacer" />
          <span className={`agent-count ${bootstrap.hermes.state}`}><CircleDot size={13} /> {agentLabel}</span>
        </section>

        {liveEnabled ? <div className="live-room-toolbar">
          <label className="session-picker">Session
            <select value={selectedSession?.id ?? ''} onChange={(event) => setSelectedSession(sessions.find((session) => session.id === event.target.value) ?? null)}>
              <option value="">Overview</option>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
            </select>
          </label>
          <CreateSession onCreated={(session) => {
            setSessions((previous) => [session, ...previous.filter((item) => item.id !== session.id)]);
            setSelectedSession(session);
          }} />
          {selectedSession ? <p className="selected-session-title" aria-label="Selected session">{selectedSession.title}</p> : null}
        </div> : null}
        <section className="timeline" aria-label="Mission timeline">
          {liveEnabled && selectedSession ? <LiveRoom key={`${selectedSession.id}:${live.refresh?.sessionId === selectedSession.id ? live.refresh.revision : ''}`} session={selectedSession} onHistory={live.history} /> : <>
          <div className="room-intro">
            <div className="room-emblem" aria-hidden="true"><Command size={28} /></div>
            <p className="eyebrow">PROJECT COMMAND ROOM</p>
            <h1>Jarvis Command</h1>
            <p>A browser-native command deck for conversations, agents, approvals, artifacts, and the occasional homelab goblin.</p>
            <div className="intro-badges">
              <span className={`identity-badge ${bootstrap.identity.provider}`}><ShieldCheck size={13} /> {identityLabel}</span>
              <span><GitBranch size={13} /> v{bootstrap.command.version}</span>
              <span className={`state-badge ${bootstrap.hermes.state}`}><Activity size={13} /> {controlPlaneLabel}</span>
            </div>
          </div>

          <div className="timeline-divider"><span>Operational snapshot</span></div>

          <TimelineEvent
            icon={<ShieldCheck size={17} />}
            label="Identity"
            title={identityLabel}
            tone={bootstrap.identity.provider === 'cloudflare-access' ? 'green' : 'violet'}
            meta={bootstrap.identity.provider === 'cloudflare-access' ? 'Cloudflare Access' : 'Local test mode'}
          >
            {bootstrap.identity.provider === 'cloudflare-access'
              ? 'The origin accepted a signed human application assertion for this browser session.'
              : 'Cloudflare identity verification is intentionally bypassed for this local development build.'}
          </TimelineEvent>

          <TimelineEvent
            icon={<ServerCog size={17} />}
            label="Hermes control plane"
            title={hermesOnline ? 'Read-only bridge synchronized' : controlPlaneLabel}
            tone={hermesOnline ? 'cyan' : hermesReachable ? 'amber' : 'red'}
            meta={hermesReachable ? `Hermes ${bootstrap.hermes.version ?? 'version unavailable'}` : 'Private bridge unreachable'}
          >
            {hermesOnline
              ? `${bootstrap.hermes.capabilities.length} API capabilities discovered. Session and readiness data came from the private snapshot.`
              : hermesReachable
                ? 'The private snapshot arrived, but readiness checks reported a degraded control plane. Controls remain disabled.'
                : 'The command shell is healthy, but Hermes did not answer the private upstream probe. Controls remain disabled.'}
          </TimelineEvent>

          <TimelineEvent
            icon={<Code2 size={17} />}
            label="Build snapshot"
            title={`Jarvis Command v${bootstrap.command.version}`}
            tone="violet"
            meta={formatTimestamp(bootstrap.command.generatedAt)}
          >
            The first vertical slice is intentionally read-only: secure bootstrap, current status, recent sessions, and responsive supervision surfaces.
          </TimelineEvent>
          </>}
          {live.recoveryError ? <p role="alert">{live.recoveryError}</p> : null}
          {live.turn && (live.turn.intent.sessionId === selectedSession?.id || live.turn.intent.input === null) ? <TurnView turn={live.turn} allowed={writeAllowed && live.turn.intent.sessionId === selectedSession?.id} approve={live.approve} stop={live.stop} /> : null}
        </section>

        <footer className="composer-wrap">
          {liveEnabled ? <TurnComposer blocked={!!live.recoveryError} allowed={hermesOnline && bootstrap.hermes.capabilities.includes('run_events_sse') && selectedSession?.ownership === 'command' && selectedSession.id.startsWith('jc_')} sessionId={selectedSession?.id} max={bootstrap.command.liveRoom.maxInputCharacters} maxSteer={bootstrap.command.liveRoom.maxSteerCharacters} turn={live.turn} send={live.send} retry={live.retry} resume={live.resume} steer={live.steer} recoveries={live.recoveries} consumeRecovery={live.consumeRecovery} /> : <>
          <div className="composer-status">
            <span className={`status-dot ${bootstrap.hermes.state === 'online' ? '' : bootstrap.hermes.state}`} />
            {hermesOnline ? 'Read-only bridge' : controlPlaneLabel}
          </div>
          <div className="composer-locked" role="status">
            <LockKeyhole size={15} />
            <span>Messaging is unavailable in this read-only slice.</span>
          </div>
          <p>Command execution is locked until approval and audit paths land. Sensible, if less cinematic.</p>
          </>}
        </footer>
      </main>

      <OperationsDeck bootstrap={bootstrap} agentStatus={agentStatus} />
      <MobileNavigation />
    </div>
  );
}

function WorkspaceRail() {
  return (
    <aside className="workspace-rail" aria-label="Workspaces">
      <div className="brand-mark" aria-label="Jarvis Command"><Command size={22} /></div>
      <div className="rail-rule" />
      <RailButton label="Command center" active>⚡</RailButton>
      <RailButton label="Game Lab">🎮</RailButton>
      <RailButton label="Homelab">🧪</RailButton>
      <RailButton label="Writing">📖</RailButton>
      <div className="rail-spacer" />
      <RailButton label="Add workspace"><Plus size={18} /></RailButton>
      <RailButton label="Settings"><Settings2 size={17} /></RailButton>
    </aside>
  );
}

function RailButton({ children, label, active = false }: Readonly<{ children: ReactNode; label: string; active?: boolean }>) {
  return (
    <button
      type="button"
      className={`rail-button ${active ? 'active' : ''}`}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={active ? label : `${label} — not available in this slice`}
      disabled={!active}
    >
      {children}
    </button>
  );
}

function RoomSidebar({ sessions, state, agentStatus, selectedId, onSelect }: Readonly<{
  sessions: SessionSummary[];
  state: CommandBootstrap['hermes']['state'];
  agentStatus: string;
  selectedId?: string | undefined;
  onSelect?: ((session: SessionSummary) => void) | undefined;
}>) {
  return (
    <aside className="room-sidebar">
      <div className="sidebar-brand">
        <div>
          <p>JARVIS</p>
          <strong>COMMAND</strong>
        </div>

      </div>

      <nav aria-label="Project rooms" className="room-navigation">
        <SidebarSection label="Command center">
          <SidebarItem icon={<Home size={15} />} label="Overview" />
          <SidebarItem icon={<Activity size={15} />} label="Activity" />
          <SidebarItem icon={<ShieldCheck size={15} />} label="Approvals" badge="0" />
        </SidebarSection>

        <SidebarSection label="Project room">
          <SidebarItem icon={<MessageSquare size={15} />} label="Jarvis Command" active />
          <SidebarItem icon={<Layers3 size={15} />} label="Artifacts" />
          <SidebarItem icon={<Bot size={15} />} label="Agent runs" />
        </SidebarSection>

        <SidebarSection label="Recent sessions">
          {sessions.length > 0 ? sessions.map((session) => (
            <button type="button" className="session-item" key={session.id} disabled={!onSelect} aria-current={selectedId === session.id ? 'page' : undefined} onClick={() => onSelect?.(session)}>
              <span className="session-source">{sourceGlyph(session.source)}</span>
              <span>
                <strong>{session.title}</strong>
                <small>{session.messageCount} messages · {session.toolCallCount} tools</small>
              </span>
              {session.pinned ? <span className="pin-dot" title="Pinned" /> : null}
            </button>
          )) : <p className="empty-copy">No sessions returned by Hermes.</p>}
        </SidebarSection>
      </nav>

      <div className="sidebar-footer">
        <div className="mini-avatar"><Bot size={15} /></div>
        <div><strong>Jarvis Prime</strong><span>{agentStatus}</span></div>
        <span className={`status-dot ${state}`} />
      </div>
    </aside>
  );
}

function SidebarSection({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return <section className="sidebar-section"><h2>{label}</h2>{children}</section>;
}

function SidebarItem({ icon, label, badge, active = false }: Readonly<{ icon: ReactNode; label: string; badge?: string | undefined; active?: boolean }>) {
  return (
    <button
      type="button"
      className={`sidebar-item ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
      disabled={!active}
    >
      {icon}<span>{label}</span>{badge ? <small>{badge}</small> : null}
    </button>
  );
}

function ContextChip({ icon, label, tone = 'neutral' }: Readonly<{ icon: ReactNode; label: string; tone?: string }>) {
  return <span className={`context-chip ${tone}`}>{icon}{label}</span>;
}

function TimelineEvent({ icon, label, title, tone, meta, children }: Readonly<{
  icon: ReactNode;
  label: string;
  title: string;
  tone: string;
  meta: string;
  children: ReactNode;
}>) {
  return (
    <article className="timeline-event">
      <div className={`event-icon ${tone}`}>{icon}</div>
      <div className="event-body">
        <div className="event-label">
          <span>{label}</span>
          <time>{meta}</time>
        </div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </article>
  );
}

function OperationsDeck({ bootstrap, agentStatus }: Readonly<{
  bootstrap: CommandBootstrap;
  agentStatus: string;
}>) {
  const checks = Object.entries(bootstrap.hermes.readinessChecks);
  return (
    <aside className="operations-deck" aria-label="Operations deck">
      <header><div><p>OPERATIONS</p><strong>Read-only deck</strong></div><span className="snapshot-badge"><Radio size={12} /> Static snapshot</span></header>

      <section className="ops-card agent-card">
        <div className="ops-title"><span><Bot size={15} /> Agent deck</span></div>
        <div className={`agent-orb ${bootstrap.hermes.state}`}><BrainCircuit size={25} /><span className={bootstrap.hermes.state} /></div>
        <strong>Jarvis Prime</strong>
        <p>{agentStatus}</p>
        <div className="metric-row"><span>Active agents</span><strong>{bootstrap.hermes.activeAgents}</strong></div>
      </section>

      <section className="ops-card">
        <div className="ops-title"><span><Activity size={15} /> Readiness</span><small>{checks.length} reported</small></div>
        <div className="check-list">
          {checks.map(([name, state]) => (
            <div className="check-row" key={name}>
              <span className={`check-icon ${state}`}>{state === 'pass' ? <Check size={11} /> : '!'}</span>
              <span>{humanize(name)}</span>
              <small className={state}>{humanize(state)}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="ops-card">
        <div className="ops-title"><span><SquareTerminal size={15} /> Capabilities</span><small>{bootstrap.hermes.capabilities.length}</small></div>
        <div className="capability-list">
          {bootstrap.hermes.capabilities.slice(0, 5).map((capability) => <code key={capability}>{capability}</code>)}
          {bootstrap.hermes.capabilities.length === 0 ? <p className="empty-copy">Awaiting Hermes bridge.</p> : null}
        </div>
      </section>

      <section className="ops-card artifact-card">
        <div className="ops-title"><span><FileText size={15} /> Artifacts</span><small>0</small></div>
        <div className="artifact-empty"><Layers3 size={21} /><p>Artifacts created in this room will land here.</p></div>
      </section>
    </aside>
  );
}

function MobileNavigation() {
  return (
    <nav className="mobile-navigation" aria-label="Mobile navigation">
      <button type="button" className="active" aria-current="page"><MessageSquare size={18} /><span>Room</span></button>
      <button type="button" disabled><Bot size={18} /><span>Agents</span></button>
      <button type="button" disabled><ShieldCheck size={18} /><span>Approve</span></button>
      <button type="button" disabled><Layers3 size={18} /><span>Artifacts</span></button>
    </nav>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function sourceGlyph(source: string): string {
  switch (source.toLowerCase()) {
    case 'discord': return '💬';
    case 'cli': return '⌘';
    case 'web': return '🌐';
    default: return '◆';
  }
}

function humanize(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}
