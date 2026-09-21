import { ArrowUp, ChevronRight, Command, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { InferenceOptionsResponseSchema, type InferenceOptionsResponse, type InferenceOverride, type ReasoningEffort, type RunEvent } from '@jarvis-command/contracts';
import { boundedJson, type DraftRecovery, type Turn } from './useLiveTurn';

export function TurnView({ turn, allowed, approve, stop }: Readonly<{ turn: Turn; allowed: boolean; approve: (run: Turn, choice: 'once' | 'deny') => void; stop: (run: Turn) => void }>) {
  const [confirmation, setConfirmation] = useState<Turn | null>(null);
  const canControl = allowed && turn.identityVerified;
  return <section className="live-turn" aria-label="Current turn">
    <p className="turn-phase" role="status">{turn.phase}</p>
    {turn.usage?.execution ? <ExecutionReceipt usage={turn.usage} />
      : 'inference' in turn.intent && turn.intent.inference ? <p className="turn-route">Requested route · {turn.intent.inference.model} · {turn.intent.inference.reasoningEffort}</p> : null}
    {turn.intent.input === null ? <><p>Original message unavailable after reload; no message was retransmitted.</p><p>Recovery target · Session: {turn.intent.sessionId} · Request: {turn.intent.clientRequestId} · Run: {turn.publicRunId ?? 'Unknown — admission lookup unsupported'}</p></> : !turn.userHistoryMatched ? <article className="timeline-event live-message" aria-label="Your message"><div className="event-icon violet" aria-hidden="true">You</div><div className="event-body"><div className="event-label">You</div><p className="turn-input">{turn.intent.input}</p></div></article> : null}
    {turn.output && !turn.historyMatched ? <article className="timeline-event live-message" aria-label="Jarvis response"><div className="event-icon cyan" aria-hidden="true"><Command size={21} /></div><div className="event-body"><div className="event-label">Jarvis</div><p className="turn-output">{turn.output}</p><CopyResponse key={JSON.stringify([turn.intent.sessionId, turn.intent.clientRequestId])} text={turn.output} limited={turn.outputLimited} /></div></article> : null}
    {turn.outputLimited ? <p role="status">Output preview limited. Full output may be available in session history.</p> : null}
    {turn.publicRunId || turn.events.length > 0 || turn.usage?.execution ? <RunInspector turn={turn} /> : null}
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
  const tools = turn.events.filter(event => event.type === 'tool.started').length;
  const failedTool = turn.events.some(event => event.type === 'tool.completed' && event.error);
  const failed = !!turn.error || failedTool || turn.phase === 'Run failed' || turn.phase === 'Run interrupted';
  const telemetry = turn.telemetry ?? { admissionAttempts: turn.publicRunId ? 1 : 0, streamConnections: 0, statusChecks: 0 };
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
      admissionAttempts: telemetry.admissionAttempts,
      streamConnections: telemetry.streamConnections,
      streamReconnects: Math.max(0, telemetry.streamConnections - 1),
      statusChecks: telemetry.statusChecks,
    },
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
  return <details className={`run-inspector${failed ? ' failed' : ''}`} open={failed || undefined}>
    <summary><ChevronRight size={14} /><span>Run details</span><small>{tools} {tools === 1 ? 'tool' : 'tools'} · {turn.phase.replace(/^Run /, '')}{failed ? ' · Attention needed' : ''}</small></summary>
    <div className="run-inspector-body" role="region" aria-label="Run inspector">
      <div className="inspector-heading"><h3>Run receipt</h3><button className="secondary-button copy-receipt" type="button" onClick={() => { void copy(); }}><Copy size={14} /> Copy receipt</button></div>
      <span className="copy-status" role="status">{copyMessage}</span>
      <dl className="inspector-facts">
        <div><dt>Status</dt><dd>{turn.phase.replace(/^Run /, '')}</dd></div>
        <div><dt>Run</dt><dd>{turn.publicRunId ?? 'Not admitted'}</dd></div>
        <div><dt>Admission attempts</dt><dd>{telemetry.admissionAttempts}</dd></div>
        <div><dt>Stream reconnects</dt><dd>{Math.max(0, telemetry.streamConnections - 1)}</dd></div>
        <div><dt>Status checks</dt><dd>{telemetry.statusChecks}</dd></div>
      </dl>
      {turn.error ? <p className="inspector-error" role="alert">{turn.error}</p> : null}
      {execution ? <section className="route-decision" aria-label="Route decision">
        <h4>Route decision</h4>
        <dl className="inspector-facts">
          <div><dt>Requested</dt><dd>{routeLabel(execution.requested)}</dd></div>
          <div><dt>Executed</dt><dd>{routeLabel(execution.executed)}</dd></div>
          <div><dt>Decision</dt><dd>{execution.fallbackUsed ? 'Fallback used' : execution.exact ? 'Exact route' : 'Route changed'}{execution.routeSource ? ` · ${execution.routeSource}` : ''}</dd></div>
        </dl>
      </section> : null}
      {turn.events.length > 0 ? <section className="activity-timeline" aria-label="Activity timeline"><h4>Activity</h4><ol className="turn-activity" aria-label="Run activity">{turn.events.map((event, index) => <li className={event.type === 'tool.completed' && event.error ? 'failed' : ''} key={`${event.timestamp}:${event.type}:${index}`}><time dateTime={event.timestamp}>{event.timestamp.slice(11, 19)}</time><span>{activity(event, turn.done)}</span></li>)}</ol></section> : <p className="empty-activity">No tool or agent activity reported.</p>}
    </div>
  </details>;
}

