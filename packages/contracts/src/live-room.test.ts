import { describe, expect, it } from 'vitest';

import {
  ApprovalChoiceSchema,
  LiveRunStatusSchema,
  LiveRunApprovalRequestSchema,
  LiveRunSubmissionRequestSchema,
  LiveRunSubmissionResponseSchema,
  RunEventSchema,
  SessionMessagesPageSchema,
  SessionMutationResponseSchema,
} from './contracts';

const session = {
  id: 'jc_1234567890abcdef1234567890abcdef',
  title: 'Live Room',
  source: 'jarvis-command',
  ownership: 'command',
  model: 'gpt-5.6-sol',
  lastActive: '2026-09-04T14:00:00.000Z',
  messageCount: 2,
  toolCallCount: 1,
  pinned: false,
};

describe('Live Room session contracts', () => {
  it('accepts optional exact persisted history IDs while rejecting malformed bindings', () => {
    const status = { publicRunId: 'jcr_' + 'a'.repeat(32), sessionId: session.id, status: 'completed', updatedAt: '2026-09-04T14:00:00Z', approval: null, output: 'answer', error: null, pendingSteer: null, usage: null };
    expect(LiveRunStatusSchema.safeParse(status).success).toBe(true);
    const historyBinding = { userMessageId: 'user:exact', assistantMessageId: 'assistant:exact' };
    expect(LiveRunStatusSchema.parse({ ...status, historyBinding }).historyBinding).toEqual(historyBinding);
    for (const binding of [null, {}, { ...historyBinding, userMessageId: ' padded' }, { ...historyBinding, assistantMessageId: 'x'.repeat(161) }, { ...historyBinding, upstreamRunId: 'private' }]) {
      expect(LiveRunStatusSchema.safeParse({ ...status, historyBinding: binding }).success).toBe(false);
    }
  });
  it('never normalizes message, tool or subagent identifiers in public contracts', () => {
    for (const id of [' padded', 'padded ', 'id\n', 'a b', 'é', 'x'.repeat(161)]) {
      const page = { sessionId: session.id, messages: [{ id, sessionId: session.id, role: 'assistant', content: '', timestamp: null, toolName: null, displayKind: null }], pagination: { limit: 1, offset: 0, returned: 1, hasMore: true } };
      expect(SessionMessagesPageSchema.safeParse(page).success, JSON.stringify(id)).toBe(false);
      for (const event of [
        { type: 'subagent.start', subagentId: id, goal: '', status: null },
        { type: 'subagent.complete', subagentId: id, summary: '', status: null },
        { type: 'tool.started', tool: id, preview: '' },
        { type: 'tool.completed', tool: id, durationSeconds: 0, error: false },
      ]) expect(RunEventSchema.safeParse({ publicRunId: 'jcr_' + 'a'.repeat(32), timestamp: '2026-09-04T14:00:00Z', ...event }).success, `${event.type}: ${JSON.stringify(id)}`).toBe(false);
    }
  });

  it('accepts a strict projected message page without reasoning or tool arguments', () => {
    const page = {
      sessionId: session.id,
      messages: [
        {
          id: '42',
          sessionId: session.id,
          role: 'assistant',
          content: 'All systems nominal.',
          timestamp: '2026-09-04T14:00:01.000Z',
          toolName: null,
          displayKind: 'message',
        },
      ],
      pagination: { limit: 50, offset: 0, returned: 1, hasMore: false },
    };

    expect(SessionMessagesPageSchema.parse(page)).toEqual(page);
  });

  it('rejects hidden reasoning and upstream tool arguments', () => {
    const page = {
      sessionId: session.id,
      messages: [{
        id: '42',
        sessionId: session.id,
        role: 'assistant',
        content: 'Safe output',
        timestamp: null,
        toolName: null,
        displayKind: 'message',
        reasoning: 'private chain of thought',
        toolCalls: [{ arguments: { token: 'secret' } }],
      }],
      pagination: { limit: 50, offset: 0, returned: 1, hasMore: false },
    };

    expect(() => SessionMessagesPageSchema.parse(page)).toThrow();
  });

  it('accepts a command-owned session mutation response', () => {
    expect(SessionMutationResponseSchema.parse({ session })).toEqual({ session });
  });
});

