import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnComposer } from './TurnView';

const sessionId = 'jc_' + 'a'.repeat(32);
const base = { allowed: true, imageAttachmentsEnabled: false, sessionId, projectId: null, project: null, max: 200_000, maxSteer: 4000, turn: null, retry: vi.fn(), resume: vi.fn(), steer: vi.fn(), recoveries: [], consumeRecovery: vi.fn() };
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

const at = '2026-11-14T12:00:00.000Z';
const creator = { subject: 'operator', source: 'upload' };
const artifact = {
  id: 'art_' + 'c'.repeat(32), title: 'backup.zip', type: 'file', mime: 'application/zip', createdAt: at, updatedAt: at, creator,
  sessionId, projectId: null, runId: null, sourceRequestId: null, size: 4, sha256: 'a'.repeat(64), currentVersion: 1, canonical: false,
  privateMode: 'private', originalFilename: 'backup.zip',
  versions: [{ version: 1, parentVersion: null, baseVersion: null, createdAt: at, creator, type: 'file', mime: 'application/zip', size: 4, sha256: 'a'.repeat(64), revisionNote: null, feedback: null, originalFilename: 'backup.zip' }],
  comments: [],
};

it('puts small text files in the message and uploads other files for Jarvis to open on the host', async () => {
  const uploads: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/artifacts/upload') { uploads.push(String((init?.body as FormData).get('metadata'))); return Response.json({ artifact }); }
    return Response.json({ default: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, options: [] });
  }));
  const send = vi.fn(() => true);
  render(<TurnComposer {...base} send={send} />);
  const log = new File(['disk full on /var\n'], 'syslog.txt', { type: 'text/plain' });
  const zip = new File([new Uint8Array([0x50, 0x4b, 0, 0])], 'backup.zip', { type: 'application/zip' });
  fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [log, zip] } });
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message Jarvis' }) as HTMLTextAreaElement).value).toBe('syslog.txt:\n```\ndisk full on /var\n```'));
  await screen.findByRole('button', { name: 'Remove backup.zip' });
  expect(uploads).toHaveLength(1);
});
