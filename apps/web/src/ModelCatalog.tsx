import type { InferenceOption, ModelCatalog, ModelCatalogEntry } from '@jarvis-command/contracts';
import { useMemo, useState } from 'react';

// Rendering is bounded even when a contract-valid catalog is large. The server also
// bounds and flags its own read, so both limits stay visible rather than implied.
const MAX_VISIBLE_ENTRIES = 200;

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-api': 'OpenAI API',
  'openai-codex': 'OpenAI',
  openrouter: 'OpenRouter',
  'xai-oauth': 'xAI',
};

const CATALOG_PROVIDER_LABELS: Record<string, string> = {
  ...PROVIDER_LABELS,
  openai: 'OpenAI API',
  'openai-codex': 'OpenAI Codex',
};

export function providerLabel(provider: string | null): string {
  if (provider === null) return 'provider unknown';
  return PROVIDER_LABELS[provider] ?? provider;
}

function catalogProviderLabel(provider: string): string {
  return CATALOG_PROVIDER_LABELS[provider] ?? provider;
}

function reasonLabel(entry: ModelCatalogEntry): string {
  switch (entry.unavailableReason) {
    case 'not_advertised': return 'Not advertised by Hermes';
    case 'provider_unauthenticated': return 'Provider not authenticated';
    case 'not_approved_allowlist': return 'Not on the approved Command list';
    // Fail closed: a catalog claim alone never grants selection.
    default: return 'Not selectable in Command';
  }
}

export function ModelCatalogView({ catalog, options, disabled, onSelect }: Readonly<{
  catalog: ModelCatalog;
  options: readonly InferenceOption[];
  disabled: boolean;
  onSelect: (value: string) => void;
}>) {
  const [query, setQuery] = useState('');
  const optionKeys = useMemo(() => new Set(options.map(option => `${option.provider}:${option.model}`)), [options]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return catalog.entries;
    return catalog.entries.filter(entry =>
      entry.model.toLocaleLowerCase().includes(needle)
      || entry.provider.toLocaleLowerCase().includes(needle)
      || catalogProviderLabel(entry.provider).toLocaleLowerCase().includes(needle));
  }, [catalog.entries, query]);
  const visible = matches.slice(0, MAX_VISIBLE_ENTRIES);
  const groups = useMemo(() => {
    const grouped = new Map<string, ModelCatalogEntry[]>();
    for (const entry of visible) {
      const entries = grouped.get(entry.provider);
      if (entries) entries.push(entry);
      else grouped.set(entry.provider, [entry]);
    }
    return [...grouped.entries()]
      .map(([provider, entries]) => ({ provider, entries, available: entries.some(entry => optionKeys.has(`${entry.provider}:${entry.model}`)) }))
      .sort((a, b) => Number(b.available) - Number(a.available) || catalogProviderLabel(a.provider).localeCompare(catalogProviderLabel(b.provider)) || a.provider.localeCompare(b.provider));
  }, [visible, optionKeys]);
  return <section className="model-catalog" aria-label="Advertised model catalog">
    <div className="catalog-heading">
      <h4>Advertised by Hermes</h4>
      <span>{catalog.returned.toLocaleString('en-US')} catalog {catalog.returned === 1 ? 'entry' : 'entries'} · {catalog.advertisedCount.toLocaleString('en-US')} advertised{catalog.truncated ? ' · inventory truncated' : ''}</span>
    </div>
    <p className="catalog-note">This is the bounded inventory Hermes advertises now, not every model a provider offers. Advertisement and authentication do not approve a route: only entries marked Available can be requested, and the server revalidates each send.</p>
    <label className="catalog-search">Search advertised models
      <input type="search" value={query} placeholder="Model or provider" onChange={(event) => setQuery(event.target.value)} />
    </label>
    {matches.length === 0 ? <p role="status">{catalog.entries.length === 0 ? 'Hermes advertised no models in this read.' : `No advertised models match “${query.trim()}”.`}</p> : <>
      {matches.length > visible.length ? <p role="status">Showing first {visible.length} of {matches.length} matching entries. Refine the search to narrow the catalog.</p> : null}
      <div className="catalog-groups">
        {groups.map(group => <section key={group.provider} className="catalog-provider" aria-label={`${catalogProviderLabel(group.provider)} advertised models`}>
          <h5>{catalogProviderLabel(group.provider)} <span>{group.entries.length}</span></h5>
          <ul>
            {group.entries.map(entry => {
              const key = `${entry.provider}:${entry.model}`;
              const available = optionKeys.has(key);
              return <li key={key} className={available ? 'available' : undefined}>
                <div className="catalog-entry-facts">
                  <code>{entry.model}</code>
                  {available
                    ? <span className="catalog-available">Available in Command</span>
                    : <span className="catalog-reason">{reasonLabel(entry)}</span>}
                </div>
                {available ? <button className="secondary-button catalog-use" type="button" disabled={disabled} onClick={() => onSelect(key)} aria-label={`Use ${catalogProviderLabel(entry.provider)} ${entry.model}`}>Use</button> : null}
              </li>;
            })}
          </ul>
          {group.provider === 'openrouter' ? <p className="catalog-note">OpenRouter entries are discovery only. Ids without <code>:free</code> are not eligible, and every OpenRouter route still needs explicit Command approval.</p> : null}
        </section>)}
      </div>
    </>}
  </section>;
}
