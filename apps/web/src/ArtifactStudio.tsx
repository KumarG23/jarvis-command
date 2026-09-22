import {
  ArtifactListResponseSchema,
  ArtifactMetadataSchema,
  ArtifactMutationResponseSchema,
  ArtifactSourceResponseSchema,
  type ArtifactMetadata,
  type ArtifactSummary,
  type ArtifactType,
} from '@jarvis-command/contracts';
import { Code2, Download, Eye, FilePlus2, History, Image as ImageIcon, Maximize2, MessageSquareQuote, Minimize2, Pencil, Search, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type SaveResponseRequest = Readonly<{
  key: string;
  sessionId: string | null;
  projectId: string | null;
  runId?: string | null;
  sourceRequestId?: string | null;
  title: string;
  artifactType?: ArtifactType | null;
  content: string;
}>;

type GenerateArtifactRequest = Readonly<{
  title: string;
  type: ArtifactType;
  instructions: string;
}>;

type GenerationStatus = Readonly<{
  state: 'idle' | 'running' | 'failed' | 'saving';
  message: string | null;
  title?: string | null;
  type?: ArtifactType | null;
  canRetry: boolean;
  canCancel: boolean;
}>;

type ArtifactStudioProps = Readonly<{
  open: boolean;
  selectedSessionId: string | null;
  projectId: string | null;
  canSendPrompt: boolean;
  pendingSave: SaveResponseRequest | null;
  onConsumedSave: (key: string) => void;
  onSendPrompt: (prompt: string) => boolean;
  onCreateWithJarvis: (request: GenerateArtifactRequest) => boolean;
  generation: GenerationStatus;
  onRetryGeneration: () => void;
  onCancelGeneration: () => void;
  onClose: () => void;
  fullScreen: boolean;
  onToggleFullScreen: () => void;
  onLibraryChanged?: () => void;
}>;

type ViewMode = 'preview' | 'source' | 'versions' | 'feedback' | 'export';
type Scope = 'current-session' | 'current-project' | 'all';

const textTypes: ArtifactType[] = ['markdown', 'text', 'report', 'log', 'code', 'diff', 'html', 'svg', 'mermaid'];
const typeLabels: Record<ArtifactType | 'all', string> = {
  all: 'All types',
  markdown: 'Markdown',
  text: 'Text',
  report: 'Report',
  log: 'Log',
  code: 'Code',
  diff: 'Diff',
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid',
  image: 'Image',
  pdf: 'PDF',
  file: 'File',
};

export function ArtifactStudio({ open, selectedSessionId, projectId, canSendPrompt, pendingSave, onConsumedSave, onSendPrompt, onCreateWithJarvis, generation, onRetryGeneration, onCancelGeneration, onClose, fullScreen, onToggleFullScreen, onLibraryChanged }: ArtifactStudioProps) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ArtifactMetadata | null>(null);
  const [source, setSource] = useState<{ version: number; content: string; type: ArtifactType; mime: string; sha256: string; size: number } | null>(null);
  const [mode, setMode] = useState<ViewMode>('preview');
  const [scope, setScope] = useState<Scope>(() => selectedSessionId ? 'current-session' : projectId ? 'current-project' : 'all');
  const [type, setType] = useState<ArtifactType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', type: 'markdown' as ArtifactType, content: '' });
  const [generationDraft, setGenerationDraft] = useState({ title: '', type: 'markdown' as ArtifactType, instructions: '' });
  const [edit, setEdit] = useState('');
  const [revisionNote, setRevisionNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [comment, setComment] = useState('');
  const [compare, setCompare] = useState<{ from: number; to: number; diff: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [dragging, setDragging] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const camera = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectedSessionId) setScope('current-session');
    else if (projectId) setScope('current-project');
  }, [selectedSessionId, projectId]);

  useEffect(() => {
    if (!open) return;
    void loadList();
  }, [open, scope, type, search, selectedSessionId, projectId]);

  useEffect(() => {
    if (!selectedId || !open) return;
    void loadArtifact(selectedId);
  }, [selectedId, open]);

  useEffect(() => {
    if (!selected || !open) return;
    void loadSource(selected.currentVersion).catch(() => setSource(null));
  }, [selected?.id, selected?.currentVersion, open]);

  useEffect(() => {
    if (!pendingSave || !open) return;
    void perform(async () => {
      const extracted = pendingSave.artifactType
        ? { type: pendingSave.artifactType, content: extractWholeFenceBody(pendingSave.content) ?? pendingSave.content }
        : artifactFromAssistantResponse(pendingSave.content);
      const artifact = await mutate('/api/artifacts/text', {
        title: pendingSave.title,
        type: extracted.type,
        content: extracted.content,
        sessionId: pendingSave.sessionId,
        projectId: pendingSave.projectId,
        runId: pendingSave.runId ?? null,
        sourceRequestId: pendingSave.sourceRequestId ?? null,
        source: 'assistant-response',
      });
      setStatus('Response saved as artifact.');
      setSelectedId(artifact.id);
      onConsumedSave(pendingSave.key);
      await loadList();
      onLibraryChanged?.();
    });
  }, [pendingSave?.key, open]);

  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!selected || !source || mode !== 'export') {
      setExportUrl(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      return;
    }
    const payload = JSON.stringify({ artifactId: selected.id, version: source.version, sha256: source.sha256, title: selected.title, type: source.type, mime: source.mime, content: source.content }, null, 2);
    const next = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }));
    setExportUrl(previous => {
      if (previous) URL.revokeObjectURL(previous);
      return next;
    });
    return () => URL.revokeObjectURL(next);
  }, [selected?.id, selected?.title, source?.version, source?.sha256, source?.type, source?.mime, source?.content, mode]);

  const filteredScope = useMemo(() => {
    if (scope === 'current-session' && selectedSessionId) return `sessionId=${encodeURIComponent(selectedSessionId)}`;
    if (scope === 'current-project' && projectId) return `projectId=${encodeURIComponent(projectId)}`;
    return '';
  }, [scope, selectedSessionId, projectId]);

  async function loadList() {
    setError(null);
    const params = new URLSearchParams();
    if (filteredScope) {
      const [key, value] = filteredScope.split('=');
      params.set(key!, decodeURIComponent(value!));
    }
    if (type !== 'all') params.set('type', type);
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', '80');
    try {
      const payload = ArtifactListResponseSchema.parse(await getJson(`/api/artifacts?${params.toString()}`));
      setArtifacts(payload.artifacts);
      if (!selectedId && payload.artifacts[0]) setSelectedId(payload.artifacts[0].id);
      if (selectedId && !payload.artifacts.some(item => item.id === selectedId)) setSelectedId(payload.artifacts[0]?.id ?? null);
    } catch {
      setError('Artifact library could not load.');
    }
  }

  async function loadArtifact(id: string) {
    setError(null);
    try {
      const artifact = ArtifactMetadataSchema.parse(await getJson(`/api/artifacts/${encodeURIComponent(id)}`));
      setSelected(artifact);
      setEdit('');
      setCompare(null);
    } catch {
      setError('Artifact metadata could not load.');
    }
  }

  async function loadSource(version: number) {
    if (!selected) return;
    const payload = ArtifactSourceResponseSchema.parse(await getJson(`/api/artifacts/${selected.id}/versions/${version}/source`));
      setSource({ version, content: payload.content, type: payload.type, mime: payload.mime, sha256: payload.sha256, size: payload.size });
      setEdit(payload.content);
  }

  async function createText() {
    if (!draft.title.trim() || !draft.content.trim()) return;
    await perform(async () => {
      const artifact = await mutate('/api/artifacts/text', {
        title: draft.title,
        type: draft.type,
        content: draft.content,
        sessionId: selectedSessionId,
        projectId,
        source: 'human',
      });
      setDraft({ title: '', type: 'markdown', content: '' });
      setStatus('Artifact created.');
      setSelectedId(artifact.id);
      await loadList();
      onLibraryChanged?.();
    });
  }

  async function upload(files: FileList | File[] | null) {
    const item = files?.[0];
    if (!item) return;
    await perform(async () => {
      const form = new FormData();
      form.append('metadata', JSON.stringify({
        title: item.name,
        sessionId: selectedSessionId,
        projectId,
      }));
      form.append('file', item, item.name);
      const artifact = await uploadArtifact(form);
      setStatus('Upload saved.');
      setSelectedId(artifact.id);
      await loadList();
      onLibraryChanged?.();
    });
  }

  async function saveVersion() {
    if (!selected || source?.version !== selected.currentVersion || !edit.trim()) return;
    await perform(async () => {
      const artifact = await mutate(`/api/artifacts/${selected.id}/versions`, {
        baseVersion: selected.currentVersion,
        content: edit,
        type: selected.type,
        revisionNote: revisionNote || null,
        feedback: feedback || null,
      });
      setSelected(artifact);
      setRevisionNote('');
      setFeedback('');
      setStatus('New immutable version saved.');
      await loadList();
      onLibraryChanged?.();
    });
  }

  async function toggleCanonical() {
    if (!selected) return;
    await perform(async () => {
      const artifact = await mutate(`/api/artifacts/${selected.id}/canonical`, {
        canonical: !selected.canonical,
        currentVersion: selected.currentVersion,
      });
      setSelected(artifact);
      setStatus(artifact.canonical ? 'Marked as the primary artifact for this work.' : 'Primary designation removed.');
      await loadList();
      onLibraryChanged?.();
    });
  }

  async function addComment() {
    if (!selected || !comment.trim()) return;
    await perform(async () => {
      const artifact = await mutate(`/api/artifacts/${selected.id}/comments`, {
        version: selected.currentVersion,
        body: comment,
      });
      setSelected(artifact);
      setComment('');
      setStatus('Feedback saved.');
      onLibraryChanged?.();
    });
  }

  async function compareVersions(from: number, to: number) {
    if (!selected) return;
    await perform(async () => {
      const payload = await getJson(`/api/artifacts/${selected.id}/compare?from=${from}&to=${to}`) as { diff: string };
      setCompare({ from, to, diff: payload.diff });
      setMode('versions');
    });
  }

  async function deleteArtifact() {
    if (!selected || deleteConfirm !== selected.id) return;
    await perform(async () => {
      const response = await fetch(`/api/artifacts/${selected.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' },
        body: JSON.stringify({ confirmArtifactId: selected.id, currentVersion: selected.currentVersion }),
      });
      if (!response.ok) throw new Error('delete failed');
      setStatus('Artifact deleted.');
      setSelected(null);
      setSelectedId(null);
      setDeleteConfirm('');
      await loadList();
      onLibraryChanged?.();
    });
  }

  function sendRevisionPrompt() {
    if (!selected || !source) return;
    const prompt = artifactPrompt('revision', selected, source.content, feedback || comment || '');
    if (onSendPrompt(prompt)) setStatus('Revision prompt sent. No artifact was changed until a resulting response is saved.');
  }

  function sendExportPrompt(kind: 'obsidian' | 'repository') {
    if (!selected || !source) return;
    const destination = kind === 'obsidian' ? 'Obsidian vault path to be reviewed' : 'repository path/branch to be reviewed';
    const prompt = artifactPrompt(kind, selected, source.content, `${feedback || comment || ''}\nDestination: ${destination}`);
    if (onSendPrompt(prompt)) setStatus('Export prompt sent for review. No external write has completed from Artifact Studio.');
  }

  function createWithJarvis() {
    if (!generationDraft.title.trim() || !generationDraft.instructions.trim()) return;
    const accepted = onCreateWithJarvis({
      title: generationDraft.title.trim(),
      type: generationDraft.type,
      instructions: generationDraft.instructions.trim(),
    });
    if (accepted) setGenerationDraft({ title: '', type: 'markdown', instructions: '' });
  }

  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      await operation();
    } catch {
      setError('Artifact operation could not be confirmed. Reload before retrying if the result is uncertain.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="artifact-studio" aria-label="Artifact Studio" onPaste={(event) => {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length) {
      event.preventDefault();
      void upload(pasted);
    }
  }} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (fullScreen) onToggleFullScreen();
      else onClose();
    }
  }} onDragEnter={event => {
    if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); }
  }} onDragOver={event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault();
  }} onDragLeave={event => {
    if (event.currentTarget === event.target) setDragging(false);
  }} onDrop={event => {
    const files = event.dataTransfer.files;
    if (files.length) {
      event.preventDefault();
      setDragging(false);
      void upload(files);
    }
  }}>
    <header className="pane-header artifact-header">
      <div><h2>Artifacts</h2><p>Private Command-side artifacts. Exports require Jarvis/tool approval.</p></div>
      <button className="icon-button" type="button" aria-label={fullScreen ? 'Exit full screen artifacts' : 'Full screen artifacts'} title={fullScreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullScreen}>{fullScreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
      <button ref={closeButton} className="icon-button" type="button" aria-label="Close artifacts" onClick={onClose}><X size={20} /></button>
    </header>
    {dragging ? <div className="drop-target" role="status">Drop to upload</div> : null}
    <div className="artifact-layout">
      <aside className="artifact-library" aria-label="Artifact library">
        <div className="artifact-controls">
          <label className="sidebar-search"><Search size={16} /><input type="search" aria-label="Search artifacts" placeholder="Search artifacts" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label>Scope<select aria-label="Artifact scope" value={scope} onChange={event => setScope(event.target.value as Scope)}>
            <option value="current-session" disabled={!selectedSessionId}>This chat</option>
            <option value="current-project" disabled={!projectId}>This project</option>
            <option value="all">All artifacts</option>
          </select></label>
          <label>Type<select aria-label="Artifact type filter" value={type} onChange={event => setType(event.target.value as ArtifactType | 'all')}>
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
        <details className="artifact-create-disclosure">
          <summary><FilePlus2 size={16} /> New text artifact</summary>
          <form className="artifact-create" aria-label="Create text artifact" onSubmit={event => { event.preventDefault(); void createText(); }}>
          <label>Title<input value={draft.title} maxLength={160} required onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Type<select value={draft.type} aria-label="New artifact type" onChange={event => setDraft({ ...draft, type: event.target.value as ArtifactType })}>{textTypes.map(item => <option key={item} value={item}>{typeLabels[item]}</option>)}</select></label>
          <label>Source<textarea value={draft.content} maxLength={1_048_576} required onChange={event => setDraft({ ...draft, content: event.target.value })} /></label>
          <button className="primary-button" type="submit" disabled={busy || !draft.title.trim() || !draft.content.trim()}>Create</button>
          </form>
        </details>
        <details className="artifact-create-disclosure">
          <summary><Sparkles size={16} /> Create with Jarvis</summary>
          <form className="artifact-create jarvis-create" aria-label="Create with Jarvis" onSubmit={event => { event.preventDefault(); createWithJarvis(); }}>
          <label>Title<input value={generationDraft.title} maxLength={160} required onChange={event => setGenerationDraft({ ...generationDraft, title: event.target.value })} /></label>
          <label>Type<select value={generationDraft.type} aria-label="Generated artifact type" onChange={event => setGenerationDraft({ ...generationDraft, type: event.target.value as ArtifactType })}>{textTypes.map(item => <option key={item} value={item}>{typeLabels[item]}</option>)}</select></label>
          <label>Instructions<textarea value={generationDraft.instructions} maxLength={8000} required onChange={event => setGenerationDraft({ ...generationDraft, instructions: event.target.value })} /></label>
          {generation.message ? <p className={`generation-status${generation.state === 'failed' ? ' error' : ''}`} role={generation.state === 'failed' ? 'alert' : 'status'}>{generation.message}</p> : null}
          <div className="button-row">
            <button className="primary-button" type="submit" disabled={busy || !canSendPrompt || generation.state === 'running' || generation.state === 'saving' || !generationDraft.title.trim() || !generationDraft.instructions.trim()}>Create with Jarvis</button>
            {generation.canRetry ? <button className="secondary-button" type="button" onClick={onRetryGeneration}>Retry</button> : null}
            {generation.canCancel ? <button className="secondary-button" type="button" onClick={onCancelGeneration}>Cancel</button> : null}
          </div>
          </form>
        </details>
        <div className="button-row upload-row">
          <input ref={file} type="file" className="visually-hidden" aria-label="Upload artifact file" onChange={event => void upload(event.target.files)} />
          <input ref={camera} type="file" className="visually-hidden" accept="image/*" capture="environment" aria-label="Capture artifact image" onChange={event => void upload(event.target.files)} />
          <button className="secondary-button" type="button" disabled={busy} onClick={() => file.current?.click()}><Upload size={15} /> Upload</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => camera.current?.click()}><ImageIcon size={15} /> Camera</button>
        </div>
        <div className="artifact-list" role="list" aria-label="Artifacts">
          {!artifacts.length ? <p className="empty-copy">No artifacts match this view.</p> : artifacts.map(artifact => <button key={artifact.id} type="button" role="listitem" className="artifact-card" aria-current={artifact.id === selectedId ? 'page' : undefined} onClick={() => setSelectedId(artifact.id)}>
            <span>{artifact.title}</span>
            <small>{typeLabels[artifact.type]} · v{artifact.currentVersion} · {formatBytes(artifact.size)}</small>
            {artifact.canonical ? <strong><Star size={13} /> Primary</strong> : null}
          </button>)}
        </div>
      </aside>
      <main className="artifact-workspace" aria-live="polite">
        {error ? <p role="alert" className="notice error">{error}</p> : null}
        {status ? <p role="status" className="notice">{status}</p> : null}
        {!selected ? <div className="artifact-empty"><FilePlus2 size={36} /><h3>Select or create an artifact</h3><p>Saved responses, uploads, text, diagrams and files appear here.</p></div> : <>
          <div className="artifact-title-row">
            <div><h3>{selected.title}</h3><p>{selected.id} · v{selected.currentVersion} · {selected.sha256.slice(0, 16)}…</p></div>
            <button className={`secondary-button${selected.canonical ? ' active' : ''}`} type="button" disabled={busy} title="Mark this as the preferred artifact to use for this work" onClick={() => void toggleCanonical()}><Star size={15} /> {selected.canonical ? 'Primary' : 'Set as primary'}</button>
            <a className="secondary-button" href={downloadUrl(selected)}><Download size={15} /> Download</a>
          </div>
          {source && source.version !== selected.currentVersion ? <p className="notice">Viewing historical source v{source.version}. Current metadata is v{selected.currentVersion}; historical source is read-only.</p> : null}
          <div className="artifact-tabs" role="tablist" aria-label="Artifact views">
            {(['preview', 'source', 'versions', 'feedback', 'export'] as ViewMode[]).map(item => <button key={item} role="tab" aria-selected={mode === item} className="tab-button" type="button" onClick={() => setMode(item)}>{tabIcon(item)} {item}</button>)}
          </div>
          {mode === 'preview' ? <ArtifactPreview artifact={source ? { ...selected, type: source.type, mime: source.mime, size: source.size, sha256: source.sha256, currentVersion: source.version } : selected} source={source?.content ?? ''} /> : null}
          {mode === 'source' ? <section className="artifact-editor" aria-label="Artifact source editor">
            <textarea aria-label="Edit artifact source" value={edit} readOnly={source?.version !== selected.currentVersion} disabled={!textTypes.includes(selected.type)} onChange={event => setEdit(event.target.value)} />
            {!textTypes.includes(selected.type) ? <p className="muted">Binary artifacts are immutable from this editor. Upload a new file artifact instead.</p> : null}
            {source?.version !== selected.currentVersion ? <button className="secondary-button" type="button" onClick={() => void loadSource(selected.currentVersion)}>View current version for editing</button> : null}
            <label>Revision note<input value={revisionNote} maxLength={2000} onChange={event => setRevisionNote(event.target.value)} /></label>
            <label>Feedback/context<textarea value={feedback} maxLength={8000} onChange={event => setFeedback(event.target.value)} /></label>
            <div className="button-row">
              <button className="primary-button" type="button" disabled={busy || source?.version !== selected.currentVersion || !textTypes.includes(selected.type) || source?.content === edit || !edit.trim()} onClick={() => void saveVersion()}><Pencil size={15} /> Save new version</button>
              <button className="secondary-button" type="button" disabled={!canSendPrompt || !source} onClick={sendRevisionPrompt}><MessageSquareQuote size={15} /> Revision prompt</button>
            </div>
          </section> : null}
          {mode === 'versions' ? <section className="artifact-versions" aria-label="Artifact version history">
            {selected.versions.map(version => <div className="version-row" key={version.version}>
              <button className="text-button" type="button" onClick={() => void loadSource(version.version)}>v{version.version}</button>
              <span>{new Date(version.createdAt).toLocaleString()}</span><span>{formatBytes(version.size)}</span><code>{version.sha256.slice(0, 12)}</code>
              {version.parentVersion ? <button className="secondary-button" type="button" onClick={() => void compareVersions(version.parentVersion!, version.version)}>Compare to parent</button> : null}
            </div>)}
            {compare ? <pre className="artifact-diff" aria-label={`Diff v${compare.from} to v${compare.to}`}>{compare.diff}</pre> : null}
          </section> : null}
          {mode === 'feedback' ? <section className="artifact-feedback" aria-label="Artifact feedback">
            <form onSubmit={event => { event.preventDefault(); void addComment(); }}>
              <label>Comment<textarea value={comment} maxLength={4000} onChange={event => setComment(event.target.value)} /></label>
              <button className="primary-button" type="submit" disabled={busy || !comment.trim()}>Add comment</button>
            </form>
            {selected.comments.length ? selected.comments.map(item => <article className="comment-card" key={item.id}><p>{item.body}</p><small>v{item.version ?? 'all'} · {new Date(item.createdAt).toLocaleString()}</small></article>) : <p className="empty-copy">No feedback yet.</p>}
          </section> : null}
          {mode === 'export' ? <section className="artifact-export" aria-label="Reviewed export workflows">
            <p className="muted">These create review payloads and Jarvis prompts only. Artifact Studio does not write to Obsidian or repositories.</p>
            {exportUrl ? <a className="secondary-button" href={exportUrl} download={`${selected.id}-v${source?.version ?? selected.currentVersion}-export.json`}><Download size={15} /> Export payload</a> : null}
            <button className="secondary-button" type="button" disabled={!canSendPrompt || !source} onClick={() => sendExportPrompt('obsidian')}>Prompt Obsidian export</button>
            <button className="secondary-button" type="button" disabled={!canSendPrompt || !source} onClick={() => sendExportPrompt('repository')}>Prompt repository commit</button>
            <div className="delete-zone">
              <label>Confirm delete by artifact ID<input value={deleteConfirm} onChange={event => setDeleteConfirm(event.target.value)} /></label>
              <button className="danger-button" type="button" disabled={busy || deleteConfirm !== selected.id} onClick={() => void deleteArtifact()}><Trash2 size={15} /> Delete artifact</button>
            </div>
          </section> : null}
        </>}
      </main>
    </div>
  </section>;
}

function ArtifactPreview({ artifact, source }: Readonly<{ artifact: ArtifactMetadata; source: string }>) {
  if (artifact.type === 'markdown') return <div className="artifact-preview markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
    img: ({ alt }) => <span className="markdown-image-placeholder">[Image blocked: {alt || 'no alt text'}]</span>,
  }}>{source}</ReactMarkdown></div>;
  if (['code', 'diff', 'text', 'report', 'log'].includes(artifact.type)) return <pre className="artifact-pre">{source}</pre>;
  if (artifact.type === 'html') return <SandboxFrame title={artifact.title} content={source} kind="html" />;
  if (artifact.type === 'svg') return <SandboxFrame title={artifact.title} content={source} kind="svg" />;
  if (artifact.type === 'mermaid') return <MermaidFrame title={artifact.title} graph={source} />;
  if (artifact.type === 'image' || artifact.type === 'pdf') return <BlobPreview artifact={artifact} />;
  return <div className="generic-artifact"><h4>{artifact.originalFilename ?? artifact.title}</h4><p>{artifact.mime} · {formatBytes(artifact.size)} · {artifact.sha256}</p><a className="primary-button" href={downloadUrl(artifact)}><Download size={15} /> Download file</a></div>;
}

function BlobPreview({ artifact }: Readonly<{ artifact: ArtifactMetadata }>) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let current: string | null = null;
    const controller = new AbortController();
    void fetch(`/api/artifacts/${artifact.id}/versions/${artifact.currentVersion}/blob`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('blob');
        return response.blob();
      })
      .then(blob => {
        current = URL.createObjectURL(blob);
        setUrl(current);
      })
      .catch(() => setUrl(null));
    return () => {
      controller.abort();
      if (current) URL.revokeObjectURL(current);
    };
  }, [artifact.id, artifact.currentVersion]);
  if (!url) return <p role="status">Loading preview…</p>;
  return artifact.type === 'pdf'
    ? <iframe className="blob-frame" title={artifact.title} src={url} sandbox="" />
    : <img className="image-preview" src={url} alt={artifact.title} />;
}

function SandboxFrame({ title, content, kind }: Readonly<{ title: string; content: string; kind: 'html' | 'svg' }>) {
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  const body = kind === 'svg' ? content : content;
  const srcDoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}"><body>${body}</body>`;
  return <iframe className="sandbox-frame" title={title} sandbox="allow-scripts" srcDoc={srcDoc} />;
}

function MermaidFrame({ title, graph }: Readonly<{ title: string; graph: string }>) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    void import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
        return mermaid.render(`artifact-mermaid-${Math.random().toString(16).slice(2)}`, graph);
      })
      .then(result => { if (!cancelled) setSvg(result.svg); })
      .catch(() => { if (!cancelled) setSvg('<pre>Mermaid diagram could not render.</pre>'); });
    return () => { cancelled = true; };
  }, [graph]);
  return <SandboxFrame title={title} content={svg} kind="html" />;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('request failed');
  return response.json() as Promise<unknown>;
}

