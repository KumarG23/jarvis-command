import { type CommandBootstrap, type ProjectRoom, type SessionSummary } from '@jarvis-command/contracts';
import { useState } from 'react';
import { LiveRoom } from './LiveRoom';
import { TurnComposer, TurnView } from './TurnView';
import { type useLiveTurn } from './useLiveTurn';

type Props = {
  session: SessionSummary; live: ReturnType<typeof useLiveTurn>; project: ProjectRoom | null;
  bootstrap: CommandBootstrap; onClose: () => void; onFocus: () => void;
  onProjectReadback: (room: ProjectRoom) => void;
  onThreadLink: (projectId: string, sessionId: string) => void;
  onSave: (text: string, runId: string | null) => void;
};
export function ThreadConversation({ session, live, project, bootstrap, onClose, onFocus, onProjectReadback, onThreadLink, onSave }: Props) {
  const [authorized, setAuthorized] = useState<string | null>(null);
  const allowed = !!project && !project.archived && bootstrap.command.liveRoom.enabled && bootstrap.hermes.state === 'online' && bootstrap.hermes.capabilities.includes('run_events_sse') && session.ownership === 'command' && session.id.startsWith('jc_');
  const artifacts = bootstrap.hermes.capabilities.includes('artifact_studio');
  return <section className="command-main second-conversation" aria-label="Second conversation pane">
    <header className="command-header"><strong>{session.title}</strong><button type="button" className="text-button" onClick={onFocus}>Focus thread</button><button type="button" className="icon-button" aria-label="Close second conversation" onClick={onClose}>×</button></header>
    <section className="timeline" aria-label={`Conversation: ${session.title}`}><div className="conversation-content">
      <LiveRoom key={`${session.id}:${live.refresh?.revision ?? ''}`} session={session} threadProjectId={project?.id ?? null} threadProjectSessionIds={project?.sessionIds ?? []} onThreadLink={onThreadLink} onHistory={(id, messages, complete) => { live.history(id, messages, complete); setAuthorized(complete ? id : null); }} turns={[...live.completedTurns, ...(live.turn ? [live.turn] : [])]} onSaveResponse={artifacts ? message => onSave(message.content, null) : undefined} renderTurn={turn => <TurnView turn={turn} allowed={allowed && turn.intent === live.turn?.intent} approve={live.approve} stop={live.stop} threadProjectId={project?.id ?? null} threadProjectSessionIds={project?.sessionIds ?? []} onThreadLink={onThreadLink} onSaveResponse={artifacts ? onSave : undefined} />} />
      {live.recoveryError ? <p role="alert">{live.recoveryError}</p> : null}
    </div></section>
    <footer className="composer-wrap"><TurnComposer allowed={allowed} draftsAuthorized={authorized === session.id} blocked={!!live.recoveryError || !live.historyReady(session.id) || live.historyBacklogFull} imageAttachmentsEnabled={artifacts} sessionId={session.id} projectId={project?.id ?? null} project={project} onProjectReadback={onProjectReadback} max={bootstrap.command.liveRoom.maxInputCharacters} maxSteer={bootstrap.command.liveRoom.maxSteerCharacters} turn={live.turn} send={(id, input, max, inference, images) => live.send(id, input, max, inference, images, undefined, project?.id)} retry={live.retry} resume={live.resume} steer={live.steer} recoveries={live.recoveries} consumeRecovery={live.consumeRecovery} /></footer>
  </section>;
}
