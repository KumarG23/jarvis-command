import { ProjectRoomSchema, ProjectRoomsSchema, ProjectRoomCreateSchema, SessionMutationResponseSchema, type ProjectRoom, type SessionSummary } from '@jarvis-command/contracts';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const KEY = 'jarvis-command:project-room:v1';
async function request(path: string, body?: unknown) {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-jarvis-command': '1' }) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  if (!response.ok) throw Error('Project operation unavailable. Check access and connection, then reload rooms before retrying; a write may already have succeeded.');
  return response.json() as Promise<unknown>;
}
export function ProjectRooms({ sessions, onScope, onSession, navigationTarget }: Readonly<{ sessions: SessionSummary[]; onScope: (name: string | null) => void; onSession: (session: SessionSummary | null) => void; navigationTarget?: HTMLElement | null }>) {
  const [rooms, setRooms] = useState<ProjectRoom[]>([]);
  const [selected, setSelected] = useState<ProjectRoom | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachId, setAttachId] = useState('');
  const [creationPending, setCreationPending] = useState(false);
  const callbacks = useRef({ onScope, onSession }); callbacks.current = { onScope, onSession };
  const mounted = useRef(true);
  const working = useRef(false);
  function remember(id: string | null) { try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY); } catch { /* Optional view hint, not room database. */ } }
  async function perform(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await operation(); } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Project operation unavailable'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  async function choose(room: ProjectRoom | null) {
    if (!mounted.current) return;
    setSelected(room); remember(room?.id ?? null); callbacks.current.onScope(room?.name ?? null); callbacks.current.onSession(null);
    if (room?.lastSessionId) {
      const { session } = SessionMutationResponseSchema.parse(await request(`/api/live/sessions/${room.lastSessionId}`));
      if (session.id !== room.lastSessionId || session.ownership !== 'command') throw Error('Saved conversation unavailable. No replacement was selected.');
      if (mounted.current) callbacks.current.onSession(session);
    }
  }
  async function load(remembered?: string) {
    const data = ProjectRoomsSchema.parse(await request('/api/rooms'));
    if (!mounted.current) return;
    setRooms(data.rooms); setLoaded(true);
    if (remembered) {
      const room = data.rooms.find(item => item.id === remembered);
      if (!room) throw Error('Remembered project room unavailable. Choose All sessions or another room.');
      await choose(room);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let remembered: string | null = null;
    try { remembered = sessionStorage.getItem(KEY); } catch { /* Optional hint. */ }
    if (remembered && /^room_[a-f0-9]{32}$/.test(remembered)) {
      callbacks.current.onScope('Loading project'); callbacks.current.onSession(null);
      void perform(() => load(remembered!));
    }
    return () => { mounted.current = false; };
    // Load only once; callbacks are deliberately held separately from room identity.

  }, []);
  async function attach(id: string) {
    if (!selected) return;
    const payload = await request(`/api/rooms/${selected.id}/sessions`, { sessionId: id });
    const room = ProjectRoomSchema.parse((payload as { room: unknown }).room);
    const { session } = SessionMutationResponseSchema.parse({ session: (payload as { session: unknown }).session });
    if (room.id !== selected.id || room.lastSessionId !== id || session.id !== id || session.ownership !== 'command') throw Error('Conversation association could not be verified.');
    if (!mounted.current) return;
    setSelected(room); setRooms(previous => previous.map(item => item.id === room.id ? room : item)); callbacks.current.onSession(session);
    setCreationPending(false);
  }
  const navigation = <>{rooms.map(room => <button type="button" className="sidebar-item" key={room.id} disabled={busy} aria-current={selected?.id === room.id ? 'page' : undefined} onClick={() => void perform(() => choose(room))}>{room.name}</button>)}</>;
  return <section className="project-rooms" aria-label="Persistent project rooms">
    {navigationTarget ? createPortal(<><button type="button" className="sidebar-item" disabled={busy} onClick={() => { setOpen(true); if (!loaded) void perform(() => load()); }}>Browse project rooms</button>{navigation}</>, navigationTarget) : null}
    <div className="project-room-bar">
      <button type="button" disabled={busy} onClick={() => { setOpen(!open); if (!loaded) void perform(() => load()); }}>Project rooms</button>
      <button type="button" disabled={busy} onClick={() => { setOpen(false); void perform(() => choose(null)); }}>All sessions</button>
      {selected ? <><strong>{selected.name}</strong><button type="button" onClick={() => setOpen(!open)}>Project details</button></> : null}
    </div>
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void perform(() => load(selected?.id))}>Reload rooms</button></p> : null}
    {open ? <div className="project-room-drawer">
      <nav aria-label="Saved project rooms" className={navigationTarget ? 'drawer-room-navigation' : undefined}>{navigation}</nav>
      {!loaded ? <p>Loading rooms…</p> : <form onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void perform(async () => {
          const metadata = ProjectRoomCreateSchema.parse({ name: data.get('name'), goal: data.get('goal'), repository: data.get('repository'), notes: String(data.get('notes')).split('\n').filter(Boolean) });
          const payload = await request('/api/rooms', metadata);
          const room = ProjectRoomSchema.parse((payload as { room: unknown }).room);
          if (!mounted.current) return;
          setRooms(previous => [...previous, room]); await choose(room);
        });
      }}>
        <label>Room name<input name="name" maxLength={80} required /></label>
        <label>Room goal<textarea name="goal" maxLength={2000} required /></label>
        <label>Repository / workdir reference<input name="repository" maxLength={512} /></label>
        <label>Pinned note references (one per line)<textarea name="notes" maxLength={6156} /></label>
        <button type="submit" disabled={busy}>Create project room</button>
      </form>}
      {selected ? <div className="project-room-details">
        <p>{selected.goal}</p><p>Associated metadata only — not applied execution configuration. References are not read or injected into Hermes.</p>
        <p>Repository / workdir: {selected.repository || 'Not associated'}</p>
        <ul>{selected.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
        <p>Runtime model, provider, reasoning and context size: not reported by this room API.</p>
      </div> : null}
    </div> : null}
    {selected ? <div className="project-room-conversations">
      <label>Room conversation<select disabled={busy} value={selected.lastSessionId ?? ''} onChange={event => void perform(() => attach(event.target.value))}><option value="" disabled>Choose conversation</option>{selected.sessionIds.map(id => <option key={id} value={id}>{sessions.find(session => session.id === id)?.title ?? id}</option>)}</select></label>
      <label>Attach existing Command session<input value={attachId} onChange={event => setAttachId(event.target.value)} list="command-session-references" placeholder="Exact jc_ session ID" maxLength={35} /></label>
      <datalist id="command-session-references">{sessions.filter(session => session.ownership === 'command').map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</datalist>
      <button type="button" disabled={busy || !/^jc_[a-f0-9]{32}$/.test(attachId)} onClick={() => void perform(() => attach(attachId))}>Attach conversation</button>
      <button type="button" disabled={busy || creationPending} onClick={() => void perform(async () => {
        setCreationPending(true);
        const { session } = SessionMutationResponseSchema.parse(await request('/api/live/sessions', { title: selected.name }));
        // Creation is already audited. If linking fails, preserve the exact ID for explicit retry.
        if (mounted.current) setAttachId(session.id);
        await attach(session.id);
      })}>New Command session</button>
      {creationPending ? <p>Session creation or association needs reconciliation. Attach the preserved ID, or check All sessions before creating again. Do not repeat creation on an uncertain response.</p> : null}
    </div> : null}
  </section>;
}
