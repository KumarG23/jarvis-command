import { describe, expect, it } from 'vitest';

import {
  CommandBootstrapSchema,
  InferenceOptionsResponseSchema,
  isOpenRouterFreeModelId,
  LiveRunSubmissionRequestSchema,
  MAX_INFERENCE_OPTIONS,
  MODEL_CATALOG_MAX_ENTRIES,
  ModelCatalogSchema,
  SessionSummarySchema,
} from './contracts';
import { ProjectRoomSchema } from './project-rooms';

it('allows a validated external Hermes session to belong to a project', () => {
  const externalId = 'discord:channel+message';
  expect(ProjectRoomSchema.parse({
    id: 'room_' + 'a'.repeat(32), name: 'External work', goal: 'Keep context together',
    repository: '', notes: [], sessionIds: [externalId], lastSessionId: externalId,
  }).sessionIds).toEqual([externalId]);
});

const validBootstrap = {
  identity: {
    provider: 'cloudflare-access',
  },
  command: {
    version: '0.2.0',
    environment: 'production',
    generatedAt: '2026-09-03T14:00:00.000Z',
    liveRoom: {
      enabled: true,
      externalContinue: false,
      maxInputCharacters: 16_000,
      maxSteerCharacters: 4_000,
    },

  },
  hermes: {
    state: 'online',
    version: '0.21.0',
    model: 'gpt-5.6-sol',
    provider: 'OpenAI Codex',
    gatewayState: 'idle',
    activeAgents: 0,
    capabilities: ['run_events_sse', 'session_resources', 'artifact_studio'],
    readinessChecks: {
      config: 'pass',
      disk: 'pass',
      sessionDb: 'pass',
    },
  },
  sessions: [
    {
      id: 'session_123',
      title: 'Jarvis Command',
      source: 'discord',
      ownership: 'external',
      model: 'gpt-5.6-sol',
      lastActive: '2026-09-03T13:59:00.000Z',
      messageCount: 12,
      toolCallCount: 4,
      pinned: true,
    },
  ],
};

describe('CommandBootstrapSchema', () => {
  it('accepts the bounded client-safe bootstrap contract', () => {
    expect(CommandBootstrapSchema.parse(validBootstrap)).toEqual(validBootstrap);
  });

  it('rejects negative operational counts', () => {
    const candidate = structuredClone(validBootstrap);
    candidate.hermes.activeAgents = -1;

    expect(() => CommandBootstrapSchema.parse(candidate)).toThrow();
  });

  it('rejects unknown fields that could leak upstream data', () => {
    const candidate = structuredClone(validBootstrap) as typeof validBootstrap & {
      apiKey?: string;
    };
    candidate.apiKey = 'must-never-cross-the-wire';

    expect(() => CommandBootstrapSchema.parse(candidate)).toThrow();
  });

  it('accepts an explicit development identity only in the shared wire shape', () => {
    const candidate = structuredClone(validBootstrap);
    candidate.identity.provider = 'development';

    expect(CommandBootstrapSchema.parse(candidate).identity.provider).toBe('development');
  });

  it('rejects identity email addresses at the browser contract boundary', () => {
    const candidate = {
      ...structuredClone(validBootstrap),
      identity: {
        ...validBootstrap.identity,
        email: 'operator@example.com',
      },
    };

    expect(() => CommandBootstrapSchema.parse(candidate)).toThrow();
  });

  it('rejects malformed timestamps', () => {
    const candidate = structuredClone(validBootstrap);
    candidate.command.generatedAt = 'yesterday-ish';

    expect(() => CommandBootstrapSchema.parse(candidate)).toThrow();
  });
});

describe('SessionSummarySchema', () => {
  it('rejects system prompts and model configuration', () => {
    const candidate = {
      ...validBootstrap.sessions[0],
      systemPrompt: 'hidden prompt',
      modelConfig: { apiKey: 'hidden' },
    };

    expect(() => SessionSummarySchema.parse(candidate)).toThrow();
  });

  it('rejects session message previews at the public contract boundary', () => {
    const candidate = {
      ...validBootstrap.sessions[0],
      preview: 'message content must not cross the first-slice boundary',
    };

    expect(() => SessionSummarySchema.parse(candidate)).toThrow();
  });

  it('requires integral operational counters', () => {
    const candidate = {
      ...validBootstrap.sessions[0],
      messageCount: 1.2,
    };

    expect(() => SessionSummarySchema.parse(candidate)).toThrow();
  });
});

