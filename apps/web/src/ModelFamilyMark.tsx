import type { LiveRunUsage, SessionMessage } from '@jarvis-command/contracts';
import type { Turn } from './useLiveTurn';
import { matchTurn } from './timeline';

type Execution = LiveRunUsage['execution'];
const families = {
  openai: { label: 'OpenAI', glyph: 'OA' },
  claude: { label: 'Claude', glyph: 'CL' },
  gemini: { label: 'Gemini', glyph: 'GE' },
  grok: { label: 'Grok', glyph: 'GR' },
  unknown: { label: 'Model family unknown', glyph: '?' },
} as const;

// Explicit executed provider/model pairs only. Aggregators need a qualified vendor
// and a matching family; requested route, session.model and prose are never inputs.
export function modelFamily(execution: Execution): keyof typeof families {
  const provider = execution?.executed?.provider, model = execution?.executed?.model;
  if (typeof provider !== 'string' || typeof model !== 'string' || !provider || !model || provider.length > 120 || model.length > 160) return 'unknown';
  const mappings = [
    { family: 'openai', providers: ['openai', 'openai-codex'], vendor: 'openai', pattern: /^(?:gpt-[a-z0-9][a-z0-9.-]*|o[134](?:-[a-z0-9.-]+)?)$/ },
    { family: 'claude', providers: ['anthropic'], vendor: 'anthropic', pattern: /^claude-[a-z0-9][a-z0-9.-]*$/ },
    { family: 'gemini', providers: ['google', 'google-gemini'], vendor: 'google', pattern: /^gemini-[a-z0-9][a-z0-9.-]*$/ },
    { family: 'grok', providers: ['xai'], vendor: 'x-ai', pattern: /^grok-[a-z0-9][a-z0-9.-]*$/ },
  ] as const;
  for (const mapping of mappings) {
    const qualified = `${mapping.vendor}/`;
    const identifier = model.startsWith(qualified) ? model.slice(qualified.length) : model;
    if (mapping.pattern.test(identifier) && (mapping.providers.some(value => value === provider)
      || (provider === 'openrouter' && model.startsWith(qualified)))) return mapping.family;
  }
  return 'unknown';
}

export function verifiedTurnExecution(turn: Turn): Execution {
  return turn.identityVerified && !!turn.publicRunId && turn.events.every(event => event.publicRunId === turn.publicRunId)
    ? turn.usage?.execution : null;
}

export function boundMessageExecution(message: SessionMessage, turns: Turn[], messages: SessionMessage[], complete: boolean): Execution {
  if (message.role !== 'assistant') return null;
  // Baseline/text projection can suppress echoes, but is never model attribution.
  const bound = turns.filter(turn => turn.intent.sessionId === message.sessionId
    && turn.historyBinding?.assistantMessageId === message.id
    && matchTurn(turn, messages, complete).assistant?.id === message.id);
  // Two runs claiming one message are conflicting evidence, even if names agree.
  return bound.length === 1 ? verifiedTurnExecution(bound[0]!) : null;
}

export function ModelFamilyMark({ execution, variant = 'full' }: Readonly<{ execution: Execution; variant?: 'full' | 'icon' | 'label' }>) {
  const family = modelFamily(execution), { label, glyph } = families[family];
  const accessible = family === 'unknown' ? label : `${label} · executed model family`;
  return <span className={`model-family-mark model-family-${variant}`} data-family={family}
    {...(variant === 'icon' ? { role: 'img', 'aria-label': accessible } : {})}>
    {variant !== 'label' ? <span className="model-family-glyph" aria-hidden="true">{glyph}</span> : null}
    {variant !== 'icon' ? <span className="model-family-label">{accessible}</span> : null}
  </span>;
}
