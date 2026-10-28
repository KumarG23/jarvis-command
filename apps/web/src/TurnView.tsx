import { composeProjectInput, projectContext, readProjectForSend } from './projectInput';
import type { ProjectRoom } from '@jarvis-command/contracts';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronRight, Command, Copy, FilePlus2, ImagePlus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArtifactMutationResponseSchema, InferenceOptionsResponseSchema, type InferenceOptionsResponse, type InferenceOverride, type LiveRunSubmissionRequest, type ReasoningEffort, type RunEvent } from '@jarvis-command/contracts';
import { boundedJson, type DraftRecovery, type Turn } from './useLiveTurn';
import { MessageContent } from './MessageContent';
import { useTextDraft } from './textDraft';
import { routeDecision, selectionProblem, useInferencePreference } from './inferencePreference';

export function TurnView({ turn, allowed, approve, stop, onSaveResponse }: Readonly<{ turn: Turn; allowed: boolean; approve: (run: Turn, choice: 'once' | 'deny') => void; stop: (run: Turn) => void; onSaveResponse?: ((text: string, runId: string | null) => void) | undefined }>) {
  const [confirmation, setConfirmation] = useState<Turn | null>(null);
  const canControl = allowed && turn.identityVerified;
  return <section className="live-turn" aria-label="Current turn">
    <RunInspector key={JSON.stringify([turn.intent.sessionId, turn.intent.clientRequestId])} turn={turn} />
    {turn.intent.input === null ? <><p>Original message unavailable after reload; no message was retransmitted.</p>{turn.projectId ? <p>Original project: {turn.projectId}. Saved context may have changed since admission; recovery does not resend it.</p> : null}<p>Recovery target · Session: {turn.intent.sessionId} · Request: {turn.intent.clientRequestId} · Run: {turn.publicRunId ?? 'Unknown — admission unconfirmed'}</p></> : !turn.userHistoryMatched ? <article className="timeline-event live-message" aria-label="Your message"><div className="event-icon violet" aria-hidden="true">You</div><div className="event-body"><div className="event-label">You</div><p className="turn-input">{turn.intent.input}</p></div></article> : null}
    {turn.output && turn.intent.input === null && !turn.historyBinding ? <details className="recovered-run-output"><summary>Recovered run output — canonical message link unavailable</summary><MessageContent className="turn-output" text={turn.output} /></details> : null}
    {turn.output && !turn.historyMatched && (turn.intent.input !== null || turn.historyBinding) ? <article className="timeline-event live-message" aria-label="Jarvis response"><div className="event-icon cyan" aria-hidden="true"><Command size={21} /></div><div className="event-body"><div className="event-label">Jarvis</div><MessageContent className="turn-output" text={turn.output} /><CopyResponse key={JSON.stringify([turn.intent.sessionId, turn.intent.clientRequestId])} text={turn.output} limited={turn.outputLimited} onSave={onSaveResponse ? () => onSaveResponse(turn.output!, turn.publicRunId ?? null) : undefined} /></div></article> : null}
    {turn.outputLimited ? <p role="status">Output preview limited. Full output may be available in session history.</p> : null}
    {turn.controlMessage ? <p role="status">{turn.done && /steer/i.test(turn.controlMessage)
      ? turn.terminalPendingSteer ? 'Run ended — unconsumed guidance was returned for draft recovery.' : 'Run ended — steer consumption was not reported.'
      : turn.controlMessage}</p> : null}
    {turn.approval ? <section aria-label="Awaiting approval"><h2>Awaiting approval</h2><pre>{turn.approval.command}</pre><p>{turn.approval.description}</p><p>Tool: {turn.approval.tool ?? 'Not reported'}</p><p>Request: {turn.approval.requestId}</p><p>Run: {turn.publicRunId} · Session: {turn.intent.sessionId}</p>
      {canControl && !turn.done ? <><button type="button" disabled={turn.controlBusy} onClick={() => approve(turn, 'once')}>Approve once</button><button type="button" disabled={turn.controlBusy} onClick={() => approve(turn, 'deny')}>Deny</button></> : null}
    </section> : null}
    {canControl && !turn.done && turn.publicRunId ? <>
      {confirmation?.intent === turn.intent && confirmation.publicRunId === turn.publicRunId ? <section aria-label="Confirm stop">
        <h2>Confirm stop</h2><p>Run: {confirmation.publicRunId}</p><p>Session: {confirmation.intent.sessionId}</p>
        <button type="button" disabled={turn.controlBusy} onClick={() => { stop(confirmation); setConfirmation(null); }}>Confirm stop</button>
        <button type="button" onClick={() => setConfirmation(null)}>Keep running</button>
      </section> : <button type="button" disabled={turn.controlBusy} onClick={() => setConfirmation(turn)}>Stop run</button>}
    </> : null}
  </section>;
}