describe('per-prompt inference contracts', () => {
  const request = {
    sessionId: 'jc_1234567890abcdef1234567890abcdef',
    input: 'Use the inexpensive lane for this turn.',
    clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e',
  };

  it('accepts only curated provider/model pairs and bounded reasoning levels', () => {
    expect(LiveRunSubmissionRequestSchema.parse({
      ...request,
      inference: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'low' },
    }).inference?.model).toBe('gpt-6-luna');
    expect(LiveRunSubmissionRequestSchema.parse({
      ...request,
      inference: { provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'high' },
    }).inference?.model).toBe('gpt-6-sol');
    expect(LiveRunSubmissionRequestSchema.parse({
      ...request,
      inference: { provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
    }).inference?.model).toBe('gpt-5.6-luna');
    expect(LiveRunSubmissionRequestSchema.parse({
      ...request,
      inference: { provider: 'xai-oauth', model: 'grok-4.6', reasoningEffort: 'high' },
    }).inference?.model).toBe('grok-4.6');
    expect(LiveRunSubmissionRequestSchema.parse({
      ...request,
      inference: { provider: 'xai-oauth', model: 'grok-4.7', reasoningEffort: 'xhigh' },
    }).inference?.model).toBe('grok-4.7');

    // Model ids are shape-checked only; which provider/model pairs are real is decided by
    // the command proxy against the authenticated provider's live inventory.
    expect(LiveRunSubmissionRequestSchema.parse({ ...request, inference: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high' } }).inference?.model).toBe('gpt-6.1-sol');
    for (const inference of [
      { provider: 'openai-codex', model: 'GPT-6-SOL', reasoningEffort: 'high' },
      { provider: 'openai-codex', model: 'gpt 6', reasoningEffort: 'high' },
      { provider: 'openai-codex', model: '../gpt', reasoningEffort: 'high' },
      { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
      { provider: 'openai-api', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    ]) expect(() => LiveRunSubmissionRequestSchema.parse({ ...request, inference })).toThrow();
  });

  it('accepts well-formed Claude routes with provider-default effort only', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
      expect(LiveRunSubmissionRequestSchema.parse({
        ...request,
        inference: { provider: 'anthropic', model },
      }).inference).toEqual({ provider: 'anthropic', model });
    }
    for (const inference of [
      { provider: 'anthropic', model: 'claude-opus-5-5', reasoningEffort: 'high' },
      { provider: 'anthropic', model: 'gpt-6-sol' },
      { provider: 'anthropic', model: 'Claude-Opus' },
      { provider: 'openai-codex', model: 'claude-opus-5-5' },
    ]) expect(() => LiveRunSubmissionRequestSchema.parse({ ...request, inference })).toThrow();
  });

  it('accepts only the exact lowercase OpenRouter :free suffix with provider-default effort', () => {
    for (const model of ['z-ai/glm-4.5-air:free', 'thinkingmachines/inkling:free', 'a:free']) {
      expect(isOpenRouterFreeModelId(model)).toBe(true);
      expect(LiveRunSubmissionRequestSchema.parse({
        ...request,
        inference: { provider: 'openrouter', model },
      }).inference).toEqual({ provider: 'openrouter', model });
    }
    for (const model of [
      'z-ai/glm-4.5-air', 'z-ai/glm-4.5-air:free-paid', 'vendor/model:paid:free', 'x:free:y',
      'vendor/model:FREE', 'vendor/model:Free', 'Vendor/model:free', 'vendor//model:free',
      'vendor/model/:free', ':free', 'vendor/model:free ', `vendor/${'a'.repeat(154)}:free`,
    ]) {
      expect(isOpenRouterFreeModelId(model)).toBe(false);
      expect(() => LiveRunSubmissionRequestSchema.parse({
        ...request,
        inference: { provider: 'openrouter', model },
      })).toThrow();
    }
    expect(() => LiveRunSubmissionRequestSchema.parse({
      ...request,
      inference: { provider: 'openrouter', model: 'z-ai/glm-4.5-air:free', reasoningEffort: 'low' },
    })).toThrow();
    expect(() => LiveRunSubmissionRequestSchema.parse({
      ...request,
      inference: { provider: 'openai-codex', model: 'z-ai/glm-4.5-air:free', reasoningEffort: 'low' },
    })).toThrow();
  });

  it('accepts bounded provider-default OpenRouter options and rejects invented effort', () => {
    const option = {
      provider: 'openrouter', model: 'z-ai/glm-4.5-air:free',
      label: 'Free · z-ai/glm-4.5-air:free', reasoningEfforts: [],
    };
    const payload = { default: { provider: 'openai-codex', model: 'gpt-5.6-sol' }, options: [option] };
    expect(InferenceOptionsResponseSchema.parse(payload)).toEqual(payload);
    expect(() => InferenceOptionsResponseSchema.parse({
      ...payload,
      options: [{ ...option, reasoningEfforts: ['low'] }],
    })).toThrow();
    expect(() => InferenceOptionsResponseSchema.parse({
      ...payload,
      options: [{ ...option, model: 'z-ai/glm-4.5-air' }],
    })).toThrow();
    expect(() => InferenceOptionsResponseSchema.parse({
      ...payload,
      options: Array.from({ length: MAX_INFERENCE_OPTIONS + 1 }, () => option),
    })).toThrow();
    expect(InferenceOptionsResponseSchema.parse({
      ...payload,
      options: Array.from({ length: MAX_INFERENCE_OPTIONS }, () => option),
    }).options).toHaveLength(MAX_INFERENCE_OPTIONS);
    const maxModel = `vendor/${'a'.repeat(148)}:free`;
    expect(maxModel).toHaveLength(160);
    expect(InferenceOptionsResponseSchema.parse({
      ...payload,
      options: [{ ...option, model: maxModel, label: `Free · ${maxModel}` }],
    }).options[0]?.model).toBe(maxModel);
  });

  it('projects a strict inventory without provider metadata', () => {
    const payload = {
      default: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      options: [{
        provider: 'openai-codex', model: 'gpt-5.6-sol', label: 'Sol',
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      }],
    };
    expect(InferenceOptionsResponseSchema.parse(payload)).toEqual(payload);
    expect(() => InferenceOptionsResponseSchema.parse({ ...payload, apiKey: 'nope' })).toThrow();
  });

  it('accepts provider-default Claude options but not invented effort values', () => {
    const payload = {
      default: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      options: [{
        provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5',
        reasoningEfforts: [],
      }],
    };
    expect(InferenceOptionsResponseSchema.parse(payload)).toEqual(payload);
    expect(() => InferenceOptionsResponseSchema.parse({
      ...payload,
      options: [{ ...payload.options[0], reasoningEfforts: ['medium'] }],
    })).toThrow();
    expect(() => InferenceOptionsResponseSchema.parse({
      ...payload,
      options: [{ provider: 'openai-codex', model: 'gpt-6-sol', label: 'Sol', reasoningEfforts: [] }],
    })).toThrow();
    expect(() => InferenceOptionsResponseSchema.parse({
      ...payload,
      options: Array.from({ length: MAX_INFERENCE_OPTIONS + 1 }, () => payload.options[0]),
    })).toThrow();
  });

  it('keeps an empty selection honest and catalog metadata strictly allowlisted', () => {
    const entry = {
      provider: 'openrouter',
      model: 'private-model:free',
      advertised: true,
      authenticated: true,
      eligible: false,
      selectable: false,
      unavailableReason: 'not_approved_allowlist',
    };
    const payload = {
      default: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      options: [],
      catalog: { entries: [entry], advertisedCount: 1, returned: 1, truncated: false },
    };
    expect(InferenceOptionsResponseSchema.parse(payload)).toEqual(payload);
    expect(ModelCatalogSchema.parse(payload.catalog)).toEqual(payload.catalog);
    expect(() => InferenceOptionsResponseSchema.parse({
      ...payload,
      catalog: { ...payload.catalog, entries: [{ ...entry, apiKey: 'secret' }] },
    })).toThrow();
    expect(() => InferenceOptionsResponseSchema.parse({
      ...payload,
      catalog: { ...payload.catalog, warning: 'private' },
    })).toThrow();
    expect(() => ModelCatalogSchema.parse({
      ...payload.catalog,
      entries: Array.from({ length: MODEL_CATALOG_MAX_ENTRIES + 1 }, () => entry),
    })).toThrow();
    expect(() => ModelCatalogSchema.parse({
      ...payload.catalog,
      entries: [{ ...entry, unavailableReason: 'provider_guessed' }],
    })).toThrow();
  });
});

describe('cockpit terminal reports', () => {
  it('recognizes terminal query replies but never keystrokes', async () => {
    const { isTerminalReport, CockpitTerminalClientFrameSchema } = await import('./cockpit');
    for (const reply of ['\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b]11;rgb:0d0d/1010/0f0f\x07', '\x1b]10;rgb:f1f1/eeee/e7e7\x1b\\', '\x1b[12;40R', '\x1b[I']) expect(isTerminalReport(reply)).toBe(true);
    for (const key of ['ls\r', '\x1b', '\x1b[A', '\x03', 'rm -rf /\r', '\x1b[?1;2cls\r']) expect(isTerminalReport(key)).toBe(false);
    expect(CockpitTerminalClientFrameSchema.safeParse({ type: 'report', data: 'echo pwned\r' }).success).toBe(false);
  });
});
