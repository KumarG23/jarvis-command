import type { SessionSummary } from '@jarvis-command/contracts';

const SOURCE_LABEL: Record<string, string> = {
  discord: 'Discord chat', cron: 'Scheduled job', scheduler: 'Scheduled job', cli: 'Terminal session', terminal: 'Terminal session',
  telegram: 'Telegram chat', slack: 'Slack chat', whatsapp: 'WhatsApp chat', signal: 'Signal chat', email: 'Email',
  api_server: 'API session', webhook: 'Webhook', acp: 'Editor session', mcp: 'Tool session',
};

/** Where an outside Jarvis session came from, in words. */
export function sourceLabel(source: string): string {
  const key = source.toLowerCase();
  if (SOURCE_LABEL[key]) return SOURCE_LABEL[key];
  if (!key || key === 'unknown') return 'Jarvis session';
  return `${key[0]!.toUpperCase()}${key.slice(1).replace(/[_-]+/g, ' ')} session`;
}

/** A chat's title; Hermes leaves some sessions untitled, so name those by where they came from. */
export function chatTitle(session: Pick<SessionSummary, 'title' | 'source'>): string {
  return session.title === 'Untitled session' ? sourceLabel(session.source) : session.title;
}

/**
 * Recent chats shows Command's own chats. Sessions Jarvis had elsewhere (Discord, cron runs, the CLI)
 * are read-only here and go in a collapsed group; ones with no messages are left out entirely.
 */
export function splitRecent<T extends Pick<SessionSummary, 'ownership' | 'messageCount' | 'id'>>(sessions: readonly T[], keepId?: string | null) {
  const own: T[] = [], other: T[] = [];
  for (const session of sessions) {
    if (session.ownership === 'command') own.push(session);
    else if (session.messageCount > 0 || session.id === keepId) other.push(session);
  }
  return { own, other };
}
