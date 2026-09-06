import { LiveRunSteerResponseSchema, LiveRunStopResponseSchema, LiveRunApprovalResponseSchema, LiveRunSubmissionResponseSchema, LiveRunStatusSchema, RunEventSchema, type LiveRunSubmissionRequest, type LiveRunStatus, type RunEvent, type SessionMessage } from '@jarvis-command/contracts';
import { useEffect, useRef, useState } from 'react';
import { clearRecovery, readRecovery, writeRecovery, type RecoveryIdentity } from './turnRecovery';
import { matchTurn, projectTurns } from './timeline';

const eventNames = ['message.delta', 'tool.started', 'tool.completed', 'subagent.start', 'subagent.complete', 'approval.request', 'approval.responded', 'run.steered', 'run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'] as const;
const terminal = (status: string) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
const MAX_UNCONFIRMED_TURNS = 8;

// Own the reader: transport cancellation must not depend on cooperative JSON parsing.
async function boundedJson(url: string, init: RequestInit, controller: AbortController): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const dispose = () => {
    if (!reader) return;
    const abandoned = reader;
    reader = undefined;
    void abandoned.cancel().catch(() => {});
    abandoned.releaseLock();
  };
  let rejectAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { rejectAbort(new Error('request cancelled')); dispose(); };
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const work = (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error('late response'); }
      reader = response.body?.getReader();
      if (!response.ok || response.redirected || !reader) throw new Error('response');
      const decoder = new TextDecoder();
      let text = '';
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw new Error('cancelled body');
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_097_152) throw new Error('response limit');
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode()) as unknown;
    })();
    return await Promise.race([work, aborted]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    dispose();
  }
}
function outputPreview(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= 131072) return { output: value, outputLimited: false };
  let end = 131072;
  while ((bytes[end]! & 0xc0) === 0x80) end--;
  return { output: new TextDecoder().decode(bytes.subarray(0, end)), outputLimited: true };
}

type TurnIntent = LiveRunSubmissionRequest | (Pick<LiveRunSubmissionRequest, 'sessionId' | 'clientRequestId'> & { input: null });
export type Turn = {
  intent: TurnIntent; publicRunId: string | null; phase: string; output: string; outputLimited: boolean;
  events: RunEvent[]; approval: LiveRunStatus['approval']; done: boolean; historyMatched: boolean;
  identityVerified: boolean; controlBusy?: boolean; controlMessage?: string;
  historyBaseline?: string[]; userHistoryMatched?: boolean;
  terminalPendingSteer?: boolean;
};
export type DraftRecovery = { intent: TurnIntent; input: string; kind: 'terminal' | 'uncertain' };

