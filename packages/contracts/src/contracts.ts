import { z } from 'zod';

const IsoTimestampSchema = z.iso.datetime({ offset: true });
export const SessionIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:@+-]*$/, 'Invalid session ID')
  .refine((value) => !/\s/.test(value));
const PublicRunIdSchema = z
  .string()
  .regex(/^jcr_[a-f0-9]{32}$/, 'Invalid public run ID');
const ClientRequestIdSchema = z.uuid();
export const ApprovalRequestIdSchema = z.string().min(1).max(256).regex(/^[!-~]+$/).refine((value) => !/\s/.test(value));
export const OpaqueIdentifierSchema = ApprovalRequestIdSchema.max(160);
const SafeTextSchema = (maximum: number) => z.string().max(maximum);
const NonBlankTextSchema = (maximum: number) => z.string().trim().min(1).max(maximum);

export const CheckStateSchema = z.enum(['pass', 'warn', 'fail', 'unknown']);
export const HermesStateSchema = z.enum(['online', 'degraded', 'offline']);
export const GatewayStateSchema = z.enum(['idle', 'busy', 'unknown']);
export const SessionOwnershipSchema = z.enum(['command', 'external']);
export const ApprovalChoiceSchema = z.enum(['once', 'deny']);
export const ReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']);
const OpenAiCodexInferenceSchema = z.object({
  provider: z.literal('openai-codex'),
  model: z.enum(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']),
  reasoningEffort: ReasoningEffortSchema,
}).strict();
const GrokInferenceSchema = z.object({
  provider: z.literal('xai-oauth'),
  model: z.enum(['grok-4.7', 'grok-4.6']),
  reasoningEffort: ReasoningEffortSchema,
}).strict();
export const InferenceOverrideSchema = z.discriminatedUnion('provider', [
  OpenAiCodexInferenceSchema,
  GrokInferenceSchema,
]);
const InferenceOptionFields = {
  label: NonBlankTextSchema(80),
  reasoningEfforts: z.array(ReasoningEffortSchema).min(1).max(5),
};
export const InferenceOptionSchema = z.discriminatedUnion('provider', [
  OpenAiCodexInferenceSchema.omit({ reasoningEffort: true }).extend(InferenceOptionFields).strict(),
  GrokInferenceSchema.omit({ reasoningEffort: true }).extend(InferenceOptionFields).strict(),
]);
export const InferenceOptionsResponseSchema = z.object({
  default: z.object({
    provider: NonBlankTextSchema(120),
    model: NonBlankTextSchema(160),
  }).strict(),
  options: z.array(InferenceOptionSchema).min(1).max(8),
}).strict();
export const LiveRunStateSchema = z.enum([
  'queued',
  'running',
  'waiting_for_approval',
  'stopping',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export const SessionSummarySchema = z
  .object({
    id: SessionIdSchema,
    title: NonBlankTextSchema(160),
    source: NonBlankTextSchema(40),
    ownership: SessionOwnershipSchema,
    model: NonBlankTextSchema(160).nullable(),
    lastActive: IsoTimestampSchema,
    messageCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    pinned: z.boolean(),
  })
  .strict();

export const CommandBootstrapSchema = z
  .object({
    identity: z
      .object({
        provider: z.enum(['cloudflare-access', 'development']),
      })
      .strict(),
    command: z
      .object({
        version: NonBlankTextSchema(40),
        environment: z.enum(['development', 'test', 'production']),
        generatedAt: IsoTimestampSchema,
        liveRoom: z.object({
          enabled: z.boolean(),
          externalContinue: z.literal(false),
          maxInputCharacters: z.number().int().min(1).max(16_000),
          maxSteerCharacters: z.number().int().min(1).max(4_000),
        }).strict(),
      })
      .strict(),
    hermes: z
      .object({
        state: HermesStateSchema,
        version: NonBlankTextSchema(80).nullable(),
        model: NonBlankTextSchema(160).nullable(),
        provider: NonBlankTextSchema(120).nullable(),
        gatewayState: GatewayStateSchema,
        activeAgents: z.number().int().nonnegative(),
        capabilities: z.array(NonBlankTextSchema(120)).max(100),
        readinessChecks: z.record(NonBlankTextSchema(80), CheckStateSchema),
      })
      .strict(),
    sessions: z.array(SessionSummarySchema).max(50),
  })
  .strict();

export const SessionMessageSchema = z.object({
  id: OpaqueIdentifierSchema,
  sessionId: SessionIdSchema,
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: SafeTextSchema(131_072),
  timestamp: IsoTimestampSchema.nullable(),
  toolName: NonBlankTextSchema(160).nullable(),
  displayKind: NonBlankTextSchema(80).nullable(),
}).strict();

export const SessionMessagesPageSchema = z.object({
  sessionId: SessionIdSchema,
  messages: z.array(SessionMessageSchema).max(100),
  pagination: z.object({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative().max(1_000_000),
    returned: z.number().int().nonnegative().max(100),
    hasMore: z.boolean(),
  }).strict(),
}).strict();

export const LiveRoomSessionCreateRequestSchema = z.object({
  title: NonBlankTextSchema(160).optional(),
}).strict();

export const LiveRoomSessionContinueRequestSchema = z.object({
  title: NonBlankTextSchema(160).optional(),
}).strict();

export const SessionMutationResponseSchema = z.object({
  session: SessionSummarySchema,
}).strict();

export const LiveRunSubmissionRequestSchema = z.object({
  sessionId: SessionIdSchema,
  input: NonBlankTextSchema(16_000),
  clientRequestId: ClientRequestIdSchema,
  inference: InferenceOverrideSchema.optional(),
}).strict();

export const LiveRunSubmissionResponseSchema = z.object({
  publicRunId: PublicRunIdSchema,
  sessionId: SessionIdSchema,
  status: LiveRunStateSchema,
  replayed: z.boolean(),
  clientRequestId: ClientRequestIdSchema,
}).strict();

export const LiveExecutionEndpointSchema = z.object({
  provider: NonBlankTextSchema(120).nullable(),
  model: NonBlankTextSchema(160).nullable(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).nullable(),
}).strict();

export const LiveExecutionReceiptSchema = z.object({
  requested: LiveExecutionEndpointSchema,
  executed: LiveExecutionEndpointSchema.extend({
    reasoningEffortSource: z.enum(['wire', 'configured', 'unknown']),
  }).strict(),
  routeSource: SafeTextSchema(80).nullable(),
  exact: z.boolean(),
  fallbackUsed: z.boolean(),
}).strict();

export const LiveRunUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  apiCalls: z.number().int().nonnegative().optional(),
  providerLatencyMs: z.number().int().nonnegative().optional(),
  endToEndLatencyMs: z.number().int().nonnegative().optional(),
  outputTokensPerSecond: z.number().finite().nonnegative().nullable().optional(),
  context: z.object({
    usedTokens: z.number().int().nonnegative(),
    limitTokens: z.number().int().positive(),
    source: z.literal('hermes_effective'),
  }).strict().nullable().optional(),
  execution: LiveExecutionReceiptSchema.nullable().optional(),
}).strict();

export const SessionContextResponseSchema = z.object({
  sessionId: SessionIdSchema,
  state: z.enum(['available', 'unavailable']),
  updatedAt: IsoTimestampSchema.nullable(),
  receipt: LiveRunUsageSchema.nullable(),
}).strict();

export const LiveCompactionSchema = z.object({
  state: z.enum(['running', 'completed', 'aborted']),
  startedAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict();

export const SessionControlCapabilitiesSchema = z.object({
  sessionForkPreservesSource: z.boolean(),
  sessionCompactionRuns: z.boolean(),
}).strict();

export const ContextCompactionSubmissionRequestSchema = z.object({
  sessionId: SessionIdSchema,
  clientRequestId: ClientRequestIdSchema,
}).strict();

export const ContextCompactionSubmissionResponseSchema = z.object({
  publicOperationId: PublicRunIdSchema,
  sessionId: SessionIdSchema,
  status: LiveRunStateSchema,
  replayed: z.boolean(),
  clientRequestId: ClientRequestIdSchema,
}).strict();

export const ContextCompactionResultSchema = z.object({
  outcome: z.enum(['compacted', 'not_needed']),
  sourceSessionId: SessionIdSchema,
  resultSessionId: SessionIdSchema,
  beforeTokens: z.number().int().nonnegative(),
  afterTokens: z.number().int().nonnegative(),
  beforeMessages: z.number().int().nonnegative(),
  afterMessages: z.number().int().nonnegative(),
  inPlace: z.boolean(),
}).strict();

export const ContextCompactionStatusSchema = z.object({
  publicOperationId: PublicRunIdSchema,
  sessionId: SessionIdSchema,
  status: LiveRunStateSchema,
  updatedAt: IsoTimestampSchema,
  compaction: LiveCompactionSchema.nullable(),
  result: ContextCompactionResultSchema.nullable(),
  error: SafeTextSchema(256).nullable(),
}).strict();

export const LiveApprovalSchema = z.object({
  requestId: ApprovalRequestIdSchema,
  command: NonBlankTextSchema(4_096),
  description: NonBlankTextSchema(2_048),
  tool: NonBlankTextSchema(160).nullable(),
}).strict();

export const LiveRunStatusSchema = z.object({
  publicRunId: PublicRunIdSchema,
  sessionId: SessionIdSchema,
  status: LiveRunStateSchema,
  updatedAt: IsoTimestampSchema,
  approval: LiveApprovalSchema.nullable(),
  output: SafeTextSchema(262_144).nullable(),
  error: SafeTextSchema(4_096).nullable(),
  pendingSteer: SafeTextSchema(4_000).nullable(),
  usage: LiveRunUsageSchema.nullable(),
  compaction: LiveCompactionSchema.nullable().optional(),
  // Optional until the BFF can prove the persisted pair belongs to this exact
  // public run and session. IDs use the same projection as session history.
  historyBinding: z.object({
    userMessageId: OpaqueIdentifierSchema,
    assistantMessageId: OpaqueIdentifierSchema,
  }).strict().optional(),
}).strict();

const RunEventBase = {
  publicRunId: PublicRunIdSchema,
  timestamp: IsoTimestampSchema,
} as const;

export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...RunEventBase,
    type: z.literal('message.delta'),
    delta: SafeTextSchema(32_768),
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('tool.started'),
    tool: OpaqueIdentifierSchema,
    preview: SafeTextSchema(2_048),
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('tool.completed'),
    tool: OpaqueIdentifierSchema,
    durationSeconds: z.number().nonnegative().max(86_400),
    error: z.boolean(),
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('subagent.start'),
    subagentId: OpaqueIdentifierSchema,
    goal: SafeTextSchema(2_048),
    status: SafeTextSchema(80).nullable(),
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('subagent.complete'),
    subagentId: OpaqueIdentifierSchema,
    summary: SafeTextSchema(4_096),
    status: SafeTextSchema(80).nullable(),
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('approval.request'),
    approval: LiveApprovalSchema,
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('approval.responded'),
    requestId: ApprovalRequestIdSchema,
    choice: ApprovalChoiceSchema,
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('run.steered'),
    accepted: z.literal(true),
  }).strict(),
  z.object({ ...RunEventBase, type: z.literal('context.compaction.started'), state: z.literal('running') }).strict(),
  z.object({ ...RunEventBase, type: z.literal('context.compaction.progress'), state: z.literal('running') }).strict(),
  z.object({ ...RunEventBase, type: z.literal('context.compaction.completed'), state: z.literal('completed') }).strict(),
  z.object({ ...RunEventBase, type: z.literal('context.compaction.aborted'), state: z.literal('aborted') }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('run.completed'),
    output: SafeTextSchema(262_144),
    pendingSteer: SafeTextSchema(4_000).nullable(),
    usage: LiveRunUsageSchema.nullable(),
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('run.failed'),
    error: SafeTextSchema(4_096),
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('run.cancelled'),
  }).strict(),
  z.object({
    ...RunEventBase,
    type: z.literal('run.interrupted'),
    error: SafeTextSchema(4_096),
  }).strict(),
]);

