import '@xterm/xterm/css/xterm.css';
import './Cockpit.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bot, ClipboardPaste, Hand, Maximize2, Minimize2, OctagonX, Plus, RefreshCw, Square, TerminalSquare, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalReport, type CockpitAdapter, type CockpitKind, type CockpitSession } from '@jarvis-command/contracts';

const ACTIVE = new Set(['connecting', 'running', 'waiting_for_input', 'unknown']);
const STATE_LABEL: Record<string, string> = {
  connecting: 'Starting', running: 'Running', waiting_for_input: 'Waiting for input', exited: 'Exited', stopped: 'Stopped', failed: 'Failed', lost: 'Lost', unknown: 'Unknown',
};
const OWNER_LABEL = { human: 'You have input', lead: 'Lead has input', none: 'Nobody has input' } as const;

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

type Props = Readonly<{ projectId: string; projectName: string; onClose: () => void; fullScreen: boolean; onToggleFullScreen: () => void }>;

export function Cockpit({ projectId, projectName, onClose, fullScreen, onToggleFullScreen }: Props) {
  const base = `/api/cockpit/projects/${projectId}`;
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
    cockpitRequest<{ adapters: CockpitAdapter[] }>('/api/cockpit/adapters').then(value => setAdapters(value.adapters), () => undefined);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 4_000);
    return () => clearInterval(timer);
  }, [load]);

  const selected = sessions?.find(item => item.id === selectedId) ?? null;
  const replace = (session: CockpitSession) => setSessions(previous => previous ? [session, ...previous.filter(item => item.id !== session.id)] : [session]);

  return <div className={`cockpit${fullScreen ? '' : ' is-docked'}`} onKeyDown={event => { if (event.key === 'Escape' && !(event.target instanceof HTMLElement && event.target.closest('.cockpit-terminal'))) onClose(); }}>
    <header className="pane-header cockpit-header">
      <h2><TerminalSquare size={18} /> Terminals <small>{projectName}</small></h2>
      <div className="cockpit-header-actions">
        <button className="icon-button" type="button" aria-label="Refresh sessions" title="Refresh" onClick={() => void load()}><RefreshCw size={17} /></button>
        <button className="icon-button" type="button" aria-label={fullScreen ? 'Exit full screen' : 'Full screen'} title={fullScreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullScreen}>{fullScreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="icon-button" type="button" aria-label="Close terminals" onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    {error ? <p className="notice error cockpit-notice" role="alert">{error}</p> : null}
    <div className="cockpit-body">
      <nav className="cockpit-sessions" aria-label="Terminal sessions">
        <button className="secondary-button cockpit-new" type="button" onClick={() => setCreating(true)}><Plus size={16} /> New session</button>
        {sessions === null ? <p className="muted small">Loading…</p> : sessions.length === 0 ? <p className="muted small">No sessions in this project yet.</p> : null}
        <ul>
          {sessions?.map(session => <li key={session.id}>
            <button type="button" className="cockpit-session-item" aria-current={session.id === selectedId ? 'true' : undefined} onClick={() => { setSelectedId(session.id); setCreating(false); }}>
              <span className={`cockpit-dot state-${session.state}`} aria-hidden="true" />
              <span className="cockpit-session-text"><strong>{session.title}</strong><small>{session.kind} · {STATE_LABEL[session.state] ?? session.state}{session.owner === 'lead' ? ' · lead' : ''}</small></span>
            </button>
          </li>)}
        </ul>
      </nav>
      <section className="cockpit-main">
        {creating ? <CreateForm adapters={adapters} base={base} onCancel={() => setCreating(false)} onCreated={session => { replace(session); setSelectedId(session.id); setCreating(false); }} />
          : selected ? <SessionView key={selected.id} base={base} session={selected} onSession={replace} />
            : <div className="cockpit-empty"><TerminalSquare size={28} /><p>Start a session to run Claude Code, Codex, Gemini, OpenCode or a shell on the execution host.</p></div>}
      </section>
    </div>
  </div>;
}

