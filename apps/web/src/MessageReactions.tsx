import { useId, useRef, useState } from 'react';
import { ReactionEmojiSchema, type ReactionTarget } from '@jarvis-command/contracts';
import type { MessageReactionClient } from './useMessageReactions';

const labels = ['Thumbs up', 'Thumbs down', 'Heart', 'Celebrate', 'Smile', 'Confused', 'Eyes'];
export function MessageReactions({ target, client }: { target: ReactionTarget; client: MessageReactionClient }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const id = useId();
  const state = client.state(target);
  const locked = client.busy || state?.phase !== 'ready' || !!state?.intent;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const show = () => {
    setOpen(true); void client.read(target);
    // Focus the always-available Close action; Tab then reaches the picker choices.
    requestAnimationFrame(() => picker.current?.querySelector('button')?.focus());
  };
  return <div className="message-reactions" onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className="reaction-chips">
      <button ref={trigger} type="button" className="text-button reaction-trigger" disabled={client.busy && !open} aria-expanded={open} aria-controls={id} onClick={() => open ? close() : show()}>Reactions</button>
      {(state?.emojis ?? []).map(emoji => <button key={emoji} type="button" className="reaction-chip" aria-label={`Remove ${labels[ReactionEmojiSchema.options.indexOf(emoji)]} reaction`} aria-pressed="true" disabled={locked} onClick={() => { void client.change(target, emoji); }}><span aria-hidden="true">{emoji}</span></button>)}
    </div>
    {open ? <div className="reaction-picker" id={id} ref={picker} role="group" aria-label="Choose reaction">
      <div className="reaction-picker-heading"><span>Your reactions</span><button type="button" className="text-button" onClick={close}>Close reactions</button></div>
      <div className="reaction-options">{ReactionEmojiSchema.options.map((emoji, index) => <button key={emoji} type="button" className="reaction-chip" aria-label={labels[index]} aria-pressed={state?.emojis?.includes(emoji) ?? false} disabled={locked} onClick={() => { void client.change(target, emoji); }}><span aria-hidden="true">{emoji}</span><span>{labels[index]}</span></button>)}</div>
      <p className="reaction-note">Feedback is included only on a later explicit send.</p>
      {state?.phase === 'reading' || state?.phase === 'saving' ? <p role="status">{state.phase === 'reading' ? 'Reading saved reactions…' : 'Saving reaction…'}</p> : null}
      {!state && client.capacityReached ? <p role="alert">Reaction control limit reached. Reconcile a pending reaction before opening more.</p> : null}
      {state?.error ? <p role="alert">{state.error}</p> : null}
      {!client.busy ? <button type="button" className="text-button" onClick={() => { void client.read(target); }}>{state?.intent ? 'Check saved reactions' : 'Refresh reactions'}</button> : null}
      {state?.phase === 'checked' && state.intent ? <><p role="status">Saved state checked. Settle the original {state.intent.action} intent before choosing another reaction.</p><button type="button" className="secondary-button" disabled={client.busy} onClick={() => { void client.retry(target); }}>Retry same reaction intent</button></> : null}
    </div> : null}
    {!open && state?.intent ? <p role="status" className="reaction-note">Reaction save unconfirmed. Open Reactions to check and retry.</p> : null}
  </div>;
}
