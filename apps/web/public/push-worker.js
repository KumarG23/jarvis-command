/* global indexedDB, self, URL */
/* Private-safe Web Push handlers; imported by the generated precache-only worker.
   No authenticated fetch, runtime API cache, arbitrary URL or action handling. */
(() => {
  const validId = id => typeof id === 'string' && /^ntf_[a-f0-9]{32}$/.test(id);
  const claim = id => new Promise(resolve => {
    // Exact bounded receipts survive worker restarts. At capacity/storage failure do not display.
    const request = indexedDB.open('command-push-receipts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('ids');
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      let transaction;
      try { transaction = db.transaction('ids', 'readwrite'); }
      catch { db.close(); resolve(false); return; }
      const store = transaction.objectStore('ids');
      let claimed = false;
      transaction.oncomplete = () => { db.close(); resolve(claimed); };
      transaction.onabort = transaction.onerror = () => { db.close(); resolve(false); };
      const get = store.get(id);
      get.onsuccess = () => {
        if (get.result) return;
        const count = store.count();
        count.onsuccess = () => { if (count.result < 2048) { store.put(true, id); claimed = true; } };
      };
    };
  });
  self.addEventListener('push', event => {
    event.waitUntil((async () => {
      try {
        if (!event.data || event.data.text().length > 256) return;
        const payload = event.data.json();
        if (payload.version !== 1 || !validId(payload.id) || Object.keys(payload).sort().join(',') !== 'id,version') return;
        if (!await claim(payload.id)) return;
        await self.registration.showNotification('Jarvis Command', {
          body: 'An update is available. Sign in to Command to review it.',
          icon: '/pwa-192.png', tag: payload.id, renotify: false,
          data: { id: payload.id },
        });
      } catch { /* no speculative display or retry on unavailable storage/malformed payload */ }
    })());
  });
  self.addEventListener('notificationclick', event => {
    event.notification.close();
    const id = event.notification.data?.id;
    if (!validId(id) || event.action) return;
    event.waitUntil((async () => {
      const destination = new URL('/', self.location.origin);
      destination.searchParams.set('notification', id);
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
      const existing = windows.find(client => {
        const url = new URL(client.url);
        return url.origin === destination.origin && url.pathname === '/';
      });
      if (existing) {
        // Preserve the existing page's drafts, unsaved edits and active run.
        existing.postMessage({ type: 'command-notification', id });
        await existing.focus();
      } else await self.clients.openWindow(destination.href);
    })());
  });
})();
