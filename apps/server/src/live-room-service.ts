import { replyPreview } from './reply-preview';
import { requireRoutingWrites } from './routing-write-state';
import { projectInstructions } from './project-context';
import { createRoutingDefaults, RoutingRefusedError, RoutingUnavailableError } from './routing-defaults';
import { KeyedSerialQueue } from './keyed-serial-queue';
import type { ProjectRoomStore } from './project-room-store';
import type { CockpitSession, FrozenRouting, InferenceOverride, RoutingDefaultSet } from '@jarvis-command/contracts';
import { ReactionTargetSchema, ReactionMutationSchema, SessionMessagesPageSchema, SessionMutationResponseSchema, type ReactionTarget, type ReactionMutation } from '@jarvis-command/contracts';
import { type ReactionStore, ReactionUnavailableError } from './reaction-store';
import { ProjectRosterStatusSchema } from '@jarvis-command/contracts';
import { createHash, randomBytes } from 'node:crypto';

import {
  ContextCompactionStatusSchema,
  ContextCompactionSubmissionRequestSchema,
  ContextCompactionSubmissionResponseSchema,
  LiveRoomSessionContinueRequestSchema,
  LiveRoomSessionCreateRequestSchema,
  SessionContextResponseSchema,
  LiveRunApprovalRequestSchema,
  LiveRunApprovalResponseSchema,
  LiveRunStatusSchema,
  LiveRunSteerRequestSchema,
  LiveRunSteerResponseSchema,
  LiveRunStopResponseSchema,
  LiveRunSubmissionRequestSchema,
  LiveRunSubmissionResponseSchema,
  LiveRunRequestLookupSchema,
  RunEventSchema,
  type LiveRoomSessionContinueRequest,
  type LiveRoomSessionCreateRequest,
  type ContextCompactionStatus,
  type ContextCompactionSubmissionRequest,
  type ContextCompactionSubmissionResponse,
  type InferenceOptionsResponse,
  type LiveRunApprovalRequest,
  type LiveRunApprovalResponse,
  type LiveRunState,
  type LiveRunStatus,
  type LiveRunUsage,
  type LiveRunSteerRequest,
  type LiveRunSteerResponse,
  type LiveRunStopResponse,
  type LiveRunSubmissionRequest,
  type LiveRunSubmissionResponse,
  type RunEvent,
  type SessionMessagesPage,
  type SessionContextResponse,
  type SessionControlCapabilities,
  type SessionMutationResponse,
} from '@jarvis-command/contracts';

import type { AuditDraft, AuditRunRecord, AuditLedger } from './audit-ledger';
import type { RunNotifier } from './run-notifier';
import type { ReplyNotifier } from './reply-notifier';
import {
  type CommandProxyClient,
  type CommandRunEvent,
  type CommandRunStatus,
} from './command-client';

const PUBLIC_RUN_ID = /^jcr_[a-f0-9]{32}$/;
const TERMINAL_STATES = new Set<LiveRunState>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

type LiveRoomServiceOptions = Readonly<{
  defaultInference?: InferenceOverride;
  projectContext?: boolean;
  // Reads the project's cockpit sessions for the lead's context; null when unavailable.
  listTerminals?: (projectId: string) => Promise<CockpitSession[] | null>;
  /**
   * Server-side status polling after admission, so the terminal audit, inbox entry and reply push
   * happen even when no browser is watching (the phone app was closed). Off unless configured.
   */
  watchRuns?: Readonly<{ pollMs: number; watchMs: number; maxWatched?: number }>;
  rooms?: Pick<ProjectRoomStore, 'list' | 'readLocked'>;
  client: CommandProxyClient;
  ledger: AuditLedger;
  resolveImages?: (references: NonNullable<LiveRunSubmissionRequest['images']>) => Promise<ReadonlyArray<Readonly<{ mime: string; bytes: Buffer }>>>;
  createPublicRunId?: () => string;
  now?: () => Date;
  notify?: RunNotifier | undefined;
  /** Reply-only notifier; verifies its own exact message binding and never sees run output. */
  notifyReply?: ReplyNotifier | undefined;
  reactions?: ReactionStore | undefined;
  reactionsEnabled?: boolean | undefined;
}>;

type AdmittedRunRecord = AuditRunRecord & Readonly<{ upstreamRunId: string }>;

/** Server-configured actor for scheduled runs. Never derived from a request body or header. */
export type ActorSubject = Readonly<{ actor: string }>;
export type Subject = string | ActorSubject;

export class LiveRoomConflictError extends Error {
  public readonly statusCode = 409;

  public constructor(message = 'Live Room request conflicts with current state') {
    super(message);
    this.name = 'LiveRoomConflictError';
  }
}

export class LiveRoomNotFoundError extends Error {
  public readonly statusCode = 404;

  public constructor() {
    super('Live Room run was not found');
    this.name = 'LiveRoomNotFoundError';
  }
}

/**
 * First line of the run's final output, for a finished-run push that has no verified reply item.
 * Specific text reads as a real message; Chrome flags vague generic pushes as possible spam.
 */
function fallbackPreview(output: string | null | undefined): { preview?: string } {
  const preview = replyPreview(output ?? '');
  return preview ? { preview } : {};
}

