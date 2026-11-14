import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnComposer } from './TurnView';

const sessionId = 'jc_' + 'a'.repeat(32);
const base = { allowed: true, imageAttachmentsEnabled: false, sessionId, projectId: null, project: null, max: 16000, maxSteer: 4000, turn: null, retry: vi.fn(), resume: vi.fn(), steer: vi.fn(), recoveries: [], consumeRecovery: vi.fn(), send: vi.fn(() => true) };
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

it('adds a text file to the message and refuses binary files with a clear note', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ default: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, options: [] })));
  render(<TurnComposer {...base} />);
  expect(screen.getByRole('button', { name: 'Attach file' })).toBeInTheDocument();
  const log = new File(['disk full on /var\n'], 'syslog.txt', { type: 'text/plain' });
  const zip = new File([new Uint8Array([0x50, 0x4b, 0, 0])], 'backup.zip', { type: 'application/zip' });
  fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [log, zip] } });
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message Jarvis' }) as HTMLTextAreaElement).value).toBe('syslog.txt:\n```\ndisk full on /var\n```'));
  expect(screen.getByRole('alert').textContent).toContain('backup.zip (not a text file)');
});
