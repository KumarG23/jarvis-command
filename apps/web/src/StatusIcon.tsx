import { CircleHelp, Hand, MessageSquare, Moon, Sparkles } from 'lucide-react';
import { statusLabels, type ThreadStatus } from './threadStatus';
const icons = { 'needs-you': Hand, working: Sparkles, unread: MessageSquare, idle: Moon, unknown: CircleHelp };
// Idle and unknown are the resting states: like Claude or Discord, a quiet chat shows nothing.
export function StatusIcon({ state, quiet = true }: { state: ThreadStatus; quiet?: boolean }) {
  if (quiet && (state === 'idle' || state === 'unknown')) return null;
  const Icon = icons[state];
  return <span className={`thread-state thread-state-${state}`} role="img" aria-label={statusLabels[state]} title="Verified latest Command run and saved-message view; native activity may be unknown"><Icon size={15} aria-hidden="true" /><span>{statusLabels[state]}</span></span>;
}
