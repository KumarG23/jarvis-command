import { ROUTING_WRITES_AVAILABLE, requireRoutingWrites } from './routing-write-state';
import { InferenceOptionsResponseSchema, InferenceOverrideSchema, RoutingDefaultSetSchema, RoutingDefaultTargetSchema, SessionMutationResponseSchema, type FrozenRouting, type InferenceOverride, type LiveRunSubmissionRequest, type ProjectRoom } from '@jarvis-command/contracts';
import type { ProjectRoomStore } from './project-room-store';
import type { AuditLedger } from './audit-ledger';
import type { CommandProxyClient } from './command-client';

export class RoutingUnavailableError extends Error {
  readonly statusCode = 503;
  constructor() { super('Routing selection is unavailable. Review the current eligible model and effort before retrying; no fallback was selected.'); }
}
export function createRoutingDefaults(ledger: AuditLedger, client: CommandProxyClient, rooms: Pick<ProjectRoomStore, 'list' | 'readLocked'> | undefined) {
  const session = async (id: string) => {
    const result = SessionMutationResponseSchema.parse(await client.getSession(id));
    if (result.session.id !== id || result.session.ownership !== 'command' || !/^jc_[a-f0-9]{32}$/.test(id)) throw new RoutingUnavailableError();
  };
  const scope = async (sessionId: string | null, projectId: string | null, snapshot?: ProjectRoom[]) => {
    if (sessionId) await session(sessionId);
    // An archived linked thread cannot silently become an active global target.
    if (!rooms) throw new RoutingUnavailableError();
    const currentRooms = snapshot ?? await rooms.list();
    if (!projectId) {
      if (sessionId && currentRooms.some(room => room.sessionIds.includes(sessionId) && (room.archived || room.threads?.some(thread => thread.sessionId === sessionId && thread.archived)))) throw new RoutingUnavailableError();
      return;
    }
    const room = currentRooms.find(room => room.id === projectId);
    if (!room || room.archived || (sessionId && (!room.sessionIds.includes(sessionId) || room.threads?.some(thread => thread.sessionId === sessionId && thread.archived)))) throw new RoutingUnavailableError();
    if (!sessionId) for (const id of room.sessionIds) await session(id);
  };
  const eligible = async (selection: InferenceOverride) => {
    const inventory = InferenceOptionsResponseSchema.parse(await client.getInferenceOptions());
    const option = inventory.options.find(option => option.provider === selection.provider && option.model === selection.model);
    const advertised = inventory.catalog?.entries.find(entry => entry.provider === selection.provider && entry.model === selection.model);
    if (!option || !advertised?.advertised || !advertised.authenticated || !advertised.eligible || !advertised.selectable
      || ('reasoningEffort' in selection && !option.reasoningEfforts.includes(selection.reasoningEffort))) throw new RoutingUnavailableError();
    return selection;
  };
  const targetScope = async (target: ReturnType<typeof RoutingDefaultTargetSchema.parse>, snapshot?: ProjectRoom[]) => scope(target.scope === 'thread' ? target.sessionId : null, target.projectId, snapshot);
  return {
    async read(actor: string, raw: unknown) {
      const target = RoutingDefaultTargetSchema.parse(raw);
      await ledger.verifyStorage(); await targetScope(target);
      return { ...ledger.routingDefault(actor, target), writesAvailable: ROUTING_WRITES_AVAILABLE };
    },
    async set(actor: string, raw: unknown) {
      const request = RoutingDefaultSetSchema.parse(raw);
      await ledger.verifyStorage(); await targetScope(request.target);
      if (!ledger.defaultRequest(actor, request.clientRequestId)) requireRoutingWrites();
      // Replays never reapply an old preference, but still require current access.
      if (request.selection && !ledger.defaultRequest(actor, request.clientRequestId)) await eligible(request.selection);
      if (!rooms) throw new RoutingUnavailableError();
      return rooms.readLocked(async snapshot => {
        await targetScope(request.target, snapshot);
        return { ...await ledger.setRoutingDefault(actor, request), writesAvailable: ROUTING_WRITES_AVAILABLE };
      });
    },
    async resolve(actor: string, request: LiveRunSubmissionRequest, envelopeFingerprint: string): Promise<FrozenRouting> {
      requireRoutingWrites();
      if (!request.routing) throw new RoutingUnavailableError();
      await scope(request.sessionId, request.routing.projectId);
      const thread = ledger.routingDefault(actor, { scope: 'thread', sessionId: request.sessionId, projectId: request.routing.projectId });
      const project = request.routing.projectId ? ledger.routingDefault(actor, { scope: 'project', projectId: request.routing.projectId }) : null;
      const selected = request.inference ?? thread.selection ?? project?.selection;
      let inference: InferenceOverride;
      if (selected) inference = await eligible(selected);
      else {
        const inventory = InferenceOptionsResponseSchema.parse(await client.getInferenceOptions());
        // Command default has no effort tuple. Only provider-default routes can
        // supply one honestly; Codex/xAI require explicit verified effort.
        const option = inventory.options.find(option => option.provider === inventory.default.provider && option.model === inventory.default.model);
        if (!option || (option.provider !== 'anthropic' && option.provider !== 'openrouter')) throw new RoutingUnavailableError();
        inference = await eligible(InferenceOverrideSchema.parse({ provider: option.provider, model: option.model }));
      }
      return { envelopeFingerprint, inference, source: request.inference ? 'prompt' : thread.selection ? 'thread' : project?.selection ? 'project' : 'command', projectId: request.routing.projectId, threadRevision: thread.revision, projectRevision: project?.revision ?? 0 };
    },
    async withFrozen<T>(request: LiveRunSubmissionRequest, frozen: FrozenRouting, admit: () => Promise<T>) {
      if (!rooms) throw new RoutingUnavailableError();
      return rooms.readLocked(async snapshot => {
        await scope(request.sessionId, frozen.projectId, snapshot); await eligible(frozen.inference);
        return admit();
      });
    },
  };
}
