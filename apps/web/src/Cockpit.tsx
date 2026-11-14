import '@xterm/xterm/css/xterm.css';
import './Cockpit.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bot, ClipboardPaste, CornerDownLeft, Hand, Keyboard, Maximize2, Minimize2, OctagonX, Plus, RefreshCw, Square, TerminalSquare, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalReport, type CockpitAdapter, type CockpitKind, type CockpitSession } from '@jarvis-command/contracts';

const ACTIVE = new Set(['connecting', 'running', 'waiting_for_input', 'unknown']);
// Phones and tablets: the on-screen keyboard opens only from the Keyboard key.
const TOUCH = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const STATE_LABEL: Record<string, string> = {
  connecting: 'Starting', running: 'Running', waiting_for_input: 'Waiting for input', exited: 'Exited', stopped: 'Stopped', failed: 'Failed', lost: 'Lost', unknown: 'Unknown',
};
const OWNER_LABEL = { human: 'You have input', lead: 'Lead has input', none: 'Nobody has input' } as const;
const OWNER_SHORT = { human: 'You', lead: 'Lead', none: 'Nobody' } as const;
const KIND_LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', gemini: 'Gemini', opencode: 'OpenCode', shell: 'Shell', hermes: 'Hermes' };

export async function cockpitRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(body === undefined ? 15_000 : 620_000),
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-jarvis-command': '1' }) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw Error(payload.message ?? (response.status === 401 ? 'Your sign-in expired. Reload the page to sign in again.' : response.status === 503 ? 'The execution host is not reachable.' : `Request failed (${payload.error ?? response.status}).`));
  return payload;
}

const newRequestId = () => `web-${crypto.randomUUID()}`;

type Props = Readonly<{
  projectId: string; projectName: string; onClose: () => void; fullScreen: boolean; onToggleFullScreen: () => void;
  /** Hermes host admin shell: shells only, outside Projects, no lead (docs/cockpit/HOST-SHELL.md). */
  hostShell?: boolean;
}>;

