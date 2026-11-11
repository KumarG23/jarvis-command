import { z } from 'zod';

// Wire contracts for the project cockpit session host (apps/session-host).
// The BFF talks to the session host with these shapes; the browser only ever
// sees them through the BFF.

export const CockpitSessionIdSchema = z.string().regex(/^cs_[a-f0-9]{24}$/);
export const CockpitProjectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const CockpitRequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

export const CockpitKindSchema = z.enum(['shell', 'claude', 'codex', 'gemini', 'opencode']);
export type CockpitKind = z.infer<typeof CockpitKindSchema>;

export const CockpitActorSchema = z.enum(['human', 'lead']);
export type CockpitActor = z.infer<typeof CockpitActorSchema>;
export const CockpitOwnerSchema = z.enum(['human', 'lead', 'none']);
export type CockpitOwner = z.infer<typeof CockpitOwnerSchema>;

// connecting: admitted, process being started.
// running: the tmux pane's process is alive. Alive is not proof of progress.
// waiting_for_input: a native hook reported the CLI is waiting on the user.
// exited: the process ended on its own (exitCode when tmux reported it).
// stopped: someone stopped it through the cockpit.
// failed: the launch itself failed (missing binary, preflight refusal, bad workspace).
// lost: the record says it should be alive but its tmux session is gone (host reboot, killed outside the cockpit).
// unknown: the host could not determine state right now.
export const CockpitStateSchema = z.enum([
  'connecting', 'running', 'waiting_for_input', 'exited', 'stopped', 'failed', 'lost', 'unknown',
]);
export type CockpitState = z.infer<typeof CockpitStateSchema>;

const title = z.string().trim().min(1).max(120)
  .refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));

// A git URL (https/ssh/scp-like) or an absolute path on the execution host.
export const CockpitRepositorySchema = z.string().trim().min(1).max(512)
  .refine(value => !/[\0\r\n]/.test(value));

export const CockpitSessionCreateSchema = z.object({
  requestId: CockpitRequestIdSchema,
  projectId: CockpitProjectIdSchema,
  title,
  kind: CockpitKindSchema,
  repository: CockpitRepositorySchema.optional(),
  // Default true when a repository is given: each coding thread gets its own worktree and branch.
  worktree: z.boolean().optional(),
  // Optional first message typed into the session once it starts (e.g. the lead's task brief).
  initialInput: z.string().max(16_000).optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
}).strict();
export type CockpitSessionCreate = z.infer<typeof CockpitSessionCreateSchema>;

export const CockpitSessionSchema = z.object({
  id: CockpitSessionIdSchema,
  requestId: CockpitRequestIdSchema,
  projectId: CockpitProjectIdSchema,
  title: z.string(),
  kind: CockpitKindSchema,
  createdBy: CockpitActorSchema,
  owner: CockpitOwnerSchema,
  state: CockpitStateSchema,
  host: z.string(),
  cwd: z.string(),
  repository: z.string().nullable(),
  branch: z.string().nullable(),
  worktree: z.boolean(),
  nativeSessionId: z.string().nullable(),
  pid: z.number().int().nullable(),
  exitCode: z.number().int().nullable(),
  failure: z.string().nullable(),
  billing: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  stateAt: z.iso.datetime(),
}).strict();
export type CockpitSession = z.infer<typeof CockpitSessionSchema>;

export const CockpitOwnershipRequestSchema = z.object({
  projectId: CockpitProjectIdSchema,
  // take: human takes input (always allowed). hand_to_lead: human gives input to the lead.
  // release: current owner gives input up.
  action: z.enum(['take', 'hand_to_lead', 'release']),
}).strict();

export const CockpitInputRequestSchema = z.object({
  projectId: CockpitProjectIdSchema,
  // Raw bytes as typed (UTF-8). Use submit to press Enter after the text.
  data: z.string().min(1).max(16_000),
  submit: z.boolean().optional(),
}).strict();

export const CockpitAdapterSchema = z.object({
  kind: CockpitKindSchema,
  label: z.string(),
  available: z.boolean(),
  version: z.string().nullable(),
  billing: z.string(),
  qualified: z.boolean(),
  note: z.string().nullable(),
}).strict();
export type CockpitAdapter = z.infer<typeof CockpitAdapterSchema>;

// Browser/BFF -> host terminal control frames (text frames). Terminal output is sent as binary frames.
export const CockpitTerminalClientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().min(1).max(65_536) }).strict(),
  z.object({ type: z.literal('resize'), cols: z.number().int().min(20).max(500), rows: z.number().int().min(5).max(200) }).strict(),
]);
export type CockpitTerminalClientFrame = z.infer<typeof CockpitTerminalClientFrameSchema>;

export const CockpitTerminalServerFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), session: CockpitSessionSchema }).strict(),
  z.object({ type: z.literal('input_refused'), reason: z.string() }).strict(),
  z.object({ type: z.literal('closed'), reason: z.string() }).strict(),
]);
export type CockpitTerminalServerFrame = z.infer<typeof CockpitTerminalServerFrameSchema>;
