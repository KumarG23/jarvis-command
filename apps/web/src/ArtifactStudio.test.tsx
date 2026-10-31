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

function mockArtifactBackend(initial: ArtifactMetadata[] = [baseArtifact], options: { sourceStatus?: (artifact: ArtifactMetadata) => number | null } = {}) {
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
      const status = options.sourceStatus?.(artifact);
      if (status) return Response.json({ error: 'bad_request' }, { status });
      const version = Number(url.pathname.match(/\/versions\/(\d+)\/source/)?.[1] ?? artifact.currentVersion);
      const selected = artifact.versions.find(item => item.version === version) ?? artifact.versions.at(-1)!;
      return Response.json({ artifactId: id, version, type: selected.type ?? artifact.type, mime: selected.mime, size: selected.size, sha256: selected.sha256, content: version === 1 ? '# Hello' : '# Hello\nchanged' });
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
    fireEvent.click(screen.getByText('New text artifact'));
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

  it('shows an honest unavailable source with a working download instead of stale or empty preview content', async () => {
    const oversized: ArtifactMetadata = {
      ...baseArtifact,
      id: 'art_' + 'e'.repeat(32),
      title: 'Oversized page',
      type: 'html',
      mime: 'text/html',
      size: 1_300_000,
      sha256: 'f'.repeat(64),
      versions: [{ ...baseArtifact.versions[0]!, type: 'html', mime: 'text/html', size: 1_300_000, sha256: 'f'.repeat(64) }],
    };
    const fetchMock = mockArtifactBackend([baseArtifact, oversized], { sourceStatus: artifact => artifact.id === oversized.id ? 415 : null });
    renderStudio();
    fireEvent.click((await screen.findByText('Saved answer')).closest('button')!);
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Oversized page').closest('button')!);
    expect(await screen.findByText(/larger than the 1 MiB preview limit/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Hello' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Oversized page')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download version 1' }).getAttribute('href')).toBe(`/api/artifacts/${oversized.id}/versions/1/download`);

    fireEvent.click(screen.getByRole('tab', { name: /source/i }));
    expect(screen.queryByLabelText('Edit artifact source')).not.toBeInTheDocument();
    expect(screen.getByText('Editing is disabled until the correct source loads.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/artifacts/${oversized.id}/versions/1/source`, expect.anything());
  });

  it('offers a download for every immutable historical version with the matching checksum', async () => {
    const versioned: ArtifactMetadata = {
      ...baseArtifact,
      currentVersion: 2,
      size: 9,
      sha256: '2'.repeat(64),
      versions: [
        { ...baseArtifact.versions[0]!, version: 1, type: 'markdown', mime: 'text/markdown', size: 5, sha256: '1'.repeat(64) },
        { ...baseArtifact.versions[0]!, version: 2, parentVersion: 1, baseVersion: 1, type: 'markdown', mime: 'text/markdown', size: 9, sha256: '2'.repeat(64), createdAt: '2026-09-22T14:03:00.000Z' },
      ],
    };
    mockArtifactBackend([versioned]);
    renderStudio();
    fireEvent.click((await screen.findByText('Saved answer')).closest('button')!);
    fireEvent.click(await screen.findByRole('tab', { name: /versions/i }));
    expect(screen.getByText('1'.repeat(12))).toBeInTheDocument();
    expect(screen.getByText('2'.repeat(12))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download version 1' })).toHaveAttribute('href', `/api/artifacts/${versioned.id}/versions/1/download`);
    expect(screen.getByRole('link', { name: 'Download version 2' })).toHaveAttribute('href', `/api/artifacts/${versioned.id}/versions/2/download`);
  });

  it('previews images from the fixed same-origin blob route without creating a blob URL', async () => {
    const image: ArtifactMetadata = {
      ...baseArtifact,
      id: 'art_' + 'f'.repeat(32),
      title: 'Photo',
      type: 'image',
      mime: 'image/png',
      size: 2048,
      sha256: '9'.repeat(64),
      versions: [{ ...baseArtifact.versions[0]!, type: 'image', mime: 'image/png', size: 2048, sha256: '9'.repeat(64) }],
    };
    const fetchMock = mockArtifactBackend([image]);
    renderStudio();
    fireEvent.click((await screen.findByText('Photo')).closest('button')!);

    const preview = await screen.findByRole('img', { name: 'Photo' });
    expect(preview).toHaveAttribute('src', `/api/artifacts/${image.id}/versions/1/blob`);
    expect(preview.getAttribute('src')).not.toMatch(/^blob:/);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/blob'))).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('shows honest unavailable states with exact-version downloads for failed images and PDFs', async () => {
    const image: ArtifactMetadata = {
      ...baseArtifact,
      id: 'art_' + 'f'.repeat(32),
      title: 'Broken photo',
      type: 'image',
      mime: 'image/png',
      size: 2048,
      sha256: '9'.repeat(64),
      versions: [{ ...baseArtifact.versions[0]!, type: 'image', mime: 'image/png', size: 2048, sha256: '9'.repeat(64) }],
    };
    const pdf: ArtifactMetadata = {
      ...baseArtifact,
      id: 'art_' + 'e'.repeat(32),
      title: 'Paper',
      type: 'pdf',
      mime: 'application/pdf',
      size: 4096,
      sha256: '8'.repeat(64),
      versions: [{ ...baseArtifact.versions[0]!, type: 'pdf', mime: 'application/pdf', size: 4096, sha256: '8'.repeat(64) }],
    };
    const fetchMock = mockArtifactBackend([image, pdf]);
    renderStudio();

    fireEvent.click((await screen.findByText('Broken photo')).closest('button')!);
    fireEvent.error(await screen.findByRole('img', { name: 'Broken photo' }));
    expect(await screen.findByText(/this image could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download version 1' })).toHaveAttribute('href', `/api/artifacts/${image.id}/versions/1/download`);

    fireEvent.click(screen.getByText('Paper').closest('button')!);
    expect(await screen.findByText(/PDF files are download-only/)).toBeInTheDocument();
    expect(screen.queryByTitle('Paper')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download version 1' })).toHaveAttribute('href', `/api/artifacts/${pdf.id}/versions/1/download`);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/blob'))).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps binary artifacts downloadable and out of the text editor', async () => {
    const image: ArtifactMetadata = {
      ...baseArtifact,
      id: 'art_' + 'f'.repeat(32),
      title: 'Photo',
      type: 'image',
      mime: 'image/png',
      size: 2048,
      sha256: '9'.repeat(64),
      versions: [{ ...baseArtifact.versions[0]!, type: 'image', mime: 'image/png', size: 2048, sha256: '9'.repeat(64) }],
    };
    mockArtifactBackend([image]);
    renderStudio();
    fireEvent.click((await screen.findByText('Photo')).closest('button')!);
    fireEvent.click(await screen.findByRole('tab', { name: /source/i }));
    expect(await screen.findByText(/Binary artifacts can be downloaded but cannot be edited as text/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit artifact source')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /versions/i }));
    expect(screen.getByRole('link', { name: 'Download version 1' })).toHaveAttribute('href', `/api/artifacts/${image.id}/versions/1/download`);
  });
});
