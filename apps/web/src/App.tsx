import { ArtifactListResponseSchema, ArtifactTypeSchema, CommandBootstrapSchema, type ArtifactType, type CommandBootstrap, type SessionSummary } from '@jarvis-command/contracts';
import { Command, ShieldCheck, Menu, X, Settings2, PanelRight, ChevronRight, MessageSquare, Files } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import './styles.css';
import { LiveRoom } from './LiveRoom';
import { ProjectRooms, type ProjectRoomsHandle } from './ProjectRooms';
import { ContextPane } from './ContextPane';
import { appStorageKey, previewPath, recoverSignIn } from './appEnvironment';
import { useLiveTurn } from './useLiveTurn';
import { TurnComposer, TurnView } from './TurnView';
import { SessionContextMeter } from './SessionContextMeter';
import { SessionLifecycleControls } from './SessionLifecycleControls';

const ArtifactStudio = lazy(() => import('./ArtifactStudio').then(module => ({ default: module.ArtifactStudio })));

type LoadBootstrap = () => Promise<CommandBootstrap>;
type BootstrapFailureKind = 'signin' | 'denied' | 'network' | 'unavailable' | 'invalid';

class BootstrapFailure extends Error {
  constructor(readonly kind: BootstrapFailureKind) { super(kind); }
}

type AppProps = Readonly<{
  loadBootstrap?: LoadBootstrap;
  interruptedAccess?: boolean;
}>;

type PendingArtifactGeneration = Readonly<{
  version: 1;
  sourceRequestId: string;
  sessionId: string;
  projectId: string | null;
  title: string;
  artifactType: ArtifactType;
  prompt: string;
  clientRequestId: string;
  publicRunId: string | null;
  createdAt: string;
  state: 'running' | 'failed';
  message: string | null;
}>;

type ArtifactGenerationDraft = Readonly<{
  title: string;
  type: ArtifactType;
  instructions: string;
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
      await recoverSignIn();
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
      <p className="boot-copy">{previewPath() ? 'Sign in again reopens this preview through Cloudflare Access. If sign-in loops, open the preview in a fresh private window.' : <>Sign-in resets this app’s offline worker, not your saved pending work. Close other Command tabs first. If sign-in loops, open the site root in a fresh Incognito window, or clear this site’s storage in Chrome (clearing storage removes locally saved pending work).</>}</p>
      {recoveryFailed ? <p role="alert" className="boot-copy">Browser recovery could not finish. Open this app in a fresh private window. Do not copy the sign-in callback URL.</p> : null}
    </main>
  );
}

const pendingGenerationStorageKey = 'jarvis-command:artifact-generation:v1';
const textArtifactTypes: ArtifactType[] = ['markdown', 'text', 'report', 'log', 'code', 'diff', 'html', 'svg', 'mermaid'];

function readPendingGeneration(): PendingArtifactGeneration | null {
  try {
    const raw = sessionStorage.getItem(appStorageKey(pendingGenerationStorageKey));
    if (!raw || raw.length > 40_000) return null;
    const value = JSON.parse(raw) as Partial<PendingArtifactGeneration>;
    if (value.version !== 1 || value.state !== 'running' && value.state !== 'failed') return null;
    if (typeof value.sourceRequestId !== 'string' || !/^gen_[a-f0-9]{32}$/.test(value.sourceRequestId)) return null;
    if (typeof value.sessionId !== 'string' || !value.sessionId || typeof value.title !== 'string' || typeof value.prompt !== 'string') return null;
    if (typeof value.clientRequestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.clientRequestId)) return null;
    if (value.publicRunId !== null && typeof value.publicRunId !== 'string') return null;
    if (!ArtifactTypeSchema.safeParse(value.artifactType).success || !textArtifactTypes.includes(value.artifactType as ArtifactType)) return null;
    if (Date.now() - Date.parse(String(value.createdAt)) > 24 * 60 * 60 * 1000) return { ...value, state: 'failed', message: 'Stored Artifact Studio generation was stale and was not saved.' } as PendingArtifactGeneration;
    return value as PendingArtifactGeneration;
  } catch {
    return null;
  }
}

