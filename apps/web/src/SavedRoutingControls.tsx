import type { InferenceOverride, RoutingDefaultResponse } from '@jarvis-command/contracts';
import type { useSavedRouting } from './savedRouting';
import { requestedEffortLabel } from './inferencePreference';
export function SavedRoutingControls({ saved, selection, disabled }: { saved: ReturnType<typeof useSavedRouting>; selection: InferenceOverride | null; disabled: boolean }) {
  const label = (value: RoutingDefaultResponse | null) => value ? value.selection ? `${value.selection.model} · ${requestedEffortLabel(value.selection)} (revision ${value.revision})` : `Not set (revision ${value.revision})` : 'Not read';
  return <fieldset className="saved-routing-controls"><legend>Saved requested defaults</legend>
    <p>Thread: {label(saved.thread)}</p><p>Project: {saved.project ? label(saved.project) : 'No verified project readback'}</p>
    {!saved.available ? <p role="status">{saved.busy ? 'Reading saved defaults…' : saved.error || 'Saved-default changes and new saved-default sends are unavailable on this server. Existing prompt selection and legacy sends still work.'}</p> : <p>Saved choices are requested configuration. Command resolves them for a new run; only that run’s receipt can verify execution.</p>}
    <button type="button" className="secondary-button" disabled={disabled || saved.busy || !saved.supported} onClick={() => void saved.refresh()}>Refresh saved defaults</button>
    <label><input type="checkbox" checked={saved.opted} disabled={disabled || (!saved.available && !saved.opted)} onChange={event => saved.opt(event.target.checked)} />Use saved defaults for the next message</label>
    <p>Prompt override → thread → project → Command. This does not save or migrate this browser’s prompt choice.</p>
    {(['thread', 'project'] as const).map(scope => <div key={scope}>
      <button type="button" className="secondary-button" disabled={disabled || !saved.available || !selection || (scope === 'project' && !saved.project)} onClick={() => void saved.save(scope, selection)}>Save prompt choice for {scope}</button>
      <button type="button" className="text-button" disabled={disabled || !saved.available || !saved[scope]?.selection} onClick={() => void saved.save(scope, null)}>Clear {scope} default</button>
    </div>)}
  </fieldset>;
}
