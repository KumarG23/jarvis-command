import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from './config';
import { buildApp } from './app';
import { ArtifactStore } from './artifact-store';

const roots: string[] = [];

function config(root: string): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    appVersion: 'artifact-test',
    authMode: 'cloudflare',
    cloudflare: {
      teamDomain: 'team.cloudflareaccess.com',
      audience: 'a'.repeat(64),
      allowedEmailHash: 'b'.repeat(64),
      jwksFile: '/run/jarvis-command/cloudflare-jwks/certs.json',
    },
    hermes: { baseUrl: 'http://127.0.0.1:18642', readProxyKey: 'server-side-read-proxy-secret' },
    command: {
      baseUrl: 'http://127.0.0.1:18643',
      commandProxyKey: 'server-side-command-proxy-secret',
      auditLogPath: join(root, 'audit', 'events.jsonl'),
      publicOrigin: 'https://command.example.test',
    },
    webDistDir: undefined,
    artifacts: { enabled: true, root, maxFileBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 10 },
  };
}

async function makeApp() {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-artifacts-test-'));
  roots.push(root);
  const app = buildApp({
    config: config(root),
    verifyAccess: vi.fn(async assertion => {
      if (assertion !== 'valid') throw new Error('denied');
      return { subject: 'operator', provider: 'cloudflare-access' as const };
    }),
    hermes: { readSnapshot: vi.fn() },
  });
  return { app, root };
}

