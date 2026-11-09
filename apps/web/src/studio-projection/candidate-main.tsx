// Isolated, SYNTHETIC candidate harness for the P14 consumer. Served only by the Vite dev server (it is not a build input,
// not imported by the app shell and has no network source). ?fixture= picks the scenario the view is shown.
import React from 'react';
import ReactDOM from 'react-dom/client';

import '../styles.css';
import golden from './fixtures/golden.projection.json?raw';
import { StudioProjectionView } from './StudioProjectionView';
import { fixtureSource } from './studioProjectionSource';
import type { ProjectionReadResult } from './studioProjectionSource';

const scenario = new URLSearchParams(window.location.search).get('fixture') ?? 'healthy';
const label = `SYNTHETIC candidate fixture “${scenario}” (not Studio data)`;
const doc = () => JSON.parse(golden);
const responders: Record<string, () => Promise<ProjectionReadResult> | ProjectionReadResult> = {
  healthy: () => ({ status: 200, body: golden }),
  malformed: () => ({ status: 200, body: JSON.stringify({ ...doc(), surprise: true }) }),
  version: () => ({ status: 200, body: JSON.stringify({ ...doc(), version: 2 }) }),
  unreachable: () => Promise.reject(new Error('fixture unreachable')),
  loading: () => new Promise<ProjectionReadResult>(() => undefined),
  lastknown: (() => { let calls = 0; return () => (++calls === 1 ? { status: 200, body: golden } : Promise.reject(new Error('fixture unreachable'))); })(),
};
const respond = responders[scenario];
const source = scenario === 'disabled' || !respond ? null : fixtureSource(label, respond);
// ?age=<seconds> pins the viewer clock that many seconds after the golden document's observed_at (deterministic captures).
const age = Number(new URLSearchParams(window.location.search).get('age'));
const now = Number.isFinite(age) && age !== 0 ? () => Date.parse('2026-11-09T15:00:00Z') + age * 1000 : undefined;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <p style={{ margin: 0, padding: '6px 12px', background: '#e6ba66', color: '#111', fontSize: 12 }}>SYNTHETIC CANDIDATE HARNESS — fixture data only; no Studio, GitHub or network read.</p>
      <div style={{ flex: 1, minHeight: 0 }}><StudioProjectionView source={source} active {...(now ? { now } : {})} /></div>
    </div>
  </React.StrictMode>,
);
