import { CommandBootstrapSchema, type CommandBootstrap, type SessionSummary } from '@jarvis-command/contracts';
import { Command, ShieldCheck, Menu, X, Settings2, PanelRight, ChevronRight, MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import './styles.css';
import { LiveRoom } from './LiveRoom';
import { ProjectRooms, type ProjectRoomsHandle } from './ProjectRooms';
import { ContextPane } from './ContextPane';
import { useLiveTurn } from './useLiveTurn';
import { TurnComposer, TurnView } from './TurnView';

type LoadBootstrap = () => Promise<CommandBootstrap>;
type BootstrapFailureKind = 'signin' | 'denied' | 'network' | 'unavailable' | 'invalid';

class BootstrapFailure extends Error {
  constructor(readonly kind: BootstrapFailureKind) { super(kind); }
}

type AppProps = Readonly<{
  loadBootstrap?: LoadBootstrap;
  interruptedAccess?: boolean;
}>;

export function App({ loadBootstrap = fetchBootstrap, interruptedAccess = false }: AppProps) {
  const [bootstrap, setBootstrap] = useState<CommandBootstrap | null>(null);
  const [failed, setFailed] = useState<BootstrapFailureKind | null>(null);

  useEffect(() => {
    if (interruptedAccess) return;
    let current = true;
    loadBootstrap()
      .then((payload) => {
        if (current) {
          const parsed = CommandBootstrapSchema.safeParse(payload);
          if (!parsed.success) throw new BootstrapFailure('invalid');
          setBootstrap(parsed.data);
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setFailed(error instanceof BootstrapFailure ? error.kind : 'unavailable');
        }
      });

    return () => {
      current = false;
    };
  }, [loadBootstrap, interruptedAccess]);

  if (interruptedAccess) return <FailureState kind="signin" />;
  if (failed) {
    return <FailureState kind={failed} />;
  }

  if (!bootstrap) {
    return <LoadingState />;
  }

  return <CommandShell bootstrap={bootstrap} />;
}

async function fetchBootstrap(): Promise<CommandBootstrap> {
  let response: Response;
  try {
    response = await fetch('/api/bootstrap', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    throw new BootstrapFailure('network');
  }
  if (response.type === 'opaqueredirect' || response.status === 401) throw new BootstrapFailure('signin');
  if (response.status === 403) throw new BootstrapFailure('denied');
  if (!response.ok) throw new BootstrapFailure('unavailable');
  try {
    return CommandBootstrapSchema.parse(await response.json());
  } catch {
    throw new BootstrapFailure('invalid');
  }
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

function FailureState({ kind }: Readonly<{ kind: BootstrapFailureKind }>) {
  const messages: Record<BootstrapFailureKind, readonly [string, string]> = {
    signin: ['Sign-in required', 'Your secure session needs attention. Sign in again through Cloudflare Access.'],
    denied: ['Access denied', 'This request was denied. Sign in with the approved account; contact the operator if denial persists.'],
    network: ['Connection unavailable', 'Your connection or sign-in may need attention. Check connectivity, retry, or sign in again.'],
    unavailable: ['Command unavailable', 'Jarvis Command could not load. Retry shortly; signing in will not repair a server outage.'],
    invalid: ['Invalid server response', 'Jarvis Command received an unexpected response. Retry; contact the operator if this persists.'],
  };
  const [recovering, setRecovering] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  async function signIn() {
    setRecovering(true);
    setRecoveryFailed(false);
    try {
      // Unregister only this app's root worker. Keep pending work and unrelated
      // caches intact. A top-level navigation gets a new client without the old
      // controller, including on the edge's subsequent callback redirect.
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (registration) {
          const ownScript = `${window.location.origin}/sw.js`;
          const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
          if (registration.scope !== `${window.location.origin}/` || workers.some((worker) => worker!.scriptURL !== ownScript)) {
            throw new Error('recovery_unavailable');
          }
          if (!await registration.unregister()) throw new Error('recovery_unavailable');
        }
      }
      window.location.replace('/api/auth/recover');
    } catch {
      setRecoveryFailed(true);
      setRecovering(false);
    }
  }
  return (
    <main className="boot-screen failure-screen">
      <div className="boot-mark danger" aria-hidden="true">
        <ShieldCheck size={30} strokeWidth={1.6} />
      </div>
      <p className="boot-kicker">JARVIS COMMAND</p>
      <h1 role="alert">{messages[kind][0]}</h1>
      <p className="boot-copy">{messages[kind][1]}</p>
      <button className="primary-button" type="button" onClick={() => window.location.reload()}>
        Retry connection
      </button>
      <button className="primary-button" type="button" disabled={recovering} onClick={() => { void signIn(); }}>
        {recovering ? 'Opening sign-in…' : 'Sign in again'}
      </button>
      <p className="boot-copy">Sign-in resets this app’s offline worker, not your saved pending work. Close other Command tabs first. If sign-in loops, open the site root in a fresh Incognito window, or clear this site’s storage in Chrome (clearing storage removes locally saved pending work).</p>
      {recoveryFailed ? <p role="alert" className="boot-copy">Browser recovery could not finish. Use a fresh Incognito window or clear this site’s storage, then open the site root. Do not copy the sign-in callback URL.</p> : null}
    </main>
  );
}

function CommandShell({ bootstrap }: Readonly<{ bootstrap: CommandBootstrap }>) {
  const live = useLiveTurn();
  const conversationScroll = useRef<HTMLElement | null>(null), conversationContent = useRef<HTMLDivElement | null>(null), followLatest = useRef(true);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(() => {
    if (!bootstrap.command.liveRoom.enabled) return null;
    try { const id = sessionStorage.getItem('jarvis-command:selected-session:v1'); return bootstrap.sessions.find(session => session.id === id) ?? null; } catch { return null; }
  });
  const [sessions, setSessions] = useState(bootstrap.sessions);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [pane, setPane] = useState<'project' | 'runtime' | 'settings' | null>(null);
  const [contextTarget, setContextTarget] = useState<HTMLDivElement | null>(null);
  const projects = useRef<ProjectRoomsHandle | null>(null), menu = useRef<HTMLButtonElement | null>(null), sidebar = useRef<HTMLElement | null>(null);
  const panelClose = useRef<HTMLButtonElement | null>(null), panelOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try { if (selectedSession) sessionStorage.setItem('jarvis-command:selected-session:v1', selectedSession.id); else sessionStorage.removeItem('jarvis-command:selected-session:v1'); } catch { /* Optional view hint. */ }
  }, [selectedSession]);
  const recoveredSessionId = live.turn?.intent.input === null ? live.turn.intent.sessionId : null;
  useEffect(() => {
    if (recoveredSessionId) { const known = bootstrap.sessions.find(session => session.id === recoveredSessionId); if (known) setSelectedSession(known); }
  }, [recoveredSessionId, bootstrap.sessions]);
  useEffect(() => {
    if (navigationOpen) sidebar.current?.querySelector<HTMLButtonElement>('.close-navigation')?.focus();
  }, [navigationOpen]);
  useEffect(() => {
    if (pane === 'runtime' || pane === 'settings') panelClose.current?.focus();
    if (pane === 'project') contextTarget?.querySelector<HTMLButtonElement>('[aria-label="Close project details"]')?.focus();
  }, [pane, contextTarget]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !conversationContent.current) return;
    const observer = new ResizeObserver(() => {
      const element = conversationScroll.current;
      if (element && followLatest.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(conversationContent.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    followLatest.current = true;
    const element = conversationScroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [selectedSession?.id]);
  useEffect(() => {
    if (live.turn && live.turn.intent.sessionId === selectedSession?.id && live.turn.intent.input !== null) {
      followLatest.current = true;
      const element = conversationScroll.current;
      if (element) element.scrollTop = element.scrollHeight;
    }
  }, [live.turn?.intent, selectedSession?.id]);
  const liveEnabled = bootstrap.command.liveRoom.enabled;
  const hermesOnline = bootstrap.hermes.state === 'online';
  const writeAllowed = liveEnabled && hermesOnline && bootstrap.hermes.capabilities.includes('run_events_sse') && selectedSession?.ownership === 'command' && selectedSession.id.startsWith('jc_');
  const health = bootstrap.hermes.state === 'online' ? 'Hermes available' : bootstrap.hermes.state === 'degraded' ? 'Hermes degraded' : 'Hermes unavailable';
  function selectSession(session: SessionSummary | null) {
    if (session) setSessions(previous => [session, ...previous.filter(item => item.id !== session.id)]);
    setSelectedSession(session);
  }
  function closeNavigation() { setNavigationOpen(false); menu.current?.focus(); }
  function openPanel(kind: 'runtime' | 'settings', element: HTMLElement) {
    projects.current?.closeDetails(); panelOpener.current = element; setPane(kind); setNavigationOpen(false);
  }
  function closePanel() { if (pane === 'project') projects.current?.closeDetails(); setPane(null); panelOpener.current?.focus(); }
  const activeElsewhere = live.turn && !live.turn.done && live.turn.intent.sessionId !== selectedSession?.id;
  return <div className={`command-shell${pane ? ' has-context' : ''}`}>
    {navigationOpen ? <button type="button" className="navigation-scrim" aria-label="Close navigation" onClick={closeNavigation} /> : null}
    <aside ref={sidebar} className={`room-sidebar${navigationOpen ? ' is-open' : ''}`} aria-label="Chat navigation" onKeyDown={event => {
      if (!navigationOpen) return;
      if (event.key === 'Escape') { event.stopPropagation(); closeNavigation(); }
      if (event.key === 'Tab') {
        const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') ?? []).filter(element => element.getClientRects().length > 0);
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    }}>
      <div className="sidebar-brand"><Command size={29} /><strong>Jarvis Command</strong><button className="icon-button close-navigation" type="button" aria-label="Close chat navigation" onClick={closeNavigation}><X size={20} /></button></div>
      {liveEnabled ? <ProjectRooms ref={projects} sessions={sessions} selectedSessionId={selectedSession?.id} onScope={setProjectName} onSession={selectSession} contextTarget={contextTarget}
        onOpenChange={open => { setPane(previous => open ? 'project' : previous === 'project' ? null : previous); if (open) setNavigationOpen(false); }} onNavigate={() => { if (navigationOpen || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches)) closeNavigation(); }} /> : <div className="sidebar-scroll"><p className="empty-copy">Live chat is unavailable.</p>{sessions.map(session => <div key={session.id} className="sidebar-item"><MessageSquare size={17} /><span>{session.title}</span></div>)}</div>}
      <footer className="sidebar-footer"><button className="sidebar-item" type="button" onClick={event => openPanel('settings', event.currentTarget)}><Settings2 size={18} /><span>Settings</span></button><div className="account-row"><span className="operator-avatar">NS</span><span>My account<small>{bootstrap.identity.provider === 'development' ? 'Development preview' : 'Personal workspace'}</small></span></div></footer>
    </aside>
    <main className="command-main">
      <header className="command-header"><button ref={menu} className="icon-button menu-button" type="button" aria-label="Open chat navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Menu size={21} /></button>
        <div className="room-breadcrumb">{projectName ? <><span aria-label="Selected project">{projectName}</span><ChevronRight size={14} /></> : null}<strong aria-label="Selected session">{selectedSession?.title ?? (projectName ? 'New conversation' : 'Jarvis Command')}</strong></div>
        <div className="header-actions">{projectName ? <button className={`icon-button${pane === 'project' ? ' active' : ''}`} type="button" aria-label="Open project details" title="Project details" aria-expanded={pane === 'project'} onClick={event => { if (pane === 'project') projects.current?.closeDetails(); else projects.current?.openDetails(event.currentTarget); }}><PanelRight size={19} /></button> : null}
          <button className={`health-button ${bootstrap.hermes.state}`} type="button" aria-label={health} title={health} onClick={event => openPanel('runtime', event.currentTarget)}><span className="status-dot" /><span>Hermes</span></button></div>
      </header>
      {bootstrap.identity.provider === 'development' ? <div className="preview-notice">Development preview · {bootstrap.command.version}</div> : null}
      {!hermesOnline ? <p className="notice error" role="status">{health}. {bootstrap.hermes.state === 'offline' ? 'Check the connection before sending.' : 'Some capabilities may be unavailable.'}</p> : null}
      {activeElsewhere ? <div className="active-run-notice" role="status">Jarvis is working in another chat. <button className="text-button" type="button" onClick={() => { const session = sessions.find(item => item.id === live.turn?.intent.sessionId); if (session) projects.current?.selectChat(session); }}>View active chat</button></div> : null}
      <section ref={conversationScroll} className="timeline" aria-label="Conversation" onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}><div ref={conversationContent} className="conversation-content">
        {liveEnabled && selectedSession ? <LiveRoom key={`${selectedSession.id}:${live.refresh?.sessionId === selectedSession.id ? live.refresh.revision : ''}`} session={selectedSession} onHistory={live.history}
          turns={[...live.completedTurns, ...(live.turn ? [live.turn] : [])]} renderTurn={turn => <TurnView turn={turn} allowed={writeAllowed && turn.intent === live.turn?.intent} approve={live.approve} stop={live.stop} />} /> : <div className="welcome"><Command size={39} strokeWidth={1.5} /><p className="eyebrow">YOUR SPACE TO THINK & BUILD</p><h1>{projectName ? `Let’s work on ${projectName}.` : 'What are we working on?'}</h1><p>Start a conversation with Jarvis. Keep related work together in projects.</p><button className="secondary-button welcome-action" type="button" onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) setNavigationOpen(true); else projects.current?.focusSearch(); }}>Choose a chat or start a new one <ChevronRight size={17} /></button></div>}
        {live.recoveryError ? <p role="alert" className="notice error">{live.recoveryError}</p> : null}
        {live.turn && !selectedSession && live.turn.intent.input === null ? <TurnView turn={live.turn} allowed={false} approve={live.approve} stop={live.stop} /> : null}
      </div></section>
      <footer className="composer-wrap">
        {liveEnabled && selectedSession?.ownership === 'command' && !live.historyReady(selectedSession.id) ? <p className="composer-feedback" role="status">Load complete chat history before sending. Retry history or load remaining pages.</p> : null}
        {live.historyBacklogFull ? <p role="alert" className="notice">Unconfirmed reply limit reached. Your replies are retained; retry history before sending more.</p> : null}
        {liveEnabled ? <TurnComposer blocked={!!live.recoveryError || !live.historyReady(selectedSession?.id) || live.historyBacklogFull} allowed={!!writeAllowed} sessionId={selectedSession?.id} max={bootstrap.command.liveRoom.maxInputCharacters} maxSteer={bootstrap.command.liveRoom.maxSteerCharacters} turn={live.turn} send={live.send} retry={live.retry} resume={live.resume} steer={live.steer} recoveries={live.recoveries} consumeRecovery={live.consumeRecovery} /> : <p className="composer-feedback">Messaging is unavailable in this read-only connection.</p>}
      </footer>
    </main>
    <ContextPane open={pane !== null}>
      <div ref={setContextTarget} hidden={pane !== 'project'} />
      {pane === 'runtime' || pane === 'settings' ? <div className="runtime-details" onKeyDown={event => { if (event.key === 'Escape') closePanel(); }}><header className="pane-header"><h2>{pane === 'runtime' ? 'Hermes connection' : 'Settings'}</h2><button ref={panelClose} className="icon-button" type="button" aria-label="Close context" onClick={closePanel}><X size={20} /></button></header><div className="pane-body">
        <h3>{pane === 'runtime' ? health : 'Your workspace'}</h3><p className="muted">{pane === 'runtime' ? 'Reported connection snapshot' : 'Jarvis Command keeps your conversations connected to Hermes.'}</p>
        <dl className="runtime-facts"><dt>Version</dt><dd>{bootstrap.command.version}</dd><dt>Identity</dt><dd>{bootstrap.identity.provider === 'cloudflare-access' ? 'Access verified' : 'Development identity'}</dd><dt>Model</dt><dd>{bootstrap.hermes.model === 'hermes-agent' ? 'Adapter label: hermes-agent' : bootstrap.hermes.model ?? 'Not reported'}</dd><dt>Provider</dt><dd>{bootstrap.hermes.provider ?? 'Not reported'}</dd><dt>Active agents</dt><dd>{bootstrap.hermes.activeAgents}</dd></dl>
        {pane === 'runtime' ? <><h4>Readiness</h4><dl className="runtime-facts">{Object.entries(bootstrap.hermes.readinessChecks).map(([name, value]) => <div key={name}><dt>{name.replace(/([A-Z])/g, ' $1')}</dt><dd>{value}</dd></div>)}</dl><h4>Available capabilities</h4><ul className="capability-list">{bootstrap.hermes.capabilities.map(item => <li key={item}>{item}</li>)}</ul></> : <p className="muted small">Conversations use your current Hermes configuration.</p>}
      </div></div> : null}
    </ContextPane>
  </div>;
}