async function mutate(path: string, body: unknown): Promise<ArtifactMetadata> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-jarvis-command': '1' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('mutation failed');
  return ArtifactMutationResponseSchema.parse(await response.json()).artifact;
}

async function uploadArtifact(form: FormData): Promise<ArtifactMetadata> {
  const response = await fetch('/api/artifacts/upload', {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    headers: { accept: 'application/json', 'x-jarvis-command': '1' },
    body: form,
  });
  if (!response.ok) throw new Error('upload failed');
  return ArtifactMutationResponseSchema.parse(await response.json()).artifact;
}

function tabIcon(mode: ViewMode) {
  const icons = { preview: <Eye size={14} />, source: <Code2 size={14} />, versions: <History size={14} />, feedback: <MessageSquareQuote size={14} />, export: <Download size={14} /> };
  return icons[mode];
}

function artifactFromAssistantResponse(content: string): { type: ArtifactType; content: string } {
  const match = wholeFenceMatch(content);
  if (!match) return { type: 'markdown', content };
  const language = (match[1] ?? '').toLowerCase();
  const body = match[2] ?? '';
  if ((language === 'html' || language === 'svg') && isSafeActiveFence(body, language)) return { type: language, content: body };
  if (language === 'mermaid' && body.trim()) return { type: 'mermaid', content: body };
  if ((language === 'diff' || language === 'patch') && body.trim()) return { type: 'diff', content: body };
  return { type: 'markdown', content };
}