export const LiveRunApprovalRequestSchema = z.object({
  requestId: ApprovalRequestIdSchema,
  choice: ApprovalChoiceSchema,
}).strict();

export const LiveRunApprovalResponseSchema = z.object({
  publicRunId: PublicRunIdSchema,
  requestId: ApprovalRequestIdSchema,
  choice: ApprovalChoiceSchema,
  resolved: z.number().int().min(1).max(100),
}).strict();

export const LiveRunSteerRequestSchema = z.object({
  input: NonBlankTextSchema(4_000),
}).strict();

export const LiveRunSteerResponseSchema = z.object({
  publicRunId: PublicRunIdSchema,
  accepted: z.literal(true),
  state: z.literal('queued'),
}).strict();

export const LiveRunStopResponseSchema = z.object({
  publicRunId: PublicRunIdSchema,
  status: LiveRunStateSchema,
}).strict();

export type ApprovalChoice = z.infer<typeof ApprovalChoiceSchema>;
export type CheckState = z.infer<typeof CheckStateSchema>;
export type CommandBootstrap = z.infer<typeof CommandBootstrapSchema>;
export type HermesState = z.infer<typeof HermesStateSchema>;
export type InferenceOption = z.infer<typeof InferenceOptionSchema>;
export type InferenceOptionsResponse = z.infer<typeof InferenceOptionsResponseSchema>;
export type InferenceOverride = z.infer<typeof InferenceOverrideSchema>;
export type LiveExecutionReceipt = z.infer<typeof LiveExecutionReceiptSchema>;
export type LiveCompaction = z.infer<typeof LiveCompactionSchema>;
export type SessionContextResponse = z.infer<typeof SessionContextResponseSchema>;
export type SessionControlCapabilities = z.infer<typeof SessionControlCapabilitiesSchema>;
export type ContextCompactionSubmissionRequest = z.infer<typeof ContextCompactionSubmissionRequestSchema>;
export type ContextCompactionSubmissionResponse = z.infer<typeof ContextCompactionSubmissionResponseSchema>;
export type ContextCompactionResult = z.infer<typeof ContextCompactionResultSchema>;
export type ContextCompactionStatus = z.infer<typeof ContextCompactionStatusSchema>;
export type LiveApproval = z.infer<typeof LiveApprovalSchema>;
export type LiveRoomSessionContinueRequest = z.infer<typeof LiveRoomSessionContinueRequestSchema>;
export type LiveRoomSessionCreateRequest = z.infer<typeof LiveRoomSessionCreateRequestSchema>;
export type LiveRunApprovalRequest = z.infer<typeof LiveRunApprovalRequestSchema>;
export type LiveRunApprovalResponse = z.infer<typeof LiveRunApprovalResponseSchema>;
export type LiveRunState = z.infer<typeof LiveRunStateSchema>;
export type LiveRunStatus = z.infer<typeof LiveRunStatusSchema>;
export type LiveRunSteerRequest = z.infer<typeof LiveRunSteerRequestSchema>;
export type LiveRunSteerResponse = z.infer<typeof LiveRunSteerResponseSchema>;
export type LiveRunStopResponse = z.infer<typeof LiveRunStopResponseSchema>;
export type LiveRunSubmissionRequest = z.infer<typeof LiveRunSubmissionRequestSchema>;
export type LiveRunSubmissionResponse = z.infer<typeof LiveRunSubmissionResponseSchema>;
export type LiveRunUsage = z.infer<typeof LiveRunUsageSchema>;
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type SessionMessage = z.infer<typeof SessionMessageSchema>;
export type SessionMessagesPage = z.infer<typeof SessionMessagesPageSchema>;
export type SessionMutationResponse = z.infer<typeof SessionMutationResponseSchema>;
export type SessionOwnership = z.infer<typeof SessionOwnershipSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
