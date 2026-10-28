import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectReferences } from './ProjectReferences';
const projectId = 'room_' + 'a'.repeat(32);
const artifact = { id: 'art_' + 'b'.repeat(32), title: 'SYNTHETIC reference', type: 'file', mime: 'application/octet-stream', createdAt: '2026-10-28T12:00:00Z', updatedAt: '2026-10-28T12:00:00Z', creator: { subject: 'synthetic', source: 'upload' }, sessionId: null, projectId, runId: null, sourceRequestId: null, size: 7, sha256: 'c'.repeat(64), currentVersion: 2, canonical: false, privateMode: 'private', originalFilename: 'synthetic.txt' };
afterEach(() => vi.unstubAllGlobals());
it('lists the P4 project index with exact immutable downloads and opens the existing library', async () => {
  const fetcher = vi.fn(async () => Response.json({ artifacts: [artifact] })); vi.stubGlobal('fetch', fetcher);
  const open = vi.fn(); render(<ProjectReferences projectId={projectId} onOpen={open} />);
  expect(await screen.findByRole('link', { name: 'Download SYNTHETIC reference' })).toHaveAttribute('href', `/api/artifacts/${artifact.id}/versions/2/download`);
  expect(fetcher).toHaveBeenCalledWith(`/api/artifacts?projectId=${projectId}&limit=100`, expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Open project files / upload' })); expect(open).toHaveBeenCalledOnce();
});
it('reports unavailable files and never displays a response from another project', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ artifacts: [{ ...artifact, projectId: 'room_' + 'd'.repeat(32) }] })));
  render(<ProjectReferences projectId={projectId} />); await screen.findByRole('alert');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