export function useLiveTurn() {
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryBlocked = useRef(false);
  const stored = useRef<RecoveryIdentity | null>(null);
  const [recoveries, setRecoveries] = useState<DraftRecovery[]>([]);
  const recovered = useRef(new WeakSet<TurnIntent>());
  const handedOff = useRef(new WeakMap<TurnIntent, Set<string>>());
  const consumeRecovery = (recovery: DraftRecovery) => {
    const inputs = handedOff.current.get(recovery.intent) ?? new Set<string>();
    inputs.add(recovery.input); handedOff.current.set(recovery.intent, inputs);
    setRecoveries((items) => items.filter((item) => item.intent !== recovery.intent || item.input !== recovery.input));
  };
  const [turn, setTurn] = useState<Turn | null>(null);
  const [completedTurns, setCompletedTurns] = useState<Turn[]>([]);
  const completed = useRef<Turn[]>([]);
  const [, refreshHistoryReady] = useState(0);
  const retain = (items: Turn[]) => { completed.current = items; setCompletedTurns(items); };
  const [refresh, setRefresh] = useState<{ sessionId: string; revision: string } | null>(null);
  const current = useRef<Turn | null>(null);
  const alive = useRef(true);
  const cleanup = useRef(() => {});
  const checkStatus = useRef<((preserve: boolean) => boolean) | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const admissionAge = useRef({ wall: 0, monotonic: 0, elapsed: 0 });
  const retryExpired = () => {
    const age = admissionAge.current;
    age.elapsed = Math.max(age.elapsed, Date.now() - age.wall, performance.now() - age.monotonic);
    return age.elapsed >= 23 * 60 * 60 * 1000;
  };
  const histories = useRef(new Map<string, { ids: Set<string>; complete: boolean }>());

  const update = (change: Partial<Turn>) => {
    if (!alive.current || !current.current) return;
    current.current = { ...current.current, ...change };
    setTurn(current.current);
  };
  useEffect(() => {
    alive.current = true;
    try {
      const identity = readRecovery();
      stored.current = identity;
      if (identity) {
        current.current = { intent: { sessionId: identity.sessionId, clientRequestId: identity.clientRequestId, input: null }, publicRunId: identity.publicRunId,
          phase: identity.publicRunId ? 'Recovering status' : 'Admission unknown — public run ID unavailable; writer locked. Trusted operator reconciliation required.',
          output: '', outputLimited: false, events: [], approval: null, done: false, historyMatched: false, identityVerified: false };
        setTurn(current.current);
        if (identity.publicRunId) supervise(current.current, true);
      }
    } catch { recoveryBlocked.current = true; setRecoveryError('Local reload recovery unreadable or invalid — writer locked. No stored content displayed.'); }
    return () => { alive.current = false; cleanup.current(); mutation.current?.abort(); };
  }, []);

  function supervise(run: Turn, statusOnly = false, preserveApproval = false, readFirst = false) {
    let controller: AbortController | undefined;
    let source: EventSource | undefined;
    let streamOpen = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let reconciling = false;
    let terminalObserved = false;
    let approvalRevision = 0;
    let reconnects = 0;
    let polls = 0;
    let eventCount = run.events.length;
    let eventBytes = run.events.reduce((bytes, event) => bytes + new TextEncoder().encode(JSON.stringify(event)).length, 0);
    let previewBytes = new TextEncoder().encode(run.output).length;
    let limited = statusOnly || run.outputLimited;
    const valid = () => !closed && alive.current && current.current?.intent === run.intent;
    cleanup.current = () => { closed = true; controller?.abort(); source?.close(); clearTimeout(timer); };
    checkStatus.current = (preserve) => {
      if (!valid() || !streamOpen) return false;
      preserveApproval = preserve;
      void reconcile(true);
      return true;
    };
    async function reconcile(keepStream = false) {
      if (!keepStream) { streamOpen = false; source?.close(); clearTimeout(timer); }
      if (!valid() || reconciling) return;
      reconciling = true;
      polls++;
      update({ phase: 'Recovering status' });
      const approvalAtStart = current.current!.approval;
      const revisionAtStart = approvalRevision;
      try {
        controller = new AbortController();
        const status = LiveRunStatusSchema.parse(await boundedJson(`/api/live/runs/${run.publicRunId}`, { credentials: 'same-origin', headers: { accept: 'application/json' } }, controller));
        if (status.publicRunId !== run.publicRunId || status.sessionId !== run.intent.sessionId) throw new Error('binding');
        if (!valid()) return;
        // Healthy nonterminal work is not a failed recovery attempt.
        polls = 0;
        const done = terminal(status.status);
        const newerApproval = approvalRevision !== revisionAtStart || current.current!.approval !== approvalAtStart;
        // A status snapshot has no stream cursor: applying it during a healthy
        // stream can rewind output or double-count later deltas. Terminal wins.
        update({ identityVerified: true,
          phase: !done && newerApproval ? current.current!.phase : `Run ${status.status}`,
          ...(status.output === null || (!done && (keepStream || !!current.current!.output)) ? {} : outputPreview(status.output)),
          approval: done ? null : preserveApproval || newerApproval ? current.current!.approval : status.approval,
          done });
        preserveApproval = false;
        if (terminal(status.status)) {
          histories.current.delete(run.intent.sessionId);
          update({ terminalPendingSteer: status.pendingSteer !== null });
          try {
            if (stored.current) {
              clearRecovery(stored.current);
              stored.current = null; recoveryBlocked.current = false; setRecoveryError(null);
            }
          } catch { recoveryBlocked.current = true; setRecoveryError('Local reload recovery could not be cleared safely — writer locked. Trusted operator reconciliation required.'); }
          if (status.pendingSteer !== null && !recovered.current.has(run.intent)) {
            recovered.current.add(run.intent);
            const input = status.pendingSteer;
            if (!handedOff.current.get(run.intent)?.has(input)) setRecoveries((items) => [...items.filter((item) => item.intent !== run.intent || item.input !== input), { intent: run.intent, input, kind: 'terminal' }]);
          }
          cleanup.current(); setRefresh({ sessionId: run.intent.sessionId, revision: run.publicRunId! });
        }
      } catch { if (valid()) update({ phase: 'Disconnected — status unconfirmed' }); }
      finally {
        reconciling = false;
        if (valid() && !streamOpen) {
          if (polls >= 12) update({ phase: 'Disconnected — supervision paused; run outcome unknown' });
          else if (reconnects < 2 && !limited && !terminalObserved) timer = setTimeout(() => { reconnects++; connect(); }, 2_000);
          else timer = setTimeout(() => { void reconcile(); }, 2_000);
        }
      }
    }
    function connect() {
      if (!valid()) return;
      // Hermes consumes a shared queue; replacement streams do not replay their
      // prefix. Preserve visible data and cumulative per-run limits.
      if (reconnects) update({ phase: 'Reconnecting — preview retained' });
      const connection = new EventSource(`/api/live/runs/${run.publicRunId}/events`);
      source = connection;
      streamOpen = true;
      let ended = false;
      const recover = () => { if (ended) return; ended = true; void reconcile(); };
      connection.onerror = recover;
      for (const name of eventNames) connection.addEventListener(name, (message) => {
      if (!valid() || ended || source !== connection) return;
      try {
        const raw = (message as MessageEvent<string>).data;
        eventCount++;
        eventBytes += new TextEncoder().encode(raw).length;
        if (eventCount > 1000 || eventBytes > 524288) { limited = true; throw new Error('limit'); }
        const event = RunEventSchema.parse(JSON.parse(raw));
        if (event.type !== name || event.publicRunId !== run.publicRunId) throw new Error('event');
        if (event.type === 'message.delta') {
          previewBytes += new TextEncoder().encode(event.delta).length;
          if (previewBytes > 131072) { limited = true; update({ outputLimited: true }); throw new Error('preview'); }
          update({ output: current.current!.output + event.delta });
        }
        else if (event.type.startsWith('run.') && event.type !== 'run.steered') {
          terminalObserved = true; recover();
        } else if (event.type === 'approval.request') {
          approvalRevision++; update({ phase: 'Awaiting approval', approval: event.approval });
        } else if (event.type === 'approval.responded') {
          approvalRevision++;
          update({
            ...(current.current!.approval?.requestId === event.requestId ? { approval: null, phase: 'Approval acknowledged — awaiting run status' } : {}),
            events: [...current.current!.events, event],
          });
        } else update({ events: [...current.current!.events, event] });
      } catch { recover(); }
    });
      timer = setTimeout(recover, 60_000);
    }
    if (readFirst || statusOnly || terminal(run.phase.replace('Run ', ''))) void reconcile();
    else connect();
  }

  async function admit(intent: LiveRunSubmissionRequest) {
    const controller = new AbortController();
    let cancelled = false;
    cleanup.current = () => { cancelled = true; controller.abort(); };
    try {
      const accepted = LiveRunSubmissionResponseSchema.parse(await boundedJson('/api/live/runs', {
        method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' },
        body: JSON.stringify(intent), signal: controller.signal,
      }, controller));
      if (accepted.sessionId !== intent.sessionId || accepted.clientRequestId !== intent.clientRequestId) throw new Error('binding');
      if (cancelled || !alive.current || current.current?.intent !== intent) return;
      update({ identityVerified: true, publicRunId: accepted.publicRunId, phase: `Run ${accepted.status}` });
      const bound = { sessionId: intent.sessionId, clientRequestId: intent.clientRequestId, publicRunId: accepted.publicRunId };
      try { writeRecovery(bound, stored.current); stored.current = bound; }
      catch { setRecoveryError('Reload recovery degraded — keep this tab open. In-memory supervision continues.'); }
      supervise(current.current!);
    } catch { if (!cancelled && alive.current && current.current?.intent === intent) update({ phase: 'Admission uncertain — retry the same intent' }); }
  }
  function send(sessionId: string, input: string, max: number) {
    const baseline = histories.current.get(sessionId);
    if (!baseline?.complete || (current.current?.done && !current.current.historyMatched && completed.current.length >= MAX_UNCONFIRMED_TURNS)) return false;
    if (recoveryBlocked.current || (current.current && !current.current.done) || !input.trim() || input.length > max) return false;
    cleanup.current();
    mutation.current?.abort(); mutation.current = null;
    const intent = { sessionId, input, clientRequestId: crypto.randomUUID() };
    const pending = { sessionId, clientRequestId: intent.clientRequestId, publicRunId: null };
    try { writeRecovery(pending, null); stored.current = pending; }
    catch { recoveryBlocked.current = true; setRecoveryError('Local reload recovery unavailable — message not sent; writer locked.'); return false; }
    admissionAge.current = { wall: Date.now(), monotonic: performance.now(), elapsed: 0 };
    if (current.current && !current.current.historyMatched) {
      const previous = current.current;
      retain([...completed.current, previous]);
    }
    current.current = { intent, publicRunId: null, phase: 'Sending', output: '', outputLimited: false, events: [], approval: null, done: false, historyMatched: false, identityVerified: false,
      ...(baseline?.complete ? { historyBaseline: [...baseline.ids] } : {}) };
    setTurn(current.current); void admit(intent);
    return true;
  }
  function retry() {
    if (current.current?.phase !== 'Admission uncertain — retry the same intent' || current.current.intent.input === null) return;
    if (retryExpired()) { update({ phase: 'Admission unknown — retry window expired; writer locked' }); return; }
    cleanup.current();
    update({ phase: 'Sending' }); void admit(current.current.intent);
  }
  function history(sessionId: string, messages: SessionMessage[], complete = false) {
    histories.current.delete(sessionId);
    histories.current.set(sessionId, { ids: new Set(messages.map((message) => message.id)), complete });
    for (const id of histories.current.keys()) {
      if (histories.current.size <= 32) break;
      if (id !== sessionId && id !== current.current?.intent.sessionId && id !== stored.current?.sessionId) histories.current.delete(id);
    }
    refreshHistoryReady((revision) => revision + 1);
    if (complete) {
      const matched = new Set(projectTurns(completed.current.filter((item) => item.intent.sessionId === sessionId), messages, true)
        .filter((item) => item.turn.historyMatched).map((item) => item.turn.intent));
      if (matched.size) retain(completed.current.filter((item) => !matched.has(item.intent)));
    }
    const run = current.current;
    if (run && run.intent.sessionId === sessionId) {
      const match = matchTurn(run, messages, complete);
      update({ historyMatched: !!match.assistant, userHistoryMatched: !!match.user });
    }
  }
  function resume() {
    const run = current.current;
    if (!run?.publicRunId || run.done || !run.phase.startsWith('Disconnected')) return;
    cleanup.current();
    supervise(run, true);
  }
  // A read-only refresh is independent of admission retry and never repeats a mutation.
  function refreshStatus(run: Turn, preserveApproval = false, resumeStream = true) {
    if (!alive.current || current.current?.intent !== run.intent || current.current.publicRunId !== run.publicRunId || current.current.intent.sessionId !== run.intent.sessionId) return;
    if (resumeStream && checkStatus.current?.(preserveApproval)) return;
    cleanup.current(); supervise(current.current, !resumeStream, preserveApproval, true);
  }
  async function mutate(run: Turn, action: { kind: 'approval'; choice: 'once' | 'deny' } | { kind: 'stop' } | { kind: 'steer'; input: string }) {
    if (mutation.current || !current.current?.identityVerified || !run.publicRunId || current.current?.intent !== run.intent || current.current.publicRunId !== run.publicRunId || current.current.intent.sessionId !== run.intent.sessionId || current.current.done) return;
    if (action.kind === 'approval' && (!run.approval || current.current.approval !== run.approval)) return;
    const controller = new AbortController();
    mutation.current = controller;
    const valid = () => alive.current && !controller.signal.aborted && current.current?.intent === run.intent && current.current.publicRunId === run.publicRunId && current.current.intent.sessionId === run.intent.sessionId;
    const label = action.kind === 'approval' ? 'Approval' : action.kind === 'steer' ? 'Steer' : 'Stop';
    update({ controlBusy: true, controlMessage: `Submitting ${action.kind}…` });
    try {
      const payload = action.kind === 'approval' ? { requestId: run.approval!.requestId, choice: action.choice } : action.kind === 'steer' ? { input: action.input } : {};
      const raw = await boundedJson(`/api/live/runs/${run.publicRunId}/${action.kind}`, {
        method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: JSON.stringify(payload),
      }, controller);
      if (action.kind === 'approval') {
        const ack = LiveRunApprovalResponseSchema.parse(raw);
        if (ack.publicRunId !== run.publicRunId || ack.requestId !== run.approval!.requestId || ack.choice !== action.choice) throw new Error('binding');
        if (valid() && current.current!.approval === run.approval) update({ approval: null, controlMessage: 'Approval acknowledged — checking status' });
      } else if (action.kind === 'steer') {
        const ack = LiveRunSteerResponseSchema.parse(raw);
        if (ack.publicRunId !== run.publicRunId) throw new Error('binding');
        if (valid()) { update({ controlMessage: 'Steer queued — not executed. Checking status.' }); return true; }
      } else {
        const ack = LiveRunStopResponseSchema.parse(raw);
        if (ack.publicRunId !== run.publicRunId) throw new Error('binding');
        if (valid()) update({ controlMessage: 'Stop requested — outcome unconfirmed until status read-back' });
      }
    } catch {
      if (alive.current && current.current?.intent === run.intent) {
        update({ controlMessage: `${label} outcome unconfirmed — checking status. No automatic retry.` });
        if (action.kind === 'steer' && !handedOff.current.get(run.intent)?.has(action.input)) setRecoveries((items) => items.some((item) => item.intent === run.intent && item.input === action.input) ? items : [...items, { intent: run.intent, input: action.input, kind: 'uncertain' }]);
      }
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        if (alive.current && current.current?.intent === run.intent) {
          update({ controlBusy: false });
          refreshStatus(run, !!current.current!.approval && current.current!.approval !== run.approval, action.kind !== 'stop');
        }
      }
    }
  }
  const approve = (run: Turn, choice: 'once' | 'deny') => mutate(run, { kind: 'approval', choice });
  const stop = (run: Turn) => mutate(run, { kind: 'stop' });
  const steer = (run: Turn, input: string, max: number) => {
    if (!input.trim() || input.length > max || !Number.isInteger(max) || max < 1 || max > 4000) return Promise.resolve(undefined);
    return mutate(run, { kind: 'steer', input });
  };
  const historyBacklogFull = !!turn?.done && !turn.historyMatched && completedTurns.length >= MAX_UNCONFIRMED_TURNS;
  const historyReady = (sessionId: string | undefined) => !!sessionId && histories.current.get(sessionId)?.complete === true;
  return { turn, completedTurns, refresh, send, retry, history, historyReady, historyBacklogFull, resume, approve, stop, steer, recoveries, consumeRecovery, refreshStatus, recoveryError };
}
