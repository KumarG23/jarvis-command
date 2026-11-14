import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';

// An older controlling worker can still hand us the shell on an edge callback.
// Inspect only the pathname; discard (never copy/replay) query, fragment, state.
const interruptedAccess = /^\/cdn-cgi(?:\/|$)/.test(window.location.pathname);
if (interruptedAccess) window.history.replaceState(null, '', '/');

// After a deploy, the cached shell runs once more while the new worker installs; the new worker
// then takes control (autoUpdate: skipWaiting + clientsClaim). Reload once onto the new build so an
// old bundle never talks to a newer server. A first install (no controller yet) never reloads.
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App interruptedAccess={interruptedAccess} />
  </React.StrictMode>,
);
