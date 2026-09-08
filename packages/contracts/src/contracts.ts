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
}).strict();

export const LiveRunSubmissionResponseSchema = z.object({
  publicRunId: PublicRunIdSchema,
  sessionId: SessionIdSchema,
  status: LiveRunStateSchema,
  replayed: z.boolean(),
  clientRequestId: ClientRequestIdSchema,
}).strict();

export const LiveRunUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
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
export type RunEvent = z.infer<typeof RunEventSchema>;
export type SessionMessage = z.infer<typeof SessionMessageSchema>;
export type SessionMessagesPage = z.infer<typeof SessionMessagesPageSchema>;
export type SessionMutationResponse = z.infer<typeof SessionMutationResponseSchema>;
export type SessionOwnership = z.infer<typeof SessionOwnershipSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
