import {
  NotificationInboxSchema,
  NotificationReconcileResponseSchema,
  NotificationTargetSchema,
  type NotificationCategory,
  type NotificationInbox,
  type NotificationItem,
  type NotificationPreferences,
  type NotificationTarget,
} from '@jarvis-command/contracts';
import { useEffect, useRef, useState } from 'react';
import { boundedJson } from './useLiveTurn';

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  'run-completed': 'Run finished',
  'run-failed': 'Run failed',
  approval: 'Approval needed',
};
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'run-completed', label: 'Finished' },
  { key: 'run-failed', label: 'Failed' },
  { key: 'approval', label: 'Approvals' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

const read = { credentials: 'same-origin', headers: { accept: 'application/json' } } as const;
const write = (body: unknown): RequestInit => ({
  method: 'POST', credentials: 'same-origin',
  headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' },
  body: JSON.stringify(body),
});

export type NotificationsState = ReturnType<typeof useNotifications>;

/** Owns the inbox read model. The server is the only authority; nothing is cached or stored locally. */
export function useNotifications(enabled: boolean, refreshKey: string) {
  const [inbox, setInbox] = useState<NotificationInbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Responses apply only if no newer request has started, so an old read cannot overwrite a newer write.
  async function run<T>(action: (controller: AbortController) => Promise<T>, apply: (value: T) => NotificationInbox | null, failure: string): Promise<T | null> {
    const ticket = ++sequence.current;
    setBusy(true);
    try {
      const value = await action(new AbortController());
      if (!alive.current) return null;
      const next = apply(value);
      if (ticket === sequence.current) { if (next) setInbox(next); setError(null); }
      return value;
    } catch {
      if (alive.current && ticket === sequence.current) setError(failure);
      return null;
    } finally { if (alive.current && ticket === sequence.current) setBusy(false); }
  }

  const refresh = () => run(async c => NotificationInboxSchema.parse(await boundedJson('/api/notifications', read, c)), value => value, 'Notifications could not be loaded. Your other work is unaffected.');
  const reconcile = () => run(async c => NotificationReconcileResponseSchema.parse(await boundedJson('/api/notifications/reconcile', write({}), c)), value => value.inbox, 'Active runs could not be checked. Showing what was last recorded.');
  const markRead = (selection: { ids: string[] } | { all: true }) => run(async c => NotificationInboxSchema.parse(await boundedJson('/api/notifications/read', write(selection), c)), value => value, 'Read state was not saved. Try again.');
  const savePreferences = async (preferences: NotificationPreferences) => {
    const saved = await run(async c => NotificationInboxSchema.parse(await boundedJson('/api/notifications/preferences', write(preferences), c)), value => value, 'Preferences were not saved. Your edits are kept; try again.');
    // Authoritative readback: anything other than the requested value is a failed save.
    if (saved && JSON.stringify(saved.preferences) !== JSON.stringify(preferences)) { setError('Preferences were not saved as requested. Your edits are kept; try again.'); return false; }
    return saved !== null;
  };
  const open = (id: string): Promise<NotificationTarget | null> => run(
    async c => NotificationTargetSchema.parse(await boundedJson(`/api/notifications/${id}/open`, write({}), c)),
    value => value.state === 'available' ? value.inbox : null,
    'This notification could not be opened. It may no longer exist.',
  );

  // Unread count is refreshed on load and when work in this tab changes state; there is no timer.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [enabled, refreshKey]);

  return { inbox, error, busy, refresh, reconcile, markRead, savePreferences, open };
}

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function NotificationsPane({ state, onOpen }: Readonly<{
  state: NotificationsState;
  /** Returns a user-facing note when the destination could not be fully restored, or null. */
  onOpen: (target: Extract<NotificationTarget, { state: 'available' }>) => string | null;
}>) {
  const { inbox, error, busy } = state;
  const [filter, setFilter] = useState<FilterKey>('all');
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const reconciled = useRef(false);

  useEffect(() => {
    if (reconciled.current) return;
    reconciled.current = true;
    // Reopening the inbox checks this actor's own unfinished runs through the supported status read.
    void state.reconcile();
  }, []);

  const preferences = draft ?? inbox?.preferences ?? null;
  const dirty = !!draft && !!inbox && JSON.stringify(draft) !== JSON.stringify(inbox.preferences);
  const items = (inbox?.items ?? []).filter(item => filter === 'all' || (filter === 'unread' ? item.readAt === null : item.category === filter));

  async function openItem(item: NotificationItem) {
    setNotice(null);
    const target = await state.open(item.id);
    if (!target) return;
    if (target.state === 'missing') setNotice('That chat or run no longer exists, so there is nothing to open.');
    else if (target.state === 'unavailable') setNotice('Jarvis could not confirm that chat right now. It stays unread; try again shortly.');
    else setNotice(onOpen(target));
  }

  return <div className="pane-body notifications-pane">
    <p className="eyebrow">In-app inbox</p>
    <h3>{inbox ? (inbox.unreadCount ? `${inbox.unreadCount} unread` : 'All caught up') : 'Notifications'}</h3>
    <p className="muted small">Shows runs you started in Command that finished or failed, and approvals they are waiting on. Events from the CLI, Discord or other surfaces and closed-app push alerts are not available yet; no browser permission is requested.</p>
    {error ? <p role="alert" className="notice error">{error}</p> : null}
    {error && !inbox ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void state.refresh()}>Try again</button> : null}
    {notice ? <p role="status" className="notice">{notice}</p> : null}
    {!inbox && !error ? <p role="status" className="muted">Loading notifications…</p> : null}
    {inbox ? <>
      <div className="notification-toolbar">
        <div role="group" aria-label="Filter notifications" className="notification-filters">
          {FILTERS.map(({ key, label }) => <button key={key} type="button" className="chip-button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        <button type="button" className="secondary-button" disabled={busy || inbox.unreadCount === 0} onClick={() => void state.markRead({ all: true })}>Mark all read</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void state.reconcile()}>Check active runs</button>
      </div>
      {items.length === 0 ? <p className="empty-copy" role="status">{inbox.items.length === 0 ? 'No notifications yet.' : 'No notifications match this filter.'}</p> : <ul className="notification-list" aria-label="Notifications">
        {items.map(item => <li key={item.id} className={`notification-row${item.readAt === null ? ' unread' : ''}`}>
          <div>
            <strong>{item.title}{item.readAt === null ? <span className="visually-hidden"> (unread)</span> : null}</strong>
            <p>{item.body}</p>
            <small>Observed by Command {timeFormat.format(new Date(item.observedAt))}</small>
          </div>
          <div className="notification-actions">
            <button type="button" className="secondary-button" disabled={busy} aria-label={`Open chat for ${item.title}`} onClick={() => void openItem(item)}>Open</button>
            {item.readAt === null ? <button type="button" className="text-button" disabled={busy} aria-label={`Mark ${item.title} read`} onClick={() => void state.markRead({ ids: [item.id] })}>Mark read</button> : null}
          </div>
        </li>)}
      </ul>}
      <section aria-labelledby="notification-preferences">
        <h4 id="notification-preferences">Preferences</h4>
        <p className="muted small">Choose which new events are recorded. Turning a category off does not remove existing items or add past events later.</p>
        {preferences ? <fieldset className="notification-preferences">
          <legend className="visually-hidden">Record these events</legend>
          {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map(category => <label key={category} className="notification-preference">
            <input type="checkbox" checked={preferences.categories[category]} onChange={event => { setSaved(false); setDraft({ categories: { ...preferences.categories, [category]: event.target.checked } }); }} />
            <span>{CATEGORY_LABELS[category]}</span>
          </label>)}
        </fieldset> : null}
        <button type="button" className="secondary-button" disabled={!dirty || busy} onClick={async () => { if (draft && await state.savePreferences(draft)) { setDraft(null); setSaved(true); } }}>Save preferences</button>
        {saved && !dirty ? <p role="status" className="muted small">Preferences saved and confirmed.</p> : null}
      </section>
    </> : null}
  </div>;
}
