import { ArrowUpRight, Bell, CalendarClock, ChevronRight, Command, Plus, Server, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import type { SessionSummary } from '@jarvis-command/contracts';
import { createLiveSession, createSessionError } from './CreateSession';
import { seedTextDraft } from './textDraft';

/** Starter prompts for a new chat. Ones ending in a space leave the cursor for Neal to finish. */
export const SUGGESTIONS = [
  { label: 'Homelab check', icon: Server, text: 'Check disk, memory and service health on every server and tell me anything that needs attention.' },
  { label: 'Set a reminder', icon: Bell, text: 'Remind me at 5 PM to ' },
  { label: 'Schedule a job', icon: CalendarClock, text: 'Every morning at 8, check ' },
  { label: 'Help me plan', icon: Sparkles, text: 'Help me plan ' },
] as const;

export function Welcome({ projectName, canCreate, onCreated, onBrowse }: Readonly<{
  projectName: string | null;
  canCreate: boolean;
  onCreated: (session: SessionSummary) => void;
  onBrowse: () => void;
}>) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function start(text?: string) {
    if (busy.current || !canCreate) return;
    busy.current = true; setCreating(true); setError(null);
    try {
      const session = await createLiveSession();
      if (text) seedTextDraft(session.id, text);
      onCreated(session);
    } catch (failure) {
      setError(createSessionError(failure));
    } finally {
      busy.current = false; setCreating(false);
    }
  }

  // Inside a project, new chats are made from the project's own list so they join it.
  if (projectName) return <div className="welcome">
    <Command size={36} strokeWidth={1.5} aria-hidden="true" />
    <h1>{`Let’s work on ${projectName}.`}</h1>
    <p>Pick a chat in this project, or start a new one with the + next to its name.</p>
    <button className="secondary-button welcome-action" type="button" onClick={onBrowse}>Show project chats <ChevronRight size={17} /></button>
  </div>;

  return <div className="welcome">
    <Command size={36} strokeWidth={1.5} aria-hidden="true" />
    <h1>What are we working on?</h1>
    <div className="welcome-suggestions" role="group" aria-label="Start a chat">
      {SUGGESTIONS.map(({ label, icon: Icon, text }) => <button key={label} type="button" className="welcome-suggestion" disabled={creating || !canCreate} onClick={() => void start(text)}>
        <Icon size={17} aria-hidden="true" /><span>{label}</span><ArrowUpRight size={15} aria-hidden="true" className="welcome-suggestion-go" />
      </button>)}
    </div>
    <div className="welcome-actions">
      <button className="primary-button" type="button" disabled={creating || !canCreate} onClick={() => void start()}><Plus size={17} />{creating ? 'Creating chat…' : 'Start a blank chat'}</button>
      <button className="text-button" type="button" onClick={onBrowse}>Open a recent chat</button>
    </div>
    {error ? <p role="alert" className="notice error">{error}</p> : null}
  </div>;
}
