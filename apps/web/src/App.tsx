import { StatusIcon } from './StatusIcon';
import { threadStatus, summarizeThreads, type ThreadStatus } from './threadStatus';
import { useThreadStates } from './useThreadStates';
import { useMessageReactions } from './useMessageReactions';
import { ProjectIdentity } from './ProjectIdentity';
import { readThreadRecoveries } from './turnRecovery';
import { ThreadConversation } from './ThreadConversation';
import { PushLink } from './PushLink';
import { composeProjectInput, projectContext, readProjectForSend, readProjectThreadTarget } from './projectInput';
import { ArtifactListResponseSchema, SessionMutationResponseSchema, ArtifactTypeSchema, CommandBootstrapSchema, type NotificationTarget, type ProjectRoom, type ArtifactType, type CommandBootstrap, type SessionSummary } from '@jarvis-command/contracts';
import { Command, ShieldCheck, Menu, X, Settings2, PanelRight, ChevronRight, MessageSquare, Files, Bell, Clapperboard, TerminalSquare } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './styles.css';
import { LiveRoom } from './LiveRoom';
import { readArtifactSave, persistArtifactSave, consumeArtifactSave, saveRecoveryError, type PendingArtifactSave } from './artifactSaveRecovery';
import { ProjectRooms, type ProjectRoomsHandle } from './ProjectRooms';
import { ContextPane } from './ContextPane';
import { appStorageKey, previewPath, recoverSignIn } from './appEnvironment';
import { boundedJson } from './useLiveTurn';
import { useThreadTurns } from './useThreadTurns';
import { TurnComposer, TurnView } from './TurnView';
import { SessionContextMeter } from './SessionContextMeter';
import { SessionLifecycleControls } from './SessionLifecycleControls';
import { NotificationsPane, useNotifications } from './Notifications';
import { StudioProjectionView } from './studio-projection/StudioProjectionView';
import { STUDIO_PROJECTION_SOURCE } from './studio-projection/studioProjectionConfig';

const Cockpit = lazy(() => import('./Cockpit').then(module => ({ default: module.Cockpit })));
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

