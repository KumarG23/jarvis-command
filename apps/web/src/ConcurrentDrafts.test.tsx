import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTextDraft } from './textDraft';
import { useInferencePreference } from './inferencePreference';

it('retains the latest draft when the same thread moves between two panes repeatedly', () => {
  const first = renderHook(({ id }) => useTextDraft(id, true), { initialProps: { id: 'jc_a' } });
  const second = renderHook(({ id }) => useTextDraft(id, true), { initialProps: { id: 'jc_b' } });
  act(() => first.result.current.setRoomDraft('jc_a', 'A original'));
  act(() => second.result.current.setRoomDraft('jc_b', 'B original'));
  first.rerender({ id: 'jc_b' }); second.rerender({ id: 'jc_a' });
  expect(first.result.current.draft).toBe('B original');
  expect(second.result.current.draft).toBe('A original');
  act(() => first.result.current.setRoomDraft('jc_b', 'B newer'));
  act(() => second.result.current.setRoomDraft('jc_a', 'A newer'));
  first.rerender({ id: 'jc_a' }); second.rerender({ id: 'jc_b' });
  expect(first.result.current.draft).toBe('A newer');
  expect(second.result.current.draft).toBe('B newer');
  act(() => second.result.current.clearForSend('jc_b'));
  first.rerender({ id: 'jc_b' });
  expect(first.result.current.draft).toBe('');
});

it('uses the latest requested selection after a thread moves panes without silently restoring an older route', () => {
  const first = renderHook(({ id }) => useInferencePreference(id), { initialProps: { id: 'jc_a' } });
  const second = renderHook(({ id }) => useInferencePreference(id), { initialProps: { id: 'jc_b' } });
  const choice = { provider: 'openai-codex', model: 'gpt-6-sol', reasoningEffort: 'low' } as const;
  act(() => first.result.current.select(choice));
  first.rerender({ id: 'jc_b' }); second.rerender({ id: 'jc_a' });
  expect(second.result.current.selection).toEqual(choice);
  act(() => second.result.current.select('inherit'));
  first.rerender({ id: 'jc_a' });
  expect(first.result.current.selection).toBe('inherit');
});
