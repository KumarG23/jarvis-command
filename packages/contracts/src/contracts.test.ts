import { describe, expect, it } from 'vitest';

import {
  CommandBootstrapSchema,
  InferenceOptionsResponseSchema,
  LiveRunSubmissionRequestSchema,
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

    for (const inference of [
      { provider: 'xai-oauth', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      { provider: 'openai-codex', model: 'grok-4.6', reasoningEffort: 'high' },
      { provider: 'openai-codex', model: 'private-model', reasoningEffort: 'high' },
      { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'ultra' },
    ]) expect(() => LiveRunSubmissionRequestSchema.parse({ ...request, inference })).toThrow();
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
});
