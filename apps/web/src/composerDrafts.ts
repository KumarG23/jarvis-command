import { useRef, useState } from 'react';
import type { LiveRunSubmissionRequest } from '@jarvis-command/contracts';
import type { TextDraftMemory } from './textDraft';
import type { PreferenceMemory } from './inferencePreference';

export type PendingChatImage = NonNullable<LiveRunSubmissionRequest['images']>[number] & Readonly<{ name: string; size: number }>;
// Retained by the thread supervisor, never browser storage. Closing or moving
// a pane must not lose unsent guidance, image references or failed-storage edits.
export function useComposerDrafts() {
  const [steers, setSteers] = useState<Record<string, string>>({});
  const steerVersions = useRef<Record<string, number>>({});
  const [imagesBySession, setImagesBySession] = useState<Record<string, PendingChatImage[]>>({});
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const text = useState<TextDraftMemory>({});
  const preferences = useState<PreferenceMemory>({});
  return { steers, setSteers, steerVersions, imagesBySession, setImagesBySession, imageBusy, setImageBusy, imageError, setImageError, text, preferences };
}
export type ComposerDrafts = ReturnType<typeof useComposerDrafts>;
