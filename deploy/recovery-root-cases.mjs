import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// These run under the ordinary test UID with only the anchor/UID mapped in the
// packaged script. No service, Docker, root, SSH or host-network action is real.
export async function checkRootRefusal(makeFixture, run, kind) {
  const fixture = await makeFixture();
  try {
    let path = fixture.backupRoot;
    if (kind === 'missing') { await rm(path, { recursive: true }); }
    if (kind === 'empty') path = '';
    if (kind === 'relative') path = 'backups';
    if (kind === 'newline') path += '\n';
    if (kind === 'trailing-slash') path += '/';
    if (kind === 'dot') path += '/.';
    if (kind === 'traversal') path += '/../backups';
    if (kind === 'writable-leaf') await chmod(path, 0o770);
    if (kind === 'writable-ancestor') await chmod(fixture.directory, 0o770);
    if (kind === 'symlink-ancestor') {
      const alias = join(fixture.directory, 'alias');
      const parent = join(fixture.directory, 'parent');
      await mkdir(parent, { mode: 0o700 });
      await rename(path, join(parent, 'backups'));
      await symlink(parent, alias);
      path = join(alias, 'backups');
    }
    if (kind === 'file' || kind === 'fifo') {
      await rm(path, { recursive: true });
      if (kind === 'file') await writeFile(path, 'unrelated sentinel', { mode: 0o600 });
      else assert.equal(spawnSync('mkfifo', [path]).status, 0);
    }
    const metadata = await lstat(path).catch(() => null);
    const result = run(fixture, path);
    assert.notEqual(result.status, 0, `${kind}: ${result.stderr}`);
    assert.equal(await readFile(fixture.log, 'utf8').catch(() => ''), '', kind);
    assert.doesNotMatch(result.stdout, /STATE_DIR=|ROLLED_BACK_FROM=|BOOTSTRAP_RESTORED_FROM=/);
    if (metadata) {
      const after = await lstat(path);
      for (const field of ['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'mtimeMs']) {
        assert.equal(after[field], metadata[field], `${kind} changed ${field}`);
      }
    }
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
}

export const rejectedRoots = ['missing', 'empty', 'relative', 'newline', 'trailing-slash',
  'dot', 'traversal', 'writable-leaf', 'writable-ancestor', 'symlink-ancestor', 'file', 'fifo'];

export const rollbackAttacks = ['symlink-leaf', 'symlink-ancestor', 'writable-leaf',
  'writable-ancestor', 'file-symlink', 'hardlink', 'fifo', 'file-mode',
  'missing-scalar', 'forged-scalar', 'missing-artifact', 'missing-status', 'forged-status',
  'metadata-timing', 'identity-timing'];

async function fileEvidence(path) {
  const info = await lstat(path);
  return { metadata: Object.fromEntries(['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'mtimeMs']
    .map(key => [key, info[key]])), bytes: info.isFile() ? await readFile(path, 'hex') : null };
}

export async function checkRollbackRefusal(makeFixture, apply, rollback, scalar, artifact, kind) {
  const fixture = await makeFixture({ initialAssociation: true });
  try {
    const state = await apply(fixture);
    let retained = state;
    const sentinel = join(fixture.directory, 'sentinel');
    await writeFile(sentinel, 'unrelated sentinel\n', { mode: 0o600 });
    const target = join(state, scalar);
    if (kind === 'metadata-timing' || kind === 'identity-timing') {
      const script = join(fixture.directory, 'packaged-recovery.sh');
      const source = await readFile(script, 'utf8');
      if (kind === 'metadata-timing') {
        const marker = '  python3 -c "$recovery_python" files "$recovery_directory"';
        assert.ok(source.includes(marker));
        await writeFile(script, source.replace(marker, marker + `\n  chmod 0777 ${JSON.stringify(state)}`));
      } else {
        const marker = '  # The proc path is produced by our child, never supplied by the operator.';
        assert.ok(source.includes(marker));
        await writeFile(script, source.replace(marker, `  mv ${JSON.stringify(state)} ${JSON.stringify(state + '.retained')}\n  ln -s ${JSON.stringify(state + '.retained')} ${JSON.stringify(state)}\n${marker}`));
      }
    } else if (kind.startsWith('missing:')) await rm(join(state, kind.slice('missing:'.length)));
    else if (kind === 'symlink-leaf') {
      retained = state + '.retained';
      await rename(state, retained);
      await symlink(retained, state);
    } else if (kind === 'symlink-ancestor') {
      await rename(fixture.backupRoot, fixture.backupRoot + '.retained');
      await symlink(fixture.backupRoot + '.retained', fixture.backupRoot);
      retained = state.replace('/backups/', '/backups.retained/');
    } else if (kind === 'writable-leaf') await chmod(state, 0o770);
    else if (kind === 'writable-ancestor') await chmod(fixture.backupRoot, 0o770);
    else if (kind === 'file-mode') await chmod(target, 0o640);
    else if (kind === 'forged-scalar') await writeFile(target, 'forged\n');
    else if (kind === 'forged-status') await writeFile(join(state, 'status'), 'forged\n');
    else if (kind === 'missing-status') await rm(join(state, 'status'));
    else if (kind === 'missing-artifact') await rm(join(state, artifact));
    else {
      await rm(target);
      if (kind === 'file-symlink') await symlink(sentinel, target);
      if (kind === 'hardlink') await link(sentinel, target);
      if (kind === 'fifo') assert.equal(spawnSync('mkfifo', ['-m', '600', target]).status, 0);
    }
    const before = await fileEvidence(sentinel);
    const genuine = {};
    for (const name of await readdir(retained)) genuine[name] = await fileEvidence(join(retained, name));
    const runtime = {};
    for (const key of ['composeTarget', 'associationTarget', 'bootstrapRunning', 'appRunning']) {
      if (fixture[key]) runtime[key] = await fileEvidence(fixture[key]);
    }
    await writeFile(fixture.log, '');
    const result = rollback(fixture, state);
    if (kind === 'identity-timing') retained = state + '.retained';
    assert.notEqual(result.status, 0, `${kind}: must refuse`);
    assert.equal(result.error, undefined, `${kind}: must not hang`);
    assert.equal(await readFile(fixture.log, 'utf8'), '', `${kind}: commands before refusal`);
    assert.doesNotMatch(result.stdout, /STATE_DIR=|ROLLED_BACK_FROM=|BOOTSTRAP_RESTORED_FROM=/);
    assert.deepEqual(await fileEvidence(sentinel), before, `${kind}: unrelated sentinel changed`);
    for (const [name, evidence] of Object.entries(genuine)) {
      assert.deepEqual(await fileEvidence(join(retained, name)), evidence, `${kind}: state ${name} changed`);
    }
    for (const [key, evidence] of Object.entries(runtime)) {
      assert.deepEqual(await fileEvidence(fixture[key]), evidence, `${kind}: runtime ${key} changed`);
    }
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
}