function CreateForm({ adapters, base, onCancel, onCreated }: Readonly<{ adapters: CockpitAdapter[]; base: string; onCancel: () => void; onCreated: (session: CockpitSession) => void }>) {
  const [kind, setKind] = useState<CockpitKind>('claude');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request ID per intended session, so a retry after a timeout never launches a second agent.
  const requestId = useRef(newRequestId());
  const adapter = adapters.find(item => item.kind === kind);
  const options: { kind: CockpitKind; label: string }[] = adapters.length ? adapters.map(item => ({ kind: item.kind, label: item.label }))
    : [{ kind: 'claude', label: 'Claude Code' }, { kind: 'codex', label: 'Codex' }, { kind: 'gemini', label: 'Gemini CLI' }, { kind: 'opencode', label: 'OpenCode' }, { kind: 'shell', label: 'Shell' }];
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const { session } = await cockpitRequest<{ session: CockpitSession }>(`${base}/sessions`, {
        requestId: requestId.current, title: title.trim() || options.find(item => item.kind === kind)?.label || kind, kind,
        ...(kind === 'shell' ? {} : { worktree }), ...(prompt.trim() ? { initialInput: prompt } : {}),
      });
      requestId.current = newRequestId();
      onCreated(session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The session could not be started.'); } finally { setBusy(false); }
  };
  return <form className="cockpit-create" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3>New session</h3>
    <label>Agent<select value={kind} onChange={event => { setKind(event.target.value as CockpitKind); requestId.current = newRequestId(); }}>
      {options.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}
    </select></label>
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

function SessionView({ base, session, onSession }: Readonly<{ base: string; session: CockpitSession; onSession: (session: CockpitSession) => void }>) {
  const host = useRef<HTMLDivElement | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const ctrl = useRef(false);
  const [ctrlOn, setCtrlOn] = useState(false);
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
      socket.current?.close(); socket.current = null; term.dispose(); terminal.current = null; unmirror();
    };
  }, [base, send, type]);

  const act = async (path: string, body: unknown = {}) => {
    setBusy(true); setNotice(null);
    try {
      const result = await cockpitRequest<{ session?: CockpitSession }>(`${base}/sessions/${session.id}/${path}`, body);
      if (result.session) onSession(result.session);
      terminal.current?.focus();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'The action failed.'); } finally { setBusy(false); }
  };
  const active = ACTIVE.has(session.state);
  const key = (data: string) => { type(data); terminal.current?.focus(); };
  const paste = async () => {
    try { const text = await navigator.clipboard.readText(); if (text) terminal.current?.paste(text); } catch { setNotice('Clipboard access was blocked. Long-press in the terminal to paste instead.'); }
    terminal.current?.focus();
  };

  return <div className="cockpit-session">
    <div className="cockpit-toolbar">
      <div className="cockpit-meta">
        <strong>{session.title}</strong>
        <small>{STATE_LABEL[session.state] ?? session.state}{session.exitCode !== null ? ` (${session.exitCode})` : ''} · {session.host}{session.branch ? ` · ${session.branch}` : ''} · {link === 'open' ? 'live' : link}</small>
      </div>
      <div className="cockpit-actions">
        <span className={`cockpit-owner owner-${session.owner}`} title={OWNER_LABEL[session.owner]}>{session.owner === 'lead' ? <Bot size={14} /> : <UserRound size={14} />}<span className="cockpit-label">{OWNER_LABEL[session.owner]}</span></span>
        {active && session.owner !== 'human' ? <button className="secondary-button" type="button" disabled={busy} aria-label="Take over" onClick={() => void act('ownership', { action: 'take' })}><Hand size={15} /><span className="cockpit-label">Take over</span></button> : null}
        {active && session.owner === 'human' ? <button className="secondary-button" type="button" disabled={busy} aria-label="Hand to lead" onClick={() => void act('ownership', { action: 'hand_to_lead' })}><Bot size={15} /><span className="cockpit-label">Hand to lead</span></button> : null}
        {active ? <button className="secondary-button" type="button" disabled={busy} title="Send Ctrl-C" aria-label="Interrupt" onClick={() => void act('interrupt')}><OctagonX size={15} /><span className="cockpit-label">Interrupt</span></button> : null}
        {active ? confirmStop
          ? <><button className="danger-button" type="button" disabled={busy} onClick={() => { setConfirmStop(false); void act('stop'); }}>Stop it</button><button className="secondary-button" type="button" onClick={() => setConfirmStop(false)}>Keep running</button></>
          : <button className="secondary-button" type="button" disabled={busy} aria-label="Stop" onClick={() => setConfirmStop(true)}><Square size={14} /><span className="cockpit-label">Stop</span></button> : null}
      </div>
    </div>
    {session.failure ? <p className="notice error cockpit-notice" role="alert">{session.failure}</p> : null}
    {notice ? <p className="notice cockpit-notice" role="status">{notice}</p> : null}
    <div className="cockpit-terminal" ref={host} />
    {active ? <div className="cockpit-keys" role="toolbar" aria-label="Terminal keys">
      <button type="button" onClick={() => key('\x1b')}>Esc</button>
      <button type="button" onClick={() => key('\t')}>Tab</button>
      <button type="button" aria-pressed={ctrlOn} onClick={() => { ctrl.current = !ctrl.current; setCtrlOn(ctrl.current); terminal.current?.focus(); }}>Ctrl</button>
      <button type="button" onClick={() => key('\x03')}>^C</button>
      <button type="button" aria-label="Left" onClick={() => key('\x1b[D')}><ArrowLeft size={15} /></button>
      <button type="button" aria-label="Up" onClick={() => key('\x1b[A')}><ArrowUp size={15} /></button>
      <button type="button" aria-label="Down" onClick={() => key('\x1b[B')}><ArrowDown size={15} /></button>
      <button type="button" aria-label="Right" onClick={() => key('\x1b[C')}><ArrowRight size={15} /></button>
      <button type="button" aria-label="Paste" onClick={() => void paste()}><ClipboardPaste size={15} /></button>
      <button type="button" onClick={() => key('\r')}>Enter</button>
    </div> : null}
  </div>;
}