function RunInspector({ turn }: Readonly<{ turn: Turn }>) {
  const [copyMessage, setCopyMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const failedTool = turn.events.some(event => event.type === 'tool.completed' && event.error);
  const failed = !!turn.error || failedTool || turn.phase === 'Run failed' || turn.phase === 'Run interrupted';
  const telemetry = turn.telemetry;
  const execution = turn.usage?.execution;
  const receipt = JSON.stringify({
    version: 1,
    run: {
      publicRunId: turn.publicRunId,
      sessionId: turn.intent.sessionId,
      clientRequestId: turn.intent.clientRequestId,
      phase: turn.phase,
      error: turn.error ?? null,
    },
    route: execution ?? (turn.intent.input !== null && 'inference' in turn.intent ? turn.intent.inference ?? null : null),
    usage: turn.usage ?? null,
    recovery: {
      scope: 'current_tab',
      admissionAttempts: telemetry?.admissionAttempts ?? null,
      streamConnections: telemetry?.streamConnections ?? null,
      streamReconnects: telemetry ? Math.max(0, telemetry.streamConnections - 1) : null,
      statusChecks: telemetry?.statusChecks ?? null,
    },
    activityComplete: !turn.activityUnavailable,
    activity: turn.events.map(receiptActivity),
  }, null, 2);
  const copy = async () => {
    setCopyMessage('');
    try {
      await navigator.clipboard.writeText(receipt);
      setCopyMessage('Run receipt copied');
    } catch {
      setCopyMessage('Could not copy receipt.');
    }
  };
  const handoff = turn.events.some(event => event.type === 'subagent.start' || event.type === 'subagent.complete');
  const decision = execution ? routeDecision(execution) : null;
  return <details className={`run-inspector${failed ? ' failed' : ''}`} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary aria-expanded={expanded} aria-controls={panelId}>
      <ChevronRight size={16} aria-hidden="true" />
      <span className="run-status-line"><span role="status" aria-label="Run status"><span>{runStatus(turn)}</span>
        {failedTool ? ' · Tool failure reported' : ''}{handoff ? ' · Agent handoff reported' : ''}
        {turn.activityUnavailable ? ' · Activity incomplete' : ''}
        {decision && decision !== 'Exact route' ? ` · ${decision}` : turn.usage && !execution ? ' · Executed route unavailable' : ''}
      </span>{!turn.done ? <ObservationAge /> : null}</span>
      <span className="status-disclosure">Activity / Usage</span>
    </summary>
    <div id={panelId} className="run-inspector-body" role="region" aria-label="Run inspector">
      <h3>Usage</h3>
      {turn.usage ? <ExecutionReceipt usage={turn.usage} /> : <p>{turn.done ? 'Run usage unavailable' : 'Usage available when run finishes'}</p>}
      {!execution && 'inference' in turn.intent && turn.intent.inference ? <p className="turn-route">Requested route · {turn.intent.inference.model} · {turn.intent.inference.reasoningEffort}</p> : null}
      <div className="inspector-heading"><h3>Run receipt</h3><button className="secondary-button copy-receipt" type="button" onClick={() => { void copy(); }}><Copy size={14} /> Copy receipt</button></div>
      <span className="copy-status" role="status">{copyMessage}</span>
      <dl className="inspector-facts">
        <div><dt>Status</dt><dd>{turn.phase.replace(/^Run /, '')}</dd></div>
        <div><dt>Run</dt><dd>{turn.publicRunId ?? 'Unknown — admission unconfirmed'}</dd></div>
        <div><dt>Session</dt><dd>{turn.intent.sessionId}</dd></div>
        <div><dt>Admission attempts (this tab)</dt><dd>{telemetry?.admissionAttempts ?? <Unknown label="Admission attempts" source="this tab" />}</dd></div>
        <div><dt>Stream reconnects (this tab)</dt><dd>{telemetry ? Math.max(0, telemetry.streamConnections - 1) : <Unknown label="Stream reconnects" source="this tab" />}</dd></div>
        <div><dt>Status checks (this tab)</dt><dd>{telemetry?.statusChecks ?? <Unknown label="Status checks" source="this tab" />}</dd></div>
      </dl>
      {turn.error ? <p className="inspector-error" role="alert">{turn.error}</p> : null}
      {execution ? <section className="route-decision" aria-label="Route decision">
        <h4>Route decision</h4>
        <dl className="inspector-facts">
          <div><dt>Requested</dt><dd>{routeLabel(execution.requested)}</dd></div>
          <div><dt>Executed</dt><dd>{routeLabel(execution.executed)}</dd></div>
          <div><dt>Decision</dt><dd>{routeDecision(execution)}{execution.routeSource ? ` · ${execution.routeSource}` : ''}</dd></div>
        </dl>
      </section> : null}
      {turn.activityUnavailable ? <p role="status">Some live activity was unavailable. Saved session history may contain tool results.</p> : null}
      {turn.events.length > 0 ? <section className="activity-timeline" aria-label="Activity timeline"><h4>Activity</h4><ol className="turn-activity" aria-label="Run activity">{turn.events.map((event, index) => <li className={event.type === 'tool.completed' && event.error ? 'failed' : ''} key={`${event.timestamp}:${event.type}:${index}`}><time dateTime={event.timestamp}>{event.timestamp.slice(11, 19)}</time><span>{event.type === 'tool.started' || (event.type === 'tool.completed' && !event.error)
          ? <details className="tool-activity"><summary>{event.type === 'tool.started' ? `Tool started: ${event.tool}` : `Tool completed: ${event.tool}`}</summary>{activity(event, turn.done)}</details>
          : activity(event, turn.done)}</span></li>)}</ol></section> : !turn.activityUnavailable ? <p className="empty-activity">No tool or agent activity reported.</p> : null}
    </div>
  </details>;
}

// This DTO has no authoritative run-start timestamp. Keep observation time in
// the mounted view only; reconnects keep it, reopening resets it, terminal hides it.
function ObservationAge() {
  const [started] = useState(() => performance.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((performance.now() - started) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [started]);
  const label = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return <span className="observation-age" role="timer" aria-label="Current-tab observation age" aria-live="off"
    title="Time observed in this view in the current tab; resets when reopened. Provider start time and duration are unknown.">Current-tab observation age · {label}</span>;
}

// Describe the last observed event rather than infer tool lifetimes or execution restarts.
function runStatus(turn: Turn): string {
  if (turn.done) return turn.phase;
  const last = turn.events.at(-1);
  const observed = turn.approval ? 'Waiting for your approval'
    : turn.compaction?.state === 'running' ? 'Compacting context'
    : last?.type === 'tool.started' ? `Tool started: ${last.tool}`
    : last?.type === 'subagent.start' ? `Subagent started: ${last.subagentId}`
    : last?.type === 'subagent.complete' ? `Subagent completed: ${last.subagentId}`
    : last?.type === 'tool.completed' ? `Tool ${last.error ? 'failed' : 'completed'}: ${last.tool}`
    : turn.output ? 'Reply output received' : 'Working…';
  if (/^Reconnecting/.test(turn.phase)) return `Reconnecting · Last reported: ${observed}`;
  if (turn.approval) return observed;
  if (!['Run running', 'Run queued'].includes(turn.phase)) return turn.phase;
  return turn.phase === 'Run queued' && !last && !turn.output ? 'Run queued' : observed;
}

function Unknown({ label, source = 'Hermes' }: Readonly<{ label: string; source?: string }>) {
  const explanation = `${label} unavailable: not reported by ${source}`;
  return <span role="img" title={explanation} aria-label={explanation}>—</span>;
}

function routeLabel(route: { provider: string | null; model: string | null; reasoningEffort: string | null }) {
  return <>{route.model ? modelLabel(route.model) : <Unknown label="Model" />} · {route.reasoningEffort ?? <Unknown label="Effort" />} · {route.provider ? providerLabel(route.provider) : <Unknown label="Provider" />}</>;
}

export function ExecutionReceipt({ usage }: Readonly<{ usage: NonNullable<Turn['usage']> }>) {
  const receipt = usage.execution;
  const context = usage.context;
  const contextPercent = context ? Math.min(100, (context.usedTokens / context.limitTokens) * 100) : null;
  const decision = receipt ? routeDecision(receipt) : null;
  const changed = decision === 'Fallback used' || decision === 'Route changed';
  return <section className={`execution-receipt${changed ? ' warning' : ''}`} aria-label="Execution receipt">
    {receipt ? <p className="receipt-title">Executed · {routeLabel(receipt.executed)}</p> : <p className="receipt-title">Executed route unavailable</p>}
    <p>Run spend · {formatInteger(usage.totalTokens)} tokens · {formatInteger(usage.inputTokens)} in / {formatInteger(usage.outputTokens)} out
      {usage.outputTokensPerSecond == null ? <> · Throughput <Unknown label="Throughput" /></> : ` · ${usage.outputTokensPerSecond.toFixed(1)} tok/s`}</p>
    <p>{usage.apiCalls === undefined ? <>API calls <Unknown label="API calls" /></> : `${usage.apiCalls} API ${usage.apiCalls === 1 ? 'call' : 'calls'}`}
      {usage.providerLatencyMs === undefined ? <> · Provider latency <Unknown label="Provider latency" /></> : ` · ${formatDuration(usage.providerLatencyMs)} provider`}
      {usage.endToEndLatencyMs === undefined ? <> · End-to-end latency <Unknown label="End-to-end latency" /></> : ` · ${formatDuration(usage.endToEndLatencyMs)} end-to-end`}</p>
    <p>{usage.reasoningTokens === undefined ? <>Reasoning <Unknown label="Reasoning" /></> : `${formatInteger(usage.reasoningTokens)} reasoning`}
      {usage.cacheReadTokens === undefined ? <> · Cache read <Unknown label="Cache read" /></> : ` · ${formatInteger(usage.cacheReadTokens)} cache read`}
      {usage.cacheWriteTokens === undefined ? <> · Cache write <Unknown label="Cache write" /></> : ` · ${formatInteger(usage.cacheWriteTokens)} cache write`}
    </p>
    {context && contextPercent !== null ? <div className="context-usage">
      <span>Session context · {contextPercent.toFixed(contextPercent < 10 ? 1 : 0)}% · {formatInteger(context.usedTokens)} / {formatInteger(context.limitTokens)}</span>
      <progress aria-label="Context usage" aria-valuetext={`${formatInteger(context.usedTokens)} / ${formatInteger(context.limitTokens)} tokens · ${contextPercent.toFixed(1)}%`} max={100} value={contextPercent} />
    </div> : <p>Context usage unavailable · Session context <Unknown label="Session context" /></p>}
    {changed ? <p className="receipt-warning">Requested route changed during execution.</p> : null}
    {decision === 'Fallback used' ? <p>Fallback used</p> : null}
    {decision === 'Route verification unavailable' ? <p>Route verification unavailable</p> : null}
    {!changed && receipt?.exact ? <p>Exact route · {receipt.executed.reasoningEffortSource === 'wire' ? 'effort captured at provider wire' : 'effort not wire-confirmed'}</p> : null}
  </section>;
}

function providerLabel(provider: string | null): string {
  if (provider === 'openai-codex') return 'OpenAI';
  if (provider === 'xai-oauth') return 'xAI';
  return provider ?? 'provider unknown';
}

function modelLabel(model: string | null): string {
  return ({
    'gpt-6-astra': 'Astra',
    'gpt-6-sol': 'Sol',
    'gpt-6-luna': 'Luna',
    'gpt-5.6-sol': 'Sol 5.6',
    'gpt-5.6-terra': 'Terra',
    'gpt-5.6-luna': 'Luna 5.6',
    'grok-4.7': 'Grok 4.7',
    'grok-4.6': 'Grok 4.6',
  } as Record<string, string>)[model ?? ''] ?? model ?? 'model unknown';
}

const formatInteger = (value: number) => value.toLocaleString('en-US');
const formatDuration = (milliseconds: number) => milliseconds < 1000
  ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;

export function CopyResponse({ text, limited, onSave }: Readonly<{ text: string; limited: boolean; onSave?: (() => void) | undefined }>) {
  const [notice, setNotice] = useState<{ text: string; message: string } | null>(null);
  const copy = async () => {
    setNotice(null);
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ text, message: limited ? 'Preview copied' : 'Response copied' });
    } catch {
      setNotice({ text, message: 'Could not copy. Select the response text and copy manually.' });
    }
  };
  return <div className="response-actions">
    <button className="icon-button" type="button" aria-label={limited ? 'Copy preview' : 'Copy response'} title={limited ? 'Copy preview' : 'Copy response'} onClick={() => { void copy(); }}><Copy size={16} /></button>
    {onSave ? <button className="icon-button" type="button" aria-label={limited ? 'Save response preview as artifact' : 'Save response as artifact'} title="Save as artifact" onClick={onSave}><FilePlus2 size={16} /></button> : null}
    <span role="status">{notice?.text === text ? notice.message : ''}</span>
  </div>;
}

