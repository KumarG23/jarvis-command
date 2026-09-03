import { z } from 'zod';

const IsoTimestampSchema = z.iso.datetime({ offset: true });

export const CheckStateSchema = z.enum(['pass', 'warn', 'fail', 'unknown']);
export const HermesStateSchema = z.enum(['online', 'degraded', 'offline']);
export const GatewayStateSchema = z.enum(['idle', 'busy', 'unknown']);

export const SessionSummarySchema = z
  .object({
    id: z.string().min(1).max(160),
    title: z.string().min(1).max(160),
    source: z.string().min(1).max(40),
    model: z.string().min(1).max(160).nullable(),
    lastActive: IsoTimestampSchema,
    preview: z.string().max(500),
    messageCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    pinned: z.boolean(),
  })
  .strict();

export const CommandBootstrapSchema = z
  .object({
    identity: z
      .object({
        email: z.email(),
        provider: z.literal('cloudflare-access'),
      })
      .strict(),
    command: z
      .object({
        version: z.string().min(1).max(40),
        environment: z.enum(['development', 'test', 'production']),
        generatedAt: IsoTimestampSchema,
      })
      .strict(),
    hermes: z
      .object({
        state: HermesStateSchema,
        version: z.string().min(1).max(80).nullable(),
        model: z.string().min(1).max(160).nullable(),
        provider: z.string().min(1).max(120).nullable(),
        gatewayState: GatewayStateSchema,
        activeAgents: z.number().int().nonnegative(),
        capabilities: z.array(z.string().min(1).max(120)).max(100),
        readinessChecks: z.record(z.string().min(1).max(80), CheckStateSchema),
      })
      .strict(),
    sessions: z.array(SessionSummarySchema).max(50),
  })
  .strict();

export type CheckState = z.infer<typeof CheckStateSchema>;
export type HermesState = z.infer<typeof HermesStateSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type CommandBootstrap = z.infer<typeof CommandBootstrapSchema>;
