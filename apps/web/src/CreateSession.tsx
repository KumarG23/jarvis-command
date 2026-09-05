import { SessionMutationResponseSchema, type SessionSummary } from '@jarvis-command/contracts';
import { useEffect, useRef, useState } from 'react';

export function CreateSession({ onCreated }: Readonly<{ onCreated: (session: SessionSummary) => void }>) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function create() {
    if (busy.current) return;
    busy.current = true;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/live/sessions', {
        method: 'POST', credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' },
        body: '{}',
      });
      if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('access');
      if (!response.ok) throw new Error('create');
      const { session } = SessionMutationResponseSchema.parse(await response.json());
      if (session.ownership !== 'command' || !session.id.startsWith('jc_')) throw new Error('create');
      if (mounted.current) onCreated(session);
    } catch (failure: unknown) {
      if (mounted.current) setError(failure instanceof Error && failure.message === 'access'
        ? 'Access expired or denied. Confirm Cloudflare Access before creating a session.'
        : 'Session creation could not be confirmed. Refresh recent sessions before creating again; the session may already exist.');
    } finally {
      busy.current = false;
      if (mounted.current) setCreating(false);
    }
  }

  return <div className="create-session">
    <button type="button" className="primary-button" disabled={creating} onClick={() => void create()}>{creating ? 'Creating session…' : 'New Command session'}</button>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
