import { describe, expect, it } from 'vitest';

import { CommandBootstrapSchema, SessionSummarySchema } from './contracts';

const validBootstrap = {
  identity: {
    email: 'operator@example.com',
    provider: 'cloudflare-access',
  },
  command: {
    version: '0.1.0',
    environment: 'production',
    generatedAt: '2026-09-03T14:00:00.000Z',
  },
  hermes: {
    state: 'online',
    version: '0.21.0',
    model: 'gpt-5.6-sol',
    provider: 'OpenAI Codex',
    gatewayState: 'idle',
    activeAgents: 0,
    capabilities: ['run_events_sse', 'session_resources'],
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
      model: 'gpt-5.6-sol',
      lastActive: '2026-09-03T13:59:00.000Z',
      preview: 'Build the first command room.',
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

  it('bounds previews and counters', () => {
    const candidate = {
      ...validBootstrap.sessions[0],
      preview: 'x'.repeat(501),
      messageCount: 1.2,
    };

    expect(() => SessionSummarySchema.parse(candidate)).toThrow();
  });
});