// Dev Studio is paused, so its "Studio crew" entry is hidden; flip this to bring it back.
export const SHOW_STUDIO_ENTRY = false;

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
  const reactions = useMessageReactions();
  const conversationScroll = useRef<HTMLElement | null>(null), conversationContent = useRef<HTMLDivElement | null>(null), followLatest = useRef(true);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectRoom | null>(null);
  const [projectSendError, setProjectSendError] = useState('');
  useEffect(() => { setProjectSendError(''); }, [projectId]);
  const [savedSelection] = useState(() => {
    try { return { id: sessionStorage.getItem(appStorageKey('jarvis-command:selected-session:v1')), project: sessionStorage.getItem(appStorageKey('jarvis-command:project-room:v1')) }; }
    catch { return { id: null, project: null }; }
  });
  const missingSaved = !!savedSelection.id && !bootstrap.sessions.some(session => session.id === savedSelection.id);
  const [preserveSaved, setPreserveSaved] = useState(!!savedSelection.project || missingSaved);
  const [projectNavigationReady, setProjectNavigationReady] = useState(false);
  const [savedRecovery, setSavedRecovery] = useState<'pending' | 'retry' | 'done'>(() => {
    if (!missingSaved || savedSelection.project || !/^jc_[a-f0-9]{32}$/.test(savedSelection.id!)) return 'done';
    return bootstrap.command.liveRoom.enabled && bootstrap.hermes.state === 'online' ? 'pending' : 'retry';
  });
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(() => {
    if (!bootstrap.command.liveRoom.enabled || savedSelection.project) return null;
    try { return bootstrap.sessions.find(session => session.id === savedSelection.id)
      ?? (!savedSelection.id ? bootstrap.sessions.find(session => session.id === readThreadRecoveries()[0]?.sessionId) : null) ?? null; } catch { return null; }
  });
  const selectionRef = useRef({ projectId, sessionId: selectedSession?.id ?? null });
  const threadLinkAttempt = useRef(0);
  const pendingThreadNavigation = useRef<{ projectId: string; sessionId: string; sourcePane: 'primary' | 'second'; sourceSessionId: string; sourceGeneration: number } | null>(null);
  const [threadLinkFeedback, setThreadLinkFeedback] = useState('');
  useEffect(() => {
    const pending = pendingThreadNavigation.current;
    if (!pending || (pending.projectId === projectId && pending.sessionId === selectedSession?.id)) return;
    pendingThreadNavigation.current = null;
    threadLinkAttempt.current++;
    setThreadLinkFeedback('Your selection changed while this link was checked. No navigation occurred; review the project and retry.');
  }, [projectId, selectedSession?.id]);
  const [sessions, setSessions] = useState(bootstrap.sessions);
  const mergeResolvedSessions = useCallback((resolved: SessionSummary[]) => {
    if (!resolved.length) return;
    setSessions(previous => [...previous.filter(session => !resolved.some(item => item.id === session.id)), ...resolved]);
  }, []);
  const retainedNavigation = useRef<{ controller: AbortController; saved?: boolean } | null>(null);
  const [retainedFeedback, setRetainedFeedback] = useState('');
  useEffect(() => () => { retainedNavigation.current?.controller.abort(); retainedNavigation.current = null; }, []);
  useEffect(() => {
    if (!projectNavigationReady || savedRecovery !== 'pending') return;
    if (!bootstrap.command.liveRoom.enabled || bootstrap.hermes.state !== 'online') { setSavedRecovery('retry'); return; }
    void openRetainedThread(savedSelection.id!, undefined, true);
    // Start once the existing project adapter is ready; further attempts are explicit.
  }, [projectNavigationReady]);
  // Exact durable reply to focus once its real history loads; cleared when the focus settles.
  const [replyFocus, setReplyFocus] = useState<{ sessionId: string; messageId: string } | null>(null);
  const [notificationAttachment, setNotificationAttachment] = useState<Extract<NotificationTarget, { state: 'available' }> | null>(null);
  const [secondSessionId, setSecondSessionId] = useState<string | null>(null);
  const secondSource = useRef<{ sessionId: string | null; generation: number }>({ sessionId: null, generation: 0 });
  const [splitVisible, setSplitVisible] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1001px)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 1001px)');
    const changed = () => { if (!query.matches) invalidateSecondLink(); setSplitVisible(query.matches); };
    query.addEventListener?.('change', changed);
    return () => query.removeEventListener?.('change', changed);
  }, []);
  const threads = useThreadTurns(sessions.map(session => session.id), [selectedSession?.id ?? '', ...(splitVisible && secondSessionId ? [secondSessionId] : [])]);
  const threadState = useThreadStates(sessions.map(session => session.id), bootstrap.command.liveRoom.enabled);
  // Retained cards supervise exact runs, but the thread-state contract cannot
  // identify its latest run. Session/arrival time cannot authorize an overlay.
  const statusStates = threadState.states;
  const live = threads.get(selectedSession?.id);
  const secondSession = sessions.find(session => session.id === secondSessionId) ?? null;
  const [navigationOpen, setNavigationOpen] = useState(false);
  // Studio is a top-level destination of its own, not project Threads and not a chat pane.
  // This slice is unavailable by design: it reads and writes no Studio data.
  const [studioOpen, setStudioOpen] = useState(false);
  const studioEntry = useRef(crypto.randomUUID()), studioVisible = useRef(false), studioDismissed = useRef(false), studioReturnFocus = useRef(false);
  const studioRegion = useRef<HTMLElement | null>(null), studioNav = useRef<HTMLButtonElement | null>(null), studioMenu = useRef<HTMLButtonElement | null>(null);
  const [draftAuthorizedSession, setDraftAuthorizedSession] = useState<string | null>(null);
  const [pane, setPane] = useState<'project' | 'runtime' | 'settings' | 'artifacts' | 'agents' | 'collaboration' | 'notifications' | 'cockpit' | 'host-shell' | null>(null);
  const [artifactPaneFullScreen, setArtifactPaneFullScreen] = useState(false);
  const [cockpitFullScreen, setCockpitFullScreen] = useState(true);
  const [associatedArtifacts, setAssociatedArtifacts] = useState<number | null>(null);
  const [artifactRefresh, setArtifactRefresh] = useState(0);
  const [pendingGeneration, setPendingGeneration] = useState<PendingArtifactGeneration | null>(() => readPendingGeneration());
  const generationRef = useRef(pendingGeneration); generationRef.current = pendingGeneration;
  const [saveRecovery, setSaveRecovery] = useState(readArtifactSave);
  const pendingArtifactSave = saveRecovery.pending;
  const saveRecoveryRef = useRef(saveRecovery);
  const [saveActive, setSaveActive] = useState(false);
  const saveAuthorized = !!pendingArtifactSave?.sessionId && selectedSession?.id === pendingArtifactSave.sessionId && draftAuthorizedSession === pendingArtifactSave.sessionId;
  function stageArtifactSave(pending: PendingArtifactSave) {
    if (saveRecoveryRef.current.pending || saveRecoveryRef.current.error) return;
    try {
      persistArtifactSave(pending);
      saveRecoveryRef.current = { pending, error: null };
      setSaveRecovery(saveRecoveryRef.current);
      setSaveActive(true);
    } catch {
      saveRecoveryRef.current = { pending, error: saveRecoveryError };
      setSaveRecovery(saveRecoveryRef.current);
    }
  }
  const [inferenceTarget, setInferenceTarget] = useState<HTMLDivElement | null>(null);
  const navigationEntry = useRef(crypto.randomUUID()), navigationVisible = useRef(false);
  const [contextTarget, setContextTarget] = useState<HTMLDivElement | null>(null);
  const [contextRevision, setContextRevision] = useState(0);
  const [compactedContext, setCompactedContext] = useState<{ sessionId: string; usedTokens: number } | null>(null);
  const projects = useRef<ProjectRoomsHandle | null>(null), menu = useRef<HTMLButtonElement | null>(null), sidebar = useRef<HTMLElement | null>(null);
  const panelClose = useRef<HTMLButtonElement | null>(null), panelOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try { if (selectedSession) sessionStorage.setItem(appStorageKey('jarvis-command:selected-session:v1'), selectedSession.id); else if (!preserveSaved) sessionStorage.removeItem(appStorageKey('jarvis-command:selected-session:v1')); } catch { /* Optional view hint. */ }
  }, [selectedSession, preserveSaved]);
  useEffect(() => {
    if (navigationOpen) sidebar.current?.querySelector<HTMLButtonElement>('.close-navigation')?.focus();
  }, [navigationOpen]);
  useEffect(() => {
    if (pane && pane !== 'project' && pane !== 'artifacts') panelClose.current?.focus();
    if (pane === 'project') projects.current?.focusDetails();
  }, [pane, contextTarget]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !conversationContent.current) return;
    const observer = new ResizeObserver(() => {
      const element = conversationScroll.current;
      // A message picker is an explicit reading target; resume ordinary tail follow once closed.
      if (element && followLatest.current && !element.querySelector('.reaction-picker')) element.scrollTop = element.scrollHeight;
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
  const cockpitOn = bootstrap.hermes.capabilities.includes('project_cockpit');
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
  // Hermes host admin shell: present only when the server enables it; checked each time the Hermes panel opens.
  const [hostShell, setHostShell] = useState<{ name: string; reachable: boolean } | null>(null);
  useEffect(() => {
    if (!liveEnabled || pane !== 'runtime') return;
    const controller = new AbortController();
    void fetch('/api/host-shell/status', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal })
      .then(async response => {
        const value = response.ok ? await response.json() as { enabled?: unknown; name?: unknown; reachable?: unknown } : null;
        if (!controller.signal.aborted) setHostShell(value?.enabled === true && typeof value.name === 'string' ? { name: value.name, reachable: value.reachable === true } : null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [liveEnabled, pane]);
  const notifications = useNotifications(liveEnabled, threads.all.map(item => `${item.turn?.publicRunId ?? ''}:${item.turn?.done ? 'done' : 'open'}:${item.turn?.approval?.requestId ?? ''}`).join('|'));
  const hermesOnline = bootstrap.hermes.state === 'online';
  const writeAllowed = liveEnabled && hermesOnline && bootstrap.hermes.capabilities.includes('run_events_sse') && selectedSession?.ownership === 'command' && selectedSession.id.startsWith('jc_');
  const health = bootstrap.hermes.state === 'online' ? 'Hermes available' : bootstrap.hermes.state === 'degraded' ? 'Hermes degraded' : 'Hermes unavailable';
  const generationLive = threads.get(pendingGeneration?.sessionId);
  useEffect(() => {
    if (!pendingGeneration || pendingGeneration.state !== 'running') return;
    const turn = generationLive.turn;
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
  }, [generationLive.turn?.intent, generationLive.turn?.publicRunId, generationLive.turn?.done, pendingGeneration]);
  useEffect(() => {
    if (!pendingGeneration || pendingGeneration.state !== 'running') return;
    const candidates = [...generationLive.completedTurns, ...(generationLive.turn ? [generationLive.turn] : [])];
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
    if (saveRecoveryRef.current.pending || saveRecoveryRef.current.error) return;
    stageArtifactSave({
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
  }, [generationLive.turn, generationLive.completedTurns, pendingGeneration, pendingArtifactSave?.sourceRequestId]);
  function invalidateSecondLink() {
    secondSource.current.generation++;
    if (pendingThreadNavigation.current?.sourcePane !== 'second') return;
    pendingThreadNavigation.current = null;
    threadLinkAttempt.current++;
    setThreadLinkFeedback('The source conversation changed while this link was checked. No navigation occurred; review the thread and retry.');
  }
  function selectSecondPane(id: string | null) {
    if (id !== secondSource.current.sessionId) invalidateSecondLink();
    secondSource.current.sessionId = id;
    setSecondSessionId(id);
  }
  function finishSavedSelection(session?: SessionSummary | null) {
    // ProjectRooms clears/replaces its hint before explicit global/project navigation.
    // Its initial project-loading null callbacks must retain the original scoped hint.
    let sameProject = false;
    try { sameProject = !!savedSelection.project && sessionStorage.getItem(appStorageKey('jarvis-command:project-room:v1')) === savedSelection.project; } catch { /* Keep authorization separate from optional storage. */ }
    if (!session && sameProject) return;
    setPreserveSaved(false); setSavedRecovery('done');
  }
  function selectSession(session: SessionSummary | null) {
    finishSavedSelection(session);
    leaveStudio();
    invalidateRetainedNavigation();
    invalidateThreadNavigation(selectionRef.current.projectId, session?.id ?? null);
    selectionRef.current = { ...selectionRef.current, sessionId: session?.id ?? null };
    if (session?.id !== selectedSession?.id) { setDraftAuthorizedSession(null); setSaveActive(false); }
    if (session) setSessions(previous => [session, ...previous.filter(item => item.id !== session.id)]);
    if (session?.id === secondSessionId) selectSecondPane(selectedSession?.id ?? null);
    setSelectedSession(session);
  }
  function selectProjectId(id: string | null) {
    finishSavedSelection();
    leaveStudio();
    invalidateRetainedNavigation();
    invalidateThreadNavigation(id, selectionRef.current.sessionId);
    selectionRef.current = { ...selectionRef.current, projectId: id };
    setProjectId(id);
    if (id !== projectId) selectSecondPane(null);
  }
  function invalidateThreadNavigation(projectId: string | null, sessionId: string | null) {
    const pending = pendingThreadNavigation.current;
    if (!pending || (pending.projectId === projectId && pending.sessionId === sessionId)) return;
    pendingThreadNavigation.current = null;
    threadLinkAttempt.current++;
    setThreadLinkFeedback('Your selection changed while this link was checked. No navigation occurred; review the project and retry.');
  }
  async function openThreadLink(requestedProjectId: string, sessionId: string, sourcePane: 'primary' | 'second' = 'primary') {
    invalidateRetainedNavigation();
    const attempt = ++threadLinkAttempt.current;
    const start = { ...selectionRef.current };
    const source = sourcePane === 'second' ? { ...secondSource.current } : { sessionId: start.sessionId, generation: 0 };
    if (!source.sessionId || !start.sessionId || start.projectId !== requestedProjectId) {
      setThreadLinkFeedback('Thread links work only inside their selected project. Your current chat was kept.');
      return;
    }
    pendingThreadNavigation.current = { projectId: start.projectId!, sessionId: start.sessionId, sourcePane, sourceSessionId: source.sessionId, sourceGeneration: source.generation };
    setThreadLinkFeedback('Checking the project and thread before opening…');
    try {
      const target = await readProjectThreadTarget(requestedProjectId, sessionId, new AbortController());
      if (attempt !== threadLinkAttempt.current) return;
      if (selectionRef.current.projectId !== start.projectId || selectionRef.current.sessionId !== start.sessionId
        || (sourcePane === 'second' && (secondSource.current.sessionId !== source.sessionId || secondSource.current.generation !== source.generation))) {
        pendingThreadNavigation.current = null;
        setThreadLinkFeedback('Your selection changed while this link was checked. No navigation occurred; review the project and retry.');
        return;
      }
      pendingThreadNavigation.current = null;
      if (!projects.current?.openLinkedChat(target.room, target.session)) {
        setThreadLinkFeedback('Project navigation is busy or has an edit draft. Your current chat and drafts were kept; close the project edit and retry.');
        return;
      }
      setThreadLinkFeedback('');
    } catch (error) {
      if (attempt !== threadLinkAttempt.current) return;
      pendingThreadNavigation.current = null;
      if (selectionRef.current.projectId === start.projectId && selectionRef.current.sessionId === start.sessionId) {
        setThreadLinkFeedback(error instanceof Error ? error.message : 'Thread link could not be checked. Your current chat was kept; review the project and retry.');
      }
    }
  }
  function invalidateRetainedNavigation() {
    if (!retainedNavigation.current) return;
    retainedNavigation.current.controller.abort();
    retainedNavigation.current = null;
    if (savedRecovery !== 'done') setSavedRecovery('done');
    setRetainedFeedback('Your selection changed while the retained chat was checked. Your current chat and drafts were kept; retry to open it.');
  }
  async function openRetainedThread(sessionId: string, retainedProjectId?: string, saved = false) {
    // A later retained click also supersedes an in-flight message thread link.
    pendingThreadNavigation.current = null;
    threadLinkAttempt.current++;
    setThreadLinkFeedback('');
    retainedNavigation.current?.controller.abort();
    const attempt = { controller: new AbortController(), saved };
    retainedNavigation.current = attempt;
    if (saved) setSavedRecovery('pending');
    setRetainedFeedback('Checking the retained chat before opening…');
    try {
      // Recovery ids are hints, never session facts. Always verify exact access; a
      // retained project's identity must not be replaced with the current project.
      const target = retainedProjectId
        ? await readProjectThreadTarget(retainedProjectId, sessionId, attempt.controller)
        : { room: null, session: SessionMutationResponseSchema.parse(await boundedJson(`/api/live/sessions/${encodeURIComponent(sessionId)}`, {
          credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' },
        }, attempt.controller)).session };
      if (retainedNavigation.current !== attempt) return;
      if (target.session.id !== sessionId || target.session.ownership !== 'command') throw Error('Retained chat identity or ownership is unavailable. Your current chat and drafts were kept.');
      retainedNavigation.current = null;
      const opened = target.room ? projects.current?.openLinkedChat(target.room, target.session) : projects.current?.selectChat(target.session);
      if (saved && !opened) setSavedRecovery('retry');
      setRetainedFeedback(opened ? '' : 'Project navigation is busy or has an edit draft. Your current chat and drafts were kept; finish the edit and retry.');
    } catch {
      if (retainedNavigation.current !== attempt) return;
      retainedNavigation.current = null;
      if (saved) setSavedRecovery('retry');
      setRetainedFeedback('Retained chat access or project membership could not be verified. Your current chat and drafts were kept; retry. No message was sent.');
    }
  }
  function openNavigation() {
    if (!navigationOpen) {
      window.history.pushState({ ...window.history.state, commandNavigation: navigationEntry.current }, '');
      navigationVisible.current = true; setNavigationOpen(true);
    }
  }
  // The drawer opener must be the visibly rendered one: Studio keeps the chat mounted
  // but hidden, so focusing menu.current there would move focus into hidden content.
  function navigationOpener() {
    return studioVisible.current ? studioMenu.current : menu.current;
  }
  function closeNavigation(restoreFocus = true) {
    if (window.history.state?.commandNavigation === navigationEntry.current) window.history.back();
    navigationVisible.current = false; setNavigationOpen(false); if (restoreFocus) navigationOpener()?.focus();
  }
  function pauseSavedRecovery() {
    if (savedRecovery !== 'pending') return;
    if (retainedNavigation.current?.saved) { retainedNavigation.current.controller.abort(); retainedNavigation.current = null; }
    setSavedRecovery('retry'); setRetainedFeedback('Saved chat recovery paused. Your view and drafts were kept.');
  }
  function openStudio(element?: HTMLElement | null) {
    pauseSavedRecovery();
    if (studioVisible.current) { if (navigationOpen) closeNavigation(); return; }
    if (element) studioNav.current = element as HTMLButtonElement;
    studioDismissed.current = false;
    setPane(null); projects.current?.closeDetails(); setArtifactPaneFullScreen(false);
    if (window.history.state?.commandNavigation === navigationEntry.current) {
      // The open drawer entry becomes the Studio entry, so one Back returns to chat.
      navigationVisible.current = false; setNavigationOpen(false);
      window.history.replaceState({ commandStudio: studioEntry.current }, '');
    } else {
      window.history.pushState({ ...window.history.state, commandStudio: studioEntry.current }, '');
    }
    studioVisible.current = true; setStudioOpen(true);
  }
  function closeStudio() {
    if (!studioVisible.current) return;
    studioReturnFocus.current = true;
    studioVisible.current = false; setStudioOpen(false);
    if (window.history.state?.commandStudio === studioEntry.current) window.history.back();
  }
  // Programmatic navigation away from Studio (a chat, project or panel was chosen) never
  // steals focus back to the Studio entry.
  function leaveStudio() {
    if (!studioVisible.current) return;
    studioDismissed.current = true;
    studioVisible.current = false; setStudioOpen(false);
    if (window.history.state?.commandStudio === studioEntry.current) window.history.back();
  }
  useEffect(() => {
    const back = () => {
      const open = window.history.state?.commandNavigation === navigationEntry.current;
      const wasOpen = navigationVisible.current; navigationVisible.current = open; setNavigationOpen(open);
      if (wasOpen && !open) navigationOpener()?.focus();
      const studio = window.history.state?.commandStudio === studioEntry.current;
      if (studio && studioDismissed.current) {
        studioDismissed.current = false;
        const rest = { ...(window.history.state as Record<string, unknown> | null) };
        delete rest.commandStudio;
        window.history.replaceState(rest, '');
        studioVisible.current = false; setStudioOpen(false);
        return;
      }
      if (!studio) studioDismissed.current = false;
      const wasStudio = studioVisible.current;
      if (wasStudio && !studio) studioReturnFocus.current = true;
      studioVisible.current = studio; setStudioOpen(studio);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    if (studioOpen) { studioRegion.current?.focus(); return; }
    if (!studioReturnFocus.current) return;
    studioReturnFocus.current = false;
    const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
    if (phone) menu.current?.focus(); else studioNav.current?.focus();
  }, [studioOpen]);
  function setProjectScope(name: string | null) {
    setProjectName(name);
  }
  function openPanel(kind: 'runtime' | 'settings' | 'artifacts' | 'agents' | 'collaboration' | 'notifications' | 'cockpit' | 'host-shell', element: HTMLElement) {
    pauseSavedRecovery();
    leaveStudio();
    if (kind !== 'artifacts') setSaveActive(false);
    projects.current?.closeDetails(); panelOpener.current = element; setPane(kind); if (navigationOpen) closeNavigation(false);
  }
  // Navigation only: the server already re-verified the actor, run and session. Never sends,
  // approves or alters the draft, and never displaces a run that is active in this tab.
  function openNotificationTarget(target: Extract<NotificationTarget, { state: 'available' }>): string | null {
    setReplyFocus(target.messageId ? { sessionId: target.sessionId, messageId: target.messageId } : null);
    let note: string | null = null;
    // A delivery target has no run: it only opens its chat.
    const { publicRunId, clientRequestId, runStatus } = target;
    if (publicRunId && clientRequestId && runStatus) {
      const targetLive = threads.get(target.sessionId);
      if (!threads.ready(target.sessionId)) setNotificationAttachment(target);
      const settled = ['completed', 'failed', 'cancelled', 'interrupted'].includes(runStatus);
      const sameRun = targetLive.turn?.publicRunId === publicRunId;
      const occupied = !!targetLive.turn && !targetLive.turn.done && !sameRun;
      if (threads.ready(target.sessionId) && !settled && !sameRun) {
        if (occupied) note = 'Opened the chat. Another run is active in this chat, so this run’s live card is not attached here; open it after the active run finishes.';
        else if (!targetLive.adopt({ sessionId: target.sessionId, clientRequestId, publicRunId })) note = 'Opened the chat, but this run’s live card could not be attached. Reload the chat to retry.';
      }
    }
    // Open the chat inside the project that holds it, whichever project is selected now.
    if (projects.current) {
      const room = projects.current.roomFor(target.sessionId) ?? (project?.sessionIds.includes(target.sessionId) ? project : null);
      const opened = room ? projects.current.openLinkedChat(room, target.session) : projects.current.selectChat(target.session);
      if (!opened) note = 'Project navigation is busy or has an edit draft, so the chat was not opened. Finish the edit and open the notification again.';
    } else selectSession(target.session);
    if (!note) closePanel();
    return note;
  }
  useEffect(() => {
    if (!notificationAttachment || !threads.ready(notificationAttachment.sessionId)) return;
    const target = notificationAttachment;
    const handle = threads.get(target.sessionId);
    const { publicRunId, clientRequestId, runStatus } = target;
    if (publicRunId && clientRequestId && runStatus && !['completed', 'failed', 'cancelled', 'interrupted'].includes(runStatus) && handle.turn?.publicRunId !== publicRunId) handle.adopt({ sessionId: target.sessionId, clientRequestId, publicRunId });
    setNotificationAttachment(null);
  }, [notificationAttachment, threads]);
  function closePanel() { setSaveActive(false); if (pane === 'project') projects.current?.closeDetails(); setPane(null); setArtifactPaneFullScreen(false); if (panelOpener.current?.closest('.room-sidebar') && window.matchMedia?.('(max-width: 760px)').matches) menu.current?.focus(); else panelOpener.current?.focus(); }

  const activeElsewhere = threads.all.find(item => item.turn && threadStatus(statusStates[item.turn.intent.sessionId], threadState.clock) === 'working' && item.turn.intent.sessionId !== selectedSession?.id && (!splitVisible || item.turn.intent.sessionId !== secondSessionId));
  const latestUsage = [...live.completedTurns, ...(live.turn ? [live.turn] : [])]
    .reverse()
    .find(item => item.intent.sessionId === selectedSession?.id && item.usage)?.usage ?? null;
  useEffect(() => {
    if (live.turn && !live.turn.done && live.turn.intent.sessionId === compactedContext?.sessionId) setCompactedContext(null);
  }, [live.turn?.done, live.turn?.intent.sessionId, compactedContext?.sessionId]);
  function saveResponseArtifact(content: string, runId: string | null = null, savedProjectId: string | null = projectId, savedSessionId: string | null = selectedSession?.id ?? null) {
    if (!content.trim()) return;
    if (saveRecoveryRef.current.pending || saveRecoveryRef.current.error) { setPane('artifacts'); return; }
    const sourceRequestId = newGenerationId();
    stageArtifactSave({
      key: sourceRequestId, sourceRequestId,
      sessionId: savedSessionId, projectId: savedProjectId, runId,
      title: `Jarvis response ${new Date().toLocaleString()}`,
      artifactType: null, content,
    });
    setPane('artifacts');
  }
  const artifactSendContext = useRef<object | null>(null);
  const artifactContextValue = useMemo(() => ({ projectId, project, session: selectedSession, writeAllowed }), [projectId, project, selectedSession, writeAllowed]);
  artifactSendContext.current = artifactContextValue;
  const artifactSending = useRef(false);
  async function prepareArtifactInput(prompt: string, alreadyComposed = false): Promise<string | null> {
    if (artifactSending.current || !writeAllowed || !selectedSession) return null;
    artifactSending.current = true;
    const context = artifactSendContext.current;
    setProjectSendError('');
    try {
      let input = prompt;
      if (projectId) {
        const fresh = await readProjectForSend(projectId, selectedSession.id, new AbortController());
        // Stable dependencies let unrelated shell renders keep the same send context.
        if (artifactSendContext.current !== context) throw Error('Chat context changed. Review and retry the artifact request.');
        if (project?.id !== projectId || projectContext(project) !== projectContext(fresh)) {
          setProject(fresh); projects.current?.readback(fresh);
          throw Error('Saved project context changed. Review it in the chat composer, then retry the artifact request.');
        }
        if (alreadyComposed && !prompt.startsWith(composeProjectInput('', fresh))) throw Error('Saved context differs from this failed request. The pending request is kept. Review the context, then cancel and create a new request.');
        input = alreadyComposed ? prompt : composeProjectInput(prompt, fresh);
      }
      if (!input.trim()) throw Error('This failed request has no complete input. Cancel and create a new request.');
      if (input.length > bootstrap.command.liveRoom.maxInputCharacters) throw Error('Complete artifact request including project context exceeds the message limit. Shorten the request or saved context.');
      return input;
    } catch (error) { setProjectSendError(error instanceof Error ? error.message : 'Project readback unavailable. Request not sent.'); return null; }
    finally { artifactSending.current = false; }
  }
  async function sendArtifactPrompt(prompt: string): Promise<boolean> {
    if (!writeAllowed || !selectedSession || prompt.length > bootstrap.command.liveRoom.maxInputCharacters) return false;
    const input = await prepareArtifactInput(prompt);
    return input !== null && live.send(selectedSession.id, input, bootstrap.command.liveRoom.maxInputCharacters, undefined, undefined, undefined, projectId);
  }
  async function createArtifactWithJarvis(request: ArtifactGenerationDraft): Promise<boolean> {
    if (!writeAllowed || !selectedSession || (live.turn && !live.turn.done)) return false;
    const rawPrompt = buildArtifactGenerationPrompt(request, projectId ? 16000 : bootstrap.command.liveRoom.maxInputCharacters);
    const prompt = rawPrompt ? await prepareArtifactInput(rawPrompt) : null;
    if (rawPrompt && prompt === null) return false;
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
    const accepted = live.send(selectedSession.id, prompt, bootstrap.command.liveRoom.maxInputCharacters, undefined, undefined, clientRequestId, projectId);
    if (!accepted) {
      setPendingGeneration({ ...pending, state: 'failed', message: 'Jarvis could not start this artifact request. Retry after the active run clears.' });
      return false;
    }
    setPane('artifacts');
    return true;
  }
  async function retryArtifactGeneration() {
    if (!pendingGeneration || pendingGeneration.state !== 'failed' || !selectedSession || selectedSession.id !== pendingGeneration.sessionId || projectId !== pendingGeneration.projectId || !writeAllowed || (live.turn && !live.turn.done)) return;
    const original = pendingGeneration;
    const input = await prepareArtifactInput(original.prompt, true);
    if (input === null || generationRef.current !== original) return;
    const clientRequestId = crypto.randomUUID();
    const next: PendingArtifactGeneration = {
      ...original,
      prompt: input,
      sourceRequestId: newGenerationId(),
      clientRequestId,
      publicRunId: null,
      createdAt: new Date().toISOString(),
      state: 'running',
      message: 'Create with Jarvis is retrying.',
    };
    const accepted = live.send(next.sessionId, next.prompt, bootstrap.command.liveRoom.maxInputCharacters, undefined, undefined, clientRequestId, projectId);
    if (accepted) setPendingGeneration(next);
    else setProjectSendError('Retry could not start. The original pending request is kept. Check that no run is active and try again.');
  }
  function cancelArtifactGeneration() {
    setPendingGeneration(null);
    // A generation cancellation cannot discard an unconfirmed artifact save.
  }
  const generationStatus = {
    state: pendingArtifactSave?.sourceRequestId === pendingGeneration?.sourceRequestId && pendingArtifactSave ? 'saving' as const : pendingGeneration?.state ?? 'idle' as const,
    message: pendingArtifactSave?.sourceRequestId === pendingGeneration?.sourceRequestId && pendingArtifactSave ? 'Jarvis completed. Saving artifact version 1...' : pendingGeneration?.message ?? null,
    title: pendingGeneration?.title ?? null,
    type: pendingGeneration?.artifactType ?? null,
    canRetry: !!pendingGeneration && pendingGeneration.state === 'failed' && selectedSession?.id === pendingGeneration.sessionId && projectId === pendingGeneration.projectId && !!writeAllowed && !(live.turn && !live.turn.done),
    canCancel: !!pendingGeneration,
  };
  return <div className={`command-shell${pane ? ' has-context' : ''}`}>
    {threads.supervisors}
    {navigationOpen ? <button type="button" className="navigation-scrim" aria-label="Close navigation" onClick={() => closeNavigation()} /> : null}
    <aside ref={sidebar} className={`room-sidebar${navigationOpen ? ' is-open' : ''}`} aria-label="Chat navigation" onKeyDown={event => {
      if (!navigationOpen) return;
      if (event.key === 'Escape') { event.stopPropagation(); closeNavigation(); }
      if (event.key === 'Tab') {
        const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') ?? []).filter(element => element.getClientRects().length > 0);
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    }}>
      <div className="sidebar-brand"><Command size={29} /><strong>Jarvis Command</strong><button className="icon-button close-navigation" type="button" aria-label="Close chat navigation" onClick={() => closeNavigation()}><X size={20} /></button></div>
      {liveEnabled ? <ProjectRooms onReady={() => setProjectNavigationReady(true)} ref={projects} onResolvedSessions={mergeResolvedSessions} threadStates={statusStates} statusClock={threadState.clock} sessions={sessions} selectedSessionId={selectedSession?.id} onScope={setProjectScope} onProjectScope={selectProjectId} onProjectChange={setProject} artifactsEnabled={artifactStudioEnabled} onOpenArtifacts={() => { pauseSavedRecovery(); leaveStudio(); projects.current?.closeDetails(); setPane('artifacts'); }} onSession={selectSession} onDeleted={sessionId => {
        setSessions(previous => previous.filter(session => session.id !== sessionId));
        if (selectedSession?.id === sessionId) { selectSession(null); setProjectScope(null); selectProjectId(null); }
      }} contextTarget={contextTarget}
        onOpenChange={open => { if (open) pauseSavedRecovery(); setPane(previous => open ? 'project' : previous === 'project' ? null : previous); if (open && navigationOpen) closeNavigation(); }} onNavigate={() => { if (navigationOpen || (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches)) closeNavigation(); }} /> : <div className="sidebar-scroll"><p className="empty-copy">Live chat is unavailable.</p>{sessions.map(session => <div key={session.id} className="sidebar-item"><MessageSquare size={17} /><span>{session.title}</span></div>)}</div>}
      <div className="thread-status-list" aria-label="Thread supervision">
        {navigationOpen && retainedFeedback ? <p role="status" className="notice">{retainedFeedback}</p> : null}
        {threads.all.filter(item => item.turn).map(item => <button type="button" className="sidebar-item" aria-label={`Supervise ${sessions.find(session => session.id === item.turn!.intent.sessionId)?.title ?? item.turn!.intent.sessionId}`} key={item.turn!.intent.sessionId} onClick={() => { void openRetainedThread(item.turn!.intent.sessionId, item.turn!.projectId); }}><span>{sessions.find(session => session.id === item.turn!.intent.sessionId)?.title ?? 'Retained thread'}<StatusIcon state={threadStatus(statusStates[item.turn!.intent.sessionId], threadState.clock)} /><small>{item.turn!.phase} · retained Command run; session status separate{item.turn!.statusObservedAt ? ` · checked ${new Date(item.turn!.statusObservedAt).toLocaleTimeString()}` : ' · status observation unavailable'}</small></span></button>)}
      </div>
      <div className="capability-navigation" aria-label="Capabilities">
        {/* Agents and Collaboration rooms stay out of the sidebar until they work on this installation. */}
        {SHOW_STUDIO_ENTRY ? <button ref={studioNav} className="sidebar-item" type="button" aria-current={studioOpen ? 'page' : undefined} onClick={event => openStudio(event.currentTarget)}><Clapperboard size={18} /><span>Studio crew<small>Unavailable</small></span></button> : null}
        {([{ key: 'notifications', label: 'Notifications', Icon: Bell }] as const).map(({ key, label, Icon }) => <button key={key} className="sidebar-item" type="button" aria-expanded={pane === key} onClick={event => openPanel(key, event.currentTarget)}><Icon size={18} /><span>{label}<small>{key === 'notifications' && liveEnabled ? (notifications.inbox ? (notifications.inbox.unreadCount ? `${notifications.inbox.unreadCount} unread` : 'Inbox') : 'Inbox') : 'Unavailable'}</small></span></button>)}
      </div>
      <footer className="sidebar-footer"><button className="sidebar-item" type="button" onClick={event => openPanel('settings', event.currentTarget)}><Settings2 size={18} /><span>Settings</span></button><div className="account-row"><span className="operator-avatar">NS</span><span>My account<small>{bootstrap.identity.provider === 'development' ? 'Development preview' : 'Personal workspace'}</small></span></div></footer>
    </aside>
    <div className={`conversation-panes${secondSession ? ' is-split' : ''}`}>
    <main className="command-main" hidden={studioOpen}>
      <PushLink enabled={liveEnabled} ready={projectNavigationReady} state={notifications} onOpen={openNotificationTarget} />
      <header className={`command-header${projectId ? ' has-project-threads' : ''}`}><button ref={menu} className="icon-button menu-button" type="button" aria-label="Open chat navigation" aria-expanded={navigationOpen} onClick={openNavigation}><Menu size={21} />{notifications.inbox?.unreadCount ? <span className="notification-dot" aria-hidden="true" /> : null}</button>
        <div className="room-breadcrumb">{projectName ? <><span aria-label="Selected project">{project?.id === projectId ? <ProjectIdentity project={project} /> : null}{projectName}</span><ChevronRight size={14} /></> : null}<strong aria-label="Selected session">{selectedSession?.title ?? (projectName ? 'New conversation' : 'Jarvis Command')}</strong></div>
        {(() => {
          // Only states worth acting on (working, needs you, unread) earn header space.
          const projectState = projectName ? summarizeThreads(project?.sessionIds ?? [], statusStates, threadState.clock) : null;
          const chatState = selectedSession ? threadStatus(statusStates[selectedSession.id], threadState.clock) : null;
          const shown = (state: ThreadStatus | null) => state !== null && state !== 'idle' && state !== 'unknown';
          return shown(projectState) || shown(chatState) ? <div className="header-thread-states">{shown(projectState) ? <span>Project <StatusIcon state={projectState!} /></span> : null}{shown(chatState) ? <span>Chat <StatusIcon state={chatState!} /></span> : null}</div> : null;
        })()}
        {projectId ? <button className="secondary-button project-threads-button" type="button" aria-label="Threads" aria-expanded={pane === 'project'} onClick={event => projects.current?.openThreads(event.currentTarget)}>Threads</button> : null}
        <div ref={setInferenceTarget} className="requested-route-slot" />
        <div className="header-actions"><SessionContextMeter enabled={bootstrap.command.liveRoom.enabled && selectedSession?.ownership === 'command'} sessionId={selectedSession?.id ?? null} liveUsage={latestUsage} compaction={live.turn && live.turn.intent.sessionId === selectedSession?.id ? live.turn.compaction ?? null : null} refreshVersion={contextRevision} compactedContext={compactedContext} /><SessionLifecycleControls enabled={bootstrap.command.liveRoom.enabled && selectedSession?.ownership === 'command'} session={selectedSession} blocked={!writeAllowed || !!(live.turn && !live.turn.done)} onCompacted={status => { if (status.result) setCompactedContext({ sessionId: status.result.resultSessionId, usedTokens: status.result.afterTokens }); setContextRevision(value => value + 1); }} onSession={async session => { if (projects.current) await projects.current.adoptSession(session); else selectSession(session); }} />{projectName ? <button className={`icon-button${pane === 'project' ? ' active' : ''}`} type="button" aria-label="Open project details" title="Project details" aria-expanded={pane === 'project'} onClick={event => { if (pane === 'project') projects.current?.closeDetails(); else projects.current?.openDetails(event.currentTarget); }}><PanelRight size={19} /></button> : null}
          {cockpitOn && projectId ? <button className={`artifact-context-button terminals-button${pane === 'cockpit' ? ' active' : ''}`} type="button" aria-label="Open project terminals" title="Agent terminals for this project" aria-expanded={pane === 'cockpit'} onClick={event => openPanel('cockpit', event.currentTarget)}><TerminalSquare size={17} /><span>Terminals</span></button> : null}
          {artifactStudioEnabled ? <button className={`artifact-context-button${pane === 'artifacts' ? ' active' : ''}`} type="button" aria-label="Open Artifact Studio" title="Artifacts for this context" aria-expanded={pane === 'artifacts'} onClick={event => openPanel('artifacts', event.currentTarget)}><Files size={17} /><span>Artifacts</span><strong>{associatedArtifacts ?? '...'}</strong></button> : null}
          <button className={`health-button ${bootstrap.hermes.state}`} type="button" aria-label={health} title={health} onClick={event => openPanel('runtime', event.currentTarget)}><span className="status-dot" /><span>Hermes</span></button></div>
      </header>
      {project && project.id === projectId && !project.archived && project.sessionIds.some(id => id !== selectedSession?.id) ? <div className="split-controls"><label>Second conversation <select aria-label="Second conversation" value={secondSessionId ?? ''} onChange={event => selectSecondPane(event.target.value || null)}><option value="">Closed</option>{project.sessionIds.filter(id => id !== selectedSession?.id).map(id => {
        const session = sessions.find(session => session.id === id), thread = project.threads?.find(thread => thread.sessionId === id);
        const title = thread?.title ?? session?.title ?? 'Saved chat';
        const reason = thread?.archived ? 'Archived' : !session ? 'Unavailable — retry chat titles in project navigation' : session.ownership !== 'command' ? 'Read-only external chat' : '';
        return <option key={id} value={id} disabled={!!reason}>{title}{session && session.title !== title ? ` · ${session.title}` : ''}{reason ? ` · ${reason}` : ''}</option>;
      })}</select></label></div> : null}
      {preserveSaved && savedSelection.project && !/^room_[a-f0-9]{32}$/.test(savedSelection.project) ? <p role="status" className="notice">Saved project is unavailable. Choose a project or chat to continue; your drafts are kept.</p> : null}
      {preserveSaved && savedRecovery === 'done' && !savedSelection.project ? <p role="status" className="notice">Saved chat is unavailable. Choose a chat to continue; your drafts are kept.</p> : null}
      {savedRecovery === 'retry' ? <p role="status" className="notice">Saved chat could not be opened. Your selection hint and drafts are kept. <button type="button" disabled={!bootstrap.command.liveRoom.enabled || bootstrap.hermes.state !== 'online'} onClick={() => void openRetainedThread(savedSelection.id!, undefined, true)}>Retry saved chat</button></p> : null}
      {!navigationOpen && retainedFeedback ? <p role="status" className="notice">{retainedFeedback}</p> : null}
      {bootstrap.identity.provider === 'development' ? <div className="preview-notice">Development preview · {bootstrap.command.version}</div> : null}
      {!hermesOnline ? <p className="notice error" role="status">{health}. {bootstrap.hermes.state === 'offline' ? 'Check the connection before sending.' : 'Some capabilities may be unavailable.'}</p> : null}
      {activeElsewhere ? <div className="active-run-notice" role="status">Jarvis is working in another chat. <button className="text-button" type="button" onClick={() => { if (activeElsewhere?.turn) void openRetainedThread(activeElsewhere.turn.intent.sessionId, activeElsewhere.turn.projectId); }}>View active chat</button></div> : null}
      <section ref={conversationScroll} className="timeline" aria-label="Conversation" onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}><div ref={conversationContent} className="conversation-content">
        {liveEnabled && selectedSession && threads.ready(selectedSession.id) ? <LiveRoom key={`${selectedSession.id}:${live.refresh?.sessionId === selectedSession.id ? live.refresh.revision : ''}`} session={selectedSession} reactions={reactions} reactionsAvailable={bootstrap.hermes.capabilities.includes('message_reactions') && !project?.archived} reactionsUnavailableReason={project?.archived ? 'Reactions unavailable in archived projects.' : undefined} threadProjectId={project && project.id === projectId && !project.archived ? projectId : null} threadProjectSessionIds={project && project.id === projectId && !project.archived ? project.sessionIds : undefined} onThreadLink={openThreadLink} focusMessageId={replyFocus?.sessionId === selectedSession.id ? replyFocus.messageId : null} onFocusSettled={() => setReplyFocus(null)} reportPresence={!!notifications.inbox && !studioOpen} showDeliveries={!!notifications.inbox} readObservation={threadState.states[selectedSession.id]?.observedAt} onLatestViewed={threadState.viewed} onHistory={(sessionId, messages, complete) => { live.history(sessionId, messages, complete); setDraftAuthorizedSession(complete ? sessionId : null); }}
          turns={[...live.completedTurns, ...(live.turn ? [live.turn] : [])]} onSaveResponse={artifactStudioEnabled ? message => saveResponseArtifact(message.content, null) : undefined}
          renderTurn={turn => <TurnView turn={turn} threadProjectId={project && project.id === projectId && !project.archived ? projectId : null} threadProjectSessionIds={project && project.id === projectId && !project.archived ? project.sessionIds : undefined} onThreadLink={openThreadLink} allowed={writeAllowed && turn.intent === live.turn?.intent} approve={live.approve} stop={live.stop} onSaveResponse={artifactStudioEnabled ? (text, runId) => saveResponseArtifact(text, runId, turn.projectId ?? projectId) : undefined} />} /> : <div className="welcome"><Command size={39} strokeWidth={1.5} /><p className="eyebrow">YOUR SPACE TO THINK & BUILD</p><h1>{projectName ? `Let’s work on ${projectName}.` : 'What are we working on?'}</h1><p>Start a conversation with Jarvis. Keep related work together in projects.</p><button className="secondary-button welcome-action" type="button" onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) openNavigation(); else projects.current?.focusSearch(); }}>Choose a chat or start a new one <ChevronRight size={17} /></button></div>}
        {!selectedSession ? threads.all.filter(item => item.turn?.intent.input === null).map(item => <TurnView key={item.turn!.intent.sessionId} turn={item.turn!} allowed={false} approve={item.approve} stop={item.stop} />) : null}
        {live.recoveryError ? <p role="alert" className="notice error">{live.recoveryError}</p> : null}
        {live.turn && !selectedSession && live.turn.intent.input === null ? <TurnView turn={live.turn} allowed={false} approve={live.approve} stop={live.stop} onSaveResponse={artifactStudioEnabled ? saveResponseArtifact : undefined} /> : null}
      </div></section>
      <footer className="composer-wrap">
        {threadLinkFeedback ? <p className="composer-feedback" role="status">{threadLinkFeedback}</p> : null}
        {liveEnabled && selectedSession?.ownership === 'command' && !live.historyReady(selectedSession.id) ? <p className="composer-feedback" role="status">Load complete chat history before sending. Retry history or load remaining pages.</p> : null}
        {live.historyBacklogFull ? <p role="alert" className="notice">Unconfirmed reply limit reached. Your replies are retained; retry history before sending more.</p> : null}
        {projectSendError ? <p role="alert">{projectSendError}</p> : null}
        {liveEnabled ? <TurnComposer retainedDrafts={live.composerDrafts} inferenceTarget={inferenceTarget} draftsAuthorized={draftAuthorizedSession !== null && draftAuthorizedSession === selectedSession?.id} blocked={(preserveSaved && !selectedSession) || !!live.recoveryError || !live.historyReady(selectedSession?.id) || live.historyBacklogFull} allowed={!!writeAllowed} imageAttachmentsEnabled={artifactStudioEnabled} sessionId={selectedSession?.id} projectId={projectId} project={project} onProjectReadback={room => { setProject(room); projects.current?.readback(room); }} max={bootstrap.command.liveRoom.maxInputCharacters} maxSteer={bootstrap.command.liveRoom.maxSteerCharacters} turn={live.turn} send={(session, input, max, inference, images, routing) => live.send(session, input, max, inference, images, undefined, projectId, routing)} retry={live.retry} resume={live.resume} steer={live.steer} recoveries={live.recoveries} consumeRecovery={live.consumeRecovery} /> : <p className="composer-feedback">Messaging is unavailable in this read-only connection.</p>}
      </footer>
    </main>
    {studioOpen ? <section ref={studioRegion} tabIndex={-1} className="command-main studio-destination" aria-labelledby="studio-crew-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeStudio(); } }}>
      <header className="command-header studio-header">
        <button ref={studioMenu} className="icon-button menu-button" type="button" aria-label="Open chat navigation" aria-expanded={navigationOpen} onClick={openNavigation}><Menu size={21} /></button>
        <div className="room-breadcrumb"><strong>Studio crew</strong></div>
        <button className="secondary-button studio-return" type="button" aria-label="Return to chat" onClick={closeStudio}>Back to chat</button>
      </header>
      <div className="timeline studio-scroll"><div className="conversation-content">
        <div className="welcome unavailable-capability studio-unavailable">
          <Clapperboard size={39} strokeWidth={1.5} aria-hidden="true" />
          <p className="eyebrow">UNAVAILABLE</p>
          <h1 id="studio-crew-title">Studio crew</h1>
          <StudioProjectionView source={STUDIO_PROJECTION_SOURCE} active={studioOpen} />
          <p className="studio-note">This page reads and changes nothing. Your chats, projects and any running replies stay as you left them.</p>
        </div>
      </div></div>
    </section> : null}
    {secondSession && threads.ready(secondSession.id) ? <ThreadConversation threadState={statusStates[secondSession.id]} statusClock={threadState.clock} onLatestViewed={threadState.viewed} hidden={studioOpen} reactions={reactions} reportPresence={!!notifications.inbox && splitVisible && !studioOpen} session={secondSession} live={threads.get(secondSession.id)} project={project && project.id === projectId && project.sessionIds.includes(secondSession.id) && !project.archived ? project : null} bootstrap={bootstrap} onClose={() => selectSecondPane(null)} onFocus={() => { if (project) projects.current?.openLinkedChat(project, secondSession); }} onProjectReadback={room => { setProject(room); projects.current?.readback(room); }} onThreadLink={(id, sessionId) => { void openThreadLink(id, sessionId, 'second'); }} onSave={(text, runId) => { selectSession(secondSession); saveResponseArtifact(text, runId, projectId, secondSession.id); }} /> : null}
    </div>
    <ContextPane open={pane !== null} fullScreen={(pane === 'artifacts' && artifactPaneFullScreen) || ((pane === 'cockpit' || pane === 'host-shell') && cockpitFullScreen)}>
      <div ref={setContextTarget} hidden={pane !== 'project'} />
      {pane === 'artifacts' ? <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {saveRecovery.error ? <p className="notice error" role="alert" style={{ flexShrink: 0 }}>{saveRecovery.error}</p> : null}
        {pendingArtifactSave && !saveRecovery.error && !saveActive ? <div className="notice" role="status" style={{ flexShrink: 0 }}>
          <p>An unconfirmed response save is retained. Recovery uses its original chat, project, run and request identity.</p>
          <p>{saveAuthorized ? 'Retry the original save to confirm whether it committed.' : 'Open the original chat and load its complete history to recover this save.'}</p>
          <button type="button" className="secondary-button" disabled={!saveAuthorized} onClick={() => setSaveActive(true)}>Recover response save</button>
      </div> : null}
      <Suspense fallback={<p className="pane-loading" role="status">Loading Artifact Studio…</p>}><ArtifactStudio open selectedSessionId={selectedSession?.id ?? null} projectId={projectId} requestError={projectSendError} projectContextText={project?.id === projectId ? projectContext(project) : undefined} canSendPrompt={!!writeAllowed && !(live.turn && !live.turn.done)} pendingSave={saveActive && saveAuthorized && !saveRecovery.error ? pendingArtifactSave : null} onConsumedSave={key => {
        if (saveRecoveryRef.current.pending?.key !== key) return;
        try {
          consumeArtifactSave(key);
          saveRecoveryRef.current = { pending: null, error: null };
          setSaveRecovery(saveRecoveryRef.current);
          setSaveActive(false);
        } catch {
          saveRecoveryRef.current = { ...saveRecoveryRef.current, error: 'The save was confirmed, but its recovery record could not be cleared. Further response saves are blocked until storage cleanup succeeds.' };
          setSaveRecovery(saveRecoveryRef.current);
        }
        setPendingGeneration(previous => previous?.sourceRequestId === key ? null : previous);
      }} onSendPrompt={sendArtifactPrompt} onCreateWithJarvis={createArtifactWithJarvis} generation={generationStatus} onRetryGeneration={retryArtifactGeneration} onCancelGeneration={cancelArtifactGeneration} onClose={closePanel} fullScreen={artifactPaneFullScreen} onToggleFullScreen={() => setArtifactPaneFullScreen(value => !value)} onLibraryChanged={() => setArtifactRefresh(value => value + 1)} /></Suspense>
      </div> : null}
      {pane === 'host-shell' && hostShell ? <Suspense fallback={<p className="pane-loading" role="status">Loading shell…</p>}><Cockpit key="host-shell" hostShell projectId="host-shell" projectName={hostShell.name} onClose={closePanel} fullScreen={cockpitFullScreen} onToggleFullScreen={() => setCockpitFullScreen(value => !value)} /></Suspense> : null}
      {pane === 'cockpit' && projectId ? <Suspense fallback={<p className="pane-loading" role="status">Loading terminals…</p>}><Cockpit key={projectId} projectId={projectId} projectName={projectName ?? 'Project'} onClose={closePanel} fullScreen={cockpitFullScreen} onToggleFullScreen={() => setCockpitFullScreen(value => !value)} /></Suspense> : null}
      {pane === 'agents' || pane === 'collaboration' || pane === 'notifications' ? <div className="runtime-details" onKeyDown={event => { if (event.key === 'Escape') closePanel(); }}>
        <header className="pane-header"><h2>{pane === 'agents' ? 'Agents' : pane === 'collaboration' ? 'Collaboration rooms' : 'Notifications'}</h2><button ref={panelClose} className="icon-button" type="button" aria-label="Close context" onClick={closePanel}><X size={20} /></button></header>
        {pane === 'notifications' && liveEnabled ? <NotificationsPane state={notifications} onOpen={openNotificationTarget} /> : <div className="pane-body unavailable-capability"><p className="eyebrow">Unavailable</p><h3>{pane === 'notifications' ? 'Not available in this connection' : 'Not available on this installation'}</h3>
          <p>{pane === 'agents' ? 'Agent profiles and direct delegation are not available through this Command installation’s verified Hermes contract.' : pane === 'collaboration' ? 'Collaboration rooms are not available through this installation’s verified Command contract. A native writable room driver has not been proven.' : 'The notification inbox needs live chat, which is unavailable in this connection. No alerts or push subscriptions are enabled here.'}</p>
          {pane !== 'notifications' ? <p>{pane === 'agents' ? 'Profile discovery, canonical profile sessions and Bot delivery have not been verified. Native support elsewhere remains unknown.' : 'Projects organize your chats and references locally in Command. They are separate from native collaboration rooms.'}</p> : null}
        </div>}
      </div> : null}
      {pane === 'runtime' || pane === 'settings' ? <div className="runtime-details" onKeyDown={event => { if (event.key === 'Escape') closePanel(); }}><header className="pane-header"><h2>{pane === 'runtime' ? 'Hermes connection' : 'Settings'}</h2><button ref={panelClose} className="icon-button" type="button" aria-label="Close context" onClick={closePanel}><X size={20} /></button></header><div className="pane-body">
        <h3>{pane === 'runtime' ? health : 'Your workspace'}</h3><p className="muted">{pane === 'runtime' ? 'Reported connection snapshot' : 'Jarvis Command keeps your conversations connected to Hermes.'}</p>
        <dl className="runtime-facts"><dt>Version</dt><dd>{bootstrap.command.version}</dd><dt>Identity</dt><dd>{bootstrap.identity.provider === 'cloudflare-access' ? 'Access verified' : 'Development identity'}</dd><dt>Model</dt><dd>{bootstrap.hermes.model === 'hermes-agent' ? 'Adapter label: hermes-agent' : bootstrap.hermes.model ?? 'Not reported'}</dd><dt>Provider</dt><dd>{bootstrap.hermes.provider ?? 'Not reported'}</dd><dt>Active agents</dt><dd>{bootstrap.hermes.activeAgents}</dd></dl>
        {pane === 'runtime' ? <><h4>Readiness</h4><dl className="runtime-facts">{Object.entries(bootstrap.hermes.readinessChecks).map(([name, value]) => <div key={name}><dt>{name.replace(/([A-Z])/g, ' $1')}</dt><dd>{value}</dd></div>)}</dl>{hostShell ? <div className="host-shell-entry"><h4>{hostShell.name} shell</h4><p className="muted small">{hostShell.reachable ? 'A shell on the Hermes machine. It runs separately from Hermes, so it works while Hermes is down.' : `${hostShell.name} isn't reachable right now. Its shell service may be stopped.`}</p><button className="secondary-button" type="button" onClick={event => openPanel('host-shell', event.currentTarget)}><TerminalSquare size={16} /> Open shell</button></div> : null}<h4>Available capabilities</h4><ul className="capability-list">{bootstrap.hermes.capabilities.map(item => <li key={item}>{item}</li>)}</ul></> : <p className="muted small">Conversations use your current Hermes configuration.</p>}
      </div></div> : null}
    </ContextPane>
  </div>;
}