function receiptActivity(event: RunEvent) {
  const base = { type: event.type, timestamp: event.timestamp };
  switch (event.type) {
    case 'tool.started': return { ...base, tool: event.tool };
    case 'tool.completed': return { ...base, tool: event.tool, error: event.error, durationSeconds: event.durationSeconds };
    case 'subagent.start': return { ...base, subagentId: event.subagentId };
    case 'subagent.complete': return { ...base, subagentId: event.subagentId };
    case 'approval.responded': return { ...base, choice: event.choice };
    default: return base;
  }
}

function activity(event: RunEvent, done: boolean): string {
  switch (event.type) {
    case 'tool.started': return `Tool started: ${event.tool} — ${event.preview}`;
    case 'tool.completed': return `Tool ${event.error ? 'failed' : 'completed'}: ${event.tool} · ${event.durationSeconds}s`;
    case 'subagent.start': return `Subagent started: ${event.subagentId} — ${event.goal}`;
    case 'subagent.complete': return `Subagent completed: ${event.subagentId} — ${event.summary}`;
    case 'approval.responded': return `Approval responded: ${event.choice}`;
    case 'run.steered': return done ? 'Steer was acknowledged; run ended. Consumption not reported by this event.' : 'Steer queued';
    case 'message.delta': return 'Reply output received';
    case 'approval.request': return 'Approval requested';
    case 'context.compaction.started': return 'Context compaction started';
    case 'context.compaction.progress': return 'Context compaction in progress';
    case 'context.compaction.completed': return 'Context compaction completed';
    case 'context.compaction.aborted': return 'Context compaction stopped';
    case 'run.completed': return 'Run completed';
    case 'run.failed': return `Run failed: ${event.error}`;
    case 'run.interrupted': return `Run interrupted: ${event.error}`;
    case 'run.cancelled': return 'Run cancelled';
  }
}
type PendingChatImage = NonNullable<LiveRunSubmissionRequest['images']>[number] & Readonly<{ name: string; size: number }>;

