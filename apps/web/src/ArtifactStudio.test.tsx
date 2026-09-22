import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStudio } from './ArtifactStudio';
import type { ArtifactMetadata } from '@jarvis-command/contracts';

const baseArtifact: ArtifactMetadata = {
  id: 'art_' + 'a'.repeat(32),
  title: 'Saved answer',
  type: 'markdown',
  mime: 'text/markdown',
  createdAt: '2026-09-22T14:00:00.000Z',
  updatedAt: '2026-09-22T14:00:00.000Z',
  creator: { subject: 'operator', source: 'assistant-response' },
  sessionId: 'jc_' + 'b'.repeat(32),
  projectId: 'room_' + 'c'.repeat(32),
  runId: null,
  sourceRequestId: null,
  size: 13,
  sha256: 'd'.repeat(64),
  currentVersion: 1,
  canonical: false,
  privateMode: 'private',
  originalFilename: null,
  versions: [{ version: 1, parentVersion: null, baseVersion: null, createdAt: '2026-09-22T14:00:00.000Z', creator: { subject: 'operator', source: 'assistant-response' }, mime: 'text/markdown', size: 13, sha256: 'd'.repeat(64), revisionNote: null, feedback: null, originalFilename: null }],
  comments: [],
};

function mockArtifactBackend(initial: ArtifactMetadata[] = [baseArtifact]) {
  let artifacts = [...initial];
  const fetchMock = vi.fn(async (raw: string, init?: RequestInit) => {
    const url = new URL(raw, 'https://command.example.test');
    const id = url.pathname.match(/\/api\/artifacts\/(art_[a-f0-9]{32})/)?.[1];
    if (url.pathname === '/api/artifacts') {
      return Response.json({ artifacts: artifacts.map((artifact) => {
        const summary = { ...artifact } as Partial<ArtifactMetadata>;
        delete summary.versions;
        delete summary.comments;
        return summary;
      }) });
    }
    if (url.pathname === '/api/artifacts/text') {
      const body = JSON.parse(String(init?.body)) as { title: string; type: ArtifactMetadata['type']; content: string; sessionId: string | null; projectId: string | null; runId?: string | null; sourceRequestId?: string | null; source: ArtifactMetadata['creator']['source'] };
      const artifact: ArtifactMetadata = {
        ...baseArtifact,
        id: `art_${String(artifacts.length + 1).padStart(32, '0')}`,
        title: body.title,
        type: body.type,
        mime: body.type === 'markdown' ? 'text/markdown' : 'text/plain',
        sessionId: body.sessionId,
        projectId: body.projectId,
        runId: body.runId ?? null,
        sourceRequestId: body.sourceRequestId ?? null,
        creator: { subject: 'operator', source: body.source },
        currentVersion: 1,
        versions: [{ ...baseArtifact.versions[0]!, creator: { subject: 'operator', source: body.source }, mime: body.type === 'markdown' ? 'text/markdown' : 'text/plain' }],
        comments: [],
      };
      artifacts = [artifact, ...artifacts];
      return Response.json({ artifact });
    }
    if (id && url.pathname === `/api/artifacts/${id}`) {
      return Response.json(artifacts.find(item => item.id === id));
    }
    if (url.pathname.endsWith('/source') && id) {
      const artifact = artifacts.find(item => item.id === id)!;
      return Response.json({ artifactId: id, version: artifact.currentVersion, type: artifact.type, mime: artifact.mime, size: 13, sha256: artifact.sha256, content: artifact.currentVersion === 1 ? '# Hello' : '# Hello\nchanged' });
    }
    if (url.pathname.endsWith('/versions') && id) {
      const artifact = artifacts.find(item => item.id === id)!;
      const next = { ...artifact, currentVersion: artifact.currentVersion + 1, updatedAt: '2026-09-22T14:01:00.000Z', versions: [...artifact.versions, { ...artifact.versions[0]!, version: artifact.currentVersion + 1, parentVersion: artifact.currentVersion, baseVersion: artifact.currentVersion, createdAt: '2026-09-22T14:01:00.000Z' }] };
      artifacts = artifacts.map(item => item.id === id ? next : item);
      return Response.json({ artifact: next });
    }
    if (url.pathname.endsWith('/compare') && id) return Response.json({ artifactId: id, from: 1, to: 2, diff: '--- version A\n+++ version B\n+# Hello changed' });
    if (url.pathname.endsWith('/comments') && id) {
      const artifact = artifacts.find(item => item.id === id)!;
      const next = { ...artifact, comments: [...artifact.comments, { id: 'comment_' + 'e'.repeat(24), artifactId: id, version: artifact.currentVersion, body: 'Needs polish', createdAt: '2026-09-22T14:02:00.000Z', creator: 'operator' }] };
      artifacts = artifacts.map(item => item.id === id ? next : item);
      return Response.json({ artifact: next });
    }
    if (url.pathname.endsWith('/canonical') && id) {
      const artifact = artifacts.find(item => item.id === id)!;
      const next = { ...artifact, canonical: !artifact.canonical };
      artifacts = artifacts.map(item => item.id === id ? next : item);
      return Response.json({ artifact: next });
    }
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:artifact-export') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

function renderStudio(props: Partial<Parameters<typeof ArtifactStudio>[0]> = {}) {
  return render(<ArtifactStudio
    open
    selectedSessionId={baseArtifact.sessionId}
    projectId={baseArtifact.projectId}
    canSendPrompt
    pendingSave={null}
    onConsumedSave={vi.fn()}
    onSendPrompt={vi.fn()}
    onCreateWithJarvis={vi.fn()}
    generation={{ state: 'idle', message: null, title: null, type: null, canRetry: false, canCancel: false }}
    onRetryGeneration={vi.fn()}
    onCancelGeneration={vi.fn()}
    onClose={vi.fn()}
    fullScreen={false}
    onToggleFullScreen={vi.fn()}
    {...props}
  />);
}

describe('ArtifactStudio', () => {
  it('loads the library, previews markdown safely, edits a new version and compares versions', async () => {
    mockArtifactBackend();
    renderStudio();
    fireEvent.click((await screen.findByText('Saved answer')).closest('button')!);
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /source/i }));
    fireEvent.change(screen.getByLabelText('Edit artifact source'), { target: { value: '# Hello\nchanged' } });
    fireEvent.click(screen.getByRole('button', { name: /Save new version/ }));
    await screen.findByText('New immutable version saved.');
    fireEvent.click(screen.getByRole('tab', { name: /versions/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Compare to parent/ }));
    expect(await screen.findByLabelText('Diff v1 to v2')).toHaveTextContent('Hello changed');
  });

  it('creates text artifacts, saves real response payloads, comments, canonical state and reviewed export prompts', async () => {
    const fetchMock = mockArtifactBackend([]);
    const sent = vi.fn((prompt: string) => prompt.length > 0);
    const consumed = vi.fn();
    renderStudio({ pendingSave: { key: 'response-1', sessionId: baseArtifact.sessionId, projectId: baseArtifact.projectId, title: 'Actual response', content: 'assistant body' }, onConsumedSave: consumed, onSendPrompt: sent });
    await waitFor(() => expect(consumed).toHaveBeenCalledWith('response-1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/artifacts/text', expect.objectContaining({ body: expect.stringContaining('assistant body') }));
    const manual = screen.getByRole('form', { name: 'Create text artifact' });
    fireEvent.change(within(manual).getByLabelText('Title'), { target: { value: 'Manual note' } });
    fireEvent.change(within(manual).getByLabelText('Source'), { target: { value: 'note body' } });
    fireEvent.click(within(manual).getByRole('button', { name: 'Create' }));
    await screen.findByText('Artifact created.');
    fireEvent.click(screen.getByRole('tab', { name: /feedback/i }));
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Needs polish' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(await screen.findByText('Needs polish')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Set as primary/ }));
    await screen.findByText('Marked as the primary artifact for this work.');
    fireEvent.click(screen.getByRole('tab', { name: /export/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Prompt Obsidian export' }));
    expect(sent.mock.calls[0]![0]).toContain('reviewed Obsidian export action');
    expect(within(screen.getByRole('region', { name: 'Reviewed export workflows' })).getByText(/does not write to Obsidian/)).toBeInTheDocument();
  });

  it('uses sandboxed iframes for executable HTML artifacts and mobile-friendly close semantics', async () => {
    const htmlArtifact = { ...baseArtifact, type: 'html' as const, mime: 'text/html', title: 'Interactive page' };
    mockArtifactBackend([htmlArtifact]);
    const close = vi.fn();
    renderStudio({ selectedSessionId: htmlArtifact.sessionId, projectId: htmlArtifact.projectId, canSendPrompt: false, onClose: close });
    const frame = await screen.findByTitle('Interactive page');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('connect-src'));
    fireEvent.click(screen.getByRole('button', { name: 'Close artifacts' }));
    expect(close).toHaveBeenCalled();
  });

  it('defaults assistant responses to Markdown unless the whole response is one safe artifact fence', async () => {
    const fetchMock = mockArtifactBackend([]);
    const consumed = vi.fn();
    const first = renderStudio({ pendingSave: { key: 'mixed', sessionId: baseArtifact.sessionId, projectId: baseArtifact.projectId, title: 'Mixed response', content: 'Notes\n```html\n<html></html>\n```' }, onConsumedSave: consumed });
    await waitFor(() => expect(consumed).toHaveBeenCalledWith('mixed'));
    expect(fetchMock).toHaveBeenCalledWith('/api/artifacts/text', expect.objectContaining({ body: expect.stringContaining('"type":"markdown"') }));

    first.unmount();
    vi.unstubAllGlobals();
    mockArtifactBackend([]);
    const exact = vi.fn();
    renderStudio({ pendingSave: { key: 'exact', sessionId: baseArtifact.sessionId, projectId: baseArtifact.projectId, title: 'Exact page', content: '```html\n<!doctype html><html><body>ok</body></html>\n```' }, onConsumedSave: exact });
    await waitFor(() => expect(exact).toHaveBeenCalledWith('exact'));
    expect(fetch).toHaveBeenCalledWith('/api/artifacts/text', expect.objectContaining({ body: expect.stringContaining('"type":"html"') }));
    expect(fetch).toHaveBeenCalledWith('/api/artifacts/text', expect.objectContaining({ body: expect.stringContaining('<!doctype html><html><body>ok</body></html>') }));
  });

  it('preserves generated artifact requested type and provenance while extracting one exact whole-response fence', async () => {
    const fetchMock = mockArtifactBackend([]);
    const consumed = vi.fn();
    const sourceRequestId = 'gen_' + '2'.repeat(32);
    const runId = 'jcr_' + '3'.repeat(32);
    renderStudio({
      pendingSave: {
        key: sourceRequestId,
        sourceRequestId,
        sessionId: baseArtifact.sessionId,
        projectId: baseArtifact.projectId,
        runId,
        title: 'Generated code',
        artifactType: 'code',
        content: '```ts\nexport const answer = 42;\n```',
      },
      onConsumedSave: consumed,
    });
    await waitFor(() => expect(consumed).toHaveBeenCalledWith(sourceRequestId));
    const body = JSON.parse(String(fetchMock.mock.calls.find(call => call[0] === '/api/artifacts/text')![1]!.body));
    expect(body).toMatchObject({
      title: 'Generated code',
      type: 'code',
      content: 'export const answer = 42;',
      runId,
      sourceRequestId,
      source: 'assistant-response',
    });
  });

  it('keeps historical source read-only until the current version is explicitly reloaded', async () => {
    const versioned = { ...baseArtifact, currentVersion: 2, versions: [...baseArtifact.versions, { ...baseArtifact.versions[0]!, version: 2, parentVersion: 1, baseVersion: 1, createdAt: '2026-09-22T14:03:00.000Z' }] };
    mockArtifactBackend([versioned]);
    renderStudio();
    fireEvent.click((await screen.findByText('Saved answer')).closest('button')!);
    fireEvent.click(screen.getByRole('tab', { name: /versions/i }));
    fireEvent.click(screen.getByRole('button', { name: 'v1' }));
    expect(await screen.findByText(/Viewing historical source v1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /source/i }));
    expect(screen.getByLabelText('Edit artifact source')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: /Save new version/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /View current version for editing/ }));
    await waitFor(() => expect(screen.getByLabelText('Edit artifact source')).not.toHaveAttribute('readonly'));
  });
});
