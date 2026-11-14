/* global indexedDB, self, URL */
/* Private-safe Web Push handlers; imported by the generated precache-only worker.
   No authenticated fetch, runtime API cache, arbitrary URL or action handling. */
(() => {
  const validId = id => typeof id === 'string' && /^ntf_[a-f0-9]{32}$/.test(id);
  // Version 2 (reply alerts only) carries a server-sanitized, bounded one-line title/body.
  // eslint-disable-next-line no-control-regex
  const validText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
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
        if (!event.data || event.data.text().length > 1024) return;
        const payload = event.data.json();
        const keys = Object.keys(payload).sort().join(',');
        // A test push (owner pressed "Send test notification") carries `test: true` and is not an inbox item.
        const test = payload.version === 2 && keys === 'body,id,test,title,version' && payload.test === true;
        const reply = payload.version === 2 && (keys === 'body,id,title,version' || test) && validText(payload.title, 80) && validText(payload.body, 160);
        if (!validId(payload.id) || !(reply || (payload.version === 1 && keys === 'id,version'))) return;
        if (!await claim(payload.id)) return;
        await self.registration.showNotification(reply ? payload.title : 'Jarvis Command', {
          body: reply ? payload.body : 'An update is available. Sign in to Command to review it.',
          icon: '/pwa-192.png', tag: payload.id, renotify: false,
          data: test ? { id: payload.id, test: true } : { id: payload.id },
        });
      } catch { /* no speculative display or retry on unavailable storage/malformed payload */ }
    })());
  });
  self.addEventListener('notificationclick', event => {
    event.notification.close();
    const id = event.notification.data?.id;
    if (!validId(id) || event.action) return;
    event.waitUntil((async () => {
      const test = event.notification.data?.test === true;
      const destination = new URL('/', self.location.origin);
      if (!test) destination.searchParams.set('notification', id);
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
      const existing = windows.find(client => {
        const url = new URL(client.url);
        return url.origin === destination.origin && url.pathname === '/';
      });
      if (existing) {
        // Preserve the existing page's drafts, unsaved edits and active run.
        if (!test) existing.postMessage({ type: 'command-notification', id });
        await existing.focus();
      } else await self.clients.openWindow(destination.href);
    })());
  });
})();
