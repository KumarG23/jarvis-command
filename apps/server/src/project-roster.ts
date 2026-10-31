import { PROJECT_ROSTER_LIMIT, ProjectRosterSchema, type ProjectRoom, type ProjectRosterItem, type SessionMessagesPage } from '@jarvis-command/contracts';
import type { createLiveRoomService } from './live-room-service';

// One projection at a time per BFF; at most two outstanding upstream reads even
// when a caller times out. The supported client also enforces a 10s transport cap.
export function createProjectRosterReader(service: Pick<ReturnType<typeof createLiveRoomService>, 'getMessages' | 'getSession' | 'getRosterStatus'>, timeoutMs = 3000) {
  let active = false;
  return async (subject: string, project: ProjectRoom) => {
    if (active) throw Object.assign(Error('Roster busy'), { statusCode: 503 });
    active = true;
    const deadline = Date.now() + timeoutMs;
    const items: ProjectRosterItem[] = project.sessionIds.slice(0, PROJECT_ROSTER_LIMIT).map(sessionId => {
      const thread = project.threads?.find(item => item.sessionId === sessionId);
      return { sessionId, title: thread?.title ?? null, archived: thread?.archived ?? null, lead: project.leadSessionId === sessionId,
        status: 'unknown', statusObservedAt: null, runUpdatedAt: null, messagesObservedAt: null, messages: [], messagesTruncated: false, messagesUnavailable: true };
    });
    let next = 0;
    const worker = async () => {
      while (next < items.length && Date.now() < deadline) {
        const item = items[next++]!;
        // Verify the exact session before reading it; upstream names/archive are
        // deliberately not substituted for Command metadata.
        try {
          const { session } = await service.getSession(subject, item.sessionId);
          if (session.id !== item.sessionId || Date.now() >= deadline) continue;
        } catch { continue; }
        try {
          const status = await service.getRosterStatus(subject, item.sessionId);
          if (Date.now() >= deadline) continue;
          item.status = status.status; item.runUpdatedAt = status.runUpdatedAt; item.statusObservedAt = new Date().toISOString();
        } catch { /* independent message read may still succeed */ }
        if (Date.now() >= deadline) continue;
        try {
          const page: SessionMessagesPage = await service.getMessages(subject, item.sessionId, 2, 0);
          if (Date.now() >= deadline || page.sessionId !== item.sessionId || page.messages.some(message => message.sessionId !== item.sessionId)) continue;
          item.messages = page.messages.slice(0, 2).map(message => ({ role: message.role, text: message.content.slice(0, 240), truncated: message.content.length > 240 }));
          item.messagesTruncated = page.pagination.hasMore || page.messages.length > 2 || item.messages.some(message => message.truncated);
          item.messagesUnavailable = false; item.messagesObservedAt = new Date().toISOString();
        } catch { /* unknown/unavailable is intentional */ }
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.all([worker(), worker()]).finally(() => { active = false; });
    try {
      await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
      // Parse copies the result: late upstream completion cannot mutate a response.
      const result = ProjectRosterSchema.parse({ project, observedAt: new Date().toISOString(), limit: PROJECT_ROSTER_LIMIT,
        total: project.sessionIds.length, omitted: project.sessionIds.length - items.length,
        partial: project.sessionIds.length > items.length || items.some(item => item.status === 'unknown' || item.messagesUnavailable || item.messagesTruncated), items });
      if (Buffer.byteLength(JSON.stringify(result)) > 262144) throw Object.assign(Error('Roster too large'), { statusCode: 503 });
      return result;
    } finally { clearTimeout(timer); }
  };
}
