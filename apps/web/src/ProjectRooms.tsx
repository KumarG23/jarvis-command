import { ProjectReferences } from './ProjectReferences';
import { ProjectThreadUpdateSchema, ProjectRoomSchema, ProjectRoomsSchema, ProjectRoomCreateSchema, SessionMutationResponseSchema, type ProjectRoom, type SessionSummary } from '@jarvis-command/contracts';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Folder, FolderPlus, MessageSquare, Plus, Search, Trash2, X, FileText, Link, Pencil } from 'lucide-react';
import { CreateSession } from './CreateSession';

import { appStorageKey } from './appEnvironment';

const UNCERTAIN_KEY = appStorageKey('jarvis-command:uncertain-project-create:v1');
const KEY = appStorageKey('jarvis-command:project-room:v1');
async function request(path: string, body?: unknown) {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-jarvis-command': '1' }) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  if (response.status === 404 && body !== undefined && /^\/api\/rooms\/room_[a-f0-9]{32}$/.test(path)) throw Error('Project editing is unavailable on this server, or this project no longer exists. Your draft is kept here until you reload or cancel. Reload projects to check availability.');
  if (!response.ok) throw Error('Project operation could not be confirmed. Reload projects before retrying; the change may already have been saved.');
  return response.json() as Promise<unknown>;
}
export type ProjectRoomsHandle = { readback: (room: ProjectRoom) => void; openDetails: (opener?: HTMLElement) => void; closeDetails: () => void; focusSearch: () => void; selectChat: (session: SessionSummary) => void; adoptSession: (session: SessionSummary) => Promise<void> };
type Props = Readonly<{
  ref?: Ref<ProjectRoomsHandle>;
  sessions: SessionSummary[];
  selectedSessionId?: string | undefined;
  onScope: (name: string | null) => void;
  onProjectChange?: (room: ProjectRoom | null) => void;
  onOpenArtifacts?: () => void;
  artifactsEnabled?: boolean;
  onProjectScope?: (id: string | null) => void;
  onSession: (session: SessionSummary | null) => void;
  onDeleted?: (sessionId: string) => void;
  contextTarget?: HTMLElement | null;
  onOpenChange?: (open: boolean) => void;
  onNavigate?: () => void;
}>;
export function ProjectRooms({ ref, sessions, selectedSessionId, onScope, onProjectScope, onProjectChange, onOpenArtifacts, artifactsEnabled, onSession, onDeleted, contextTarget, onOpenChange, onNavigate }: Props) {
  const [rooms, setRooms] = useState<ProjectRoom[]>([]);
  const [selected, setSelected] = useState<ProjectRoom | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadDraft, setThreadDraft] = useState<{ roomId: string; sessionId: string; title: string } | null>(null);
  const [uncertainCreates, setUncertainCreates] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(sessionStorage.getItem(UNCERTAIN_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && /^room_[a-f0-9]{32}$/.test(id)).slice(0, 100) : []; } catch { return []; }
  });
  function markCreation(roomId: string, uncertain: boolean) {
    setUncertainCreates(previous => {
      const next = uncertain ? [...new Set([...previous, roomId])] : previous.filter(id => id !== roomId);
      try { sessionStorage.setItem(UNCERTAIN_KEY, JSON.stringify(next)); } catch { /* In-memory guard still applies. */ }
      return next;
    });
  }
  const [attachId, setAttachId] = useState('');
  const [pendingProjectChat, setPendingProjectChat] = useState<{ roomId: string; roomName: string; session: SessionSummary } | null>(null);
  const [draft, setDraft] = useState<{ id: string; name: string; goal: string; instructions: string; archived: boolean; repository: string; notes: string } | null>(null);
  const [query, setQuery] = useState('');
  const [known, setKnown] = useState<Record<string, SessionSummary>>({});
  const [titleError, setTitleError] = useState(false);
  const [titleAttempt, setTitleAttempt] = useState(0);
  const [projectTarget, setProjectTarget] = useState<SessionSummary | null>(null);
  const [targetRoomId, setTargetRoomId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const callbacks = useRef({ onScope, onProjectScope, onSession, onDeleted, onOpenChange, onNavigate }); callbacks.current = { onScope, onProjectScope, onSession, onDeleted, onOpenChange, onNavigate };
  const mounted = useRef(true), working = useRef(false);
  const opener = useRef<HTMLElement | null>(null), closeButton = useRef<HTMLButtonElement | null>(null), search = useRef<HTMLInputElement | null>(null);
  const roomCreation = useRef({ name: '', goal: '', instructions: '', repository: '', notes: '' });
  useEffect(() => { onProjectChange?.(busy ? null : selected); }, [selected, busy, onProjectChange]);
  useEffect(() => { callbacks.current.onOpenChange?.(open); if (open) closeButton.current?.focus(); }, [open]);
  function closeDrawer() {
    setOpen(false); opener.current?.focus();
    if (opener.current && !opener.current.getClientRects().length) callbacks.current.onNavigate?.();
  }
  function showDetails(element?: HTMLElement, create = false) { opener.current = element ?? null; setCreatingRoom(create); setOpen(true); }
  useImperativeHandle(ref, () => ({
    readback: room => { if (selected?.id === room.id) { callbacks.current.onScope(room.name); setSelected(room); setRooms(previous => previous.map(item => item.id === room.id ? room : item)); } },
    openDetails: element => showDetails(element),
    closeDetails: closeDrawer,
    focusSearch: () => search.current?.focus(),
    selectChat: session => { if (!draft) void perform(() => chooseChat(session)); },
    adoptSession: async session => {
      if (draft || working.current) throw Error('Finish the current project operation before switching chats.');
      working.current = true; setBusy(true); setError(null);
      try {
        if (selected) await attach(session.id);
        else await chooseChat(session);
      } finally {
        working.current = false;
        if (mounted.current) setBusy(false);
      }
    },
  }));
  function remember(id: string | null) { try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY); } catch { /* Optional view hint, never the room database. */ } }
  async function perform(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await operation(); } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Project operation unavailable'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  async function saveMetadata(id: string, metadata: unknown) {
    const expected = ProjectRoomCreateSchema.parse(metadata);
    await request(`/api/rooms/${id}`, expected);
    const data = ProjectRoomsSchema.parse(await request('/api/rooms'));
    const room = data.rooms.find(item => item.id === id);
    if (!room || Object.entries(expected).some(([key, value]) => JSON.stringify(room[key as keyof ProjectRoom]) !== JSON.stringify(value))) throw Error('Saved project readback differs. Your draft is kept; reload projects before retrying.');
    if (!mounted.current) return room;
    setRooms(data.rooms); setSelected(room);
    callbacks.current.onScope(room.name); callbacks.current.onProjectScope?.(room.id);
    return room;
  }
  async function saveThread(room: ProjectRoom, sessionId: string, metadata: unknown) {
    const expected = ProjectThreadUpdateSchema.parse(metadata);
    let failure: unknown;
    try { await request(`/api/rooms/${room.id}/threads/${encodeURIComponent(sessionId)}`, expected); } catch (error) { failure = error; }
    // Read back even after a lost acknowledgement. Never resend a write automatically.
    const data = ProjectRoomsSchema.parse(await request('/api/rooms'));
    const saved = data.rooms.find(item => item.id === room.id);
    if (mounted.current) { setRooms(data.rooms); if (saved) setSelected(saved); }
    const thread = saved?.threads?.find(item => item.sessionId === sessionId);
    if (!thread || (expected.title !== undefined && thread.title !== expected.title)
      || (expected.archived !== undefined && thread.archived !== expected.archived)
      || (expected.designateLead && saved?.leadSessionId !== sessionId)) {
      throw failure ?? Error('Thread save readback differs. Your draft is kept; reload projects before retrying.');
    }
    if (mounted.current && expected.title !== undefined) setThreadDraft(null);
  }
  async function resolveSession(id: string) {
    const { session } = SessionMutationResponseSchema.parse(await request(`/api/live/sessions/${id}`));
    if (session.id !== id) throw Error('Saved chat unavailable. No replacement was selected.');
    if (mounted.current) setKnown(previous => ({ ...previous, [id]: session }));
    return session;
  }
  async function choose(room: ProjectRoom | null) {
    if (!mounted.current) return;
    if (!room) setOpen(false);
    setSelected(room); setExpanded(room?.id ?? null); remember(room?.id ?? null);
    callbacks.current.onScope(room?.name ?? null); callbacks.current.onProjectScope?.(room?.id ?? null); callbacks.current.onSession(null);
    if (room?.lastSessionId) {
      const session = await resolveSession(room.lastSessionId);
      if (mounted.current) callbacks.current.onSession(session);
    }
  }
  async function chooseChat(session: SessionSummary) {
    setSelected(null); setExpanded(null); setOpen(false); remember(null);
    callbacks.current.onScope(null); callbacks.current.onProjectScope?.(null); callbacks.current.onSession(session); callbacks.current.onNavigate?.();
  }
  async function load(remembered?: string) {
    const data = ProjectRoomsSchema.parse(await request('/api/rooms'));
    if (!mounted.current) return;
    setRooms(data.rooms); setLoaded(true);
    if (remembered) {
      const room = data.rooms.find(item => item.id === remembered);
      if (!room) throw Error('Remembered project unavailable. Choose another project or a recent chat.');
      await choose(room);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let remembered: string | null = null;
    try { remembered = sessionStorage.getItem(KEY); } catch { /* Optional hint. */ }
    if (remembered && /^room_[a-f0-9]{32}$/.test(remembered)) {
      callbacks.current.onScope('Loading project'); callbacks.current.onProjectScope?.(null); callbacks.current.onSession(null);
      void perform(() => load(remembered!));
    } else void perform(() => load());
    return () => { mounted.current = false; };
  }, []);
  // Resolve older project chats outside bootstrap recents without exposing internal IDs.
  const expandedRoom = rooms.find(room => room.id === expanded);
  const missing = (expandedRoom?.sessionIds ?? []).filter(id => !known[id] && !sessions.some(session => session.id === id));
  const missingKey = missing.join(',');
  useEffect(() => {
    if (!missingKey) return;
    let current = true;
    setTitleError(false);
    void (async () => {
      const ids = missingKey.split(',');
      for (let index = 0; index < ids.length && current; index += 4) {
        await Promise.all(ids.slice(index, index + 4).map(async id => {
          try { const { session } = SessionMutationResponseSchema.parse(await request(`/api/live/sessions/${id}`));
            if (session.id !== id) throw Error('identity');
            if (current) setKnown(previous => ({ ...previous, [id]: session }));
          } catch { if (current) setTitleError(true); }
        }));
      }
    })();
    return () => { current = false; };
    // Resolve once per project/membership change; failures retry explicitly.
  }, [expanded, expandedRoom?.sessionIds.join(','), titleAttempt]);
  async function linkToProject(roomId: string, id: string, selectChat = true, activateRoom = false) {
    const payload = await request(`/api/rooms/${roomId}/sessions`, { sessionId: id });
    const room = ProjectRoomSchema.parse((payload as { room: unknown }).room);
    const { session } = SessionMutationResponseSchema.parse({ session: (payload as { session: unknown }).session });
    if (room.id !== roomId || room.lastSessionId !== id || session.id !== id) throw Error('Chat association could not be verified.');
    if (!mounted.current) return;
    if (activateRoom) {
      setSelected(room); setExpanded(room.id); remember(room.id); callbacks.current.onScope(room.name); callbacks.current.onProjectScope?.(room.id);
    } else if (selected?.id === room.id) setSelected(room);
    setRooms(previous => previous.map(item => item.id === room.id ? room : item)); setKnown(previous => ({ ...previous, [id]: session }));
    if (selectChat) callbacks.current.onSession(session);
    if (!rooms.find(item => item.id === roomId)?.sessionIds.includes(id) || pendingProjectChat?.session.id === id) markCreation(roomId, false);
    setPendingProjectChat(previous => previous?.session.id === id ? null : previous); setAttachId('');
  }
  async function attach(id: string) { if (selected) await linkToProject(selected.id, id); }
  async function createProjectChat(room: ProjectRoom) {
    if (uncertainCreates.includes(room.id) || pendingProjectChat?.roomId === room.id) throw Error('Check the existing chat before creating another thread.');
    // Set before the request: timeout/lost ACK must not offer a create retry.
    markCreation(room.id, true);
    const { session } = SessionMutationResponseSchema.parse(await request('/api/live/sessions', { title: room.name }));
    if (session.ownership !== 'command' || !/^jc_[a-f0-9]{32}$/.test(session.id)) throw Error('New chat identity could not be verified.');
    if (!mounted.current) return;
    setPendingProjectChat({ roomId: room.id, roomName: room.name, session });
    setKnown(previous => ({ ...previous, [session.id]: session }));
    try {
      await linkToProject(room.id, session.id, true, true);
      setOpen(false);
      callbacks.current.onNavigate?.();
    } catch {
      // The session identity is confirmed, but project linking is not. Keep the
      // exact target available for an explicit retry without locking navigation.
    }
  }
  async function deleteChat(session: SessionSummary) {
    const response = await fetch(`/api/live/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', 'x-jarvis-command': '1' } });
    const payload = await response.json().catch(() => null) as { deleted?: unknown; sessionId?: unknown } | null;
    if (!response.ok || payload?.deleted !== true || payload.sessionId !== session.id) throw Error('Chat deletion could not be confirmed. Reload chats before retrying; it may already be gone.');
    if (!mounted.current) return;
    setKnown(previous => { const next = { ...previous }; delete next[session.id]; return next; });
    setRooms(previous => previous.map(room => {
      const sessionIds = room.sessionIds.filter(id => id !== session.id);
      return sessionIds.length === room.sessionIds.length ? room : { ...room, ...(room.threads ? { threads: room.threads.filter(thread => thread.sessionId !== session.id) } : {}), ...(room.leadSessionId === session.id ? { leadSessionId: null } : {}), sessionIds, lastSessionId: room.lastSessionId === session.id ? sessionIds.at(-1) ?? null : room.lastSessionId };
    }));
    setSelected(previous => previous ? (() => { const sessionIds = previous.sessionIds.filter(id => id !== session.id); return { ...previous, ...(previous.threads ? { threads: previous.threads.filter(thread => thread.sessionId !== session.id) } : {}), ...(previous.leadSessionId === session.id ? { leadSessionId: null } : {}), sessionIds, lastSessionId: previous.lastSessionId === session.id ? sessionIds.at(-1) ?? null : previous.lastSessionId }; })() : null);
    setDeleteTarget(null); callbacks.current.onDeleted?.(session.id);
  }
  const filter = query.trim().toLowerCase();
  const sessionTitle = (id: string) => sessions.find(session => session.id === id)?.title ?? known[id]?.title;
  const threadTitle = (room: ProjectRoom, id: string) => room.threads?.find(thread => thread.sessionId === id)?.title ?? sessionTitle(id) ?? 'Saved chat';
  const creationBlocked = (roomId: string) => uncertainCreates.includes(roomId) || pendingProjectChat?.roomId === roomId;
  const filtered = rooms.filter(room => [room.name, room.goal, room.repository, ...room.notes, ...room.sessionIds.map(id => threadTitle(room, id))].some(value => value.toLowerCase().includes(filter))).sort((a, b) => Number(!!a.archived) - Number(!!b.archived));
  const recent = sessions.filter(session => session.title.toLowerCase().includes(filter));
  const allKnown = [...sessions, ...Object.values(known).filter(session => !sessions.some(item => item.id === session.id))];
  const panel = open ? <div className="project-details" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeDrawer(); } }}>
    <header className="pane-header"><h2>{creatingRoom ? 'New project' : 'Project details'}</h2><button ref={closeButton} type="button" className="icon-button" aria-label="Close project details" onClick={closeDrawer}><X size={20} /></button></header>
    <div className="pane-body">
      {draft ? <form aria-label="Edit project" onSubmit={event => {
        event.preventDefault(); void perform(async () => {
          const parsed = ProjectRoomCreateSchema.safeParse({ name: draft.name, goal: draft.goal, instructions: draft.instructions, archived: draft.archived, repository: draft.repository, notes: draft.notes.split('\n').filter(Boolean) });
          if (!parsed.success) throw Error('Check the project fields. Name and goal are required; instructions allow up to 4,000 characters; use up to 12 references, each at most 512 characters.');
          await saveMetadata(draft.id, parsed.data);
          if (mounted.current) setDraft(null);
        });
      }}>
        <h3>Edit project</h3>
        <label>Project name<input value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} maxLength={80} required /></label>
        <label>Project goal<textarea value={draft.goal} disabled={busy} onChange={event => setDraft({ ...draft, goal: event.target.value })} maxLength={2000} required /></label>
        <p className="muted small">Standing instructions: up to 4,000 characters, included in each new project message.</p>
        <label>Standing instructions<textarea value={draft.instructions} disabled={busy} maxLength={4000} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></label>
        <label>Repository reference<input value={draft.repository} disabled={busy} onChange={event => setDraft({ ...draft, repository: event.target.value })} maxLength={512} /></label>
        <label>Note references (one per line)<textarea value={draft.notes} disabled={busy} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={6156} /></label>
        <p className="muted small">Closing this panel keeps your draft until reload. Save or cancel before changing projects.</p>
        <div className="button-row"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>Cancel</button></div>
      </form> : creatingRoom ? <form aria-label="Create project" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void perform(async () => {
          const metadata = ProjectRoomCreateSchema.parse({ name: data.get('name'), goal: data.get('goal'), instructions: data.get('instructions'), archived: false, repository: data.get('repository'), notes: String(data.get('notes')).split('\n').filter(Boolean) });
          const payload = await request('/api/rooms', metadata); const room = ProjectRoomSchema.parse((payload as { room: unknown }).room);
          if (!mounted.current) return;
          const readback = ProjectRoomsSchema.parse(await request('/api/rooms'));
          const saved = readback.rooms.find(item => item.id === room.id);
          if (!saved || Object.entries(metadata).some(([key, value]) => JSON.stringify(saved[key as keyof ProjectRoom]) !== JSON.stringify(value))) throw Error('Created project readback could not be verified. Your draft is kept; reload projects before retrying.');
          setRooms(readback.rooms); setCreatingRoom(false); roomCreation.current = { name: '', goal: '', instructions: '', repository: '', notes: '' }; await choose(saved);
        });
      }}>
        <h3>A place for related work.</h3><p className="muted">Give your project a name and a goal. You can add references whenever you need them.</p>
        <label>Project name<input name="name" disabled={busy} defaultValue={roomCreation.current.name} onChange={event => { roomCreation.current.name = event.target.value; }} maxLength={80} required /></label>
        <label>Project goal<textarea name="goal" disabled={busy} defaultValue={roomCreation.current.goal} onChange={event => { roomCreation.current.goal = event.target.value; }} maxLength={2000} required /></label>
        <p className="muted small">Standing instructions: up to 4,000 characters, included in each new project message.</p>
        <label>Standing instructions<textarea name="instructions" disabled={busy} defaultValue={roomCreation.current.instructions} onChange={event => { roomCreation.current.instructions = event.target.value; }} maxLength={4000} /></label>
        <label>Repository reference<input name="repository" disabled={busy} defaultValue={roomCreation.current.repository} onChange={event => { roomCreation.current.repository = event.target.value; }} maxLength={512} /></label>
        <label>Note references (one per line)<textarea name="notes" disabled={busy} defaultValue={roomCreation.current.notes} onChange={event => { roomCreation.current.notes = event.target.value; }} maxLength={6156} /></label>
        <button className="primary-button" type="submit" disabled={busy}>Create project</button>
      </form> : selected ? <>
        <div className="project-title"><Folder size={24} /><h3>{selected.name}</h3><button className="secondary-button" type="button" disabled={busy} onClick={() => { setError(null); setDraft({ id: selected.id, name: selected.name, goal: selected.goal, instructions: selected.instructions ?? '', archived: selected.archived ?? false, repository: selected.repository, notes: selected.notes.join('\n') }); }}><Pencil size={14} /> Edit project</button></div>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void perform(async () => { await saveMetadata(selected.id, { name: selected.name, goal: selected.goal, repository: selected.repository, notes: selected.notes, instructions: selected.instructions ?? '', archived: !selected.archived }); })}>{selected.archived ? 'Restore project' : 'Archive project'}</button>
        {selected.archived ? <p role="status">Archived project — restore before sending new project messages.</p> : null}
        <section><h4>Standing instructions</h4><p className="project-goal">{selected.instructions || 'No standing instructions saved.'}</p><p className="muted small">Saved context is included as ordinary text in each new project message. Review the complete context at the composer.</p></section>
        <section aria-label="Project threads"><h4>Lead and threads</h4>
          <p className="muted small">Titles and archive are saved for this project. Archiving keeps the same Hermes chat. Tracked dates show when Command added thread metadata.</p>
          {selected.leadSessionId ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void perform(async () => { await attach(selected.leadSessionId!); closeDrawer(); callbacks.current.onNavigate?.(); })}>Open lead: {threadTitle(selected, selected.leadSessionId)}</button> : <p>No lead designated. Choose a writable Command chat below.</p>}
          {[false, true].map(archived => <div key={String(archived)}>
            {archived && selected.threads?.some(thread => thread.archived) ? <h4>Archived threads</h4> : null}
            {selected.sessionIds.filter(id => !!selected.threads?.find(thread => thread.sessionId === id)?.archived === archived).map(id => {
              const thread = selected.threads?.find(thread => thread.sessionId === id);
              const session = sessions.find(item => item.id === id) ?? known[id];
              const lead = selected.leadSessionId === id;
              return <div key={id} className="project-thread" role="group" aria-label={`Thread: ${threadTitle(selected, id)}`}>
                <button className="sidebar-item" type="button" disabled={busy} onClick={() => void perform(async () => { await attach(id); closeDrawer(); callbacks.current.onNavigate?.(); })}>{threadTitle(selected, id)}</button>
                <p className="muted small">{lead ? 'Lead · ' : ''}{session?.ownership === 'external' ? 'Read-only · ' : ''}{thread ? `Tracked ${new Date(thread.createdAt).toLocaleDateString()}` : 'Legacy chat · tracking date unavailable'}</p>
                {threadDraft?.roomId === selected.id && threadDraft.sessionId === id ? <form aria-label="Rename thread" onSubmit={event => { event.preventDefault(); void perform(() => saveThread(selected, id, { title: threadDraft.title })); }}>
                  <label>Thread title<input required maxLength={120} disabled={busy} value={threadDraft.title} onChange={event => setThreadDraft({ roomId: selected.id, sessionId: id, title: event.target.value })} /></label>
                  <div className="button-row"><button type="submit" className="secondary-button" disabled={busy}>Save thread title</button><button type="button" className="text-button" disabled={busy} onClick={() => setThreadDraft(null)}>Cancel rename</button></div>
                </form> : <div className="button-row">
                  <button className="text-button" type="button" disabled={busy} onClick={() => setThreadDraft({ roomId: selected.id, sessionId: id, title: threadTitle(selected, id) })}>Rename thread</button>
                  <button className="text-button" type="button" disabled={busy || lead} title={lead ? 'Choose another lead before archiving this thread' : undefined} onClick={() => void perform(() => saveThread(selected, id, { archived: !archived }))}>{archived ? 'Restore thread' : 'Archive thread'}</button>
                  {!lead && !archived && session?.ownership === 'command' ? <button className="text-button" type="button" disabled={busy} onClick={() => void perform(() => saveThread(selected, id, { designateLead: true }))}>Designate lead</button> : null}
                </div>}
              </div>;
            })}
          </div>)}
          <button className="secondary-button" type="button" disabled={busy || selected.archived || creationBlocked(selected.id)} onClick={() => void perform(() => createProjectChat(selected))}>Start project chat</button>
        </section>
        <section><h4>Goal</h4><p className="project-goal">{selected.goal}</p></section>
        <section><h4>References</h4>{selected.repository ? <Reference value={selected.repository} repository /> : null}{selected.notes.map((note, index) => <Reference key={index} value={note} />)}{!selected.repository && !selected.notes.length ? <p className="muted">No references added yet.</p> : null}<p className="muted small">Reference labels are included as text; saved non-image files are not delivered to Hermes. Images require the explicit Attach image action.</p></section>
        <p className="notice">In-run delegation detail is not available from this Hermes installation</p>
        {artifactsEnabled ? <ProjectReferences key={selected.id} projectId={selected.id} onOpen={onOpenArtifacts} /> : <p>Reference file storage is unavailable on this connection.</p>}
        <section><h4>Add an existing chat</h4><label>Chat<select value={attachId} disabled={busy} onChange={event => setAttachId(event.target.value)}><option value="">Choose a chat</option>{allKnown.filter(session => !selected.sessionIds.includes(session.id)).map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</select></label><button className="secondary-button" type="button" disabled={busy || !attachId} onClick={() => void perform(() => attach(attachId))}>Add to project</button></section>
      </> : <p className="muted">Select a project to see its goal and references.</p>}
      {error ? <p role="alert" className="notice error">{error} <button type="button" className="text-button" disabled={busy} onClick={() => void perform(() => load(selected?.id))}>Reload projects</button></p> : null}
    </div>
  </div> : null;
  return <>
    <CreateSession disabled={busy} onCreated={session => { void chooseChat(session); }} />
    {uncertainCreates.some(id => id !== pendingProjectChat?.roomId) ? <div className="project-chat-recovery" role="alert"><p>A project chat creation is unconfirmed. Check recent chats after reloading the app, then add the existing chat to its project. Creating another chat in that project is paused to avoid duplicates.</p></div> : null}
    {pendingProjectChat ? <div className="project-chat-recovery" role="alert"><p>Chat created. Adding it to {pendingProjectChat.roomName} still needs confirmation.</p><button className="text-button" type="button" disabled={busy} onClick={() => void perform(() => linkToProject(pendingProjectChat.roomId, pendingProjectChat.session.id, true, true))}>Finish adding chat to {pendingProjectChat.roomName}</button></div> : null}
    <label className="sidebar-search"><Search size={17} /><input ref={search} type="search" aria-label="Search projects and chats" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button className="icon-button" type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15} /></button> : null}</label>
    <div className="sidebar-scroll">
      <nav aria-label="Projects" className="sidebar-section"><div className="section-heading"><h2>Projects</h2><button className="icon-button" type="button" aria-label="New project" disabled={busy || !!draft} onClick={event => showDetails(event.currentTarget, true)}><Plus size={17} /></button></div>
        {!loaded ? <p className="empty-copy">Loading projects…</p> : !rooms.length ? <p className="empty-copy">No projects yet.</p> : !filtered.length ? <p className="empty-copy">No matching projects.</p> : null}
        {filtered.map((room, index) => <div key={room.id} className="project-nav-group">{room.archived && !filtered[index - 1]?.archived ? <h3 className="section-heading">Archived projects</h3> : null}<div className="project-nav-row"><button type="button" className="sidebar-item project-nav" title={room.name} disabled={busy || !!draft} aria-current={selected?.id === room.id ? 'page' : undefined} aria-expanded={expanded === room.id} onClick={() => {
          if (selected?.id === room.id) { setExpanded(previous => previous === room.id ? null : room.id); return; }
          void perform(() => choose(room));
        }}><Folder size={18} /><span>{room.name}</span>{expanded === room.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><button className="icon-button project-new-chat" type="button" aria-label={`New chat in ${room.name}`} title={`New chat in ${room.name}`} disabled={busy || !!draft || room.archived || creationBlocked(room.id)} onClick={() => void perform(() => createProjectChat(room))}><Plus size={15} /></button></div>
        {expanded === room.id ? <div className="project-chat-list">{room.sessionIds.length ? room.sessionIds.filter(id => !room.threads?.find(thread => thread.sessionId === id)?.archived).map(id => <button key={id} className="sidebar-item chat-item" type="button" title={threadTitle(room, id)} aria-current={id === selectedSessionId ? 'page' : undefined} disabled={busy || !!draft} onClick={() => void perform(async () => { await attach(id); callbacks.current.onNavigate?.(); })}><MessageSquare size={16} /><span>{room.leadSessionId === id ? 'Lead · ' : ''}{threadTitle(room, id)}</span></button>) : <p className="empty-copy">Start a chat in this project.</p>}
          {titleError ? <button className="text-button small" type="button" onClick={() => setTitleAttempt(value => value + 1)}>Retry chat titles</button> : null}
          <button className="text-button project-info-button" type="button" aria-expanded={open && !creatingRoom} onClick={event => showDetails(event.currentTarget)}>Project details <ChevronRight size={13} /></button>
        </div> : null}</div>)}
      </nav>
      <nav aria-label="Recent chats" className="sidebar-section"><div className="section-heading"><h2>Recent chats</h2></div>{recent.length ? recent.map(session => <div className="recent-chat-row" key={session.id}><button type="button" className="sidebar-item chat-item" aria-label={session.title} disabled={busy || !!draft} aria-current={!selected && selectedSessionId === session.id ? 'page' : undefined} title={session.ownership === 'external' ? `${session.title} · Read-only` : session.title} onClick={() => void perform(() => chooseChat(session))}><MessageSquare size={17} /><span>{session.title}</span>{session.ownership === 'external' ? <span className="read-only-dot" aria-label="Read-only chat" /> : null}</button><button className="icon-button chat-row-action" type="button" aria-label={`Add ${session.title} to project`} disabled={busy || !rooms.length} onClick={() => { setProjectTarget(session); setTargetRoomId(rooms[0]?.id ?? ''); }}><FolderPlus size={15} /></button>{session.ownership === 'command' ? <button className="icon-button chat-row-action danger" type="button" aria-label={`Delete ${session.title}`} disabled={busy} onClick={() => setDeleteTarget(session)}><Trash2 size={15} /></button> : null}</div>) : <p className="empty-copy">{query ? 'No matching chats.' : 'Your chats will appear here.'}</p>}</nav>
      {error && !open ? <p role="alert" className="notice error">{error} <button className="text-button" type="button" disabled={busy} onClick={() => void perform(() => load(selected?.id))}>Reload projects</button></p> : null}
    </div>
    {projectTarget ? <div className="action-dialog-backdrop"><section className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="add-chat-title"><h2 id="add-chat-title">Add chat to project</h2><p>{projectTarget.title}</p><label>Project<select value={targetRoomId} disabled={busy} onChange={event => setTargetRoomId(event.target.value)}>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><div className="button-row"><button className="primary-button" type="button" disabled={busy || !targetRoomId} onClick={() => void perform(async () => { await linkToProject(targetRoomId, projectTarget.id, false); setProjectTarget(null); })}>Add to project</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setProjectTarget(null)}>Cancel</button></div></section></div> : null}
    {deleteTarget ? <div className="action-dialog-backdrop"><section className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-chat-title"><h2 id="delete-chat-title">Delete this chat permanently?</h2><p><strong>{deleteTarget.title}</strong></p><p className="muted">This removes the chat history from Hermes and every Command project. This cannot be undone.</p><div className="button-row"><button className="danger-button" type="button" disabled={busy} onClick={() => void perform(() => deleteChat(deleteTarget))}>Delete permanently</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button></div></section></div> : null}
    {contextTarget ? createPortal(panel, contextTarget) : panel}
  </>;
}
function Reference({ value, repository = false }: Readonly<{ value: string; repository?: boolean }>) {
  // Only explicit web references are navigable; local paths are displayed as metadata.
  const href = /^https?:\/\//i.test(value) ? value : undefined;
  return <div className="reference-row">{repository ? <Link size={17} /> : <FileText size={17} />}{href ? <a href={href} target="_blank" rel="noreferrer">{value}</a> : <span>{value}</span>}</div>;
}
