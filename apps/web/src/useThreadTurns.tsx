import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveTurn } from './useLiveTurn';
import { readThreadRecoveries } from './turnRecovery';

type Supervisor = ReturnType<typeof useLiveTurn>;
// Supervisors stay mounted when panes change. Navigation never owns transport,
// admission or control lifetime. Each supervisor polls its exact admitted run.
const ThreadSupervisor = memo(function ThreadSupervisor({ sessionId, foreground, publish }: { sessionId: string; foreground: boolean; publish: (id: string, live: Supervisor) => void }) {
  const live = useLiveTurn(sessionId, foreground);
  useLayoutEffect(() => { publish(sessionId, live); });
  return null;
});
export function useThreadTurns(sessionIds: readonly string[], visibleIds: readonly string[]) {
  const fallback = useLiveTurn('__unselected__', false);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  const handles = useRef(new Map<string, Supervisor>());
  const retained = useRef(new Set<string>());
  const [, changed] = useState(0);
  const publish = useCallback((id: string, live: Supervisor) => {
    handles.current.set(id, live);
    changed(revision => revision + 1);
  }, []);
  for (const id of sessionIds) retained.current.add(id);
  try { for (const record of readThreadRecoveries()) retained.current.add(record.sessionId); } catch { /* Every writer fails closed on this same invalid store. */ }
  return {
    get: (id: string | undefined) => id ? handles.current.get(id) ?? fallback : fallback,
    ready: (id: string) => handles.current.has(id),
    all: [...handles.current.values()],
    supervisors: [...retained.current].map(id => <ThreadSupervisor key={id} sessionId={id} foreground={visible && visibleIds.includes(id)} publish={publish} />),
  };
}