const headers = {
  'cf-access-jwt-assertion': 'valid',
  origin: 'https://command.example.test',
  'x-jarvis-command': '1',
  'content-type': 'application/json',
  accept: 'application/json',
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('artifact routes', () => {
  it('protects artifact reads and writes with Access and the command mutation header', async () => {
    const { app } = await makeApp();
    try {
      expect((await app.inject({ method: 'GET', url: '/api/artifacts' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/artifacts/text', headers: { ...headers, 'x-jarvis-command': '0' }, payload: '{}' })).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('creates, reopens, versions, compares, comments, promotes, downloads and deletes a text artifact', async () => {
    const { app, root } = await makeApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/artifacts/text',
        headers,
        payload: JSON.stringify({ title: 'Plan', type: 'markdown', content: '# One\nhello', sessionId: 'jc_' + 'a'.repeat(32), source: 'human' }),
      });
      expect(created.statusCode).toBe(200);
      const artifact = created.json().artifact;
      expect(artifact.sha256).toBe(createHash('sha256').update('# One\nhello').digest('hex'));

      const reopened = buildApp({
        config: config(root),
        verifyAccess: vi.fn(async () => ({ subject: 'operator', provider: 'cloudflare-access' as const })),
        hermes: { readSnapshot: vi.fn() },
      });
      const listed = await reopened.inject({ method: 'GET', url: `/api/artifacts?sessionId=${artifact.sessionId}`, headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(listed.json().artifacts[0].id).toBe(artifact.id);

      const version = await reopened.inject({
        method: 'POST',
        url: `/api/artifacts/${artifact.id}/versions`,
        headers,
        payload: JSON.stringify({ baseVersion: 1, content: '# Two\nhello\nworld', revisionNote: 'expand' }),
      });
      expect(version.statusCode).toBe(200);
      expect(version.json().artifact.currentVersion).toBe(2);
      const conflict = await reopened.inject({
        method: 'POST',
        url: `/api/artifacts/${artifact.id}/versions`,
        headers,
        payload: JSON.stringify({ baseVersion: 1, content: 'stale' }),
      });
      expect(conflict.statusCode).toBe(409);

      const diff = await reopened.inject({ method: 'GET', url: `/api/artifacts/${artifact.id}/compare?from=1&to=2`, headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(diff.json().diff).toContain('+# Two');
      expect(diff.json()).toMatchObject({ fromType: 'markdown', toType: 'markdown' });
      const comment = await reopened.inject({ method: 'POST', url: `/api/artifacts/${artifact.id}/comments`, headers, payload: JSON.stringify({ version: 2, body: 'Looks good' }) });
      expect(comment.json().artifact.comments[0].body).toBe('Looks good');
      const canonical = await reopened.inject({ method: 'POST', url: `/api/artifacts/${artifact.id}/canonical`, headers, payload: JSON.stringify({ canonical: true, currentVersion: 2 }) });
      expect(canonical.json().artifact.canonical).toBe(true);
      const download = await reopened.inject({ method: 'GET', url: `/api/artifacts/${artifact.id}/versions/2/download`, headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-disposition']).toContain('attachment');
      expect(download.headers['x-artifact-type']).toBe('markdown');
      expect(download.body).toBe('# Two\nhello\nworld');
      const deleted = await reopened.inject({ method: 'DELETE', url: `/api/artifacts/${artifact.id}`, headers, payload: JSON.stringify({ confirmArtifactId: artifact.id, currentVersion: 2 }) });
      expect(deleted.json()).toEqual({ deleted: true, artifactId: artifact.id });
      await reopened.close();
    } finally {
      await app.close();
    }
  });

  it('returns the existing artifact for duplicate source request creates under the global queue', async () => {
    const { app } = await makeApp();
    try {
      const sourceRequestId = 'gen_' + '1'.repeat(32);
      const payload = JSON.stringify({
        title: 'Generated plan',
        type: 'report',
        content: 'exact generated body',
        sessionId: 'jc_' + 'a'.repeat(32),
        runId: 'jcr_' + 'b'.repeat(32),
        sourceRequestId,
        source: 'assistant-response',
      });
      const [first, second] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/artifacts/text', headers, payload }),
        app.inject({ method: 'POST', url: '/api/artifacts/text', headers, payload }),
      ]);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().artifact.id).toBe(first.json().artifact.id);
      expect(second.json().artifact.sourceRequestId).toBe(sourceRequestId);
      const listed = await app.inject({ method: 'GET', url: '/api/artifacts?sessionId=jc_' + 'a'.repeat(32), headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(listed.json().artifacts).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('keeps source request tombstones durable after deletion and restart retries return 410 without recreating', async () => {
    const { app, root } = await makeApp();
    try {
      const sourceRequestId = 'gen_' + '2'.repeat(32);
      const payload = {
        title: 'Generated report',
        type: 'report',
        content: 'delete me once',
        sourceRequestId,
        source: 'assistant-response',
      };
      const created = await app.inject({ method: 'POST', url: '/api/artifacts/text', headers, payload: JSON.stringify(payload) });
      const artifact = created.json().artifact;
      expect(created.statusCode).toBe(200);
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/artifacts/${artifact.id}`,
        headers,
        payload: JSON.stringify({ confirmArtifactId: artifact.id, currentVersion: 1 }),
      });
      expect(deleted.statusCode).toBe(200);

      const restarted = buildApp({
        config: config(root),
        verifyAccess: vi.fn(async () => ({ subject: 'operator', provider: 'cloudflare-access' as const })),
        hermes: { readSnapshot: vi.fn() },
      });
      try {
        const retry = await restarted.inject({ method: 'POST', url: '/api/artifacts/text', headers, payload: JSON.stringify(payload) });
        expect(retry.statusCode).toBe(410);
        expect(retry.json()).toEqual({ error: 'artifact_deleted' });
        expect((await restarted.inject({ method: 'GET', url: '/api/artifacts', headers: { 'cf-access-jwt-assertion': 'valid' } })).json().artifacts).toEqual([]);
      } finally {
        await restarted.close();
      }
    } finally {
      await app.close();
    }
  });

  it('rejects oversized content, unsupported MIME changes and symlinked metadata', async () => {
    const { app, root } = await makeApp();
    try {
      const store = new ArtifactStore({ root, maxFileBytes: 16, maxTotalBytes: 64, maxArtifacts: 10 });
      await expect(store.createText({ title: 'Huge', type: 'text', content: 'x'.repeat(20), source: 'human', canonical: false }, 'operator')).rejects.toMatchObject({ statusCode: 413 });
      await expect(store.createBlob({ title: 'Bad image', type: 'image', mime: 'image/svg+xml', bytes: Buffer.from('<svg/>'), creator: { subject: 'operator', source: 'upload' } })).rejects.toMatchObject({ statusCode: 415 });
      const artifact = await store.createText({ title: 'Safe', type: 'text', content: 'ok', source: 'human', canonical: false }, 'operator');
      await rm(join(root, 'artifacts', artifact.id, 'metadata.json'));
      await mkdir(dirname(join(root, 'outside.json')), { recursive: true });
      await writeFile(join(root, 'outside.json'), JSON.stringify({ private: true }));
      await symlink(join(root, 'outside.json'), join(root, 'artifacts', artifact.id, 'metadata.json'));
      await expect(store.readMetadata(artifact.id)).rejects.toThrow();
    } finally {
      await app.close();
    }
  });

  it('serializes same-base version races, releases rejected work and preserves independent metadata mutations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-artifacts-race-'));
    roots.push(root);
    const store = new ArtifactStore({ root, maxFileBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 1 });
    const artifact = await store.createText({ title: 'Race', type: 'text', content: 'base', source: 'human', canonical: false }, 'operator');
    const raced = await Promise.allSettled([
      store.createTextVersion(artifact.id, { baseVersion: 1, content: 'first' }, 'operator'),
      store.createTextVersion(artifact.id, { baseVersion: 1, content: 'second' }, 'operator'),
    ]);
    expect(raced.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter(item => item.status === 'rejected').map(item => item.reason)).toMatchObject([{ statusCode: 409 }]);
    expect((await store.readMetadata(artifact.id)).currentVersion).toBe(2);

    await expect(store.createTextVersion(artifact.id, { baseVersion: 1, content: 'stale' }, 'operator')).rejects.toMatchObject({ statusCode: 409 });
    await Promise.all([
      store.addComment(artifact.id, 2, 'keep this comment', 'operator'),
      store.setCanonical(artifact.id, true, 2),
    ]);
    const updated = await store.readMetadata(artifact.id);
    expect(updated.canonical).toBe(true);
    expect(updated.comments.map(item => item.body)).toContain('keep this comment');

    await expect(store.createTextVersion(artifact.id, { baseVersion: 2, content: 'allowed at max artifact count' }, 'operator')).resolves.toMatchObject({ currentVersion: 3 });
  });

  it('serializes create and cross-artifact version quota accounting so storage cannot be oversubscribed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-artifacts-quota-'));
    roots.push(root);
    const store = new ArtifactStore({ root, maxFileBytes: 16, maxTotalBytes: 10, maxArtifacts: 10 });
    const results = await Promise.allSettled([
      store.createText({ title: 'A', type: 'text', content: '123456', source: 'human', canonical: false }, 'operator'),
      store.createText({ title: 'B', type: 'text', content: 'abcdef', source: 'human', canonical: false }, 'operator'),
    ]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(item => item.status === 'rejected').map(item => item.reason)).toMatchObject([{ statusCode: 413 }]);
    expect(await store.list({ limit: 10 })).toHaveLength(1);

    const versionRoot = await mkdtemp(join(tmpdir(), 'jarvis-artifacts-version-quota-'));
    roots.push(versionRoot);
    const versionStore = new ArtifactStore({ root: versionRoot, maxFileBytes: 16, maxTotalBytes: 12, maxArtifacts: 10 });
    const left = await versionStore.createText({ title: 'Left', type: 'text', content: 'aaa', source: 'human', canonical: false }, 'operator');
    const right = await versionStore.createText({ title: 'Right', type: 'text', content: 'bbb', source: 'human', canonical: false }, 'operator');
    const versions = await Promise.allSettled([
      versionStore.createTextVersion(left.id, { baseVersion: 1, content: 'cccc' }, 'operator'),
      versionStore.createTextVersion(right.id, { baseVersion: 1, content: 'dddd' }, 'operator'),
    ]);
    expect(versions.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(versions.filter(item => item.status === 'rejected').map(item => item.reason)).toMatchObject([{ statusCode: 413 }]);
  });

  it('bounds large text comparisons at the public contract limit with a deterministic truncation marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-artifacts-diff-'));
    roots.push(root);
    const store = new ArtifactStore({ root, maxFileBytes: 1_100_000, maxTotalBytes: 3_000_000, maxArtifacts: 10 });
    const artifact = await store.createText({ title: 'Huge diff', type: 'text', content: `${'a'.repeat(400_000)}\nbase`, source: 'human', canonical: false }, 'operator');
    await store.createTextVersion(artifact.id, { baseVersion: 1, content: `${'b'.repeat(400_000)}\nbase` }, 'operator');
    const diff = await store.compareText(artifact.id, 1, 2);
    expect(diff.length).toBeLessThanOrEqual(262_144);
    expect(diff).toContain('artifact diff truncated');
  });

  it('preserves immutable version type for mermaid and historical type changes with older metadata fallback', async () => {
    const { app, root } = await makeApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/artifacts/text',
        headers,
        payload: JSON.stringify({ title: 'Diagram', type: 'mermaid', content: 'graph TD\nA-->B', source: 'human' }),
      });
      const artifact = created.json().artifact;
      expect(artifact.versions[0].type).toBe('mermaid');
      const source = await app.inject({ method: 'GET', url: `/api/artifacts/${artifact.id}/versions/1/source`, headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(source.json().type).toBe('mermaid');
      const textRevision = await app.inject({
        method: 'POST',
        url: `/api/artifacts/${artifact.id}/versions`,
        headers,
        payload: JSON.stringify({ baseVersion: 1, type: 'text', content: 'plain revision' }),
      });
      expect(textRevision.json().artifact.versions.map((item: { type: string }) => item.type)).toEqual(['mermaid', 'text']);
      const compare = await app.inject({ method: 'GET', url: `/api/artifacts/${artifact.id}/compare?from=1&to=2`, headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(compare.json()).toMatchObject({ fromType: 'mermaid', toType: 'text' });
      const historicalDownload = await app.inject({ method: 'GET', url: `/api/artifacts/${artifact.id}/versions/1/download`, headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(historicalDownload.headers['x-artifact-type']).toBe('mermaid');

      const metadataPath = join(root, 'artifacts', artifact.id, 'metadata.json');
      const legacy = JSON.parse(await readFile(metadataPath, 'utf8'));
      delete legacy.versions[0].type;
      await writeFile(metadataPath, `${JSON.stringify(legacy, null, 2)}\n`);
      const reopened = new ArtifactStore({ root, maxFileBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 10 });
      expect((await reopened.readMetadata(artifact.id)).versions.at(0)).toMatchObject({ type: 'text' });
    } finally {
      await app.close();
    }
  });

  it('cleans incomplete create directories, refuses overwrite of immutable versions and fails capacity closed on corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-artifacts-hygiene-'));
    roots.push(root);
    await mkdir(join(root, 'artifacts', `.creating-art_${'a'.repeat(32)}.leftover`, 'versions'), { recursive: true });
    const store = new ArtifactStore({ root, maxFileBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 10 });
    await store.init();
    expect(await readdir(join(root, 'artifacts'))).toEqual([]);
    const artifact = await store.createText({ title: 'Safe', type: 'text', content: 'v1', source: 'human', canonical: false }, 'operator');
    await writeFile(join(root, 'artifacts', artifact.id, 'versions', '2.blob'), 'preexisting');
    await expect(store.createTextVersion(artifact.id, { baseVersion: 1, content: 'v2' }, 'operator')).rejects.toThrow();
    expect((await store.readMetadata(artifact.id)).currentVersion).toBe(1);
    await writeFile(join(root, 'artifacts', artifact.id, 'versions', '1.blob'), 'tampered');
    await expect(store.readVersionBytes(artifact.id, 1)).rejects.toThrow();
    await expect(store.createText({ title: 'Next', type: 'text', content: 'ok', source: 'human', canonical: false }, 'operator')).rejects.toThrow();

    const restartRoot = await mkdtemp(join(tmpdir(), 'jarvis-artifacts-restart-hygiene-'));
    roots.push(restartRoot);
    const initial = new ArtifactStore({ root: restartRoot, maxFileBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 10 });
    const restartArtifact = await initial.createText({ title: 'Restart', type: 'text', content: 'v1', source: 'human', canonical: false }, 'operator');
    await writeFile(join(restartRoot, 'artifacts', restartArtifact.id, 'versions', '2.blob'), 'orphaned-before-metadata');
    const restarted = new ArtifactStore({ root: restartRoot, maxFileBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 10 });
    await restarted.init();
    expect(await readdir(join(restartRoot, 'artifacts', restartArtifact.id, 'versions'))).toEqual(['1.blob']);
    await expect(restarted.createTextVersion(restartArtifact.id, { baseVersion: 1, content: 'v2 after recovery' }, 'operator')).resolves.toMatchObject({ currentVersion: 2 });
  });

  it('validates upload byte signatures, text encodings and active polyglots instead of trusting names or client MIME', async () => {
    const { app } = await makeApp();
    try {
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('safe')]);
      expect((await upload(app, png, 'image/png', 'image.png')).statusCode).toBe(200);
      expect((await upload(app, Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/png', 'image.png')).statusCode).toBe(415);
      expect((await upload(app, Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]), 'image/png', 'image.png')).statusCode).toBe(415);
      expect((await upload(app, Buffer.from([0xff, 0xfe, 0x00]), 'image/svg+xml', 'bad.svg', { type: 'svg', mime: 'image/svg+xml' })).statusCode).toBe(415);
      expect((await upload(app, Buffer.from('<html></html>'), 'image/svg+xml', 'bad.svg', { type: 'svg', mime: 'image/svg+xml' })).statusCode).toBe(415);
      expect((await upload(app, Buffer.from('not really a pdf'), 'application/pdf', 'paper.pdf')).statusCode).toBe(415);
    } finally {
      await app.close();
    }
  });

  it('does not serve active HTML/SVG blobs inline on the Command origin and keeps passive previews constrained', async () => {
    const { app } = await makeApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/artifacts/text',
        headers,
        payload: JSON.stringify({ title: 'Page', type: 'html', mime: 'text/html', content: '<h1>safe sandbox source</h1>', source: 'human' }),
      });
      const artifact = created.json().artifact;
      const blob = await app.inject({ method: 'GET', url: `/api/artifacts/${artifact.id}/versions/1/blob`, headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(blob.statusCode).toBe(200);
      expect(blob.headers['content-disposition']).toContain('attachment');
      expect(blob.headers['content-security-policy']).toContain('sandbox');
      expect(blob.headers['x-content-type-options']).toBe('nosniff');

      const pdf = await app.inject({
        method: 'POST',
        url: '/api/artifacts/upload',
        headers: { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example.test', 'x-jarvis-command': '1', ...multipartHeaders('x') },
        payload: multipartBody('x', Buffer.from('%PDF-1.7\n% safe\n'), 'application/pdf', 'safe.pdf'),
      });
      const pdfArtifact = pdf.json().artifact;
      const pdfBlob = await app.inject({ method: 'GET', url: `/api/artifacts/${pdfArtifact.id}/versions/1/blob`, headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(pdfBlob.headers['content-disposition']).toContain('inline');
      expect(pdfBlob.headers['content-security-policy']).toContain("script-src 'none'");
      expect(pdfBlob.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      await app.close();
    }
  });

  it('rate limits artifact reads with a stable public error', async () => {
    const { app } = await makeApp();
    try {
      for (let index = 0; index < 240; index += 1) {
        expect((await app.inject({ method: 'GET', url: '/api/artifacts', headers: { 'cf-access-jwt-assertion': 'valid' } })).statusCode).toBe(200);
      }
      const limited = await app.inject({ method: 'GET', url: '/api/artifacts', headers: { 'cf-access-jwt-assertion': 'valid' } });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: 'rate_limited' });
    } finally {
      await app.close();
    }
  });
});

async function upload(app: Awaited<ReturnType<typeof makeApp>>['app'], bytes: Buffer, mime: string, filename: string, metadata: Record<string, unknown> = {}) {
  const boundary = `artifact-test-${Math.random().toString(16).slice(2)}`;
  return app.inject({
    method: 'POST',
    url: '/api/artifacts/upload',
    headers: { 'cf-access-jwt-assertion': 'valid', origin: 'https://command.example.test', 'x-jarvis-command': '1', ...multipartHeaders(boundary) },
    payload: multipartBody(boundary, bytes, mime, filename, metadata),
  });
}

function multipartHeaders(boundary: string) {
  return { 'content-type': `multipart/form-data; boundary=${boundary}` };
}

function multipartBody(boundary: string, bytes: Buffer, mime: string, filename: string, metadata: Record<string, unknown> = {}) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="metadata"\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}