export function Cockpit({ projectId, projectName, onClose, fullScreen, onToggleFullScreen, hostShell = false }: Props) {
  const base = hostShell ? '/api/host-shell' : `/api/cockpit/projects/${projectId}`;
  const [sessions, setSessions] = useState<CockpitSession[] | null>(null);
  const [adapters, setAdapters] = useState<CockpitAdapter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { sessions: list } = await cockpitRequest<{ sessions: CockpitSession[] }>(`${base}/sessions`);
      setSessions(list); setError(null);
      setSelectedId(previous => previous && list.some(item => item.id === previous) ? previous : list.find(item => ACTIVE.has(item.state))?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sessions could not be loaded.'); }
  }, [base]);

  useEffect(() => {
    void load();
    if (!hostShell) cockpitRequest<{ adapters: CockpitAdapter[] }>('/api/cockpit/adapters').then(value => setAdapters(value.adapters), () => undefined);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 4_000);
    return () => clearInterval(timer);
  }, [load, hostShell]);

  const selected = sessions?.find(item => item.id === selectedId) ?? null;
  // Updates keep a tab where it is; new sessions go at the end, like browser tabs.
  const replace = (session: CockpitSession) => setSessions(previous => !previous ? [session]
    : previous.some(item => item.id === session.id) ? previous.map(item => item.id === session.id ? session : item) : [...previous, session]);
  const [closing, setClosing] = useState<string | null>(null);
  // Closing a tab stops the process if it still runs and removes the tab. Any worktree stays on disk.
  const closeSession = async (session: CockpitSession) => {
    setClosing(session.id); setError(null);
    try {
      await cockpitRequest(`${base}/sessions/${session.id}/close`, {});
      const list = sessions ?? [];
      const index = list.findIndex(item => item.id === session.id);
      const rest = list.filter(item => item.id !== session.id);
      setSessions(previous => previous?.filter(item => item.id !== session.id) ?? null);
      setSelectedId(current => current !== session.id ? current : (rest[index] ?? rest[index - 1])?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The session could not be closed.'); } finally { setClosing(null); }
  };
  const requestClose = (session: CockpitSession) => {
    // A running session asks first (in its toolbar); an ended one closes straight away.
    if (ACTIVE.has(session.state)) { setSelectedId(session.id); setCreating(false); setConfirmCloseId(session.id); } else void closeSession(session);
  };
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  return <div className={`cockpit${fullScreen ? '' : ' is-docked'}`} onKeyDown={event => { if (event.key === 'Escape' && !(event.target instanceof HTMLElement && event.target.closest('.cockpit-terminal'))) onClose(); }}>
    <header className="pane-header cockpit-header">
      <h2><TerminalSquare size={18} /> {hostShell ? 'Shell' : 'Terminals'} <small>{projectName}</small></h2>
      <div className="cockpit-header-actions">
        <button className="icon-button" type="button" aria-label="Refresh sessions" title="Refresh" onClick={() => void load()}><RefreshCw size={17} /></button>
        <button className="icon-button" type="button" aria-label={fullScreen ? 'Exit full screen' : 'Full screen'} title={fullScreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullScreen}>{fullScreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="icon-button" type="button" aria-label="Close terminals" onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    {error ? <p className="notice error cockpit-notice" role="alert">{error}</p> : null}
    <div className="cockpit-body">
      <nav className="cockpit-sessions" aria-label="Terminal sessions">
        <button className="secondary-button cockpit-new" type="button" onClick={() => setCreating(true)}><Plus size={16} /> {hostShell ? 'New shell' : 'New session'}</button>
        {sessions === null ? <p className="muted small">Loading…</p> : sessions.length === 0 ? <p className="muted small">{hostShell ? 'No shells open.' : 'No sessions in this project yet.'}</p> : null}
        <ul>
          {sessions?.map(session => <li key={session.id} className="cockpit-tab" aria-current={session.id === selectedId ? 'true' : undefined}>
            <button type="button" className="cockpit-session-item" aria-current={session.id === selectedId ? 'true' : undefined} onClick={() => { setSelectedId(session.id); setCreating(false); }}>
              <span className={`cockpit-dot state-${session.state}`} aria-hidden="true" />
              <span className="cockpit-session-text"><strong>{session.title}</strong><small>{KIND_LABEL[session.kind] ?? session.kind} · {STATE_LABEL[session.state] ?? session.state}{session.owner === 'lead' ? ' · lead' : ''}</small></span>
            </button>
            <button type="button" className="cockpit-tab-close" aria-label={`Close ${session.title}`} title={ACTIVE.has(session.state) ? 'Stop and close' : 'Close'} disabled={closing === session.id} onClick={() => requestClose(session)}><X size={15} /></button>
          </li>)}
        </ul>
      </nav>
      <section className="cockpit-main">
        {creating ? <CreateForm hostShell={hostShell} adapters={adapters} base={base} onCancel={() => setCreating(false)} onCreated={session => { replace(session); setSelectedId(session.id); setCreating(false); }} />
          : selected ? <SessionView key={selected.id} base={base} session={selected} onSession={replace} leadAvailable={!hostShell}
            closing={closing === selected.id} confirmClose={confirmCloseId === selected.id} onConfirmClose={value => setConfirmCloseId(value ? selected.id : null)} onClose={() => { setConfirmCloseId(null); void closeSession(selected); }} />
            : <div className="cockpit-empty"><TerminalSquare size={28} /><p>{hostShell ? `Open a shell on ${projectName}. It runs separately from Hermes, so it works while Hermes is down.` : 'Start a session to run Claude Code, Codex, Gemini, OpenCode or a shell on the execution host.'}</p></div>}
      </section>
    </div>
  </div>;
}

function CreateForm({ adapters, base, onCancel, onCreated, hostShell = false }: Readonly<{ adapters: CockpitAdapter[]; base: string; onCancel: () => void; onCreated: (session: CockpitSession) => void; hostShell?: boolean }>) {
  const [kind, setKind] = useState<CockpitKind>(hostShell ? 'shell' : 'claude');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request ID per intended session, so a retry after a timeout never launches a second agent.
  const requestId = useRef(newRequestId());
  const adapter = adapters.find(item => item.kind === kind);
  const options: { kind: CockpitKind; label: string }[] = adapters.length ? adapters.map(item => ({ kind: item.kind, label: item.label }))
    : [{ kind: 'claude', label: 'Claude Code' }, { kind: 'codex', label: 'Codex' }, { kind: 'agy', label: 'Antigravity (agy)' }, { kind: 'gemini', label: 'Gemini CLI' }, { kind: 'opencode', label: 'OpenCode' }, { kind: 'shell', label: 'Shell' }];
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const { session } = await cockpitRequest<{ session: CockpitSession }>(`${base}/sessions`, hostShell ? {
        requestId: requestId.current, ...(title.trim() ? { title: title.trim() } : {}),
      } : {
        requestId: requestId.current, title: title.trim() || options.find(item => item.kind === kind)?.label || kind, kind,
        ...(kind === 'shell' ? {} : { worktree }), ...(prompt.trim() ? { initialInput: prompt } : {}),
      });
      requestId.current = newRequestId();
      onCreated(session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The session could not be started.'); } finally { setBusy(false); }
  };
  return <form className="cockpit-create" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3>{hostShell ? 'New shell' : 'New session'}</h3>
    {hostShell ? null : <label>Agent<select value={kind} onChange={event => { setKind(event.target.value as CockpitKind); requestId.current = newRequestId(); }}>
      {options.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}
    </select></label>}
    {adapter ? <p className="muted small">{adapter.available ? `${adapter.version ?? 'Installed'} · ${adapter.billing}${adapter.qualified ? '' : ' · not yet qualified on this host'}` : 'Not installed on the execution host.'}{adapter.note ? ` ${adapter.note}` : ''}</p> : null}
    <label>Title<input value={title} maxLength={120} placeholder="What is this session for?" onChange={event => setTitle(event.target.value)} /></label>
    {kind !== 'shell' ? <>
      <label>First prompt (optional)<textarea value={prompt} maxLength={16_000} rows={4} onChange={event => setPrompt(event.target.value)} /></label>
      <label className="cockpit-check"><input type="checkbox" checked={worktree} onChange={event => setWorktree(event.target.checked)} /> Work in its own git worktree</label>
    </> : null}
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <div className="cockpit-create-actions">
      <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className="primary-button" type="submit" disabled={busy || (adapter ? !adapter.available : false)}>{busy ? 'Starting…' : 'Start session'}</button>
    </div>
  </form>;
}

// xterm builds its layout and theme CSS in <style> elements, which the app's CSP
// (style-src 'self') refuses, logging a violation each time. While a terminal is mounted,
// style elements are created as inert <x-term-style> elements instead (any other inline
// style would be refused by CSP anyway), and their text is mirrored into a constructable
// stylesheet, which CSP does not govern. The policy itself stays strict.
const INERT_STYLE = 'x-term-style';
let mountedTerminals = 0;
let nativeCreateElement: typeof document.createElement | null = null;
function mirrorTerminalStyles(root: HTMLElement) {
  if (mountedTerminals++ === 0) {
    const original = document.createElement;
    nativeCreateElement = original;
    document.createElement = function (this: Document, tagName: string, options?: ElementCreationOptions) {
      return original.call(this, tagName.toLowerCase() === 'style' ? INERT_STYLE : tagName, options);
    } as typeof document.createElement;
  }
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const sync = () => sheet.replaceSync(Array.from(root.querySelectorAll(`${INERT_STYLE}, style`), element => element.textContent ?? '').join('\n'));
  const observer = new MutationObserver(sync);
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  sync();
  return () => {
    observer.disconnect();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet);
    if (--mountedTerminals === 0 && nativeCreateElement) { document.createElement = nativeCreateElement; nativeCreateElement = null; }
  };
}

type Link = 'connecting' | 'open' | 'reconnecting' | 'closed';

type SessionViewProps = Readonly<{
  base: string; session: CockpitSession; onSession: (session: CockpitSession) => void; leadAvailable?: boolean;
  closing?: boolean; confirmClose?: boolean; onConfirmClose?: (open: boolean) => void; onClose?: () => void;
}>;

function SessionView({ base, session, onSession, leadAvailable = true, closing = false, confirmClose = false, onConfirmClose, onClose }: SessionViewProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const ctrl = useRef(false);
  const [ctrlOn, setCtrlOn] = useState(false);
  const [keyboardOn, setKeyboardOn] = useState(false);
  const [link, setLink] = useState<Link>('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const live = useRef(session); live.current = session;
  const report = useRef(onSession); report.current = onSession;

  const send = useCallback((frame: unknown) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(frame)); }, []);
  const type = useCallback((data: string) => {
    if (isTerminalReport(data)) { send({ type: 'report', data }); return; }
    let value = data;
    if (ctrl.current && value.length === 1) {
      const code = value.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) value = String.fromCharCode(code - 64);
      ctrl.current = false; setCtrlOn(false);
    }
    send({ type: 'input', data: value });
  }, [send]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      cursorBlink: true, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: window.matchMedia('(max-width: 760px)').matches ? 12 : 13,
      scrollback: 5000, allowProposedApi: false, theme: { background: '#0d100f', foreground: '#f1eee7', cursor: '#70d6b2', selectionBackground: '#2b4235' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const unmirror = mirrorTerminalStyles(element);
    term.open(element);
    terminal.current = term;
    // On phones a tap in the terminal must not pop the keyboard; the Keyboard key opens it.
    const area = term.textarea;
    const keyboardClosed = () => { area?.setAttribute('inputmode', 'none'); setKeyboardOn(false); };
    if (TOUCH) { area?.setAttribute('inputmode', 'none'); area?.addEventListener('blur', keyboardClosed); }
    try { fit.fit(); } catch { /* not laid out yet */ }
    const decoder = new TextDecoder();
    let disposed = false, attempts = 0, retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setLink(attempts ? 'reconnecting' : 'connecting');
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${scheme}//${location.host}${base}/sessions/${live.current.id}/terminal?cols=${term.cols}&rows=${term.rows}`);
      ws.binaryType = 'arraybuffer';
      socket.current = ws;
      ws.onopen = () => { attempts = 0; setLink('open'); term.reset(); };
      ws.onmessage = event => {
        if (event.data instanceof ArrayBuffer) { term.write(new Uint8Array(event.data)); return; }
        try {
          const frame = JSON.parse(typeof event.data === 'string' ? event.data : decoder.decode(event.data)) as { type: string; reason?: string; session?: CockpitSession };
          if (frame.type === 'session' && frame.session) report.current(frame.session);
          if (frame.type === 'input_refused') setNotice(live.current.owner === 'lead' ? 'The lead has input. Take over to type.' : 'Take over to type into this session.');
          if (frame.type === 'closed' && frame.reason) setNotice(frame.reason);
        } catch { /* ignore malformed control frames */ }
      };
      ws.onclose = event => {
        if (disposed || socket.current !== ws) return;
        socket.current = null;
        if (!ACTIVE.has(live.current.state) || attempts >= 8) { setLink('closed'); return; }
        attempts++;
        setLink('reconnecting');
        retry = setTimeout(connect, event.code === 4401 ? 0 : Math.min(15_000, 500 * 2 ** attempts));
      };
    };
    connect();

    const input = term.onData(type);
    const resize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    const observer = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } });
    observer.observe(element);
    return () => {
      disposed = true; clearTimeout(retry); observer.disconnect(); input.dispose(); resize.dispose();
      if (TOUCH) area?.removeEventListener('blur', keyboardClosed);
      socket.current?.close(); socket.current = null; term.dispose(); terminal.current = null; unmirror();
    };
  }, [base, send, type]);

  const act = async (path: string, body: unknown = {}) => {
    setBusy(true); setNotice(null);
    try {
      const result = await cockpitRequest<{ session?: CockpitSession }>(`${base}/sessions/${session.id}/${path}`, body);
      if (result.session) onSession(result.session);
      if (!TOUCH) terminal.current?.focus();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'The action failed.'); } finally { setBusy(false); }
  };
  const active = ACTIVE.has(session.state);
  // Desktop keeps focus in the terminal; on phones focusing would open the keyboard.
  const refocus = () => { if (!TOUCH || keyboardOn) terminal.current?.focus(); };
  const key = (data: string) => { type(data); refocus(); };
  const paste = async () => {
    try { const text = await navigator.clipboard.readText(); if (text) terminal.current?.paste(text); } catch { setNotice('Clipboard access was blocked. Long-press in the terminal to paste instead.'); }
    refocus();
  };
  const toggleKeyboard = () => {
    const area = terminal.current?.textarea;
    if (!area) return;
    const next = !keyboardOn;
    area.blur();
    area.setAttribute('inputmode', next ? 'text' : 'none');
    if (next) terminal.current?.focus();
    setKeyboardOn(next);
  };

  return <div className="cockpit-session">
    <div className="cockpit-toolbar">
      <div className="cockpit-meta">
        <strong>{session.title}</strong>
        <small>{STATE_LABEL[session.state] ?? session.state}{session.exitCode !== null ? ` (${session.exitCode})` : ''} · {session.host}{session.branch ? ` · ${session.branch}` : ''} · {link === 'open' ? 'live' : link}</small>
      </div>
      <div className="cockpit-actions">
        {active ? <span className={`cockpit-owner owner-${session.owner}`} title={OWNER_LABEL[session.owner]}>{session.owner === 'lead' ? <Bot size={14} /> : <UserRound size={14} />}<span className="cockpit-label">{OWNER_LABEL[session.owner]}</span><span className="cockpit-short">{OWNER_SHORT[session.owner]}</span></span> : null}
        {active && session.owner !== 'human' ? <button className="secondary-button" type="button" disabled={busy} aria-label="Take over" onClick={() => void act('ownership', { action: 'take' })}><Hand size={15} /><span className="cockpit-label">Take over</span><span className="cockpit-short">Take over</span></button> : null}
        {active && leadAvailable && session.owner === 'human' ? <button className="secondary-button" type="button" disabled={busy} aria-label="Hand to lead" onClick={() => void act('ownership', { action: 'hand_to_lead' })}><Bot size={15} /><span className="cockpit-label">Hand to lead</span><span className="cockpit-short">To lead</span></button> : null}
        {active ? <button className="secondary-button" type="button" disabled={busy} title="Send Ctrl-C" aria-label="Interrupt" onClick={() => void act('interrupt')}><OctagonX size={15} /><span className="cockpit-label">Interrupt</span><span className="cockpit-short">Ctrl+C</span></button> : null}
        {active && !confirmStop && !confirmClose ? <button className="secondary-button" type="button" disabled={busy} aria-label="Stop" onClick={() => setConfirmStop(true)}><Square size={14} /><span className="cockpit-label">Stop</span><span className="cockpit-short">Stop</span></button> : null}
        {!active && onClose ? <button className="secondary-button" type="button" disabled={closing} aria-label="Close tab" onClick={onClose}><X size={15} /><span className="cockpit-label">Close tab</span><span className="cockpit-short">Close</span></button> : null}
      </div>
    </div>
    {active && (confirmStop || confirmClose) ? <div className="cockpit-confirm" role="group" aria-label={confirmClose ? 'Confirm close' : 'Confirm stop'}>
      <span>{confirmClose ? 'Stop this session and close its tab?' : 'Stop this session?'} {session.worktree ? 'Its worktree stays on disk.' : ''}</span>
      <div>
        <button className="secondary-button" type="button" onClick={() => { setConfirmStop(false); onConfirmClose?.(false); }}>Keep running</button>
        {confirmClose ? null : <button className="secondary-button" type="button" disabled={busy} onClick={() => { setConfirmStop(false); void act('stop'); }}>Stop</button>}
        {onClose ? <button className="danger-button" type="button" disabled={busy || closing} onClick={() => { setConfirmStop(false); onClose(); }}>Stop and close</button> : null}
      </div>
    </div> : null}
    {session.failure ? <p className="notice error cockpit-notice" role="alert">{session.failure}</p> : null}
    {notice ? <p className="notice cockpit-notice" role="status">{notice}</p> : null}
    <div className="cockpit-terminal" ref={host} />
    {active ? <div className="cockpit-keys" role="toolbar" aria-label="Terminal keys">
      <button type="button" onClick={() => key('\x1b')}>Esc</button>
      <button type="button" onClick={() => key('\t')}>Tab</button>
      <button type="button" aria-pressed={ctrlOn} onClick={() => { ctrl.current = !ctrl.current; setCtrlOn(ctrl.current); refocus(); }}>Ctrl</button>
      <button type="button" onClick={() => key('\x03')}>^C</button>
      <button type="button" aria-label="Page up" onClick={() => key('\x1b[5~')}>PgUp</button>
      <button type="button" aria-label="Page down" onClick={() => key('\x1b[6~')}>PgDn</button>
      <button type="button" aria-label="Paste" onClick={() => void paste()}><ClipboardPaste size={18} /></button>
      <button type="button" aria-label={keyboardOn ? 'Hide keyboard' : 'Show keyboard'} aria-pressed={keyboardOn} onClick={toggleKeyboard}><Keyboard size={18} /></button>
      <button type="button" aria-label="Left" onClick={() => key('\x1b[D')}><ArrowLeft size={18} /></button>
      <button type="button" aria-label="Up" onClick={() => key('\x1b[A')}><ArrowUp size={18} /></button>
      <button type="button" aria-label="Down" onClick={() => key('\x1b[B')}><ArrowDown size={18} /></button>
      <button type="button" aria-label="Right" onClick={() => key('\x1b[C')}><ArrowRight size={18} /></button>
      <button className="cockpit-enter" type="button" aria-label="Enter" onClick={() => key('\r')}><CornerDownLeft size={18} /> Enter</button>
    </div> : null}
  </div>;
}
