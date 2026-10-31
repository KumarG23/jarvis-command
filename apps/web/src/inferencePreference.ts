import { InferenceOverrideSchema, type InferenceOptionsResponse, type InferenceOverride, type LiveRunUsage } from '@jarvis-command/contracts';
import { useMemo, useState } from 'react';
import { appStorageKey } from './appEnvironment';

type Selection = InferenceOverride | 'inherit' | 'invalid';
type Preference = { selection: Selection; storageUnavailable: boolean };
export const inferencePreferenceKey = (sessionId: string) => appStorageKey(`jarvis-command:requested-inference:${sessionId}`);

function read(sessionId: string): Preference {
  try {
    const raw = localStorage.getItem(inferencePreferenceKey(sessionId));
    if (raw === null) return { selection: 'inherit', storageUnavailable: false };
    if (raw.length > 512) throw Error('invalid');
    const value: unknown = JSON.parse(raw);
    return { selection: value === 'inherit' ? value : InferenceOverrideSchema.parse(value), storageUnavailable: false };
  } catch {
    // Never reinterpret an unreadable explicit choice as inherited routing.
    return { selection: 'invalid', storageUnavailable: true };
  }
}

export function useInferencePreference(sessionId: string | undefined) {
  const [memory, setMemory] = useState<Record<string, Preference & { snapshot: Preference }>>({});
  const stored = useMemo(() => sessionId ? read(sessionId) : { selection: 'inherit' as const, storageUnavailable: false }, [sessionId]);
  const local = sessionId ? memory[sessionId] : undefined;
  const preference = local && (local.snapshot === stored || local.storageUnavailable) ? local : stored;
  const select = (selection: Exclude<Selection, 'invalid'>) => {
    if (!sessionId) return;
    let storageUnavailable = false;
    try { localStorage.setItem(inferencePreferenceKey(sessionId), JSON.stringify(selection)); }
    catch { storageUnavailable = true; }
    setMemory(previous => ({ ...previous, [sessionId]: { selection, storageUnavailable, snapshot: stored } }));
  };
  return { ...preference, select };
}

export function selectionProblem(selection: Selection, inventory: InferenceOptionsResponse | null): string | null {
  if (selection === 'inherit') return null;
  if (selection === 'invalid') return 'Stored requested selection unavailable. Choose a model or explicitly choose Inherit.';
  if (!inventory) return 'Model choices unavailable. Retry choices or explicitly choose Inherit.';
  const option = inventory.options.find(option => option.provider === selection.provider && option.model === selection.model);
  if (!option) return 'Requested model unavailable. Choose another model or explicitly choose Inherit.';
  if (!option.reasoningEfforts.includes(selection.reasoningEffort)) return 'Requested effort unsupported by the current inventory. Choose an offered effort or explicitly choose Inherit.';
  return null;
}

export function routeDecision(receipt: NonNullable<LiveRunUsage['execution']>): 'Fallback used' | 'Route changed' | 'Exact route' | 'Route verification unavailable' {
  if (receipt.fallbackUsed) return 'Fallback used';
  const mismatch = (['provider', 'model', 'reasoningEffort'] as const).some(key =>
    receipt.requested[key] !== null && receipt.executed[key] !== null && receipt.requested[key] !== receipt.executed[key]);
  if (mismatch) return 'Route changed';
  return receipt.exact ? 'Exact route' : 'Route verification unavailable';
}
