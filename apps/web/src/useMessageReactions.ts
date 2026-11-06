import { useRef, useState } from 'react';
import { boundedJson } from './useLiveTurn';
import { ReactionMutationResultSchema, ReactionViewSchema, type ReactionMutation, type ReactionTarget } from '@jarvis-command/contracts';

type Emoji = ReactionMutation['emoji'];
export type ReactionState = {
  emojis: Emoji[] | null;
  phase: 'reading' | 'ready' | 'saving' | 'uncertain' | 'checked' | 'failed';
  intent: ReactionMutation | null;
  error: string | null;
};
const keyOf = (target: ReactionTarget) => JSON.stringify([target.sessionId, target.messageId]);
const empty = (): ReactionState => ({ emojis: null, phase: 'failed', intent: null, error: null });

async function post(path: string, body: unknown) {
  return boundedJson(`/api/live/reactions/${path}`, {
    method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' },
    body: JSON.stringify(body),
  }, new AbortController());
}

// One shell-owned, bounded cache: survives history remounts and switching either pane.
// No browser storage or actor guesses. A new authenticated shell starts with fresh reads.
export function useMessageReactions() {
  const [entries, setEntries] = useState<ReadonlyMap<string, ReactionState>>(new Map());
  const current = useRef(entries);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const update = (key: string, value: ReactionState) => {
    const next = new Map(current.current); next.set(key, value);
    current.current = next; setEntries(next);
  };
  const reserve = (key: string) => {
    if (working.current) return false;
    if (!current.current.has(key) && current.current.size >= 64) {
      // Never evict an uncertain intent. Settled entries are always read again on open.
      const settled = [...current.current].find(([, state]) => !state.intent);
      if (!settled) return false;
      const next = new Map(current.current); next.delete(settled[0]); current.current = next;
    }
    working.current = true; setBusy(true); return true;
  };
  const readState = async (target: ReactionTarget) => {
    const result = ReactionViewSchema.parse(await post('read', target));
    if (result.sessionId !== target.sessionId || result.messageId !== target.messageId
      || new Set(result.emojis).size !== result.emojis.length) throw Error('Reaction target mismatch');
    return result.emojis;
  };
  const read = async (target: ReactionTarget) => {
    const key = keyOf(target); if (!reserve(key)) return;
    const previous = current.current.get(key) ?? empty();
    update(key, { ...previous, phase: 'reading', error: null });
    try {
      const emojis = await readState(target);
      update(key, { emojis, intent: previous.intent, phase: previous.intent ? 'checked' : 'ready', error: null });
    } catch {
      update(key, { ...previous, phase: previous.intent ? 'uncertain' : 'failed', error: 'Saved reactions unavailable. Check access and try reading again.' });
    } finally { working.current = false; setBusy(false); }
  };
  const save = async (intent: ReactionMutation) => {
    const key = keyOf(intent); if (!reserve(key)) return;
    const previous = current.current.get(key) ?? empty();
    update(key, { ...previous, intent, phase: 'saving', error: null });
    try {
      const result = ReactionMutationResultSchema.parse(await post('mutate', intent));
      if (result.sessionId !== intent.sessionId || result.messageId !== intent.messageId || result.clientRequestId !== intent.clientRequestId
        || result.active !== (intent.action === 'add') || result.emojis.includes(intent.emoji) !== result.active) throw Error('Reaction receipt mismatch');
      // A replay receipt can describe an older state. Always read current state before another intent.
      const emojis = await readState({ sessionId: intent.sessionId, messageId: intent.messageId, offset: intent.offset });
      update(key, { emojis, phase: 'ready', intent: null, error: null });
    } catch {
      update(key, { ...previous, intent, phase: 'uncertain', error: 'Save unconfirmed. Check saved reactions before retrying this same intent.' });
    } finally { working.current = false; setBusy(false); }
  };
  return {
    entries, busy, capacityReached: entries.size >= 64 && [...entries.values()].every(state => !!state.intent),
    state: (target: ReactionTarget) => entries.get(keyOf(target)),
    read,
    change: (target: ReactionTarget, emoji: Emoji) => {
      const state = current.current.get(keyOf(target));
      if (!state || state.phase !== 'ready' || !state.emojis || state.intent || working.current) return;
      return save({ ...target, emoji, action: state.emojis.includes(emoji) ? 'remove' : 'add', clientRequestId: crypto.randomUUID() });
    },
    retry: (target: ReactionTarget) => {
      const state = current.current.get(keyOf(target));
      if (state?.phase === 'checked' && state.intent) return save(state.intent);
    },
  };
}
export type MessageReactionClient = ReturnType<typeof useMessageReactions>;
