import { SessionMessagesPageSchema, type SessionMessage, type SessionSummary } from '@jarvis-command/contracts';
import { useEffect, useRef, useState } from 'react';
import { Bot, MessageSquare, SquareTerminal } from 'lucide-react';
import { CopyResponse } from './TurnView';

export function LiveRoom({ session, onHistory }: Readonly<{ session: SessionSummary; onHistory: (sessionId: string, messages: SessionMessage[], complete: boolean) => void }>) {
  const report = useRef(onHistory);
  report.current = onHistory;
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pagesLoaded, setPagesLoaded] = useState(0);

  useEffect(() => { if (!loading) report.current(session.id, messages, !error && !hasMore); }, [session.id, messages, loading, error, hasMore]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=50&offset=${offset}`, {
      credentials: 'same-origin', headers: { accept: 'application/json' }, signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('access');
      if (!response.ok) throw new Error('history');
      const page = SessionMessagesPageSchema.parse(await response.json());
      if (page.sessionId !== session.id || page.messages.some((message) => message.sessionId !== session.id)
        || page.pagination.limit !== 50 || page.pagination.offset !== offset
        || page.pagination.returned !== page.messages.length || page.messages.length > 50
        || (page.pagination.hasMore && page.pagination.returned === 0)) throw new Error('history');
      if (!controller.signal.aborted) {
        setMessages((previous) => {
          const seen = new Set(previous.map((message) => message.id));
          return [...previous, ...page.messages.filter((message) => {
            if (seen.has(message.id)) return false;
            seen.add(message.id);
            return true;
          })];
        });
        setPagesLoaded((count) => count + 1);
        setNextOffset(offset + page.pagination.returned);
        setHasMore(page.pagination.hasMore);
        setLoading(false);
      }
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error && failure.message === 'access'
        ? 'Access expired or denied. Confirm Cloudflare Access before retrying.' : 'Could not load messages. Retry when the connection is available.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [session.id, offset, attempt]);

  return <>
    <div className="room-intro">
      <p className="eyebrow">LIVE ROOM · HISTORY</p>
      <h1>{session.title}</h1>
      <p>{session.ownership === 'external' ? 'External session · Read-only' : 'Command-owned session'}</p>
      {session.ownership === 'external' ? <button type="button" className="primary-button" disabled title="External continuation is unavailable">Continue in Command</button> : null}
    </div>
    {loading ? <p role="status">Loading messages…</p> : null}
    {error ? <div className="history-feedback"><p role="alert">{error}</p><button type="button" className="primary-button" onClick={() => { setError(null); setLoading(true); setAttempt((value) => value + 1); }}>Retry history</button></div> : null}
    {!loading && !error && messages.length === 0 ? <p role="status">No saved messages in session history yet.</p> : null}
    {messages.map((message) => <article className="timeline-event history-message" key={message.id} data-message-id={message.id}>
      <div className={`event-icon ${message.role === 'user' ? 'violet' : 'cyan'}`}>
        {message.role === 'tool' ? <SquareTerminal size={17} /> : message.role === 'user' ? <MessageSquare size={17} /> : <Bot size={17} />}
      </div>
      <div className="event-body">
        <div className="event-label"><span>{message.role}</span><time>{message.timestamp ? new Date(message.timestamp).toLocaleString() : 'Time not reported'}</time></div>
        {message.toolName ? <h2>{message.toolName}</h2> : null}
        <p>{message.content}</p>
        {message.role === 'assistant' && message.content ? <CopyResponse text={message.content} limited={false} /> : null}
      </div>
    </article>)}
    {!error && (hasMore && pagesLoaded >= 10 ? <p role="status">History view limit reached. More messages may exist.</p> : hasMore ? <button type="button" className="primary-button" disabled={loading} onClick={() => { setLoading(true); setOffset(nextOffset); }}>Load more messages</button> : !loading && messages.length > 0 ? <p role="status">End of history.</p> : null)}
  </>;
}
