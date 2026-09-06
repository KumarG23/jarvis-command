import type { SessionMessage } from '@jarvis-command/contracts';
import type { Turn } from './useLiveTurn';

// The public history contract has message IDs, but no run/request link. Only
// reconcile the first user after an exact, complete pre-submission prefix.
// Never search all history for matching text: repeated turns are legitimate.
export function matchTurn(turn: Turn, messages: SessionMessage[], complete: boolean) {
  const baseline = turn.historyBaseline;
  if (!baseline || turn.intent.input === null || !turn.identityVerified
    || messages.some((message) => message.sessionId !== turn.intent.sessionId)
    || baseline.some((id, index) => messages[index]?.id !== id)) return { user: null, assistant: null, echo: null };
  const user = messages[baseline.length];
  if (!user || user.role !== 'user' || user.content !== turn.intent.input) return { user: null, assistant: null, echo: null };
  const following = messages.slice(baseline.length + 1);
  const nextUser = following.findIndex((message) => message.role === 'user');
  const segment = nextUser < 0 ? following : following.slice(0, nextUser);
  const replies = segment.filter((message) => message.role === 'assistant' && message.content === turn.output);
  const echo = !turn.outputLimited && !!turn.output && replies.length === 1 ? replies[0]! : null;
  const assistant = turn.done && complete ? echo : null;
  return { user, assistant, echo };
}

export function projectTurns(turns: Turn[], messages: SessionMessage[], complete: boolean) {
  let floor = 0;
  let blocked = false;
  return turns.map((turn) => {
    const baseline = turn.historyBaseline;
    const candidate = baseline && !blocked && baseline.length < floor
      ? { ...turn, historyBaseline: messages.slice(0, floor).map((message) => message.id) } : turn;
    const match = blocked ? { user: null, assistant: null, echo: null } : matchTurn(candidate, messages, complete);
    if (match.echo) floor = messages.indexOf(match.echo) + 1;
    else blocked = true; // An unresolved earlier submission cannot share a later turn's IDs.
    const nextUser = match.user ? messages.findIndex((message, index) => index > messages.indexOf(match.user!) && message.role === 'user') : -1;
    const after = match.echo ? messages.indexOf(match.echo) : match.user && nextUser >= 0 ? nextUser - 1 : messages.length - 1;
    // On partial/active snapshots keep the local reply and omit only its exact
    // owned saved echo. This is a projection, never removal from saved history.
    return { turn: { ...turn, historyMatched: !!match.assistant, userHistoryMatched: !!match.user }, after, omittedEchoId: match.assistant ? null : match.echo?.id ?? null };
  });
}