export function createLiveRoomService({
  client,
  ledger,
  rooms,
  resolveImages,
  createPublicRunId = () => `jcr_${randomBytes(16).toString('hex')}`,
  now = () => new Date(),
  notify,
  notifyReply,
  reactions,
  reactionsEnabled = false,
  defaultInference,
  projectContext = false,
  listTerminals,
  watchRuns,
}: LiveRoomServiceOptions) {
  const routingRequests = new KeyedSerialQueue();
  const defaults = createRoutingDefaults(ledger, client, rooms, defaultInference);
  const submissions = new Map<string, { fingerprint: string; operation: Promise<LiveRunSubmissionResponse> }>();
  const compactionSubmissions = new Map<string, { fingerprint: string; operation: Promise<ContextCompactionSubmissionResponse> }>();

  const submittingSessions = new Set<string>();

  // A string is an authenticated Access subject. An ActorSubject is a server-configured actor
  // fingerprint (scheduled runs); it is never built from request input.
  const watched = new Set<string>();
  const watchTimers = new Set<NodeJS.Timeout>();
  let watchClosed = false;
  // Polls through projectStatus, which records the terminal audit and fires the inbox entry and
  // reply push. Status reads are idempotent, so a browser watching too only duplicates reads.
  const watch = (actor: string, publicRunId: string) => {
    if (!watchRuns || watchClosed || watched.has(publicRunId) || watched.size >= (watchRuns.maxWatched ?? 64)) return;
    watched.add(publicRunId);
    const deadline = Date.now() + watchRuns.watchMs;
    const schedule = () => {
      const timer = setTimeout(() => { watchTimers.delete(timer); void tick(); }, watchRuns.pollMs);
      timer.unref?.();
      watchTimers.add(timer);
    };
    const tick = async () => {
      if (watchClosed) { watched.delete(publicRunId); return; }
      let done = Date.now() >= deadline;
      try {
        const record = ledger.findRunByPublicId(actor, publicRunId);
        if (!record?.upstreamRunId) done = true;
        else {
          const status = await projectStatus(record as AdmittedRunRecord, await client.getRun(record.upstreamRunId));
          if (TERMINAL_STATES.has(status.status)) done = true;
        }
      } catch { /* transient upstream or storage fault: keep polling until the deadline */ }
      if (done || watchClosed) watched.delete(publicRunId); else schedule();
    };
    schedule();
  };

  const actorFingerprint = (subject: Subject): string => typeof subject === 'string' ? sha256(subject) : subject.actor;

  const findRun = (subject: Subject, publicRunId: string): AdmittedRunRecord => {
    const record = ledger.findRunByPublicId(actorFingerprint(subject), publicRunId);
    if (!record || !record.upstreamRunId) throw new LiveRoomNotFoundError();
    return record as AdmittedRunRecord;
  };

  // Notifications come only from observations of the actor's own admitted run: the record
  // is already actor/run/session bound. Context-compaction operations are not runs.
  const notifyStatus = async (record: AuditRunRecord, upstream: CommandRunStatus, terminalAt: string | null): Promise<void> => {
    if (upstream.kind === 'context_compaction') return;
    let replied = false;
    if (upstream.status === 'completed' && terminalAt) {
      replied = await notifyReply?.({ actor: record.actor, sessionId: record.sessionId, publicRunId: record.publicRunId, eventAt: terminalAt }) ?? false;
    }
    if (!notify) return;
    const base = { actor: record.actor, sessionId: record.sessionId, publicRunId: record.publicRunId };
    // Without a verified reply (no history binding), the finished-run item carries the push instead.
    if (upstream.status === 'completed' && terminalAt) await notify({ ...base, eventAt: terminalAt, category: 'run-completed', ...(replied ? {} : { pushFallback: true, ...fallbackPreview(upstream.output) }) });
    else if (upstream.status === 'failed' && terminalAt) await notify({ ...base, eventAt: terminalAt, category: 'run-failed' });
    else if (upstream.status === 'waiting_for_approval' && upstream.approval) {
      await notify({ ...base, eventAt: now().toISOString(), category: 'approval', key: upstream.approval.requestId });
    }
  };

  const auditTerminal = async (
    record: AuditRunRecord,
    status: LiveRunState,
    receipt: LiveRunUsage | null = null,
  ): Promise<string | null> => {
    if (!TERMINAL_STATES.has(status)) return null;
    const action = `run.${status}` as AuditDraft['action'];
    const entry = await ledger.appendOnce(`terminal:${record.publicRunId}`, auditDraft(record, {
      action,
      outcome: status === 'completed' ? 'succeeded' : 'failed',
      status,
      receipt,
    }));
    return entry.timestamp;
  };

  const projectStatus = async (
    record: AuditRunRecord,
    upstream: CommandRunStatus,
  ): Promise<LiveRunStatus> => {
    if (upstream.runId !== record.upstreamRunId || upstream.sessionId !== record.sessionId) {
      throw new LiveRoomNotFoundError();
    }
    // Terminal audit never depends on notification health; the notification follows the audit and
    // is re-delivered from the ledger by the inbox reconcile if its write fails.
    const terminalAt = await auditTerminal(record, upstream.status, upstream.usage);
    await notifyStatus(record, upstream, terminalAt);
    return LiveRunStatusSchema.parse({
      publicRunId: record.publicRunId,
      sessionId: record.sessionId,
      status: upstream.status,
      updatedAt: upstream.updatedAt,
      approval: upstream.approval,
      output: upstream.output,
      error: upstream.error,
      pendingSteer: upstream.pendingSteer,
      usage: upstream.usage,
      ...(upstream.compaction !== undefined ? { compaction: upstream.compaction } : {}),
      // Only a completed, non-compaction run may carry a binding; the run/session were checked above.
      ...(upstream.historyBinding && upstream.status === 'completed' && upstream.kind === undefined
        ? { historyBinding: upstream.historyBinding } : {}),
    });
  };

  const prepareReactionContext = async (request: LiveRunSubmissionRequest, actor: string, fingerprint: string, claimNew: boolean) => {
    const note = await reactions?.forSend(actor, request.sessionId, request.clientRequestId, fingerprint, request.input.length, claimNew,
      clientRequestId => ledger.findRunByClientRequest(actor, clientRequestId) !== null) ?? '';
    const prepared = { ...request, input: request.input + note };
    const requestFingerprint = sha256(canonicalJson({
      inference: prepared.inference ? JSON.stringify(prepared.inference) : '',
      images: prepared.images ? JSON.stringify(prepared.images) : '',
      input: prepared.input,
      sessionId: prepared.sessionId,
    }));
    return { prepared, requestFingerprint };
  };

  const reactionTarget = async (raw: ReactionTarget) => {
    if (!reactionsEnabled || !reactions) throw new ReactionUnavailableError();
    const target = ReactionTargetSchema.parse(raw);
    await ledger.verifyStorage();
    const { session } = SessionMutationResponseSchema.parse(await client.getSession(target.sessionId));
    if (session.id !== target.sessionId || session.ownership !== 'command' || !/^jc_[a-f0-9]{32}$/.test(session.id)) throw new LiveRoomNotFoundError();
    const page = SessionMessagesPageSchema.parse(await client.getMessages(target.sessionId, 100, target.offset));
    if (page.sessionId !== target.sessionId || page.pagination.offset !== target.offset || page.pagination.limit !== 100
      || page.pagination.returned !== page.messages.length || page.messages.some(m => m.sessionId !== target.sessionId)
      || new Set(page.messages.map(m => m.id)).size !== page.messages.length) throw new LiveRoomNotFoundError();
    const message = page.messages.find(m => m.id === target.messageId);
    if (!message || (message.role !== 'user' && message.role !== 'assistant') || message.toolName !== null || message.displayKind !== null) throw new LiveRoomNotFoundError();
    return { target, role: message.role as 'user' | 'assistant' };
  };

  const submitRun = async (
    subject: Subject,
    rawRequest: LiveRunSubmissionRequest,
  ): Promise<LiveRunSubmissionResponse> => {
    const request = LiveRunSubmissionRequestSchema.parse(rawRequest);
    const actor = actorFingerprint(subject);
    const submissionKey = `${actor}\0${request.clientRequestId}`;
    const payloadFingerprint = sha256(canonicalJson({
      inference: request.inference ? JSON.stringify(request.inference) : '',
      images: request.images ? JSON.stringify(request.images) : '',
      input: request.input,
      sessionId: request.sessionId,
      ...(request.routing ? { routing: JSON.stringify(request.routing) } : {}),
    }));
    const pending = submissions.get(submissionKey);
    if (pending) {
      if (pending.fingerprint !== payloadFingerprint) throw new LiveRoomConflictError();
      return pending.operation;
    }

    if (submittingSessions.has(request.sessionId)) throw new LiveRoomConflictError();
    submittingSessions.add(request.sessionId);
    const operation = routingRequests.run(submissionKey, async () => {
      const existing = ledger.findRunByClientRequest(actor, request.clientRequestId);
      if (existing) {
        if (!!existing.routing !== !!request.routing || (existing.routing && existing.routing.envelopeFingerprint !== payloadFingerprint)) throw new LiveRoomConflictError('Client request ID was already used for another envelope');
        const resolvedRequest = existing.routing ? { ...request, inference: existing.routing.inference } : request;
        const { prepared, requestFingerprint } = await prepareReactionContext(resolvedRequest, actor, payloadFingerprint, false);
        if (
          existing.requestFingerprint !== requestFingerprint
          || existing.sessionId !== request.sessionId
        ) {
          throw new LiveRoomConflictError('Client request ID was already used for another payload');
        }
        if (!existing.upstreamRunId) {
          const age = now().getTime() - Date.parse(existing.requestedAt);
          // Leave a one-hour margin inside Hermes's minimum 24-hour retention.
          if (age < 0 || age >= 23 * 60 * 60 * 1000) throw new LiveRoomConflictError();
          await ledger.verifyStorage();
          return admitUpstreamRun(existing, prepared, true);
        }
        const status = await projectStatus(existing, await client.getRun(existing.upstreamRunId));
        return LiveRunSubmissionResponseSchema.parse({
          publicRunId: existing.publicRunId,
          sessionId: existing.sessionId,
          status: status.status,
          replayed: true,
          clientRequestId: existing.clientRequestId,
        });
      }

      if (ledger.defaultRequest(actor, request.clientRequestId)) throw new LiveRoomConflictError('Client request ID was used for a default change');
      // Recovery above must remain available; reject new identities before claims/status work.
      if (request.routing) requireRoutingWrites();
      for (const active of ledger.activeRunsForSession(request.sessionId)) {
        if (!active.upstreamRunId) throw new LiveRoomConflictError('Session already has a pending run admission');
        const status = await projectStatus(active, await client.getRun(active.upstreamRunId));
        if (!TERMINAL_STATES.has(status.status)) {
          throw new LiveRoomConflictError('Session already has an active run');
        }
      }

      // Nothing is recorded or sent before this point, so a routing refusal here is definite.
      const routing: FrozenRouting | undefined = request.routing ? await defaults.resolve(actor, request, payloadFingerprint).catch((error: unknown) => {
        throw error instanceof RoutingUnavailableError ? new RoutingRefusedError(error.reason) : error;
      }) : undefined;
      const resolvedRequest = routing ? { ...request, inference: routing.inference } : request;
      const { prepared, requestFingerprint } = await prepareReactionContext(resolvedRequest, actor, payloadFingerprint, reactionsEnabled);
      const publicRunId = createPublicRunId();
      if (!PUBLIC_RUN_ID.test(publicRunId)) throw new Error('Public run ID factory returned an invalid ID');
      const requested = await ledger.appendOnce(
        `request:${actor}:${request.clientRequestId}`,
        {
          action: 'run.requested',
          ...(routing ? { routing } : {}),
          actor,
          sessionId: request.sessionId,
          publicRunId,
          clientRequestId: request.clientRequestId,
          upstreamRunId: null,
          requestId: null,
          requestFingerprint,
          outcome: 'requested',
          status: 'queued',
          choice: null,
        },
      );
      const pendingRecord: AuditRunRecord = Object.freeze({
        actor,
        sessionId: request.sessionId,
        publicRunId,
        clientRequestId: request.clientRequestId,
        upstreamRunId: null,
        requestFingerprint,
        status: requested.status ?? 'queued',
        requestedAt: requested.timestamp,
        receipt: null,
        ...(routing ? { routing } : {}),
      });
      return admitUpstreamRun(pendingRecord, prepared, false);
    });

    submissions.set(submissionKey, { fingerprint: payloadFingerprint, operation });
    try {
      const result = await operation;
      watch(actor, result.publicRunId);
      return result;
    } finally {
      submissions.delete(submissionKey);
      submittingSessions.delete(request.sessionId);
    }
  };

  const admitUpstreamRun = async (
    record: AuditRunRecord,
    request: LiveRunSubmissionRequest,
    recoveredAdmission: boolean,
  ): Promise<LiveRunSubmissionResponse> => {
    const images = request.images?.length
      ? await resolveImages?.(request.images)
      : undefined;
    if (request.images?.length && !images) throw new Error('Artifact image resolver unavailable');
    const room = projectContext && rooms
      ? (await rooms.list()).find(candidate => !candidate.archived && candidate.sessionIds.includes(request.sessionId))
      : undefined;
    const terminals = room && listTerminals ? await listTerminals(room.id).catch(() => null) : undefined;
    const instructions = room ? projectInstructions(room, request.sessionId, terminals) : undefined;
    const admit = async () => {
      const upstream = await client.startRun({
        ...(instructions ? { instructions } : {}),
        sessionId: request.sessionId,
        input: request.input,
        idempotencyKey: `jc-v1-${sha256(`${record.actor}\0${record.clientRequestId}`)}`,
        ...(request.inference ? { inference: request.inference } : {}),
        ...(images?.length ? { images } : {}),
      });
      if (upstream.sessionId !== record.sessionId) throw new LiveRoomConflictError();
      await ledger.appendOnce(`started:${record.publicRunId}`, auditDraft({
        ...record,
        upstreamRunId: upstream.runId,
      }, {
        action: 'run.started',
        outcome: upstream.replayed || recoveredAdmission ? 'replayed' : 'succeeded',
        status: upstream.status,
      }));
      return LiveRunSubmissionResponseSchema.parse({
        publicRunId: record.publicRunId,
        sessionId: record.sessionId,
        status: upstream.status,
        replayed: upstream.replayed || recoveredAdmission,
        clientRequestId: record.clientRequestId,
      });
    };
    return record.routing ? defaults.withFrozen(request, record.routing, admit) : admit();
  };

  const projectContextCompactionStatus = async (
    record: AuditRunRecord,
    upstream: CommandRunStatus,
  ): Promise<ContextCompactionStatus> => {
    if (
      upstream.runId !== record.upstreamRunId
      || upstream.sessionId !== record.sessionId
      || upstream.kind !== 'context_compaction'
    ) throw new LiveRoomNotFoundError();
    await auditTerminal(record, upstream.status);
    return ContextCompactionStatusSchema.parse({
      publicOperationId: record.publicRunId,
      sessionId: record.sessionId,
      status: upstream.status,
      updatedAt: upstream.updatedAt,
      compaction: upstream.compaction ?? null,
      result: upstream.result ?? null,
      error: upstream.error,
    });
  };

  const admitContextCompaction = async (
    record: AuditRunRecord,
    request: ContextCompactionSubmissionRequest,
    recoveredAdmission: boolean,
  ): Promise<ContextCompactionSubmissionResponse> => {
    const upstream = await client.startContextCompaction({
      sessionId: request.sessionId,
      idempotencyKey: `jc-context-v1-${sha256(`${record.actor}\0${record.clientRequestId}`)}`,
    });
    if (upstream.sessionId !== record.sessionId) throw new LiveRoomConflictError();
    await ledger.appendOnce(`started:${record.publicRunId}`, auditDraft({
      ...record,
      upstreamRunId: upstream.runId,
    }, {
      action: 'run.started',
      outcome: upstream.replayed || recoveredAdmission ? 'replayed' : 'succeeded',
      status: upstream.status,
    }));
    return ContextCompactionSubmissionResponseSchema.parse({
      publicOperationId: record.publicRunId,
      sessionId: record.sessionId,
      status: upstream.status,
      replayed: upstream.replayed || recoveredAdmission,
      clientRequestId: record.clientRequestId,
    });
  };

  const submitContextCompaction = async (
    subject: string,
    rawRequest: ContextCompactionSubmissionRequest,
  ): Promise<ContextCompactionSubmissionResponse> => {
    const request = ContextCompactionSubmissionRequestSchema.parse(rawRequest);
    const readiness = await client.readReadiness();
    if (!readiness.sessionCompactionRuns) throw new LiveRoomConflictError('Context compaction is unavailable');
    const actor = actorFingerprint(subject);
    const submissionKey = `${actor}\0${request.clientRequestId}`;
    const requestFingerprint = sha256(canonicalJson({ kind: 'context_compaction', sessionId: request.sessionId }));
    const pending = compactionSubmissions.get(submissionKey);
    if (pending) {
      if (pending.fingerprint !== requestFingerprint) throw new LiveRoomConflictError();
      return pending.operation;
    }
    if (submittingSessions.has(request.sessionId)) throw new LiveRoomConflictError();
    submittingSessions.add(request.sessionId);
    const operation = routingRequests.run(submissionKey, async () => {
      if (ledger.defaultRequest(actor, request.clientRequestId)) throw new LiveRoomConflictError('Client request ID was used for a default change');
      await reactions?.assertNoSendClaim(actor, request.clientRequestId);
      const existing = ledger.findRunByClientRequest(actor, request.clientRequestId);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint || existing.sessionId !== request.sessionId) {
          throw new LiveRoomConflictError('Client request ID was already used for another payload');
        }
        if (!existing.upstreamRunId) {
          const age = now().getTime() - Date.parse(existing.requestedAt);
          if (age < 0 || age >= 23 * 60 * 60 * 1000) throw new LiveRoomConflictError();
          await ledger.verifyStorage();
          return admitContextCompaction(existing, request, true);
        }
        const status = await projectContextCompactionStatus(existing, await client.getRun(existing.upstreamRunId));
        return ContextCompactionSubmissionResponseSchema.parse({
          publicOperationId: existing.publicRunId,
          sessionId: existing.sessionId,
          status: status.status,
          replayed: true,
          clientRequestId: existing.clientRequestId,
        });
      }
      for (const active of ledger.activeRunsForSession(request.sessionId)) {
        if (!active.upstreamRunId) throw new LiveRoomConflictError('Session already has a pending operation');
        const status = await client.getRun(active.upstreamRunId);
        if (!TERMINAL_STATES.has(status.status)) throw new LiveRoomConflictError('Session already has an active operation');
      }
      const publicRunId = createPublicRunId();
      if (!PUBLIC_RUN_ID.test(publicRunId)) throw new Error('Public run ID factory returned an invalid ID');
      const requested = await ledger.appendOnce(`request:${actor}:${request.clientRequestId}`, {
        action: 'run.requested', actor, sessionId: request.sessionId, publicRunId,
        clientRequestId: request.clientRequestId, upstreamRunId: null, requestId: null,
        requestFingerprint, outcome: 'requested', status: 'queued', choice: null,
      });
      const pendingRecord: AuditRunRecord = Object.freeze({
        actor, sessionId: request.sessionId, publicRunId,
        clientRequestId: request.clientRequestId, upstreamRunId: null,
        requestFingerprint, status: requested.status ?? 'queued',
        requestedAt: requested.timestamp, receipt: null,
      });
      return admitContextCompaction(pendingRecord, request, false);
    });
    compactionSubmissions.set(submissionKey, { fingerprint: requestFingerprint, operation });
    try { return await operation; } finally {
      compactionSubmissions.delete(submissionKey);
      submittingSessions.delete(request.sessionId);
    }
  };

  return Object.freeze({
    async withProjectDeletion<T>(subject: string, projectId: string, sessionIds: string[], operation: () => Promise<T>): Promise<T> {
      ledger.assertHealthy();
      // Reserve synchronously before any await: send, compaction and session
      // deletion all use the same admission set, across actors.
      if (sessionIds.some(id => submittingSessions.has(id) || ledger.activeRunsForSession(id).length)) throw new LiveRoomConflictError('Stop active or admitting project runs before deleting this project');
      sessionIds.forEach(id => submittingSessions.add(id));
      try {
        for (const id of sessionIds) {
          const { session } = await client.getSession(id);
          if (session.id !== id) throw new LiveRoomNotFoundError();
        }
        const audit = { actor: actorFingerprint(subject), sessionId: projectId, publicRunId: null, clientRequestId: null, upstreamRunId: null, requestId: null, requestFingerprint: null, status: null, choice: null };
        // sessionId is the ledger's scope identifier here: exactly the room id.
        await ledger.append({ ...audit, action: 'project.delete.requested', outcome: 'requested' });
        const result = await operation();
        await ledger.append({ ...audit, action: 'project.deleted', outcome: 'succeeded' });
        return result;
      } finally { sessionIds.forEach(id => submittingSessions.delete(id)); }
    },
    /** Read-only observation: never discovers external runs or writes audit/notifications. */
    async getRosterStatus(subject: string, sessionId: string) {
      const record = ledger.latestRunForSession(actorFingerprint(subject), sessionId);
      if (!record) return { status: 'unknown' as const, runUpdatedAt: null };
      if (!record.upstreamRunId) return { status: 'unknown' as const, runUpdatedAt: null };
      const upstream = await client.getRun(record.upstreamRunId);
      if (upstream.runId !== record.upstreamRunId || upstream.sessionId !== sessionId) throw new LiveRoomNotFoundError();
      const status = ProjectRosterStatusSchema.safeParse(upstream.status === 'waiting_for_approval' ? 'waiting-approval' : upstream.status);
      return { status: status.success ? status.data : 'unknown' as const, runUpdatedAt: upstream.updatedAt };
    },

    async getSessionControls(subject: string): Promise<SessionControlCapabilities> {
      void subject;
      const readiness = await client.readReadiness();
      return {
        sessionForkPreservesSource: readiness.sessionForkPreservesSource,
        sessionCompactionRuns: readiness.sessionCompactionRuns,
      };
    },

    async getInferenceOptions(subject: string): Promise<InferenceOptionsResponse> {
      void subject;
      ledger.assertHealthy();
      return client.getInferenceOptions();
    },

    async getReactions(subject: string, raw: ReactionTarget) {
      const { target } = await reactionTarget(raw);
      return reactions!.read(actorFingerprint(subject), target.sessionId, target.messageId);
    },

    async mutateReaction(subject: string, raw: ReactionMutation) {
      const request = ReactionMutationSchema.parse(raw);
      const { role } = await reactionTarget({ sessionId: request.sessionId, messageId: request.messageId, offset: request.offset });
      return reactions!.mutate(actorFingerprint(subject), request, role);
    },

    async getMessages(
      _subject: string,
      sessionId: string,
      limit: number,
      offset: number,
    ): Promise<SessionMessagesPage> {
      ledger.assertHealthy();
      return client.getMessages(sessionId, limit, offset);
    },

    async getSession(_subject: Subject, sessionId: string): Promise<SessionMutationResponse> {
      ledger.assertHealthy();
      return client.getSession(sessionId);
    },

    async deleteSession(subject: string, sessionId: string): Promise<{ deleted: true; sessionId: string }> {
      ledger.assertHealthy();
      if (submittingSessions.has(sessionId) || ledger.activeRunsForSession(sessionId).length) throw new LiveRoomConflictError('Session has an active run');
      submittingSessions.add(sessionId);
      try {
        const actor = actorFingerprint(subject);
        await ledger.append({
          action: 'session.delete.requested', actor, sessionId,
          publicRunId: null, clientRequestId: null, upstreamRunId: null,
          requestId: null, requestFingerprint: null, outcome: 'requested', status: null, choice: null,
        });
        const result = await client.deleteSession(sessionId);
        if (!result.deleted || result.sessionId !== sessionId) throw new Error('Command proxy returned a mismatched deletion receipt');
        await ledger.append({
          action: 'session.deleted', actor, sessionId,
          publicRunId: null, clientRequestId: null, upstreamRunId: null,
          requestId: null, requestFingerprint: null, outcome: 'succeeded', status: null, choice: null,
        });
        return result;
      } finally {
        submittingSessions.delete(sessionId);
      }
    },
    async createSession(
      subject: string,
      rawRequest: LiveRoomSessionCreateRequest,
    ): Promise<SessionMutationResponse> {
      ledger.assertHealthy();
      const request = LiveRoomSessionCreateRequestSchema.parse(rawRequest);
      await ledger.append(sessionAdmission(actorFingerprint(subject), 'session.created', 'pending'));
      const response = await client.createSession(request);
      await ledger.append({
        action: 'session.created',
        actor: actorFingerprint(subject),
        sessionId: response.session.id,
        publicRunId: null,
        clientRequestId: null,
        upstreamRunId: null,
        requestId: null,
        outcome: 'succeeded',
        status: null,
        choice: null,
      });
      return response;
    },

    async continueSession(
      subject: string,
      sessionId: string,
      rawRequest: LiveRoomSessionContinueRequest,
    ): Promise<SessionMutationResponse> {
      ledger.assertHealthy();
      if (!(await client.readReadiness()).sessionForkPreservesSource) {
        throw new LiveRoomConflictError('Source-preserving fork is unavailable');
      }
      const request = LiveRoomSessionContinueRequestSchema.parse(rawRequest);
      await ledger.append(sessionAdmission(actorFingerprint(subject), 'session.continued', sessionId));
      const response = await client.continueSession(sessionId, request);
      await ledger.append({
        action: 'session.continued',
        actor: actorFingerprint(subject),
        sessionId: response.session.id,
        publicRunId: null,
        clientRequestId: null,
        upstreamRunId: null,
        requestId: null,
        outcome: 'succeeded',
        status: null,
        choice: null,
      });
      return response;
    },

    submitRun,
    /** Stops server-side run watching (app shutdown). */
    closeWatchers() { watchClosed = true; for (const timer of watchTimers) clearTimeout(timer); watchTimers.clear(); watched.clear(); },
    readRoutingDefault: (subject: string, target: unknown) => defaults.read(actorFingerprint(subject), target),
    setRoutingDefault: (subject: string, raw: RoutingDefaultSet) => routingRequests.run(`${actorFingerprint(subject)}\0${raw.clientRequestId}`, () => defaults.set(actorFingerprint(subject), raw)),
    submitContextCompaction,

    async getContextCompaction(subject: string, publicOperationId: string): Promise<ContextCompactionStatus> {
      const record = findRun(subject, publicOperationId);
      return projectContextCompactionStatus(record, await client.getRun(record.upstreamRunId));
    },

    async lookupRunRequest(subject: string, sessionId: string, clientRequestId: string) {
      // Only the existing authenticated actor's exact request/session can resolve.
      // Do not contact Hermes or recover an uncertain upstream admission by writing.
      await ledger.verifyStorage();
      const record = ledger.findRunByClientRequest(actorFingerprint(subject), clientRequestId);
      if (!record || record.sessionId !== sessionId) throw new LiveRoomNotFoundError();
      return LiveRunRequestLookupSchema.parse({
        sessionId, clientRequestId,
        publicRunId: record.upstreamRunId ? record.publicRunId : null,
      });
    },

    /** Actor-bound identity of an admitted run, for notification deep links. */
    getRunIdentity(subject: string, publicRunId: string): Readonly<{ sessionId: string; clientRequestId: string }> {
      const record = findRun(subject, publicRunId);
      return { sessionId: record.sessionId, clientRequestId: record.clientRequestId };
    },

    /** The actor's terminal completed/failed runs audited after `since`, newest first. */
    listTerminalRuns(subject: string, since: string, limit: number): Array<Readonly<{ publicRunId: string; status: 'completed' | 'failed' }>> {
      return ledger.terminalRunsForActor(actorFingerprint(subject), since)
        .sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, limit).map(({ publicRunId, status }) => ({ publicRunId, status }));
    },

    /** The actor's newest admitted, not-yet-terminal runs, for reopening-time reconciliation. */
    listUnsettledRuns(subject: string, limit: number): string[] {
      return ledger.activeRunsForActor(actorFingerprint(subject))
        .filter(record => record.upstreamRunId)
        .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
        .slice(0, limit).map(record => record.publicRunId);
    },

    async getRun(subject: Subject, publicRunId: string): Promise<LiveRunStatus> {
      const record = findRun(subject, publicRunId);
      return projectStatus(record, await client.getRun(record.upstreamRunId!));
    },

    async getSessionContext(subject: string, sessionId: string): Promise<SessionContextResponse> {
      const latest = ledger.latestReceiptForSession(actorFingerprint(subject), sessionId);
      return SessionContextResponseSchema.parse({
        sessionId,
        state: latest ? 'available' : 'unavailable',
        updatedAt: latest?.updatedAt ?? null,
        receipt: latest?.receipt ?? null,
      });
    },

    async *streamRunEvents(
      subject: string,
      publicRunId: string,
      signal: AbortSignal,
    ): AsyncGenerator<RunEvent> {
      const record = findRun(subject, publicRunId);
      for await (const upstream of client.streamRunEvents(record.upstreamRunId!, signal)) {
        if (upstream.runId !== record.upstreamRunId) throw new LiveRoomNotFoundError();
        const event = projectEvent(record.publicRunId, upstream);
        if (event.type === 'approval.request') {
          await notify?.({ actor: record.actor, sessionId: record.sessionId, publicRunId: record.publicRunId, eventAt: now().toISOString(), category: 'approval', key: event.approval.requestId });
        }
        if (isTerminalEvent(event)) {
          const terminalAt = await auditTerminal(
            record,
            terminalEventStatus(event),
            event.type === 'run.completed' ? event.usage : null,
          );
          if ((notify || notifyReply) && terminalAt && (event.type === 'run.completed' || event.type === 'run.failed')) {
            // Confirm this is a run, not a compaction operation, before announcing it. If this
            // cannot be confirmed now, the inbox reconcile re-checks it from the ledger.
            const confirmed = await client.getRun(record.upstreamRunId!).catch(() => null);
            if (confirmed && confirmed.runId === record.upstreamRunId && confirmed.sessionId === record.sessionId && confirmed.kind !== 'context_compaction') {
              const replied = event.type === 'run.completed' ? await notifyReply?.({ actor: record.actor, sessionId: record.sessionId, publicRunId: record.publicRunId, eventAt: terminalAt }) ?? false : true;
              await notify?.({ actor: record.actor, sessionId: record.sessionId, publicRunId: record.publicRunId, eventAt: terminalAt, category: event.type === 'run.completed' ? 'run-completed' : 'run-failed', ...(replied ? {} : { pushFallback: true, ...(event.type === 'run.completed' ? fallbackPreview(confirmed.output) : {}) }) });
            }
          }
        }
        yield event;
      }
    },

    async approveRun(
      subject: string,
      publicRunId: string,
      rawRequest: LiveRunApprovalRequest,
    ): Promise<LiveRunApprovalResponse> {
      const record = findRun(subject, publicRunId);
      const request = LiveRunApprovalRequestSchema.parse(rawRequest);
      await ledger.append(auditDraft(record, {
        action: request.choice === 'once' ? 'run.approval.once' : 'run.approval.deny',
        outcome: 'requested',
        requestId: request.requestId,
        choice: request.choice,
      }));
      const response = await client.approveRun(record.upstreamRunId!, request);
      await ledger.append(auditDraft(record, {
        action: request.choice === 'once' ? 'run.approval.once' : 'run.approval.deny',
        outcome: 'succeeded',
        requestId: request.requestId,
        choice: request.choice,
      }));
      return LiveRunApprovalResponseSchema.parse({
        publicRunId,
        requestId: response.requestId,
        choice: response.choice,
        resolved: response.resolved,
      });
    },

    async steerRun(
      subject: string,
      publicRunId: string,
      rawRequest: LiveRunSteerRequest,
    ): Promise<LiveRunSteerResponse> {
      const record = findRun(subject, publicRunId);
      const request = LiveRunSteerRequestSchema.parse(rawRequest);
      await ledger.append(auditDraft(record, {
        action: 'run.steer',
        outcome: 'requested',
      }));
      const response = await client.steerRun(record.upstreamRunId!, request);
      await ledger.append(auditDraft(record, {
        action: 'run.steer',
        outcome: 'succeeded',
      }));
      return LiveRunSteerResponseSchema.parse({
        publicRunId,
        accepted: response.accepted,
        state: 'queued',
      });
    },

    async stopRun(subject: string, publicRunId: string): Promise<LiveRunStopResponse> {
      const record = findRun(subject, publicRunId);
      await ledger.append(auditDraft(record, {
        action: 'run.stop',
        outcome: 'requested',
      }));
      const response = await client.stopRun(record.upstreamRunId!);
      await ledger.append(auditDraft(record, {
        action: 'run.stop',
        outcome: 'succeeded',
        status: response.status,
      }));
      return LiveRunStopResponseSchema.parse({ publicRunId, status: response.status });
    },
  });
}

