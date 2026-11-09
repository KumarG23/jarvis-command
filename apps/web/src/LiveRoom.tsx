import { useLatestMessageView } from './useLatestMessageView';
import { MessageReactions } from './MessageReactions';
import type { MessageReactionClient } from './useMessageReactions';
import { SessionMessagesPageSchema, type SessionMessage, type SessionSummary } from '@jarvis-command/contracts';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Command, MessageSquare, SquareTerminal } from 'lucide-react';
import { MessageContent } from './MessageContent';
import { CopyResponse } from './TurnView';
import type { Turn } from './useLiveTurn';
import { projectTurns } from './timeline';
import { HistoryReceipt } from './HistoryReceipt';
import { useReplyPresence } from './useReplyPresence';

const FOCUS_NOTICE = {
  missing: 'Exact reply unavailable: it is not in this chat’s saved history. Nothing else was highlighted.',
  incomplete: 'Exact reply unavailable: it was not found within the history loaded so far. Load more history to look further; nothing else was highlighted.',
  unavailable: 'Exact reply unavailable: it could not be located or displayed right now. Nothing else was highlighted.',
} as const;

export function LiveRoom({ session, onHistory, reactions, reactionsAvailable = false, reactionsUnavailableReason, turns = [], renderTurn, onSaveResponse, threadProjectId, threadProjectSessionIds, onThreadLink, focusMessageId = null, onFocusSettled, reportPresence = false, readObservation, onLatestViewed }: Readonly<{ readObservation?: string | undefined; onLatestViewed?: ((sessionId: string, messageId: string, position: number) => void) | undefined; focusMessageId?: string | null; onFocusSettled?: (() => void) | undefined; reportPresence?: boolean; session: SessionSummary; reactions?: MessageReactionClient | undefined; reactionsAvailable?: boolean | undefined; reactionsUnavailableReason?: string | undefined; onHistory: (sessionId: string, messages: SessionMessage[], complete: boolean) => void; turns?: Turn[]; renderTurn?: (turn: Turn) => ReactNode; onSaveResponse?: ((message: SessionMessage) => void) | undefined; threadProjectId?: string | null; threadProjectSessionIds?: readonly string[] | undefined; onThreadLink?: ((projectId: string, sessionId: string) => void) | undefined }>) {
  const reactionSessionWritable = session.ownership === 'command' && /^jc_[a-f0-9]{32}$/.test(session.id);
  const report = useRef(onHistory);
  report.current = onHistory;
  const messageOffsets = useRef(new Map<string, number>());
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pagesLoaded, setPagesLoaded] = useState(0);

  // Presence only for a session whose history actually loaded for this actor (so it is authorized)
  // and only while this pane is mounted; the hook itself reports only while the page is visible and focused.
  useReplyPresence(session.id, reportPresence && !loading && !error);

  // Exact-reply focus: a durable message id from a server-revalidated target, matched only by id in
  // this session's own history (never by text, recency or adjacency). Bounded by the existing page cap.
  const [focus, setFocus] = useState<{ id: string; state: 'searching' | 'found' | keyof typeof FOCUS_NOTICE } | null>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const settled = useRef(onFocusSettled);
  settled.current = onFocusSettled;
  useEffect(() => { if (focusMessageId) setFocus({ id: focusMessageId, state: 'searching' }); }, [focusMessageId]);
  useEffect(() => {
    if (!focus || focus.state !== 'searching') return;
    const finish = (state: 'found' | keyof typeof FOCUS_NOTICE) => { setFocus({ id: focus.id, state }); settled.current?.(); };
    if (messages.some((message) => message.id === focus.id)) {
      const element = focusRef.current;
      if (!element) { finish('unavailable'); return; }
      element.scrollIntoView?.({ block: 'center' });
      element.focus({ preventScroll: true });
      finish('found');
    } else if (error) finish('unavailable');
    else if (!loading && !hasMore) finish('missing');
    else if (!loading && hasMore) {
      if (pagesLoaded >= 10) finish('incomplete');
      else { setLoading(true); setOffset(nextOffset); }
    }
  }, [focus, messages, loading, error, hasMore, pagesLoaded, nextOffset]);

  useEffect(() => { report.current(session.id, messages, !loading && !error && !hasMore); }, [session.id, messages, loading, error, hasMore]);

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
        for (const message of page.messages) if (!messageOffsets.current.has(message.id)) messageOffsets.current.set(message.id, offset);
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

  const latestMessage = !loading && !error && !hasMore ? messages.at(-1) : null;
  const latestMarker = useLatestMessageView(session.id, latestMessage?.id ?? null, messages.length - 1, readObservation, onLatestViewed);

  // Derive handoff from the very snapshot being rendered, not a prior mount's
  // effect. Loading/failed/partial history must not remove the only local reply.
  const projected = projectTurns(turns.filter((turn) => turn.intent.sessionId === session.id), messages, !loading && !error && !hasMore);
  const omittedEchoIds = new Set(renderTurn ? projected.map((item) => item.omittedEchoId) : []);
  const liveAfter = (index: number) => projected.filter((item) => item.after === index).map(({ turn }) => <Fragment key={turn.intent.clientRequestId}>{renderTurn?.(turn)}</Fragment>);
  return <>
    {session.ownership === 'external' ? <p className="external-chat-notice">External chat · Read-only. Continuation is unavailable.</p> : null}
    {!reactionsAvailable || !reactions || !reactionSessionWritable ? <p className="reaction-note">{!reactionSessionWritable ? 'Reactions unavailable in read-only chats.' : reactionsUnavailableReason ?? 'Reactions unavailable on this server.'}</p> : null}
    {loading ? <p role="status">Loading messages…</p> : null}
    {error ? <div className="history-feedback"><p role="alert">{error}</p><button type="button" className="primary-button" onClick={() => { setError(null); setLoading(true); setAttempt((value) => value + 1); }}>Retry history</button></div> : null}
    {!loading && !error && messages.length === 0 ? <p role="status">No saved messages in session history yet.</p> : null}
    {focus && focus.state !== 'searching' && focus.state !== 'found' ? <div className="history-feedback" role="status"><p>{FOCUS_NOTICE[focus.state]}</p><button type="button" className="text-button" onClick={() => setFocus(null)}>Dismiss</button></div> : null}
    {liveAfter(-1)}
    {messages.map((message, index) => <Fragment key={message.id}>{omittedEchoIds.has(message.id) || (message.role === 'assistant' && !message.content && !message.toolName) ? null : <article ref={message.id === focus?.id ? (element) => { focusRef.current = element; } : undefined} tabIndex={message.id === focus?.id ? -1 : undefined} data-reply-focus={message.id === focus?.id && focus.state === 'found' ? 'true' : undefined} className="timeline-event history-message" data-message-id={message.id} aria-label={message.role === 'user' ? 'Your message' : message.role === 'assistant' ? 'Jarvis response' : undefined}>
      <div className={`event-icon ${message.role === 'user' ? 'violet' : 'cyan'}`}>
        {message.role === 'tool' ? <SquareTerminal size={17} /> : message.role === 'user' ? <MessageSquare size={17} /> : <Command size={25} />}
      </div>
      <div className="event-body">
        <div className="event-label"><span>{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Jarvis' : message.role}</span><time>{message.timestamp ? new Date(message.timestamp).toLocaleString() : 'Time not reported'}</time></div>
        {message.role === 'tool' ? <details className="saved-tool-disclosure"><summary>{message.toolName ?? 'Tool activity'}</summary><p>{message.content || 'No text was saved.'}</p></details> : <>{message.toolName ? <h2>{message.toolName}</h2> : null}{message.role === 'assistant' ? <MessageContent text={message.content || 'Assistant activity record — no text was saved.'} threadProjectId={threadProjectId} threadProjectSessionIds={threadProjectSessionIds} onThreadLink={onThreadLink} /> : <p>{message.content || 'No text was saved.'}</p>}</>}
        {reactionsAvailable && reactions && reactionSessionWritable && message.sessionId === session.id && (message.role === 'user' || message.role === 'assistant') && !message.toolName && !message.displayKind && messageOffsets.current.has(message.id) ? <MessageReactions key={`${session.id}:${message.id}`} client={reactions} target={{ sessionId: session.id, messageId: message.id, offset: messageOffsets.current.get(message.id)! }} /> : null}
        {message.role === 'assistant' && message.content ? <CopyResponse text={message.content} limited={false} onSave={onSaveResponse ? () => onSaveResponse(message) : undefined} /> : null}
        {message.id === latestMessage?.id ? <span ref={latestMarker} className="latest-message-view" aria-hidden="true" /> : null}
      </div>
    </article>}{liveAfter(index)}</Fragment>)}
    {!loading && !error && messages.length > 0 && session.ownership === 'command' && !(renderTurn && turns.some(turn => turn.intent.sessionId === session.id && (!turn.done || turn.usage?.execution))) ? <HistoryReceipt key={session.id} sessionId={session.id} refreshKey={JSON.stringify(messages.map(message => message.id))} /> : null}
    {!error && (hasMore && pagesLoaded >= 10 ? <p role="status">History view limit reached. More messages may exist.</p> : hasMore ? <button type="button" className="primary-button" disabled={loading} onClick={() => { setLoading(true); setOffset(nextOffset); }}>Load more messages</button> : null)}
  </>;
}
