import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from './artifact-store';
import { createArtifactImageResolver } from './bootstrap';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-chat-images-'));
  roots.push(root);
  const artifacts = new ArtifactStore({ root, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024, maxArtifacts: 10 });
  await artifacts.init();
  return artifacts;
}

describe('artifact-backed chat images', () => {
  it('resolves the exact immutable image version bytes', async () => {
    const artifacts = await store();
    const created = await artifacts.createBlob({
      title: 'source.png', type: 'image', mime: 'image/png', creator: { subject: 'operator', source: 'upload' },
      bytes: Buffer.from('89504e470d0a1a0a', 'hex'),
    });
    const images = await createArtifactImageResolver(artifacts)([{ artifactId: created.id, version: 1 }]);
    expect(images).toEqual([{ mime: 'image/png', bytes: Buffer.from('89504e470d0a1a0a', 'hex') }]);
  });

  it('rejects non-image artifacts before they reach Hermes', async () => {
    const artifacts = await store();
    const created = await artifacts.createBlob({
      title: 'note.md', type: 'markdown', mime: 'text/markdown', creator: { subject: 'operator', source: 'human' },
      bytes: Buffer.from('# note'),
    });
    await expect(createArtifactImageResolver(artifacts)([{ artifactId: created.id, version: 1 }])).rejects.toMatchObject({ statusCode: 415 });
  });
});
