import { ArtifactListResponseSchema, type ArtifactSummary } from '@jarvis-command/contracts';
import { boundedJson } from './useLiveTurn';
import { useEffect, useState } from 'react';

// A project index over P4 storage, never a second artifact store.
export function ProjectReferences({ projectId, onOpen }: Readonly<{ projectId: string; onOpen?: (() => void) | undefined }>) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setArtifacts(null); setError(false);
    void boundedJson(`/api/artifacts?projectId=${encodeURIComponent(projectId)}&limit=100`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' }, controller)
      .then(body => { const data = ArtifactListResponseSchema.parse(body); if (data.artifacts.some(item => item.projectId !== projectId)) throw Error('Project file identity mismatch'); return data; })
      .then(data => { if (active) setArtifacts(data.artifacts); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; controller.abort(); };
  }, [projectId, attempt]);
  return <section><h4>Saved artifacts & reference files</h4>
    {error ? <p role="alert">Project files unavailable. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry files</button></p> : artifacts === null ? <p>Loading project files…</p> : artifacts.length ? <ul>{artifacts.map(artifact => <li key={artifact.id}><span>{artifact.title} · v{artifact.currentVersion}</span> <a href={`/api/artifacts/${artifact.id}/versions/${artifact.currentVersion}/download`}>Download {artifact.title}</a></li>)}</ul> : <p>No saved project files yet.</p>}
    {artifacts?.length === 100 ? <p>Showing the first 100 files. Search the project library for more.</p> : null}
    <button className="secondary-button" type="button" onClick={onOpen}>Open project files / upload</button>
  </section>;
}
