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
  const [draft, setDraft] = useState<{ id: string; name: string; goal: string; repository: string; notes: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const callbacks = useRef({ onScope, onSession }); callbacks.current = { onScope, onSession };
  const mounted = useRef(true);
  const working = useRef(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (open) closeButton.current?.focus(); }, [open]);
  function closeDrawer() { setOpen(false); opener.current?.focus(); }
  function toggleDrawer(button: HTMLButtonElement, forceOpen = false) {
    if (open && !forceOpen) { closeDrawer(); return; }
    opener.current = button; setOpen(true);
    if (!loaded) void perform(() => load());
  }
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
  const filter = query.trim().toLowerCase();
  const filtered = rooms.filter(room => [room.name, room.goal, room.repository, ...room.notes].some(value => value.toLowerCase().includes(filter)));
  const navigation = <>{filtered.map(room => <button type="button" className="sidebar-item" key={room.id} disabled={busy || !!draft} aria-current={selected?.id === room.id ? 'page' : undefined} onClick={() => void perform(() => choose(room))}>{room.name}</button>)}</>;
  return <section className="project-rooms" aria-label="Persistent project rooms">
    {navigationTarget ? createPortal(<><button type="button" className="sidebar-item" disabled={busy} aria-expanded={open} aria-controls="project-room-drawer" onClick={event => toggleDrawer(event.currentTarget, true)}>Browse project rooms</button>{navigation}</>, navigationTarget) : null}
    <div className="project-room-bar">
      <button type="button" disabled={busy} aria-expanded={open} aria-controls="project-room-drawer" onClick={event => toggleDrawer(event.currentTarget)}>Project rooms</button>
      <button type="button" disabled={busy || !!draft} onClick={() => { setOpen(false); void perform(() => choose(null)); }}>All sessions</button>
      {selected ? <><strong aria-label="Selected project room">{selected.name}</strong><button type="button" aria-expanded={open} aria-controls="project-room-drawer" onClick={event => toggleDrawer(event.currentTarget)}>Project details</button></> : null}
    </div>
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void perform(() => load(selected?.id))}>Reload rooms</button></p> : null}
    {open ? <div id="project-room-drawer" className="project-room-drawer" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeDrawer(); } }}>
      <div className="project-drawer-heading"><h2>Project rooms</h2><button ref={closeButton} type="button" onClick={closeDrawer}>Close project rooms</button></div>
      <label>Filter project rooms<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, goal or reference" /></label>
      {query ? <button type="button" onClick={() => setQuery('')}>Clear filter</button> : null}
      {loaded ? <p role="status">{rooms.length === 0 ? 'No project rooms yet. Create one below.' : filtered.length === 0 ? 'No matching project rooms.' : `${filtered.length} of ${rooms.length} project rooms`}</p> : null}
      <nav aria-label="Saved project rooms" className={navigationTarget ? 'drawer-room-navigation' : undefined}>{navigation}</nav>
      {draft ? <form aria-label="Edit project room" onSubmit={event => {
        event.preventDefault();
        void perform(async () => {
          const parsed = ProjectRoomCreateSchema.safeParse({ name: draft.name, goal: draft.goal, repository: draft.repository, notes: draft.notes.split('\n').filter(Boolean) });
          if (!parsed.success) throw Error('Check the room fields: name and goal are required; use at most 12 note references, each up to 512 characters, without control characters.');
          setSaving(true);
          try {
            const payload = await request(`/api/rooms/${draft.id}`, parsed.data);
            const room = ProjectRoomSchema.parse((payload as { room: unknown }).room);
            if (room.id !== draft.id) throw Error('Updated room identity could not be verified. Your draft is retained.');
            if (!mounted.current) return;
            setRooms(previous => previous.map(item => item.id === room.id ? room : item));
            setSelected(room); callbacks.current.onScope(room.name); setDraft(null);
          } finally { if (mounted.current) setSaving(false); }
        });
      }}>
        <h2>Edit project room</h2>
        <p>Save or Cancel before changing rooms. Closing the drawer retains this draft in this tab until reload.</p>
        <label>Room name<input value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} maxLength={80} required /></label>
        <label>Room goal<textarea value={draft.goal} disabled={busy} onChange={event => setDraft({ ...draft, goal: event.target.value })} maxLength={2000} required /></label>
        <label>Repository / workdir reference<input value={draft.repository} disabled={busy} onChange={event => setDraft({ ...draft, repository: event.target.value })} maxLength={512} /></label>
        <label>Pinned note references (one per line)<textarea value={draft.notes} disabled={busy} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={6156} /></label>
        <button type="submit" disabled={busy}>{saving ? 'Saving…' : 'Save changes'}</button>
        <button type="button" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
        {saving ? <p role="status">Saving project room…</p> : null}
      </form> : !loaded ? <p>Loading rooms…</p> : <form onSubmit={event => {
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
        {!draft ? <button type="button" disabled={busy} onClick={() => { setError(null); setDraft({ id: selected.id, name: selected.name, goal: selected.goal, repository: selected.repository, notes: selected.notes.join('\n') }); }}>Edit project room</button> : null}
        <p>{selected.goal}</p><p>Associated metadata only — not applied execution configuration. References are not read or injected into Hermes.</p>
        <p>Repository / workdir: {selected.repository || 'Not associated'}</p>
        <ul>{selected.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
        <p>Runtime model, provider, reasoning and context size: not reported by this room API.</p>
      </div> : null}
    </div> : null}
    {selected ? <div className="project-room-conversations">
      <label>Room conversation<select disabled={busy || !!draft} value={selected.lastSessionId ?? ''} onChange={event => void perform(() => attach(event.target.value))}><option value="" disabled>Choose conversation</option>{selected.sessionIds.map(id => <option key={id} value={id}>{sessions.find(session => session.id === id)?.title ?? id}</option>)}</select></label>
      <label>Attach existing Command session<input value={attachId} onChange={event => setAttachId(event.target.value)} list="command-session-references" placeholder="Exact jc_ session ID" maxLength={35} /></label>
      <datalist id="command-session-references">{sessions.filter(session => session.ownership === 'command').map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</datalist>
      <button type="button" disabled={busy || !!draft || !/^jc_[a-f0-9]{32}$/.test(attachId)} onClick={() => void perform(() => attach(attachId))}>Attach conversation</button>
      <button type="button" disabled={busy || !!draft || creationPending} onClick={() => void perform(async () => {
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