function projectEvent(publicRunId: string, event: CommandRunEvent): RunEvent {
  const projected: Record<string, unknown> = { ...event };
  delete projected.runId;
  return RunEventSchema.parse({ publicRunId, ...projected });
}

function isTerminalEvent(event: RunEvent): boolean {
  return event.type === 'run.completed'
    || event.type === 'run.failed'
    || event.type === 'run.cancelled'
    || event.type === 'run.interrupted';
}

function terminalEventStatus(event: RunEvent): LiveRunState {
  switch (event.type) {
    case 'run.completed': return 'completed';
    case 'run.failed': return 'failed';
    case 'run.cancelled': return 'cancelled';
    case 'run.interrupted': return 'interrupted';
    default: throw new Error('Not a terminal event');
  }
}

function sessionAdmission(actor: string, action: AuditDraft['action'], sessionId: string): AuditDraft {
  return { action, actor, sessionId, publicRunId: null, clientRequestId: null,
    upstreamRunId: null, requestId: null, outcome: 'requested', status: null, choice: null };
}

function auditDraft(
  record: AuditRunRecord,
  values: Readonly<{
    action: AuditDraft['action'];
    outcome: AuditDraft['outcome'];
    status?: LiveRunState | null;
    requestId?: string | null;
    choice?: AuditDraft['choice'];
    receipt?: LiveRunUsage | null;
  }>,
): AuditDraft {
  return {
    action: values.action,
    actor: record.actor,
    sessionId: record.sessionId,
    publicRunId: record.publicRunId,
    clientRequestId: record.clientRequestId,
    upstreamRunId: record.upstreamRunId,
    requestId: values.requestId ?? null,
    requestFingerprint: record.requestFingerprint,
    outcome: values.outcome,
    status: values.status ?? null,
    choice: values.choice ?? null,
    ...(values.receipt !== undefined ? { receipt: values.receipt } : {}),
  };
}

function canonicalJson(value: Record<string, string>): string {
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${JSON.stringify(value[key])}`
  )).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
