import { createHash } from 'node:crypto';
import { SessionMessagesPageSchema, ThreadStateSchema, type ThreadReadRequest } from '@jarvis-command/contracts';
import type { createLiveRoomService } from './live-room-service';
import { KeyedSerialQueue } from './keyed-serial-queue';
import type { ThreadReadStore } from './thread-read-store';

export class ThreadObservationUnavailableError extends Error {
  readonly statusCode = 503;
  constructor() { super('Thread observation unavailable'); }
}
type Source = Pick<ReturnType<typeof createLiveRoomService>, 'getSession' | 'getMessages' | 'getRosterStatus'>;
// Bounded canonical oldest-first traversal, never a timestamp/text match or a run/message join.
// Beyond 1000 rows the state is unknown; no partial page can clear unread.
export function createThreadState(source: Source, store: ThreadReadStore) {
  const queue = new KeyedSerialQueue();
  let active = 0;
  const unavailable = () => new ThreadObservationUnavailableError();
  async function snapshot(subject: string, sessionId: string) {
    const deadline = Date.now() + 8000;
    const seen = new Set<string>();
    const { session } = await source.getSession(subject, sessionId);
    if (session.id !== sessionId || session.ownership !== 'command') throw Object.assign(Error('Thread unavailable'), { statusCode: 404 });
    let latest: ThreadReadRequest | null = null;
    let recentAt: string | null = null;
    for (let offset = 0; offset < 1000;) {
      if (Date.now() >= deadline) throw unavailable();
      const page = SessionMessagesPageSchema.parse(await source.getMessages(subject, sessionId, 100, offset));
      if (page.sessionId !== sessionId || page.messages.some(m => m.sessionId !== sessionId)
        || page.pagination.offset !== offset || page.pagination.limit !== 100 || page.pagination.returned !== page.messages.length
        || (page.pagination.hasMore && !page.messages.length)) throw Error('History unavailable');
      if (Date.now() >= deadline || page.messages.some(message => { if (seen.has(message.id)) return true; seen.add(message.id); return false; })) throw unavailable();
      const last = page.messages.at(-1);
      if (last) { latest = { messageId: last.id, position: offset + page.messages.length - 1 }; recentAt = last.timestamp ?? session.lastActive ?? null; }
      if (!page.pagination.hasMore) return { latest, recentAt, historyComplete: true };
      offset += page.messages.length;
    }
    return { latest: null, recentAt: null, historyComplete: false };
  }
  const actor = (subject: string) => createHash('sha256').update(subject).digest('hex');
  async function read(subject: string, sessionId: string, viewed?: ThreadReadRequest) {
    const history = await snapshot(subject, sessionId);
    if (viewed) {
      if (!history.historyComplete || history.latest?.messageId !== viewed.messageId || history.latest.position !== viewed.position)
        throw Object.assign(Error('Latest message changed. Refresh before marking read.'), { statusCode: 409 });
      await store.advance({ actor: actor(subject), sessionId, ...viewed });
    }
    const entries = await store.list();
    const lastRead = entries.find(entry => entry.actor === actor(subject) && entry.sessionId === sessionId);
    let runStatus: (Awaited<ReturnType<typeof source.getRosterStatus>>)['status'] = 'unknown';
    let runObservedAt: string | null = null;
    try { runStatus = (await source.getRosterStatus(subject, sessionId)).status; runObservedAt = new Date().toISOString(); } catch { /* transport is not run state */ }
    return ThreadStateSchema.parse({ sessionId, observedAt: new Date().toISOString(), runStatus, runObservedAt, ...history, lastRead: lastRead ? { messageId: lastRead.messageId, position: lastRead.position } : null,
      unread: !history.historyComplete ? null : history.latest ? !(lastRead?.messageId === history.latest.messageId && lastRead.position === history.latest.position) : false });
  }
  return { read: async (subject: string, sessionId: string, viewed?: ThreadReadRequest) => {
    if (active >= 2) throw unavailable();
    active++;
    try { return await queue.run(`${actor(subject)}:${sessionId}`, () => read(subject, sessionId, viewed)); } finally { active--; }
  } };
}
