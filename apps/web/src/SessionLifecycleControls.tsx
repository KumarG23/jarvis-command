import {
  ContextCompactionStatusSchema,
  ContextCompactionSubmissionResponseSchema,
  SessionControlCapabilitiesSchema,
  SessionMutationResponseSchema,
  type ContextCompactionStatus,
  type SessionSummary,
} from '@jarvis-command/contracts';
import { GitFork, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { appStorageKey } from './appEnvironment';
import { boundedJson } from './useLiveTurn';

const STORAGE_KEY = appStorageKey('jarvis-command:context-compaction:v1');
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

type PendingOperation = Readonly<{
  publicOperationId: string;
  sessionId: string;
}>;

type Props = Readonly<{
  enabled: boolean;
  session: SessionSummary | null;
  blocked: boolean;
  onSession: (session: SessionSummary) => Promise<void>;
  onCompacted: (status: ContextCompactionStatus) => void;
}>;

function pendingFor(sessionId: string): PendingOperation | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (!value || typeof value !== 'object') return null;
    const pending = value as Record<string, unknown>;
    return pending.sessionId === sessionId
      && typeof pending.publicOperationId === 'string'
      && /^jcr_[a-f0-9]{32}$/.test(pending.publicOperationId)
      ? { sessionId, publicOperationId: pending.publicOperationId }
      : null;
  } catch { return null; }
}

async function postJson(path: string, body: unknown, controller: AbortController): Promise<unknown> {
  return boundedJson(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' },
    body: JSON.stringify(body),
  }, controller);
}

export function SessionLifecycleControls({ enabled, session, blocked, onSession, onCompacted }: Props) {
  const [capabilities, setCapabilities] = useState<ReturnType<typeof SessionControlCapabilitiesSchema.parse> | null>(null);
  const [operation, setOperation] = useState<PendingOperation | null>(null);
  const [status, setStatus] = useState<ContextCompactionStatus | null>(null);
  const [working, setWorking] = useState<'compact' | 'fork' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const callbacks = useRef({ onSession, onCompacted });
  callbacks.current = { onSession, onCompacted };

  useEffect(() => {
    setCapabilities(null);
    setStatus(null);
    setFeedback(null);
    setOperation(session ? pendingFor(session.id) : null);
    if (!enabled || !session) return;
    const controller = new AbortController();
    void boundedJson('/api/live/session-controls', {
      credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' },
    }, controller).then((value) => {
      if (!controller.signal.aborted) setCapabilities(SessionControlCapabilitiesSchema.parse(value));
    }).catch(() => {
      if (!controller.signal.aborted) setCapabilities({ sessionForkPreservesSource: false, sessionCompactionRuns: false });
    });
    return () => controller.abort();
  }, [enabled, session?.id]);

  useEffect(() => {
    if (!operation) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const poll = async () => {
      while (live) {
        try {
          const next = ContextCompactionStatusSchema.parse(await boundedJson(
            `/api/live/context-compactions/${encodeURIComponent(operation.publicOperationId)}`,
            { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } },
            controller,
          ));
          if (!live || next.sessionId !== operation.sessionId) return;
          setStatus(next);
          if (TERMINAL.has(next.status)) {
            setWorking(null);
            if (next.status === 'completed' && next.result) {
              callbacks.current.onCompacted(next);
              if (next.result.resultSessionId !== next.sessionId) {
                const resolved = SessionMutationResponseSchema.parse(await boundedJson(
                  `/api/live/sessions/${encodeURIComponent(next.result.resultSessionId)}`,
                  { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } },
                  controller,
                ));
                if (live) await callbacks.current.onSession(resolved.session);
              }
              if (live) setFeedback(next.result.outcome === 'not_needed' ? 'Context is already compact.' : `Compacted ${next.result.beforeTokens.toLocaleString()} → ${next.result.afterTokens.toLocaleString()} tokens.`);
            } else if (live) setFeedback('Context compaction could not be completed.');
            if (next.status !== 'completed') {
              try { localStorage.removeItem(STORAGE_KEY); } catch { /* Recovery pointer is optional. */ }
            }
            setOperation(null);
            return;
          }
        } catch {
          if (!live) return;
          setFeedback('Compaction status is temporarily unavailable. Retrying…');
        }
        await new Promise<void>((resolve) => { timer = setTimeout(resolve, 1_000); });
      }
    };
    void poll();
    return () => { live = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [operation?.publicOperationId, operation?.sessionId]);

  if (!enabled || !session || !capabilities || (!capabilities.sessionCompactionRuns && !capabilities.sessionForkPreservesSource)) return null;
  const operationActive = operation !== null || working === 'compact';
  const controlsBlocked = blocked || working !== null || operationActive;
  const statusCopy = operationActive
    ? (status?.compaction?.state === 'running' ? 'Compacting…' : 'Preparing compact…')
    : feedback;

  async function compact() {
    if (!session || controlsBlocked || !capabilities?.sessionCompactionRuns) return;
    const controller = new AbortController();
    setWorking('compact'); setFeedback(null);
    try {
      const admitted = ContextCompactionSubmissionResponseSchema.parse(await postJson('/api/live/context-compactions', {
        sessionId: session.id,
        clientRequestId: crypto.randomUUID(),
      }, controller));
      if (admitted.sessionId !== session.id) throw Error('identity');
      const pending = { publicOperationId: admitted.publicOperationId, sessionId: admitted.sessionId };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pending)); } catch { /* Live state still tracks the admitted operation. */ }
      setOperation(pending);
    } catch {
      setWorking(null);
      setFeedback('Context compaction was not admitted. The chat is unchanged.');
    }
  }

  async function fork() {
    if (!session || controlsBlocked || !capabilities?.sessionForkPreservesSource) return;
    const controller = new AbortController();
    setWorking('fork'); setFeedback(null);
    try {
      const title = `${session.title} · Fork`.slice(0, 160);
      const response = SessionMutationResponseSchema.parse(await postJson(
        `/api/live/sessions/${encodeURIComponent(session.id)}/continue`, { title }, controller,
      ));
      if (response.session.id === session.id || response.session.ownership !== 'command') throw Error('identity');
      await callbacks.current.onSession(response.session);
    } catch {
      setFeedback('Fork could not be verified. The source chat was not changed.');
    } finally { setWorking(null); }
  }

  return <div className="session-lifecycle-controls">
    {capabilities.sessionCompactionRuns ? <button type="button" className="icon-button compact-button" aria-label="Compact context" title="Compact this chat’s context" disabled={controlsBlocked} onClick={() => void compact()}><Minimize2 size={17} /></button> : null}
    {capabilities.sessionForkPreservesSource ? <button type="button" className="icon-button fork-button" aria-label="Fork chat" title="Fork this chat without changing the source" disabled={controlsBlocked} onClick={() => void fork()}><GitFork size={17} /></button> : null}
    {statusCopy ? <span className="session-lifecycle-feedback" role="status">{statusCopy}</span> : null}
  </div>;
}
