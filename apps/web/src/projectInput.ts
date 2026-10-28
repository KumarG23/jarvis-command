import { ProjectRoomsSchema, type ProjectRoom } from '@jarvis-command/contracts';
import { boundedJson } from './useLiveTurn';

// Command-owned text only. Reference bytes are never implicitly attached.
export function projectContext(room: ProjectRoom): string {
  return [
    '[Project context — saved in Command]',
    `Project: ${room.name}`,
    `Goal: ${room.goal}`,
    ...(room.instructions ? [`Standing instructions:\n${room.instructions}`] : []),
    ...(room.repository ? [`Repository reference: ${room.repository}`] : []),
    ...(room.notes.length ? [`Note references:\n${room.notes.join('\n')}`] : []),
    'Reference files remain in Command; file bytes are not included in this message.',
    '[/Project context]',
  ].join('\n');
}
export function composeProjectInput(input: string, room?: ProjectRoom | null): string {
  return room ? `${projectContext(room)}\n\n[Message]\n${input}` : input;
}
export async function readProjectForSend(id: string, sessionId: string, controller: AbortController): Promise<ProjectRoom> {
  let data;
  try {
    data = ProjectRoomsSchema.parse(await boundedJson('/api/rooms', {
      credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store',
    }, controller));
  } catch { throw Error('Project readback unavailable. Your draft or pending request is kept. Retry when project storage is available.'); }
  const room = data.rooms.find(item => item.id === id);
  if (!room || room.archived || !room.sessionIds.includes(sessionId)) throw Error('Project is unavailable, archived, or no longer contains this chat. Reload projects. Your draft is kept.');
  return room;
}
