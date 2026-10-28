import { useMemo, useRef, useState } from 'react';
import { appStorageKey } from './appEnvironment';

export const textDraftKey = () => appStorageKey('jarvis-command:text-drafts:v1');
const MAX_SESSIONS = 32;
const MAX_TEXT = 16000;
const MAX_STORAGE = 131072;
type Drafts = Record<string, string>;
function read(): Drafts {
  const raw = sessionStorage.getItem(textDraftKey());
  if (raw === null) return Object.create(null) as Drafts;
  if (raw.length > MAX_STORAGE || new TextEncoder().encode(raw).length > MAX_STORAGE) throw Error('draft limit');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('draft invalid');
  const entries = Object.entries(value);
  if (entries.length > MAX_SESSIONS || entries.some(([id, text]) => !id.startsWith('jc_') || id.length > 256 || typeof text !== 'string' || text.length > MAX_TEXT)) throw Error('draft invalid');
  return Object.assign(Object.create(null) as Drafts, value);
}
function write(room: string, text: string) {
  const drafts = read();
  if (text) drafts[room] = text; else delete drafts[room];
  const raw = JSON.stringify(drafts);
  if (!room.startsWith('jc_') || room.length > 256 || text.length > MAX_TEXT || Object.keys(drafts).length > MAX_SESSIONS || (raw.length > MAX_STORAGE || new TextEncoder().encode(raw).length > MAX_STORAGE)) throw Error('draft limit');
  sessionStorage.setItem(textDraftKey(), raw);
  if (sessionStorage.getItem(textDraftKey()) !== raw) throw Error('draft write unverified');
}

// Read only after the selected session's canonical history has authorized access.
// Text only, same tab and preview namespace. Never evict another unsent draft.
export function useTextDraft(sessionId: string | undefined, authorized: boolean) {
  const [memory, setMemory] = useState<Drafts>({});
  const [failed, setFailed] = useState<boolean | null>(null);
  const draftsRef = useRef<Drafts>({});
  const stored = useMemo(() => {
    if (!sessionId || !authorized) return { text: '', failed: false };
    try { return { text: read()[sessionId] ?? '', failed: false }; }
    catch { return { text: '', failed: true }; }
  }, [sessionId, authorized]);
  const draft = sessionId && authorized ? memory[sessionId] ?? stored.text : '';
  if (sessionId && authorized) draftsRef.current[sessionId] = draft;
  const setRoomDraft = (room: string, text: string) => {
    draftsRef.current[room] = text;
    setMemory(previous => ({ ...previous, [room]: text }));
    try { write(room, text); setFailed(false); }
    catch { setFailed(true); }
  };
  // Must finish before admission. If stale persisted text cannot be removed,
  // retain the visible draft and refuse this send rather than resurrect it later.
  const clearForSend = (room: string) => {
    try { write(room, ''); setFailed(false); return true; }
    catch { setFailed(true); return false; }
  };
  return { draft, draftsRef, setRoomDraft, clearForSend, storageUnavailable: failed ?? stored.failed };
}
