import { useEffect, useRef, useState } from 'react';
import type { RunEvent } from '@jarvis-command/contracts';
import type { DraftRecovery, Turn } from './useLiveTurn';

export function TurnView({ turn, allowed, approve, stop }: Readonly<{ turn: Turn; allowed: boolean; approve: (run: Turn, choice: 'once' | 'deny') => void; stop: (run: Turn) => void }>) {
  const [confirmation, setConfirmation] = useState<Turn | null>(null);
  const canControl = allowed && turn.identityVerified;
  return <section className="live-turn" aria-label="Current turn">
    <p role="status">{turn.phase}</p>
    {turn.intent.input === null ? <><p>Original message unavailable after reload; no message was retransmitted.</p><p>Recovery target · Session: {turn.intent.sessionId} · Request: {turn.intent.clientRequestId} · Run: {turn.publicRunId ?? 'Unknown — admission lookup unsupported'}</p></> : <article className="timeline-event live-message" aria-label="Your message"><div className="event-icon violet" aria-hidden="true">You</div><div className="event-body"><div className="event-label">You</div><p className="turn-input">{turn.intent.input}</p></div></article>}
    {turn.output && !turn.historyMatched ? <article className="timeline-event live-message" aria-label="Jarvis response"><div className="event-icon cyan" aria-hidden="true">J</div><div className="event-body"><div className="event-label">Jarvis</div><p className="turn-output">{turn.output}</p><CopyResponse key={JSON.stringify([turn.intent.sessionId, turn.intent.clientRequestId])} text={turn.output} limited={turn.outputLimited} /></div></article> : null}
    {turn.outputLimited ? <p role="status">Output preview limited. Full output may be available in session history.</p> : null}
    {turn.events.length > 0 ? <ol className="turn-activity" aria-label="Run activity">{turn.events.map((event, index) => <li key={index}>{activity(event)}</li>)}</ol> : null}
    {turn.controlMessage ? <p role="status">{turn.controlMessage}</p> : null}
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
    <button className="secondary-button" type="button" onClick={() => { void copy(); }}>{limited ? 'Copy preview' : 'Copy response'}</button>
    <span role="status">{notice?.text === text ? notice.message : ''}</span>
  </div>;
}

function activity(event: RunEvent): string {
  switch (event.type) {
    case 'tool.started': return `Tool started: ${event.tool} — ${event.preview}`;
    case 'tool.completed': return `Tool ${event.error ? 'failed' : 'completed'}: ${event.tool}`;
    case 'subagent.start': return `Subagent started: ${event.subagentId} — ${event.goal}`;
    case 'subagent.complete': return `Subagent completed: ${event.subagentId} — ${event.summary}`;
    case 'approval.responded': return `Approval responded: ${event.choice}`;
    case 'run.steered': return 'Steer queued';
    default: return event.type;
  }
}
export function TurnComposer({ allowed, sessionId, max, maxSteer, turn, send, retry, resume, steer, recoveries, consumeRecovery, blocked = false }: Readonly<{
  blocked?: boolean;
  allowed: boolean; sessionId: string | undefined; max: number; turn: Turn | null;
  maxSteer: number; steer: (run: Turn, input: string, max: number) => Promise<boolean | undefined>;
  recoveries: DraftRecovery[]; consumeRecovery: (recovery: DraftRecovery) => void;
  send: (sessionId: string, input: string, max: number) => boolean; retry: () => void; resume: () => void;
}>) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef(drafts);
  const offered = useRef(new WeakSet<DraftRecovery>());
  const [steers, setSteers] = useState<Record<string, string>>({});
  const steerVersions = useRef<Record<string, number>>({});
  const latestTurn = useRef(turn); latestTurn.current = turn;
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
  const queue = async () => {
    if (!allowed || !sessionId || !turn || !turn.identityVerified || turn.done || turn.intent.sessionId !== sessionId || turn.controlBusy || !steerDraft.trim() || steerDraft.length > maxSteer) return;
    const room = sessionId; const run = turn; const version = steerVersions.current[room];
    const accepted = await steer(run, steerDraft, maxSteer);
    if (accepted && latestTurn.current?.intent === run.intent && steerVersions.current[room] === version) setSteerDraft(room, '');
  };
  const busy = blocked || (!!turn && !turn.done);
  const submit = () => { if (allowed && sessionId && !busy && draft.trim() && draft.length <= max && send(sessionId, draft, max)) setDraft(''); };
  return <>
    {busy && turn ? <p role="status">{turn.phase} · {turn.intent.sessionId}</p> : null}
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
      <textarea aria-label="Message Jarvis" maxLength={max} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); }
      }} />
      <button className="primary-button" type="submit" disabled={busy || !draft.trim() || draft.length > max}>Send message</button>
    </form> : <p>Messaging is unavailable for this session.</p>}
    <p className="turn-limit">One writer in this tab; the server enforces cross-tab/session concurrency. Only opaque session, request and run identifiers are stored for reload recovery. Known runs resume by status reads, never message retransmission. Pending admission without a run ID remains locked for trusted operator reconciliation. Message bodies and drafts are never stored.</p>
  </>;
}