function writePendingGeneration(pending: PendingArtifactGeneration | null): void {
  try {
    const key = appStorageKey(pendingGenerationStorageKey);
    if (pending) sessionStorage.setItem(key, JSON.stringify(pending));
    else sessionStorage.removeItem(key);
  } catch {
    // Local recovery is a convenience; active in-memory supervision remains authoritative.
  }
}

function newGenerationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `gen_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function buildArtifactGenerationPrompt(request: ArtifactGenerationDraft, max: number): string | null {
  const language = request.type === 'markdown' ? 'markdown' : request.type;
  const header = [
    'Artifact Studio request.',
    `Create a version-1 ${request.type} artifact titled: ${request.title}`,
    'Return only the exact raw artifact content, or one exact fenced code block containing only that artifact content.',
    `If you use a fence, use this opening fence exactly: \`\`\`${language}`,
    'Do not include explanations, prefaces, summaries, JSON metadata, hidden/system/developer content, secrets, browser credentials, or claims that Hermes created a core artifact.',
    'Use only the user-visible instructions below.',
    'Instructions:',
  ].join('\n');
  const footer = request.instructions.length ? '' : '\n';
  const budget = max - header.length - footer.length - 64;
  if (budget < 200) return null;
  const boundedInstructions = request.instructions.slice(0, budget);
  const truncated = boundedInstructions.length < request.instructions.length ? '\n[Instructions truncated by Artifact Studio input bound.]' : '';
  const prompt = `${header}\n${boundedInstructions}${truncated}${footer}`;
  return prompt.length <= max ? prompt : prompt.slice(0, max);
}

