import { createHash, randomBytes } from 'node:crypto';

import {
  LiveRoomSessionContinueRequestSchema,
  LiveRoomSessionCreateRequestSchema,
  LiveRunApprovalRequestSchema,
  LiveRunApprovalResponseSchema,
  LiveRunStatusSchema,
  LiveRunSteerRequestSchema,
  LiveRunSteerResponseSchema,
  LiveRunStopResponseSchema,
  LiveRunSubmissionRequestSchema,
  LiveRunSubmissionResponseSchema,
  RunEventSchema,
  type LiveRoomSessionContinueRequest,
  type LiveRoomSessionCreateRequest,
  type LiveRunApprovalRequest,
  type LiveRunApprovalResponse,
  type LiveRunState,
  type LiveRunStatus,
  type LiveRunSteerRequest,
  type LiveRunSteerResponse,
  type LiveRunStopResponse,
  type LiveRunSubmissionRequest,
  type LiveRunSubmissionResponse,
  type RunEvent,
  type SessionMessagesPage,
  type SessionMutationResponse,
} from '@jarvis-command/contracts';

import type { AuditDraft, AuditRunRecord, AuditLedger } from './audit-ledger';
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
  client: CommandProxyClient;
  ledger: AuditLedger;
  createPublicRunId?: () => string;
  now?: () => Date;
}>;

type AdmittedRunRecord = AuditRunRecord & Readonly<{ upstreamRunId: string }>;

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

export function createLiveRoomService({
  client,
  ledger,
  createPublicRunId = () => `jcr_${randomBytes(16).toString('hex')}`,
  now = () => new Date(),
}: LiveRoomServiceOptions) {
  const submissions = new Map<string, { fingerprint: string; operation: Promise<LiveRunSubmissionResponse> }>();

  const submittingSessions = new Set<string>();

  const actorFingerprint = (subject: string): string => sha256(subject);

  const findRun = (subject: string, publicRunId: string): AdmittedRunRecord => {
    const record = ledger.findRunByPublicId(actorFingerprint(subject), publicRunId);
    if (!record || !record.upstreamRunId) throw new LiveRoomNotFoundError();
    return record as AdmittedRunRecord;
  };

  const auditTerminal = async (
    record: AuditRunRecord,
    status: LiveRunState,
  ): Promise<void> => {
    if (!TERMINAL_STATES.has(status)) return;
    const action = `run.${status}` as AuditDraft['action'];
    await ledger.appendOnce(`terminal:${record.publicRunId}`, auditDraft(record, {
      action,
      outcome: status === 'completed' ? 'succeeded' : 'failed',
      status,
    }));
  };

  const projectStatus = async (
    record: AuditRunRecord,
    upstream: CommandRunStatus,
  ): Promise<LiveRunStatus> => {
    if (upstream.runId !== record.upstreamRunId || upstream.sessionId !== record.sessionId) {
      throw new LiveRoomNotFoundError();
    }
    await auditTerminal(record, upstream.status);
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
    });
  };

  const submitRun = async (
    subject: string,
    rawRequest: LiveRunSubmissionRequest,
  ): Promise<LiveRunSubmissionResponse> => {
    const request = LiveRunSubmissionRequestSchema.parse(rawRequest);
    const actor = actorFingerprint(subject);
    const submissionKey = `${actor}\0${request.clientRequestId}`;
    const requestFingerprint = sha256(canonicalJson({ input: request.input, sessionId: request.sessionId }));
    const pending = submissions.get(submissionKey);
    if (pending) {
      if (pending.fingerprint !== requestFingerprint) throw new LiveRoomConflictError();
      return pending.operation;
    }

    if (submittingSessions.has(request.sessionId)) throw new LiveRoomConflictError();
    submittingSessions.add(request.sessionId);
    const operation = (async () => {
      const existing = ledger.findRunByClientRequest(actor, request.clientRequestId);
      if (existing) {
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
          return admitUpstreamRun(existing, request, true);
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

      for (const active of ledger.activeRunsForSession(request.sessionId)) {
        if (!active.upstreamRunId) throw new LiveRoomConflictError('Session already has a pending run admission');
        const status = await projectStatus(active, await client.getRun(active.upstreamRunId));
        if (!TERMINAL_STATES.has(status.status)) {
          throw new LiveRoomConflictError('Session already has an active run');
        }
      }

      const publicRunId = createPublicRunId();
      if (!PUBLIC_RUN_ID.test(publicRunId)) throw new Error('Public run ID factory returned an invalid ID');
      const requested = await ledger.appendOnce(
        `request:${actor}:${request.clientRequestId}`,
        {
          action: 'run.requested',
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
      });
      return admitUpstreamRun(pendingRecord, request, false);
    })();

    submissions.set(submissionKey, { fingerprint: requestFingerprint, operation });
    try {
      return await operation;
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
    const upstream = await client.startRun({
      sessionId: request.sessionId,
      input: request.input,
      idempotencyKey: `jc-v1-${sha256(`${record.actor}\0${record.clientRequestId}`)}`,
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

  return Object.freeze({
    async getMessages(
      _subject: string,
      sessionId: string,
      limit: number,
      offset: number,
    ): Promise<SessionMessagesPage> {
      ledger.assertHealthy();
      return client.getMessages(sessionId, limit, offset);
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

    async getRun(subject: string, publicRunId: string): Promise<LiveRunStatus> {
      const record = findRun(subject, publicRunId);
      return projectStatus(record, await client.getRun(record.upstreamRunId!));
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
        if (isTerminalEvent(event)) await auditTerminal(record, terminalEventStatus(event));
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
