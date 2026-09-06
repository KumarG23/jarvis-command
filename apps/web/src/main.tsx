import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';

// An older controlling worker can still hand us the shell on an edge callback.
// Inspect only the pathname; discard (never copy/replay) query, fragment, state.
const interruptedAccess = /^\/cdn-cgi(?:\/|$)/.test(window.location.pathname);
if (interruptedAccess) window.history.replaceState(null, '', '/');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App interruptedAccess={interruptedAccess} />
  </React.StrictMode>,
);
