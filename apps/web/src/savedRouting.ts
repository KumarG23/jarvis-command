import { RoutingDefaultResponseSchema, RoutingDefaultSetSchema, RoutingDefaultTargetSchema, type InferenceOverride, type RoutingDefaultResponse } from '@jarvis-command/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { boundedJson } from './useLiveTurn';

type Readback = { thread: RoutingDefaultResponse | null; project: RoutingDefaultResponse | null };
type State = Readback & { context: object; busy: boolean; error: string; opted: boolean };
const empty = (context: object): State => ({ context, thread: null, project: null, busy: false, error: '', opted: false });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const post = (path: string, body: unknown, controller: AbortController) => boundedJson(path, {
  method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
  headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' }, body: JSON.stringify(body),
}, controller);

export function useSavedRouting(sessionId: string | undefined, projectId: string | null, allowed: boolean, open: boolean) {
  const context = useMemo(() => ({ sessionId, projectId, allowed }), [sessionId, projectId, allowed]);
  const current = useRef(context); current.current = context;
  const targets = useMemo(() => {
    const result = RoutingDefaultTargetSchema.safeParse({ scope: 'thread', sessionId, projectId });
    return allowed && result.success ? { thread: result.data, project: projectId ? RoutingDefaultTargetSchema.parse({ scope: 'project', projectId }) : null } : null;
  }, [sessionId, projectId, allowed]);
  const [stored, setStored] = useState<State>(() => empty(context));
  const state = stored.context === context ? stored : empty(context);
  const latest = useRef(state); latest.current = state;
  const commit = (next: State) => { latest.current = next; setStored(next); };
  const operation = useRef<object | null>(null), controllers = useRef(new Set<AbortController>());
  useEffect(() => () => {
    operation.current = null;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
  }, [context]);
  const available = !!targets && !state.busy && !state.error && state.thread?.writesAvailable === true && (!targets.project || state.project?.writesAvailable === true);
  const begin = (controller: AbortController) => {
    const token = {}; operation.current = token; controllers.current.add(controller);
    commit({ ...latest.current, context, busy: true, error: '' });
    return { token, valid: () => current.current === context && operation.current === token && !controller.signal.aborted };
  };
  const finish = (controller: AbortController, token: object) => {
    controllers.current.delete(controller);
    if (operation.current !== token) return;
    // Timeouts cancel transport, but must not strand this target in a loading state.
    // Navigation/unmount clears the token first, so abandoned work cannot update it.
    if (current.current === context && latest.current.busy) commit({ ...latest.current, busy: false, error: 'Saved-default request was cancelled or timed out. A change may have landed. Refresh before another deliberate action; no message was sent.' });
    operation.current = null;
  };
  async function refresh(controller = new AbortController()): Promise<boolean> {
    if (!targets || operation.current || current.current !== context) return false;
    const { valid, token } = begin(controller);
    try {
      const entries = await Promise.allSettled((['thread', 'project'] as const).map(async key => {
        const target = targets[key]; if (!target) return [key, null] as const;
        const response = RoutingDefaultResponseSchema.parse(await post('/api/live/routing-defaults/read', target, controller));
        if (!same(response.target, target) || response.replayed) throw Error('binding');
        return [key, response] as const;
      }));
      if (!valid()) return false;
      const next = { ...latest.current, context, busy: false, error: '' };
      for (const entry of entries) {
        if (entry.status === 'fulfilled') next[entry.value[0]] = entry.value[1];
        else next.error = 'Saved defaults could not be refreshed. Requested readback is kept; refresh before changing defaults or using them for a new message.';
      }
      commit(next);
      return !next.error && next.thread?.writesAvailable === true && (!targets.project || next.project?.writesAvailable === true);
    } finally { finish(controller, token); }
  }
  useEffect(() => { if (open && targets) void refresh(); }, [open, context]);
  async function save(scope: 'thread' | 'project', selection: InferenceOverride | null) {
    const target = targets?.[scope], readback = latest.current[scope];
    if (!available || !target || !readback || operation.current || current.current !== context) return;
    const request = RoutingDefaultSetSchema.parse({ target, selection, expectedRevision: readback.revision, clientRequestId: crypto.randomUUID() });
    const controller = new AbortController(), { valid, token } = begin(controller);
    try {
      const response = RoutingDefaultResponseSchema.parse(await post('/api/live/routing-defaults/set', request, controller));
      if (!same(response.target, target) || response.revision !== request.expectedRevision + 1 || !same(response.selection, request.selection)) throw Error('binding');
      if (valid()) commit({ ...latest.current, context, [scope]: response, busy: false, error: '' });
    } catch {
      if (valid()) commit({ ...latest.current, context, busy: false, error: 'Saved-default change could not be confirmed or its revision changed. It may have landed. Refresh requested readback before another deliberate change; no message was sent.' });
    } finally { finish(controller, token); }
  }
  return { ...state, available, supported: !!targets, refresh, save,
    opt: (opted: boolean) => { if (current.current === context && (!opted || (available && !operation.current))) commit({ ...latest.current, context, opted }); },
  };
}