function CommandShell({ bootstrap }: Readonly<{ bootstrap: CommandBootstrap }>) {
  const live = useLiveTurn();
  const conversationScroll = useRef<HTMLElement | null>(null), conversationContent = useRef<HTMLDivElement | null>(null), followLatest = useRef(true);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(() => {
    if (!bootstrap.command.liveRoom.enabled) return null;
    try { const id = sessionStorage.getItem(appStorageKey('jarvis-command:selected-session:v1')); return bootstrap.sessions.find(session => session.id === id) ?? null; } catch { return null; }
  });
  const [sessions, setSessions] = useState(bootstrap.sessions);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [pane, setPane] = useState<'project' | 'runtime' | 'settings' | 'artifacts' | null>(null);
  const [artifactPaneFullScreen, setArtifactPaneFullScreen] = useState(false);
  const [associatedArtifacts, setAssociatedArtifacts] = useState<number | null>(null);
  const [artifactRefresh, setArtifactRefresh] = useState(0);
  const [pendingGeneration, setPendingGeneration] = useState<PendingArtifactGeneration | null>(() => readPendingGeneration());
  const [pendingArtifactSave, setPendingArtifactSave] = useState<{
    key: string;
    sessionId: string | null;
    projectId: string | null;
    runId?: string | null;
    sourceRequestId?: string | null;
    title: string;
    artifactType?: ArtifactType | null;
    content: string;
  } | null>(null);
  const [contextTarget, setContextTarget] = useState<HTMLDivElement | null>(null);
  const [contextRevision, setContextRevision] = useState(0);
  const [compactedContext, setCompactedContext] = useState<{ sessionId: string; usedTokens: number } | null>(null);
  const projects = useRef<ProjectRoomsHandle | null>(null), menu = useRef<HTMLButtonElement | null>(null), sidebar = useRef<HTMLElement | null>(null);
  const panelClose = useRef<HTMLButtonElement | null>(null), panelOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try { if (selectedSession) sessionStorage.setItem(appStorageKey('jarvis-command:selected-session:v1'), selectedSession.id); else sessionStorage.removeItem(appStorageKey('jarvis-command:selected-session:v1')); } catch { /* Optional view hint. */ }
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
  const artifactStudioEnabled = bootstrap.hermes.capabilities.includes('artifact_studio');
  useEffect(() => {
    if (!artifactStudioEnabled) return;
    if (!selectedSession?.id && !projectId) {
      setAssociatedArtifacts(0);
      return;
    }
    if (selectedSession && selectedSession.ownership !== 'command' && !projectId) {
      setAssociatedArtifacts(0);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (selectedSession?.id) params.set('sessionId', selectedSession.id);
    else if (projectId) params.set('projectId', projectId);
    params.set('limit', '100');
    fetch(`/api/artifacts?${params.toString()}`, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json' } })
      .then(response => {
        if (!response.ok) throw new Error('artifacts');
        return response.json() as Promise<unknown>;
      })
      .then(body => setAssociatedArtifacts(ArtifactListResponseSchema.parse(body).artifacts.length))
      .catch(() => { if (!controller.signal.aborted) setAssociatedArtifacts(null); });
    return () => controller.abort();
  }, [artifactStudioEnabled, selectedSession?.id, projectId, artifactRefresh]);
  useEffect(() => {
    writePendingGeneration(pendingGeneration);
  }, [pendingGeneration]);
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
  useEffect(() => {
    if (!pendingGeneration || pendingGeneration.state !== 'running') return;
    const turn = live.turn;
    if (!turn || turn.intent.sessionId !== pendingGeneration.sessionId) return;
    if (turn.intent.clientRequestId !== pendingGeneration.clientRequestId) {
      if (!turn.done) setPendingGeneration({ ...pendingGeneration, state: 'failed', message: 'A different run is active in this chat. Artifact generation was not saved.' });
      return;
    }
    if (turn.intent.input !== null && turn.intent.input !== pendingGeneration.prompt) {
      setPendingGeneration({ ...pendingGeneration, state: 'failed', message: 'The active run input did not match this Artifact Studio request. Nothing was saved.' });
      return;
    }
    if (turn.publicRunId && turn.publicRunId !== pendingGeneration.publicRunId) {
      setPendingGeneration({ ...pendingGeneration, publicRunId: turn.publicRunId, message: 'Create with Jarvis is running.' });
    }
  }, [live.turn?.intent, live.turn?.publicRunId, live.turn?.done, pendingGeneration]);
  useEffect(() => {
    if (!pendingGeneration || pendingGeneration.state !== 'running') return;
    const candidates = [...live.completedTurns, ...(live.turn ? [live.turn] : [])];
    const turn = candidates.find(item => item.intent.sessionId === pendingGeneration.sessionId
      && item.intent.clientRequestId === pendingGeneration.clientRequestId
      && (item.intent.input === null || item.intent.input === pendingGeneration.prompt)
      && item.publicRunId !== null
      && item.publicRunId === pendingGeneration.publicRunId);
    if (!turn || !turn.done) return;
    if (turn.phase !== 'Run completed' || turn.error || turn.outputLimited || !turn.output.trim()) {
      setPendingGeneration({ ...pendingGeneration, state: 'failed', message: turn.outputLimited ? 'Jarvis output was preview-limited, so Artifact Studio did not save it automatically.' : turn.error ? 'Jarvis finished with an error. Artifact Studio did not save an artifact.' : 'Jarvis did not complete with non-empty artifact content. Nothing was saved.' });
      return;
    }
    if (pendingArtifactSave?.sourceRequestId === pendingGeneration.sourceRequestId) return;
    setPendingArtifactSave({
      key: pendingGeneration.sourceRequestId,
      sourceRequestId: pendingGeneration.sourceRequestId,
      sessionId: pendingGeneration.sessionId,
      projectId: pendingGeneration.projectId,
      runId: turn.publicRunId,
      title: pendingGeneration.title,
      artifactType: pendingGeneration.artifactType,
      content: turn.output,
    });
    setPane('artifacts');
  }, [live.turn, live.completedTurns, pendingGeneration, pendingArtifactSave?.sourceRequestId]);
  function selectSession(session: SessionSummary | null) {
    if (session) setSessions(previous => [session, ...previous.filter(item => item.id !== session.id)]);
    setSelectedSession(session);
  }
  function closeNavigation() { setNavigationOpen(false); menu.current?.focus(); }
  function setProjectScope(name: string | null) {
    setProjectName(name);
  }
  function openPanel(kind: 'runtime' | 'settings' | 'artifacts', element: HTMLElement) {
    projects.current?.closeDetails(); panelOpener.current = element; setPane(kind); setNavigationOpen(false);
  }
  function closePanel() { if (pane === 'project') projects.current?.closeDetails(); setPane(null); setArtifactPaneFullScreen(false); panelOpener.current?.focus(); }
  const activeElsewhere = live.turn && !live.turn.done && live.turn.intent.sessionId !== selectedSession?.id;
  const latestUsage = [...live.completedTurns, ...(live.turn ? [live.turn] : [])]
    .reverse()
    .find(item => item.intent.sessionId === selectedSession?.id && item.usage)?.usage ?? null;
  useEffect(() => {
    if (live.turn && !live.turn.done && live.turn.intent.sessionId === compactedContext?.sessionId) setCompactedContext(null);
  }, [live.turn?.done, live.turn?.intent.sessionId, compactedContext?.sessionId]);
  function saveResponseArtifact(content: string, runId: string | null = null) {
    if (!content.trim()) return;
    const sourceRequestId = newGenerationId();
    setPendingArtifactSave({
      key: sourceRequestId,
      sourceRequestId,
      sessionId: selectedSession?.id ?? null,
      projectId,
      runId,
      title: `Jarvis response ${new Date().toLocaleString()}`,
      content,
    });
    setPane('artifacts');
  }
  function sendArtifactPrompt(prompt: string): boolean {
    if (!writeAllowed || !selectedSession || prompt.length > bootstrap.command.liveRoom.maxInputCharacters) return false;
    return live.send(selectedSession.id, prompt, bootstrap.command.liveRoom.maxInputCharacters);
  }
  function createArtifactWithJarvis(request: ArtifactGenerationDraft): boolean {
    if (!writeAllowed || !selectedSession || (live.turn && !live.turn.done)) return false;
    const prompt = buildArtifactGenerationPrompt(request, bootstrap.command.liveRoom.maxInputCharacters);
    if (!prompt) {
      setPendingGeneration({
        version: 1,
        sourceRequestId: newGenerationId(),
        sessionId: selectedSession.id,
        projectId,
        title: request.title,
        artifactType: request.type,
        prompt: '',
        clientRequestId: crypto.randomUUID(),
        publicRunId: null,
        createdAt: new Date().toISOString(),
        state: 'failed',
        message: 'The request could not be bounded under the live input limit.',
      });
      return false;
    }
    const clientRequestId = crypto.randomUUID();
    const pending: PendingArtifactGeneration = {
      version: 1,
      sourceRequestId: newGenerationId(),
      sessionId: selectedSession.id,
      projectId,
      title: request.title,
      artifactType: request.type,
      prompt,
      clientRequestId,
      publicRunId: null,
      createdAt: new Date().toISOString(),
      state: 'running',
      message: 'Create with Jarvis is starting.',
    };
    setPendingGeneration(pending);
    const accepted = live.send(selectedSession.id, prompt, bootstrap.command.liveRoom.maxInputCharacters, undefined, undefined, clientRequestId);
    if (!accepted) {
      setPendingGeneration({ ...pending, state: 'failed', message: 'Jarvis could not start this artifact request. Retry after the active run clears.' });
      return false;
    }
    setPane('artifacts');
    return true;
  }
  function retryArtifactGeneration() {
    if (!pendingGeneration || pendingGeneration.state !== 'failed' || !selectedSession || selectedSession.id !== pendingGeneration.sessionId || !writeAllowed || (live.turn && !live.turn.done)) return;
    const clientRequestId = crypto.randomUUID();
    const next: PendingArtifactGeneration = {
      ...pendingGeneration,
      sourceRequestId: newGenerationId(),
      clientRequestId,
      publicRunId: null,
      createdAt: new Date().toISOString(),
      state: 'running',
      message: 'Create with Jarvis is retrying.',
    };
    setPendingGeneration(next);
    const accepted = live.send(next.sessionId, next.prompt, bootstrap.command.liveRoom.maxInputCharacters, undefined, undefined, clientRequestId);
    if (!accepted) setPendingGeneration({ ...next, state: 'failed', message: 'Retry could not start. Check that no run is active and try again.' });
  }
  function cancelArtifactGeneration() {
    setPendingGeneration(null);
    setPendingArtifactSave(previous => previous?.sourceRequestId ? null : previous);
  }
  const generationStatus = {
    state: pendingArtifactSave?.sourceRequestId ? 'saving' as const : pendingGeneration?.state ?? 'idle' as const,
    message: pendingArtifactSave?.sourceRequestId ? 'Jarvis completed. Saving artifact version 1...' : pendingGeneration?.message ?? null,
    title: pendingGeneration?.title ?? null,
    type: pendingGeneration?.artifactType ?? null,
    canRetry: !!pendingGeneration && pendingGeneration.state === 'failed' && selectedSession?.id === pendingGeneration.sessionId && !!writeAllowed && !(live.turn && !live.turn.done),
    canCancel: !!pendingGeneration,
  };
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
      {liveEnabled ? <ProjectRooms ref={projects} sessions={sessions} selectedSessionId={selectedSession?.id} onScope={setProjectScope} onProjectScope={setProjectId} onSession={selectSession} onDeleted={sessionId => {
        setSessions(previous => previous.filter(session => session.id !== sessionId));
        if (selectedSession?.id === sessionId) { setSelectedSession(null); setProjectScope(null); setProjectId(null); }
      }} contextTarget={contextTarget}
        onOpenChange={open => { setPane(previous => open ? 'project' : previous === 'project' ? null : previous); if (open) setNavigationOpen(false); }} onNavigate={() => { if (navigationOpen || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches)) closeNavigation(); }} /> : <div className="sidebar-scroll"><p className="empty-copy">Live chat is unavailable.</p>{sessions.map(session => <div key={session.id} className="sidebar-item"><MessageSquare size={17} /><span>{session.title}</span></div>)}</div>}
      <footer className="sidebar-footer"><button className="sidebar-item" type="button" onClick={event => openPanel('settings', event.currentTarget)}><Settings2 size={18} /><span>Settings</span></button><div className="account-row"><span className="operator-avatar">NS</span><span>My account<small>{bootstrap.identity.provider === 'development' ? 'Development preview' : 'Personal workspace'}</small></span></div></footer>
    </aside>
    <main className="command-main">
      <header className="command-header"><button ref={menu} className="icon-button menu-button" type="button" aria-label="Open chat navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Menu size={21} /></button>
        <div className="room-breadcrumb">{projectName ? <><span aria-label="Selected project">{projectName}</span><ChevronRight size={14} /></> : null}<strong aria-label="Selected session">{selectedSession?.title ?? (projectName ? 'New conversation' : 'Jarvis Command')}</strong></div>
        <div className="header-actions"><SessionContextMeter enabled={bootstrap.command.liveRoom.enabled && selectedSession?.ownership === 'command'} sessionId={selectedSession?.id ?? null} liveUsage={latestUsage} compaction={live.turn && live.turn.intent.sessionId === selectedSession?.id ? live.turn.compaction ?? null : null} refreshVersion={contextRevision} compactedContext={compactedContext} /><SessionLifecycleControls enabled={bootstrap.command.liveRoom.enabled && selectedSession?.ownership === 'command'} session={selectedSession} blocked={!writeAllowed || !!(live.turn && !live.turn.done)} onCompacted={status => { if (status.result) setCompactedContext({ sessionId: status.result.resultSessionId, usedTokens: status.result.afterTokens }); setContextRevision(value => value + 1); }} onSession={async session => { if (projects.current) await projects.current.adoptSession(session); else selectSession(session); }} />{projectName ? <button className={`icon-button${pane === 'project' ? ' active' : ''}`} type="button" aria-label="Open project details" title="Project details" aria-expanded={pane === 'project'} onClick={event => { if (pane === 'project') projects.current?.closeDetails(); else projects.current?.openDetails(event.currentTarget); }}><PanelRight size={19} /></button> : null}
          {artifactStudioEnabled ? <button className={`artifact-context-button${pane === 'artifacts' ? ' active' : ''}`} type="button" aria-label="Open Artifact Studio" title="Artifacts for this context" aria-expanded={pane === 'artifacts'} onClick={event => openPanel('artifacts', event.currentTarget)}><Files size={17} /><span>Artifacts</span><strong>{associatedArtifacts ?? '...'}</strong></button> : null}
          <button className={`health-button ${bootstrap.hermes.state}`} type="button" aria-label={health} title={health} onClick={event => openPanel('runtime', event.currentTarget)}><span className="status-dot" /><span>Hermes</span></button></div>
      </header>
      {bootstrap.identity.provider === 'development' ? <div className="preview-notice">Development preview · {bootstrap.command.version}</div> : null}
      {!hermesOnline ? <p className="notice error" role="status">{health}. {bootstrap.hermes.state === 'offline' ? 'Check the connection before sending.' : 'Some capabilities may be unavailable.'}</p> : null}
      {activeElsewhere ? <div className="active-run-notice" role="status">Jarvis is working in another chat. <button className="text-button" type="button" onClick={() => { const session = sessions.find(item => item.id === live.turn?.intent.sessionId); if (session) projects.current?.selectChat(session); }}>View active chat</button></div> : null}
      <section ref={conversationScroll} className="timeline" aria-label="Conversation" onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}><div ref={conversationContent} className="conversation-content">
        {liveEnabled && selectedSession ? <LiveRoom key={`${selectedSession.id}:${live.refresh?.sessionId === selectedSession.id ? live.refresh.revision : ''}`} session={selectedSession} onHistory={live.history}
          turns={[...live.completedTurns, ...(live.turn ? [live.turn] : [])]} onSaveResponse={message => saveResponseArtifact(message.content, null)}
          renderTurn={turn => <TurnView turn={turn} allowed={writeAllowed && turn.intent === live.turn?.intent} approve={live.approve} stop={live.stop} onSaveResponse={saveResponseArtifact} />} /> : <div className="welcome"><Command size={39} strokeWidth={1.5} /><p className="eyebrow">YOUR SPACE TO THINK & BUILD</p><h1>{projectName ? `Let’s work on ${projectName}.` : 'What are we working on?'}</h1><p>Start a conversation with Jarvis. Keep related work together in projects.</p><button className="secondary-button welcome-action" type="button" onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) setNavigationOpen(true); else projects.current?.focusSearch(); }}>Choose a chat or start a new one <ChevronRight size={17} /></button></div>}
        {live.recoveryError ? <p role="alert" className="notice error">{live.recoveryError}</p> : null}
        {live.turn && !selectedSession && live.turn.intent.input === null ? <TurnView turn={live.turn} allowed={false} approve={live.approve} stop={live.stop} onSaveResponse={saveResponseArtifact} /> : null}
      </div></section>
      <footer className="composer-wrap">
        {liveEnabled && selectedSession?.ownership === 'command' && !live.historyReady(selectedSession.id) ? <p className="composer-feedback" role="status">Load complete chat history before sending. Retry history or load remaining pages.</p> : null}
        {live.historyBacklogFull ? <p role="alert" className="notice">Unconfirmed reply limit reached. Your replies are retained; retry history before sending more.</p> : null}
        {liveEnabled ? <TurnComposer blocked={!!live.recoveryError || !live.historyReady(selectedSession?.id) || live.historyBacklogFull} allowed={!!writeAllowed} imageAttachmentsEnabled={artifactStudioEnabled} sessionId={selectedSession?.id} projectId={projectId} max={bootstrap.command.liveRoom.maxInputCharacters} maxSteer={bootstrap.command.liveRoom.maxSteerCharacters} turn={live.turn} send={live.send} retry={live.retry} resume={live.resume} steer={live.steer} recoveries={live.recoveries} consumeRecovery={live.consumeRecovery} /> : <p className="composer-feedback">Messaging is unavailable in this read-only connection.</p>}
      </footer>
    </main>
    <ContextPane open={pane !== null} fullScreen={pane === 'artifacts' && artifactPaneFullScreen}>
      <div ref={setContextTarget} hidden={pane !== 'project'} />
      {pane === 'artifacts' ? <Suspense fallback={<p className="pane-loading" role="status">Loading Artifact Studio…</p>}><ArtifactStudio open selectedSessionId={selectedSession?.id ?? null} projectId={projectId} canSendPrompt={!!writeAllowed && !(live.turn && !live.turn.done)} pendingSave={pendingArtifactSave} onConsumedSave={key => {
        setPendingArtifactSave(previous => previous?.key === key ? null : previous);
        setPendingGeneration(previous => previous?.sourceRequestId === key ? null : previous);
      }} onSendPrompt={sendArtifactPrompt} onCreateWithJarvis={createArtifactWithJarvis} generation={generationStatus} onRetryGeneration={retryArtifactGeneration} onCancelGeneration={cancelArtifactGeneration} onClose={closePanel} fullScreen={artifactPaneFullScreen} onToggleFullScreen={() => setArtifactPaneFullScreen(value => !value)} onLibraryChanged={() => setArtifactRefresh(value => value + 1)} /></Suspense> : null}
      {pane === 'runtime' || pane === 'settings' ? <div className="runtime-details" onKeyDown={event => { if (event.key === 'Escape') closePanel(); }}><header className="pane-header"><h2>{pane === 'runtime' ? 'Hermes connection' : 'Settings'}</h2><button ref={panelClose} className="icon-button" type="button" aria-label="Close context" onClick={closePanel}><X size={20} /></button></header><div className="pane-body">
        <h3>{pane === 'runtime' ? health : 'Your workspace'}</h3><p className="muted">{pane === 'runtime' ? 'Reported connection snapshot' : 'Jarvis Command keeps your conversations connected to Hermes.'}</p>
        <dl className="runtime-facts"><dt>Version</dt><dd>{bootstrap.command.version}</dd><dt>Identity</dt><dd>{bootstrap.identity.provider === 'cloudflare-access' ? 'Access verified' : 'Development identity'}</dd><dt>Model</dt><dd>{bootstrap.hermes.model === 'hermes-agent' ? 'Adapter label: hermes-agent' : bootstrap.hermes.model ?? 'Not reported'}</dd><dt>Provider</dt><dd>{bootstrap.hermes.provider ?? 'Not reported'}</dd><dt>Active agents</dt><dd>{bootstrap.hermes.activeAgents}</dd></dl>
        {pane === 'runtime' ? <><h4>Readiness</h4><dl className="runtime-facts">{Object.entries(bootstrap.hermes.readinessChecks).map(([name, value]) => <div key={name}><dt>{name.replace(/([A-Z])/g, ' $1')}</dt><dd>{value}</dd></div>)}</dl><h4>Available capabilities</h4><ul className="capability-list">{bootstrap.hermes.capabilities.map(item => <li key={item}>{item}</li>)}</ul></> : <p className="muted small">Conversations use your current Hermes configuration.</p>}
      </div></div> : null}
    </ContextPane>
  </div>;
}