function extractWholeFenceBody(content: string): string | null {
  return wholeFenceMatch(content)?.[2] ?? null;
}

function wholeFenceMatch(content: string): RegExpMatchArray | null {
  return content.match(/^\s*```([A-Za-z0-9_-]+)?[^\n]*\n([\s\S]*?)\n```\s*$/);
}

function downloadUrl(artifact: ArtifactMetadata | ArtifactSummary): string {
  return `/api/artifacts/${artifact.id}/versions/${artifact.currentVersion}/download`;
}

function artifactPrompt(kind: 'revision' | 'obsidian' | 'repository', artifact: ArtifactMetadata, content: string, feedbackText: string): string {
  const contentLimit = 9_000;
  const feedbackLimit = 2_000;
  const contentTruncated = content.length > contentLimit;
  const feedbackTruncated = feedbackText.length > feedbackLimit;
  const bounded = content.slice(0, contentLimit);
  const boundedFeedback = feedbackText.trim().slice(0, feedbackLimit);
  return [
    kind === 'revision' ? 'Please propose a revised artifact response.' : kind === 'obsidian' ? 'Please prepare a reviewed Obsidian export action.' : 'Please prepare a reviewed repository commit/export action.',
    `Artifact: ${artifact.id}`,
    `Version: ${artifact.currentVersion}`,
    `SHA-256: ${artifact.sha256}`,
    `Title: ${artifact.title}`,
    `Type: ${artifact.type}`,
    'Do not claim the artifact was changed or exported until the reviewed tool action succeeds. If you produce revised content, I will save the response as a new artifact version.',
    contentTruncated || feedbackTruncated ? `Truncation notice: Artifact Studio bounded this prompt below the live input limit. Full artifact content remains in Artifact Studio.` : '',
    boundedFeedback ? `Feedback:\n${boundedFeedback}${feedbackTruncated ? '\n[Feedback truncated]' : ''}` : '',
    `Current content, bounded:\n${bounded}${contentTruncated ? '\n[Content truncated]' : ''}`,
  ].filter(Boolean).join('\n\n');
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function isSafeActiveFence(body: string, language: string): boolean {
  if (language === 'svg') return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(body);
  return /^\s*<!doctype html\b|^\s*<html(?:\s|>)/i.test(body);
}