function routeLabel(route: { provider: string | null; model: string | null; reasoningEffort: string | null }): string {
  return `${modelLabel(route.model)} · ${route.reasoningEffort ?? 'effort unknown'} · ${providerLabel(route.provider)}`;
}

function ExecutionReceipt({ usage }: Readonly<{ usage: NonNullable<Turn['usage']> }>) {
  const receipt = usage.execution!;
  const context = usage.context;
  const contextPercent = context ? Math.min(100, (context.usedTokens / context.limitTokens) * 100) : null;
  const changed = receipt.fallbackUsed
    || (receipt.requested.provider !== null && receipt.requested.provider !== receipt.executed.provider)
    || (receipt.requested.model !== null && receipt.requested.model !== receipt.executed.model)
    || (receipt.requested.reasoningEffort !== null && receipt.requested.reasoningEffort !== receipt.executed.reasoningEffort);
  return <section className={`execution-receipt${changed ? ' warning' : ''}`} aria-label="Execution receipt">
    <p className="receipt-title">Executed · {modelLabel(receipt.executed.model)} · {receipt.executed.reasoningEffort ?? 'effort unknown'} · {providerLabel(receipt.executed.provider)}</p>
    <p>{formatInteger(usage.totalTokens)} tokens · {formatInteger(usage.inputTokens)} in / {formatInteger(usage.outputTokens)} out
      {usage.outputTokensPerSecond == null ? ' · throughput unavailable' : ` · ${usage.outputTokensPerSecond.toFixed(1)} tok/s`}</p>
    <p>{usage.apiCalls === undefined ? 'API calls unavailable' : `${usage.apiCalls} API ${usage.apiCalls === 1 ? 'call' : 'calls'}`}
      {usage.providerLatencyMs === undefined ? '' : ` · ${formatDuration(usage.providerLatencyMs)} provider`}
      {usage.endToEndLatencyMs === undefined ? '' : ` · ${formatDuration(usage.endToEndLatencyMs)} end-to-end`}</p>
    {usage.reasoningTokens || usage.cacheReadTokens || usage.cacheWriteTokens ? <p>
      {usage.reasoningTokens ? `${formatInteger(usage.reasoningTokens)} reasoning` : 'Reasoning unavailable'}
      {usage.cacheReadTokens ? ` · ${formatInteger(usage.cacheReadTokens)} cache read` : ''}
      {usage.cacheWriteTokens ? ` · ${formatInteger(usage.cacheWriteTokens)} cache write` : ''}
    </p> : null}
    {context && contextPercent !== null ? <div className="context-usage">
      <span>Context · {contextPercent.toFixed(contextPercent < 10 ? 1 : 0)}% · {formatInteger(context.usedTokens)} / {formatInteger(context.limitTokens)}</span>
      <progress aria-label="Context usage" max={100} value={contextPercent} />
    </div> : <p>Context usage unavailable</p>}
    {changed ? <p className="receipt-warning">Requested route changed during execution.</p> : null}
    {!changed && receipt.exact ? <p>Exact route · {receipt.executed.reasoningEffortSource === 'wire' ? 'effort captured at provider wire' : 'effort not wire-confirmed'}</p> : null}
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
    'gpt-5.6-sol': 'Sol',
    'gpt-5.6-terra': 'Terra',
    'gpt-5.6-luna': 'Luna',
    'grok-4.6': 'Grok 4.6',
  } as Record<string, string>)[model ?? ''] ?? model ?? 'model unknown';
}

