import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModelCatalog, ModelCatalogEntry } from '@jarvis-command/contracts';
import { ModelCatalogView } from './ModelCatalog';
import { TurnComposer } from './TurnView';

const sol = { provider: 'openai-codex' as const, model: 'gpt-6-sol' as const, label: 'Sol', reasoningEfforts: ['medium', 'xhigh'] as const };
const entry = (provider: string, model: string, overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry => ({
  provider, model, advertised: true, authenticated: true, eligible: false, selectable: false,
  unavailableReason: 'not_approved_allowlist', ...overrides,
});
const inventory = (entries: ModelCatalogEntry[], options: readonly (typeof sol)[] = []) => ({
  default: { provider: 'openai-codex', model: 'gpt-6-sol' },
  options,
  catalog: { entries, advertisedCount: entries.filter(item => item.advertised).length, returned: entries.length, truncated: false },
});
const props = () => ({ allowed: true, imageAttachmentsEnabled: false, sessionId: 'jc_catalog', projectId: null, max: 100, maxSteer: 100, turn: null, send: vi.fn<Parameters<typeof TurnComposer>[0]['send']>(() => false), retry: vi.fn(), resume: vi.fn(), steer: vi.fn(), recoveries: [], consumeRecovery: vi.fn() });
const model = () => screen.getByRole('combobox', { name: 'Model for this prompt' });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('groups the observed catalog by provider, explains each unavailable reason, and refuses catalog-only selection', async () => {
  const entries = [
    entry('openai-codex', 'gpt-6-sol', { eligible: true, selectable: true, unavailableReason: null }),
    entry('anthropic', 'claude-haiku-4-5-20251001'),
    entry('openai-api', 'gpt-5.5'),
    entry('openrouter', 'thinkingmachines/inkling:free'),
    entry('openrouter', 'vendor/paid-model'),
    entry('xai-oauth', 'grok-4.7', { advertised: false, eligible: true, unavailableReason: 'not_advertised' }),
    entry('unauthenticated-provider', 'mystery-model', { authenticated: false, unavailableReason: 'provider_unauthenticated' }),
    // Hostile/inconsistent catalog claim: not executable, so it must stay inert.
    entry('rogue-provider', 'claimed-selectable', { eligible: true, selectable: true, unavailableReason: null }),
  ];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(inventory(entries, [sol]))));
  render(<TurnComposer {...props()} />);
  const catalog = await screen.findByRole('region', { name: 'Advertised model catalog' });
  expect(within(catalog).getByRole('region', { name: 'OpenAI Codex advertised models' })).toBeInTheDocument();
  expect(within(catalog).getByRole('region', { name: 'Anthropic advertised models' })).toHaveTextContent('claude-haiku-4-5-20251001');
  expect(within(catalog).getByRole('region', { name: 'OpenAI API advertised models' })).toHaveTextContent('gpt-5.5');
  expect(within(catalog).getByRole('region', { name: 'OpenRouter advertised models' })).toHaveTextContent('thinkingmachines/inkling:free');
  expect(within(catalog).getAllByText('Not on the approved Command list').length).toBeGreaterThan(0);
  expect(within(catalog).getByText('Not advertised by Hermes')).toBeInTheDocument();
  expect(within(catalog).getByText('Provider not authenticated')).toBeInTheDocument();
  expect(within(catalog).getByText('Not selectable in Command')).toBeInTheDocument();
  expect(within(catalog).getByText(/OpenRouter entries are discovery only/)).toBeInTheDocument();
  expect(within(catalog).getAllByRole('button', { name: /^Use / })).toHaveLength(1);
  fireEvent.click(within(catalog).getByRole('button', { name: 'Use OpenAI Codex gpt-6-sol' }));
  await waitFor(() => expect(model()).toHaveValue('openai-codex:gpt-6-sol'));
});

it('names and searches the actual advertised OpenAI API provider slug', async () => {
  const entries = [entry('anthropic', 'claude-haiku-5-5'), entry('openai-api', 'gpt-5.5'), entry('openrouter', 'vendor/model:free')];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(inventory(entries))));
  render(<TurnComposer {...props()} />);
  const catalog = await screen.findByRole('region', { name: 'Advertised model catalog' });
  const search = within(catalog).getByRole('searchbox', { name: 'Search advertised models' });
  fireEvent.change(search, { target: { value: 'HAIKU' } });
  expect(within(catalog).getByRole('region', { name: 'Anthropic advertised models' })).toHaveTextContent('claude-haiku-5-5');
  expect(within(catalog).queryByRole('region', { name: 'OpenAI API advertised models' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'openai api' } });
  expect(within(catalog).getByRole('region', { name: 'OpenAI API advertised models' })).toHaveTextContent('gpt-5.5');
  expect(within(catalog).queryByRole('region', { name: 'Anthropic advertised models' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'nothing-here' } });
  expect(within(catalog).getByRole('status')).toHaveTextContent('No advertised models match “nothing-here”.');
});

it('renders a contract-valid large catalog with both server and UI bounds stated', () => {
  const entries = Array.from({ length: 210 }, (_, index) => entry('openai-api', `model-${String(index).padStart(3, '0')}`));
  const catalog: ModelCatalog = { entries, advertisedCount: 5_000, returned: 210, truncated: true };
  render(<ModelCatalogView catalog={catalog} options={[]} disabled={false} onSelect={vi.fn()} />);
  expect(screen.getByText('210 catalog entries · 5,000 advertised · inventory truncated')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Showing first 200 of 210 matching entries.');
  expect(screen.getAllByRole('listitem')).toHaveLength(200);
});

it('preserves the existing picker when an older response has no catalog and when nothing is selectable', async () => {
  const fetch = vi.fn(async () => Response.json({ default: { provider: 'openai-codex', model: 'gpt-6-sol' }, options: [sol] }));
  vi.stubGlobal('fetch', fetch);
  const view = render(<TurnComposer {...props()} />);
  await waitFor(() => expect(model()).toBeEnabled());
  expect(screen.queryByRole('region', { name: 'Advertised model catalog' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Sol' })).toBeInTheDocument();

  view.unmount();
  fetch.mockResolvedValueOnce(Response.json(inventory([entry('anthropic', 'claude-haiku-5-5')], [])));
  render(<TurnComposer {...props()} sessionId="jc_catalog_empty" />);
  const catalog = await screen.findByRole('region', { name: 'Advertised model catalog' });
  expect(within(catalog).queryByRole('button', { name: /^Use / })).not.toBeInTheDocument();
  expect(model()).toHaveValue('inherit');
});

it('keeps the saved selection and draft when a catalog refresh fails before send', async () => {
  const fetch = vi.fn(async () => Response.json(inventory([
    entry('openai-codex', 'gpt-6-sol', { eligible: true, selectable: true, unavailableReason: null }),
    entry('anthropic', 'claude-haiku-5-5'),
  ], [sol])));
  vi.stubGlobal('fetch', fetch);
  const p = props();
  render(<TurnComposer {...p} />);
  const catalog = await screen.findByRole('region', { name: 'Advertised model catalog' });
  fireEvent.click(within(catalog).getByRole('button', { name: 'Use OpenAI Codex gpt-6-sol' }));
  const draft = screen.getByRole('textbox', { name: 'Message Jarvis' });
  fireEvent.change(draft, { target: { value: 'Keep this draft' } });
  fetch.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Model choices unavailable. Retry choices before sending this request, or explicitly choose Inherit.');
  expect(p.send).not.toHaveBeenCalled();
  expect(draft).toHaveValue('Keep this draft');
  expect(model()).toHaveValue('openai-codex:gpt-6-sol');
});
