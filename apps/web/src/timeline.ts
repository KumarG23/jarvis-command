import type { SessionMessage } from '@jarvis-command/contracts';
import type { Turn } from './useLiveTurn';

// Prefer authoritative message IDs from verified run status. Older backends
// need the exact, complete pre-submission prefix and original input. Never
// search all history for matching text: repeated turns are legitimate.
export function matchTurn(turn: Turn, messages: SessionMessage[], complete: boolean) {
  const empty = { user: null, assistant: null, echo: null };
  if (!turn.identityVerified || messages.some(message => message.sessionId !== turn.intent.sessionId)) return empty;
  if (turn.historyBinding) {
    // A verified status read binds these projected message IDs to this run.
    // Never fall back to text matching when an explicit binding disagrees.
    const binding = turn.historyBinding;
    const users = messages.filter(message => message.id === binding.userMessageId);
    const replies = messages.filter(message => message.id === binding.assistantMessageId);
    const user = users.length === 1 ? users[0]! : null;
    const reply = replies.length === 1 ? replies[0]! : null;
    if (!turn.publicRunId || !turn.done || !user || !reply || user.role !== 'user' || reply.role !== 'assistant'
      || messages.indexOf(reply) <= messages.indexOf(user)
      || messages.slice(messages.indexOf(user) + 1, messages.indexOf(reply)).some(message => message.role === 'user')
      || (turn.intent.input !== null && user.content !== turn.intent.input)
      || turn.outputLimited || !turn.output || reply.content !== turn.output) return empty;
    return { user, assistant: complete ? reply : null, echo: reply };
  }
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
    const match = blocked && !turn.historyBinding ? { user: null, assistant: null, echo: null } : matchTurn(candidate, messages, complete);
    if (match.echo) floor = messages.indexOf(match.echo) + 1;
    else blocked = true; // An unresolved earlier submission cannot share a later turn's IDs.
    const nextUser = match.user ? messages.findIndex((message, index) => index > messages.indexOf(match.user!) && message.role === 'user') : -1;
    const after = match.echo ? messages.indexOf(match.echo) : match.user && nextUser >= 0 ? nextUser - 1 : messages.length - 1;
    // On partial/active snapshots keep the local reply and omit only its exact
    // owned saved echo. This is a projection, never removal from saved history.
    return { turn: { ...turn, historyMatched: !!match.assistant, userHistoryMatched: !!match.user }, after, omittedEchoId: match.assistant ? null : match.echo?.id ?? null };
  });
}