const formatInteger = (value: number) => value.toLocaleString('en-US');
const formatDuration = (milliseconds: number) => milliseconds < 1000
  ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;

export function CopyResponse({ text, limited }: Readonly<{ text: string; limited: boolean }>) {
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
    case 'tool.completed': return `Tool ${event.error ? 'failed' : 'completed'}: ${event.tool}`;
    case 'subagent.start': return `Subagent started: ${event.subagentId} — ${event.goal}`;
    case 'subagent.complete': return `Subagent completed: ${event.subagentId} — ${event.summary}`;
    case 'approval.responded': return `Approval responded: ${event.choice}`;
    case 'run.steered': return done ? 'Steer was acknowledged; run ended. Consumption not reported by this event.' : 'Steer queued';
    default: return event.type;
  }
}
export function TurnComposer({ allowed, sessionId, max, maxSteer, turn, send, retry, resume, steer, recoveries, consumeRecovery, blocked = false }: Readonly<{
  blocked?: boolean;
  allowed: boolean; sessionId: string | undefined; max: number; turn: Turn | null;
  maxSteer: number; steer: (run: Turn, input: string, max: number) => Promise<boolean | undefined>;
  recoveries: DraftRecovery[]; consumeRecovery: (recovery: DraftRecovery) => void;
  send: (sessionId: string, input: string, max: number, inference?: InferenceOverride) => boolean; retry: () => void; resume: () => void;
}>) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef(drafts);
  const offered = useRef(new WeakSet<DraftRecovery>());
  const [steers, setSteers] = useState<Record<string, string>>({});
  const steerVersions = useRef<Record<string, number>>({});
  const latestTurn = useRef(turn); latestTurn.current = turn;
  const [inferenceOptions, setInferenceOptions] = useState<InferenceOptionsResponse | null>(null);
  const [inferenceError, setInferenceError] = useState(false);
  const [selectedModel, setSelectedModel] = useState('inherit');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const draft = sessionId ? drafts[sessionId] ?? '' : '';
  const setRoomDraft = (room: string, value: string) => { draftsRef.current = { ...draftsRef.current, [room]: value }; setDrafts(draftsRef.current); };
  const setDraft = (value: string) => { if (sessionId) setRoomDraft(sessionId, value); };
  const steerDraft = sessionId ? steers[sessionId] ?? '' : '';
  const setSteerDraft = (room: string, value: string) => {
    steerVersions.current[room] = (steerVersions.current[room] ?? 0) + 1;
    setSteers((previous) => ({ ...previous, [room]: value }));
  };
  const handoff = (recovery: DraftRecovery, append: boolean) => {
    const room = recovery.intent.sessionId;
    if (room !== sessionId || !allowed) return;
    const existing = draftsRef.current[room] ?? '';
    if (existing && !append) return;
    setRoomDraft(room, existing ? `${existing}\n${recovery.input}` : recovery.input);
    consumeRecovery(recovery);
  };
  useEffect(() => {
    if (!allowed || !sessionId) return;
    for (const recovery of recoveries) {
      if (recovery.kind === 'terminal' && recovery.intent.sessionId === sessionId && !offered.current.has(recovery)) {
        offered.current.add(recovery);
        if (!(draftsRef.current[sessionId] ?? '')) {
          setRoomDraft(sessionId, recovery.input);
          consumeRecovery(recovery);
        }
      }
    }
  }, [allowed, sessionId, recoveries, consumeRecovery]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void boundedJson('/api/live/model-options', {
      credentials: 'same-origin', headers: { accept: 'application/json' },
    }, controller).then((body) => {
      setInferenceOptions(InferenceOptionsResponseSchema.parse(body));
      setInferenceError(false);
    }).catch(() => { if (!controller.signal.aborted) setInferenceError(true); });
    return () => controller.abort();
  }, [allowed]);
  const queue = async () => {
    if (!allowed || !sessionId || !turn || !turn.identityVerified || turn.done || turn.intent.sessionId !== sessionId || turn.controlBusy || !steerDraft.trim() || steerDraft.length > maxSteer) return;
    const room = sessionId; const run = turn; const version = steerVersions.current[room];
    const accepted = await steer(run, steerDraft, maxSteer);
    if (accepted && latestTurn.current?.intent === run.intent && steerVersions.current[room] === version) setSteerDraft(room, '');
  };
  const busy = blocked || (!!turn && !turn.done);
  const selectedOption = inferenceOptions?.options.find(option => `${option.provider}:${option.model}` === selectedModel);
  const inference = selectedOption ? {
    provider: selectedOption.provider,
    model: selectedOption.model,
    reasoningEffort,
  } as InferenceOverride : undefined;
  const submit = () => { if (allowed && sessionId && !busy && draft.trim() && draft.length <= max && send(sessionId, draft, max, inference)) setDraft(''); };
  return <>
    {busy && turn && !turn.done ? <p className="composer-feedback" role="status">{turn.phase}</p> : null}
    {turn?.phase === 'Admission uncertain — retry the same intent' ? <button className="primary-button" type="button" onClick={retry}>Retry same intent</button> : null}
    {turn && !turn.done && turn.publicRunId && turn.phase.startsWith('Disconnected') ? <button className="primary-button" type="button" onClick={resume}>Resume status check</button> : null}
    {allowed && turn && turn.identityVerified && !turn.done && turn.publicRunId && turn.intent.sessionId === sessionId ? <form className="turn-composer" onSubmit={(event) => { event.preventDefault(); void queue(); }}>
      <textarea aria-label="Steer Jarvis" maxLength={maxSteer} value={steerDraft} onChange={(event) => setSteerDraft(sessionId!, event.target.value)} />
      <button className="primary-button" type="submit" disabled={turn.controlBusy || !steerDraft.trim() || steerDraft.length > maxSteer}>Queue steer</button>
      <p>Queue guidance for this run; acknowledgement does not mean execution.</p>
    </form> : null}
    {allowed ? recoveries.filter((item) => item.intent.sessionId === sessionId).map((item, index) => <section key={index} aria-label="Recover steer draft">
      <p>{item.kind === 'terminal' ? 'Unconsumed terminal steer' : 'Unconfirmed steer — may already be queued; no automatic retry'}</p><pre>{item.input}</pre>
      <button type="button" disabled={!!draft} onClick={() => handoff(item, false)}>Restore to empty draft</button>
      <button type="button" onClick={() => handoff(item, true)}>Append to draft</button>
    </section>) : null}
    {allowed ? <form className="turn-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <details className="inference-control">
        <summary>{selectedOption ? `${selectedOption.label} · ${reasoningEffort}` : 'Model · Inherit'}</summary>
        <div className="inference-fields">
          <label>Model<select aria-label="Model for this prompt" value={selectedModel} disabled={busy || !inferenceOptions} onChange={(event) => setSelectedModel(event.target.value)}>
            <option value="inherit">Inherit ({inferenceOptions?.default.model ?? 'session default'})</option>
            {inferenceOptions?.options.map(option => <option key={`${option.provider}:${option.model}`} value={`${option.provider}:${option.model}`}>{option.label}</option>)}
          </select></label>
          <label>Reasoning<select aria-label="Reasoning for this prompt" value={reasoningEffort} disabled={busy || !selectedOption} onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}>
            {(selectedOption?.reasoningEfforts ?? ['medium']).map(effort => <option key={effort} value={effort}>{effort}</option>)}
          </select></label>
          <p>Applies to this prompt. Permissions and tools do not change.</p>
        </div>
      </details>
      {inferenceError ? <p role="status">Model choices unavailable; inherited routing remains available.</p> : null}
      <textarea placeholder="Message Jarvis…" aria-label="Message Jarvis" maxLength={max} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); }
      }} />
      <button className="primary-button" type="submit" disabled={busy || !draft.trim() || draft.length > max} aria-label="Send message" title="Send message"><ArrowUp size={20} /></button>
    </form> : <p className="composer-feedback">{sessionId ? 'Messaging is unavailable for this chat.' : 'Choose New chat to begin.'}</p>}
    <details className="turn-limit"><summary>Connection & recovery details</summary><p>One writer in this tab; the server enforces cross-tab/session concurrency. Only opaque session, request and run identifiers are stored for reload recovery. Known runs resume by status reads, never message retransmission. Pending admission without a run ID remains locked for trusted operator reconciliation. Message bodies and drafts are never stored.</p></details>
  </>;
}