describe('Live Room run request and status contracts', () => {
  it('accepts a bounded UUID-keyed turn request', () => {
    const request = {
      sessionId: session.id,
      input: 'Inspect the service and report the real health result.',
      clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e',
    };

    expect(LiveRunSubmissionRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects blank and oversized turn input', () => {
    expect(() => LiveRunSubmissionRequestSchema.parse({
      sessionId: session.id,
      input: '   ',
      clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e',
    })).toThrow();
    expect(() => LiveRunSubmissionRequestSchema.parse({
      sessionId: session.id,
      input: 'x'.repeat(16_001),
      clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e',
    })).toThrow();
  });

  it('accepts only opaque public run identifiers', () => {
    const response = {
      publicRunId: 'jcr_1234567890abcdef1234567890abcdef',
      sessionId: session.id,
      status: 'running',
      replayed: false,
      clientRequestId: 'c17cb7d5-99cf-4a06-a24b-d5d5417e7a7e',
    };

    expect(LiveRunSubmissionResponseSchema.parse(response)).toEqual(response);
    expect(() => LiveRunSubmissionResponseSchema.parse({
      ...response,
      publicRunId: 'run_upstream-identifier',
    })).toThrow();
  });

  it('models waiting approvals and terminal pending steer without accepting extra fields', () => {
    const waiting = {
      publicRunId: 'jcr_1234567890abcdef1234567890abcdef',
      sessionId: session.id,
      status: 'waiting_for_approval',
      updatedAt: '2026-09-04T14:00:03.000Z',
      approval: {
        requestId: 'approval-1',
        command: 'rm [REDACTED]',
        description: 'Delete the disposable canary.',
        tool: 'terminal',
      },
      output: null,
      error: null,
      pendingSteer: null,
      usage: null,
    };
    const complete = {
      ...waiting,
      status: 'completed',
      approval: null,
      output: 'Done.',
      pendingSteer: 'Use the safer path next.',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    };

    expect(LiveRunStatusSchema.parse(waiting)).toEqual(waiting);
    expect(LiveRunStatusSchema.parse(complete)).toEqual(complete);
    expect(() => LiveRunStatusSchema.parse({ ...complete, hermesRunId: 'run_secret' })).toThrow();
  });
});

describe('Live Room event contracts', () => {
  const base = {
    publicRunId: 'jcr_1234567890abcdef1234567890abcdef',
    timestamp: '2026-09-04T14:00:02.000Z',
  };

  it.each([
    { ...base, type: 'message.delta', delta: 'Nominal' },
    { ...base, type: 'tool.started', tool: 'terminal', preview: 'Check service state' },
    { ...base, type: 'tool.completed', tool: 'terminal', durationSeconds: 0.42, error: false },
    { ...base, type: 'subagent.start', subagentId: 'child-1', goal: 'Inspect logs', status: null },
    { ...base, type: 'subagent.complete', subagentId: 'child-1', summary: 'Healthy', status: 'completed' },
    {
      ...base,
      type: 'approval.request',
      approval: {
        requestId: 'approval-1',
        command: 'rm [REDACTED]',
        description: 'Delete the disposable canary.',
        tool: 'terminal',
      },
    },
    { ...base, type: 'approval.responded', requestId: 'approval-1', choice: 'once' },
    { ...base, type: 'run.steered', accepted: true },
    {
      ...base,
      type: 'run.completed',
      output: 'Done.',
      pendingSteer: null,
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    },
    { ...base, type: 'run.failed', error: 'Provider unavailable.' },
    { ...base, type: 'run.cancelled' },
    { ...base, type: 'run.interrupted', error: 'Gateway restarted.' },
  ])('accepts the typed $type event', (event) => {
    expect(RunEventSchema.parse(event)).toEqual(event);
  });

  it('rejects reasoning events and unrestricted upstream payloads', () => {
    expect(() => RunEventSchema.parse({ ...base, type: 'reasoning.available', text: 'hidden' })).toThrow();
    expect(() => RunEventSchema.parse({
      ...base,
      type: 'tool.started',
      tool: 'terminal',
      preview: 'safe',
      args: { authorization: 'Bearer nope' },
    })).toThrow();
  });

  it('preserves exact approval identities rather than repairing whitespace', () => {
    expect(LiveRunApprovalRequestSchema.parse({ requestId: 'approval-1', choice: 'once' }).requestId).toBe('approval-1');
    for (const requestId of [' approval-1', 'approval-1 ', 'approval-1\n', 'approval 1']) {
      expect(() => LiveRunApprovalRequestSchema.parse({ requestId, choice: 'once' })).toThrow();
    }
  });

  it('supports only one-time approval or denial', () => {
    expect(ApprovalChoiceSchema.parse('once')).toBe('once');
    expect(ApprovalChoiceSchema.parse('deny')).toBe('deny');
    expect(() => ApprovalChoiceSchema.parse('session')).toThrow();
    expect(() => ApprovalChoiceSchema.parse('always')).toThrow();
  });
});