export function TurnComposer({ allowed, imageAttachmentsEnabled, sessionId, projectId, project, onProjectReadback, max, maxSteer, turn, send, retry, resume, steer, recoveries, consumeRecovery, blocked = false, draftsAuthorized = allowed, inferenceTarget }: Readonly<{
  project?: ProjectRoom | null;
  onProjectReadback?: (room: ProjectRoom) => void;
  inferenceTarget?: HTMLElement | null;
  draftsAuthorized?: boolean;
  blocked?: boolean;
  allowed: boolean; imageAttachmentsEnabled: boolean; sessionId: string | undefined; projectId: string | null; max: number; turn: Turn | null;
  maxSteer: number; steer: (run: Turn, input: string, max: number) => Promise<boolean | undefined>;
  recoveries: DraftRecovery[]; consumeRecovery: (recovery: DraftRecovery) => void;
  send: (sessionId: string, input: string, max: number, inference?: InferenceOverride, images?: LiveRunSubmissionRequest['images']) => boolean; retry: () => void; resume: () => void;
}>) {
  const displayedProject = project?.id === projectId ? project : null;
  const { draft, draftsRef, setRoomDraft, clearForSend, storageUnavailable } = useTextDraft(sessionId, allowed && draftsAuthorized);
  const picker = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (picker.current) picker.current.open = false; }, [sessionId]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (picker.current?.open && !picker.current.contains(event.target as Node)) picker.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  const offered = useRef(new WeakSet<DraftRecovery>());
  const [steers, setSteers] = useState<Record<string, string>>({});
  const steerVersions = useRef<Record<string, number>>({});
  const latestTurn = useRef(turn); latestTurn.current = turn;
  const [inferenceOptions, setInferenceOptions] = useState<InferenceOptionsResponse | null>(null);
  const [inferenceError, setInferenceError] = useState(false);
  const preference = useInferencePreference(sessionId);
  const selection = preference.selection;
  const selectedModel = typeof selection === 'string' ? selection : `${selection.provider}:${selection.model}`;
  const reasoningEffort = typeof selection === 'string' ? undefined : selection.reasoningEffort;
  const [inventoryRetry, setInventoryRetry] = useState(0);
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [preflightError, setPreflightError] = useState('');
  const preflight = useRef<AbortController | null>(null);
  // Invalidates an asynchronous send if the chat or send context changes.
  const contextVersion = useMemo(() => ({}), [sessionId, projectId, project, allowed, draftsAuthorized, blocked, turn, selection]);
  const sendContext = useRef(contextVersion);
  sendContext.current = contextVersion;
  useEffect(() => {
    setPreflightError('');
    return () => { preflight.current?.abort(); };
  }, [sessionId]);
  const [imagesBySession, setImagesBySession] = useState<Record<string, PendingChatImage[]>>({});
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const images = sessionId ? imagesBySession[sessionId] ?? [] : [];
  const setDraft = (value: string) => { if (sessionId) setRoomDraft(sessionId, value); };
  const steerDraft = sessionId ? steers[sessionId] ?? '' : '';
  const setSteerDraft = (room: string, value: string) => {
    steerVersions.current[room] = (steerVersions.current[room] ?? 0) + 1;
    setSteers((previous) => ({ ...previous, [room]: value }));
  };
  const handoff = (recovery: DraftRecovery, append: boolean) => {
    const room = recovery.intent.sessionId;
    if (room !== sessionId || !allowed || !draftsAuthorized) return;
    const existing = draftsRef.current[room] ?? '';
    if (existing && !append) return;
    setRoomDraft(room, existing ? `${existing}\n${recovery.input}` : recovery.input);
    consumeRecovery(recovery);
  };
  useEffect(() => {
    if (!allowed || !draftsAuthorized || !sessionId) return;
    for (const recovery of recoveries) {
      if (recovery.kind === 'terminal' && recovery.intent.sessionId === sessionId && !offered.current.has(recovery)) {
        offered.current.add(recovery);
        if (!(draftsRef.current[sessionId] ?? '')) {
          setRoomDraft(sessionId, recovery.input);
          consumeRecovery(recovery);
        }
      }
    }
  }, [allowed, draftsAuthorized, sessionId, recoveries, consumeRecovery]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    let active = true;
    setInventoryBusy(true);
    void boundedJson('/api/live/model-options', {
      credentials: 'same-origin', headers: { accept: 'application/json' },
    }, controller).then((body) => {
      const options = InferenceOptionsResponseSchema.parse(body);
      if (active) { setInferenceOptions(options); setInferenceError(false); }
    }).catch(() => { if (active) { setInferenceOptions(null); setInferenceError(true); } })
      .finally(() => { if (active) setInventoryBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [allowed, inventoryRetry]);
  const queue = async () => {
    if (!allowed || !sessionId || !turn || !turn.identityVerified || turn.done || turn.intent.sessionId !== sessionId || turn.controlBusy || !steerDraft.trim() || steerDraft.length > maxSteer) return;
    const room = sessionId; const run = turn; const version = steerVersions.current[room];
    const accepted = await steer(run, steerDraft, maxSteer);
    if (accepted && latestTurn.current?.intent === run.intent && steerVersions.current[room] === version) setSteerDraft(room, '');
  };
  const busy = blocked || !draftsAuthorized || (!!turn && !turn.done);
  const selectedOption = inferenceOptions?.options.find(option => `${option.provider}:${option.model}` === selectedModel);
  const problem = selectionProblem(selection, inferenceOptions);
  const chooseModel = (value: string) => {
    setPreflightError('');
    if (value === 'inherit') { preference.select('inherit'); return; }
    const option = inferenceOptions?.options.find(option => `${option.provider}:${option.model}` === value);
    if (!option) return;
    const effort = reasoningEffort && option.reasoningEfforts.includes(reasoningEffort) ? reasoningEffort
      : option.reasoningEfforts.includes('medium') ? 'medium' : option.reasoningEfforts[0]!;
    preference.select({ provider: option.provider, model: option.model, reasoningEffort: effort } as InferenceOverride);
  };
  const attachImages = async (files: FileList | File[] | null) => {
    if (!allowed || !imageAttachmentsEnabled || !sessionId || busy || preflight.current || imageBusy) return;
    const candidates = Array.from(files ?? []).filter(file => file.type.startsWith('image/'));
    if (!candidates.length) return;
    if (images.length + candidates.length > 4) { setImageError('Attach at most four images.'); return; }
    const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    if (candidates.some(file => !allowedMimes.has(file.type))) { setImageError('Chat supports PNG, JPEG, GIF and WebP images.'); return; }
    if (images.reduce((total, image) => total + image.size, 0) + candidates.reduce((total, file) => total + file.size, 0) > 6 * 1024 * 1024) {
      setImageError('Attached images must total 6 MB or less.'); return;
    }
    setImageBusy(true); setImageError('');
    const uploaded: PendingChatImage[] = [];
    let failures = 0;
    try {
      for (const file of candidates) {
        try {
          const form = new FormData();
          form.append('metadata', JSON.stringify({ title: file.name || 'Pasted image', sessionId, projectId }));
          form.append('file', file, file.name || 'clipboard.png');
          const response = await fetch('/api/artifacts/upload', {
            method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'x-jarvis-command': '1' }, body: form,
          });
          if (!response.ok || response.redirected) throw new Error('upload failed');
          const artifact = ArtifactMutationResponseSchema.parse(await response.json()).artifact;
          if (artifact.type !== 'image') throw new Error('not an image');
          uploaded.push({ artifactId: artifact.id, version: artifact.currentVersion, name: artifact.originalFilename ?? artifact.title, size: artifact.size });
        } catch {
          failures += 1;
        }
      }
      if (uploaded.length) setImagesBySession(previous => ({ ...previous, [sessionId]: [...(previous[sessionId] ?? []), ...uploaded] }));
      if (failures) setImageError(uploaded.length ? 'Some images could not be attached.' : 'Image upload failed. Nothing was attached to this message.');
    } finally {
      setImageBusy(false);
      if (imageInput.current) imageInput.current.value = '';
    }
  };
  const submit = async () => {
    const message = draft.trim() || (images.length ? 'Review the attached image.' : '');
    let input = composeProjectInput(message, displayedProject);
    if (!allowed || !sessionId || busy || imageBusy || preflight.current || !message) return;
    if (problem) { setPreflightError(problem); return; }
    const context = sendContext.current;
    const controller = new AbortController();
    preflight.current = controller;
    setPreflighting(true); setPreflightError('');
    try {
      if (projectId) {
        let fresh: ProjectRoom;
        try { fresh = await readProjectForSend(projectId, sessionId, controller); }
        catch (error) { if (sendContext.current === context) setPreflightError(error instanceof Error ? error.message : 'Project readback unavailable. Your draft is kept.'); return; }
        if (controller.signal.aborted || sendContext.current !== context) return;
        if (!displayedProject || projectContext(fresh) !== projectContext(displayedProject)) {
          onProjectReadback?.(fresh);
          setPreflightError('Saved project context changed. Review the updated context and send again. Your draft is kept.'); return;
        }
        input = composeProjectInput(message, fresh);
      }
      if (input.length > max) { setPreflightError(`Complete message including project context is ${input.length} / ${max} characters. Shorten the message or saved context. Your draft is kept.`); return; }
      if (typeof selection !== 'string') {
        let fresh: InferenceOptionsResponse;
        try {
          fresh = InferenceOptionsResponseSchema.parse(await boundedJson('/api/live/model-options', {
            credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store',
          }, controller));
        } catch {
          if (sendContext.current !== context) return;
          setInferenceOptions(null); setInferenceError(true);
          setPreflightError('Model choices unavailable. Retry choices before sending this request, or explicitly choose Inherit.');
          return;
        }
        if (controller.signal.aborted || sendContext.current !== context) return;
        setInferenceOptions(fresh); setInferenceError(false);
        const rejected = selectionProblem(selection, fresh);
        if (rejected) { setPreflightError(rejected); return; }
      }
      if (controller.signal.aborted || sendContext.current !== context || (draftsRef.current[sessionId] ?? '') !== draft) return;
      if (!clearForSend(sessionId)) { setPreflightError('Draft storage could not be cleared safely. Message not sent; keep this tab open and retry when storage is available.'); return; }
      if (send(sessionId, input, max, typeof selection === 'string' ? undefined : selection, images.map(({ artifactId, version }) => ({ artifactId, version })))) {
        setRoomDraft(sessionId, '');
        setImagesBySession(previous => ({ ...previous, [sessionId]: [] }));
      } else setRoomDraft(sessionId, draft);
    } finally {
      preflight.current = null;
      setPreflighting(false);
    }
  };
  const inferencePicker = (<details ref={picker} className={`inference-control${inferenceTarget ? ' header-inference' : ''}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (picker.current) picker.current.open = false; picker.current?.querySelector('summary')?.focus(); }
      }}>
        <summary title={`Requested · ${selection === 'inherit' ? 'Inherit' : selection === 'invalid' ? 'Selection unavailable' : `${selectedOption?.label ?? selection.model} · ${reasoningEffort}`}`}><span className="requested-label">Requested · </span><span className="requested-choice">{selection === 'inherit' ? 'Inherit' : selection === 'invalid' ? 'Selection unavailable' : `${selectedOption?.label ?? selection.model} · ${reasoningEffort}`}</span></summary>
        <div className="inference-fields">
          <p className="route-explanation">Requested for the next message. Executed route is reported only in a run’s Activity / Usage receipt; a latest-session receipt does not identify a selected answer.</p>
          <label>Model<select aria-label="Model for this prompt" value={selectedModel} disabled={busy || preflighting || inventoryBusy} onChange={(event) => chooseModel(event.target.value)}>
            <option value="inherit">Inherit ({inferenceOptions?.default.model ?? 'session default'})</option>
            {selection === 'invalid' ? <option value="invalid" disabled>Stored selection unavailable</option> : null}
            {typeof selection !== 'string' && !selectedOption ? <option value={selectedModel} disabled>{selection.model} (unavailable)</option> : null}
            {inferenceOptions?.options.map(option => <option key={`${option.provider}:${option.model}`} value={`${option.provider}:${option.model}`}>{option.label}</option>)}
          </select></label>
          <label>Reasoning<select aria-label="Reasoning for this prompt" value={reasoningEffort ?? ''} disabled={busy || preflighting || !selectedOption} onChange={(event) => {
            if (typeof selection !== 'string' && selectedOption?.reasoningEfforts.includes(event.target.value as ReasoningEffort)) {
              preference.select({ ...selection, reasoningEffort: event.target.value as ReasoningEffort }); setPreflightError('');
            }
          }}>
            {!reasoningEffort ? <option value="">Session default (not guaranteed)</option> : null}
            {reasoningEffort && !selectedOption?.reasoningEfforts.includes(reasoningEffort) ? <option value={reasoningEffort} disabled>{reasoningEffort} (unsupported)</option> : null}
            {(selectedOption?.reasoningEfforts ?? []).map(effort => <option key={effort} value={effort}>{effort}</option>)}
          </select></label>
          <p>Preflight request for this chat, saved only in this browser. Offered efforts are requests; execution is confirmed only by the current run receipt. Inherit uses session routing without a guaranteed effort.</p>
          <button className="secondary-button" type="button" disabled={inventoryBusy || preflighting || busy} onClick={() => { setPreflightError(''); setInventoryRetry(value => value + 1); }}>Retry model choices</button>
        </div>
      </details>);
  return <>
    {busy && turn && !turn.done ? <p className="composer-feedback" role="status">{turn.phase}</p> : null}
    {turn?.phase === 'Admission uncertain — retry the same intent' ? <button className="primary-button" type="button" onClick={retry}>Retry same intent</button> : null}
    {turn && !turn.done && !turn.publicRunId && turn.phase.startsWith('Admission unknown') ? <button className="primary-button" type="button" onClick={resume}>Check admission status</button> : null}
    {turn && !turn.done && turn.publicRunId && turn.phase.startsWith('Disconnected') ? <button className="primary-button" type="button" onClick={resume}>Resume status check</button> : null}
    {allowed && turn && turn.identityVerified && !turn.done && turn.publicRunId && turn.intent.sessionId === sessionId ? <form className="turn-composer" onSubmit={(event) => { event.preventDefault(); void queue(); }}>
      <textarea aria-label="Steer Jarvis" maxLength={maxSteer} value={steerDraft} onChange={(event) => setSteerDraft(sessionId!, event.target.value)} />
      <button className="primary-button" type="submit" disabled={turn.controlBusy || !steerDraft.trim() || steerDraft.length > maxSteer}>Queue steer</button>
      <p>Queue guidance for this run; acknowledgement does not mean execution.</p>
    </form> : null}
    {allowed && draftsAuthorized ? recoveries.filter((item) => item.intent.sessionId === sessionId).map((item, index) => <section key={index} aria-label="Recover steer draft">
      <p>{item.kind === 'terminal' ? 'Unconsumed terminal steer' : 'Unconfirmed steer — may already be queued; no automatic retry'}</p><pre>{item.input}</pre>
      <button type="button" disabled={!!draft} onClick={() => handoff(item, false)}>Restore to empty draft</button>
      <button type="button" onClick={() => handoff(item, true)}>Append to draft</button>
    </section>) : null}
    {allowed ? <form className="turn-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }} onDragOver={(event) => {
      if (!imageAttachmentsEnabled) return;
      if (Array.from(event.dataTransfer.items).some(item => item.kind === 'file' && item.type.startsWith('image/'))) event.preventDefault();
    }} onDrop={(event) => { if (!imageAttachmentsEnabled) return; const files = Array.from(event.dataTransfer.files); if (files.some(file => file.type.startsWith('image/'))) { event.preventDefault(); void attachImages(files); } }}>
      {inferenceTarget ? createPortal(inferencePicker, inferenceTarget) : inferencePicker}
      {projectId ? <details className="project-input-preview"><summary>{displayedProject ? 'Project context included' : 'Project context awaiting readback'} · {composeProjectInput(draft.trim() || (images.length ? 'Review the attached image.' : ''), displayedProject).length} / {max} characters</summary>{displayedProject ? <pre>{projectContext(displayedProject)}</pre> : <p>Project context must be read back before sending.</p>}<p>Included as ordinary message text on new sends. Saved non-image files are not delivered to Hermes. Use Attach image explicitly for images.</p></details> : null}
      {preflighting ? <p role="status">Checking saved context and requested model…</p> : null}
      {preflightError || problem || inferenceError ? <p role="status">{preflightError || problem || 'Model choices unavailable; explicitly selected Inherit remains available.'}</p> : null}
      {storageUnavailable ? <p role="status">Draft storage unavailable or full. Text remains in this tab; reload may lose recent edits. Sending requires safely clearing the saved draft.</p> : null}
      {preference.storageUnavailable ? <p role="status">Local preference storage unavailable or invalid. A new selection stays in this tab if it cannot be saved; reload may require choosing again.</p> : null}
      {images.length ? <div className="chat-images" aria-label="Attached images">{images.map(image => <span key={`${image.artifactId}:${image.version}`}><ImagePlus size={14} />{image.name}<button type="button" disabled={busy || preflighting || imageBusy} aria-label={`Remove ${image.name}`} onClick={() => setImagesBySession(previous => ({ ...previous, [sessionId!]: (previous[sessionId!] ?? []).filter(item => item !== image) }))}><X size={13} /></button></span>)}</div> : null}
      {imageBusy ? <p role="status">Uploading image…</p> : null}
      {imageError ? <p role="alert">{imageError}</p> : null}
      {imageAttachmentsEnabled ? <><input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple aria-label="Attach images" onChange={event => { void attachImages(event.target.files); }} />
      <button className="icon-button attach-image" type="button" disabled={busy || preflighting || imageBusy || images.length >= 4} aria-label="Attach image" title="Attach image" onClick={() => imageInput.current?.click()}><ImagePlus size={19} /></button></> : null}
      <textarea placeholder="Message Jarvis…" aria-label="Message Jarvis" maxLength={max} value={draft} disabled={busy || preflighting} onPaste={(event) => {
        if (!imageAttachmentsEnabled) return;
        const pasted = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
        if (pasted.length) { event.preventDefault(); void attachImages(pasted); }
      }} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void submit(); }
      }} />
      <button className="primary-button" type="submit" disabled={busy || preflighting || imageBusy || (!draft.trim() && !images.length) || draft.length > max} aria-label="Send message" title="Send message"><ArrowUp size={20} /></button>
    </form> : <p className="composer-feedback">{sessionId ? 'Messaging is unavailable for this chat.' : 'Choose New chat to begin.'}</p>}
    <details className="turn-limit"><summary>Connection & recovery details</summary><p>One writer in this tab; the server enforces cross-tab/session concurrency. Only opaque session, project, request and run identifiers are stored for reload recovery. Requested model/effort preferences are stored locally per chat and application environment. Known runs resume by status reads, never message retransmission. Pending admission without a run ID uses a read-only request lookup and stays locked while the outcome is unknown. Unsent text drafts are saved in this tab (up to 32 chats, 16,000 characters per draft and 128 KiB total). Image bytes are never saved in draft storage. Drafts appear only after selected-chat access is confirmed; sending clears the saved text before admission.</p></details>
  </>;
}
