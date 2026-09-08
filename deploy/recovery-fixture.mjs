import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

// Synthetic nonprivileged fixture only: map the trust UID/anchor, not validation
// behavior. Both scripts execute the actual standalone packaged source.
export async function recoveryFixtureScript(source, directory) {
  const bundled = spawnSync('python3', [new URL('bundle-recovery-script.py', import.meta.url).pathname, source], { encoding: 'utf8' });
  assert.equal(bundled.status, 0, bundled.stderr);
  assert.equal(bundled.stdout.split('TRUSTED_RECOVERY_UID = 0').length, 2);
  assert.equal(bundled.stdout.split('TRUSTED_RECOVERY_ANCHOR = "/"').length, 2);
  const mapped = bundled.stdout.replace('TRUSTED_RECOVERY_UID = 0', `TRUSTED_RECOVERY_UID = ${process.getuid()}`)
    .replace('TRUSTED_RECOVERY_ANCHOR = "/"', `TRUSTED_RECOVERY_ANCHOR = ${JSON.stringify(directory)}`);
  const script = join(directory, 'packaged-recovery.sh');
  await writeFile(script, mapped, { mode: 0o700 });
  return script;
}

// Deterministic test-only scheduling. Production has no race hooks. Instrument
// the Python syscall boundary and the Bash descriptor handoff in isolated bytes.
export async function injectRecoveryRace(script, fixture, point) {
  const sentinel = join(fixture.directory, 'sentinel');
  await mkdir(sentinel, { mode: 0o700 });
  await writeFile(join(sentinel, 'unrelated'), 'keep me', { mode: 0o600 });
  let source = await readFile(script, 'utf8');
  if (point === 'handoff') {
    const marker = '  # The proc path is produced by our child, never supplied by the operator.';
    assert.ok(source.includes(marker));
    source = source.replace(marker, `  chmod 0770 ${JSON.stringify(fixture.backupRoot)}\n${marker}`);
  } else {
    const instrumentation = `
_real_open, _real_mkdir = os.open, os.mkdir
def race_open(path, flags, *args, **kwargs):
    fd = _real_open(path, flags, *args, **kwargs)
    if ${JSON.stringify(point)} == "ancestor-validation" and path == "backups":
        os.chmod(${JSON.stringify(fixture.directory)}, 0o770)
    return fd
def race_mkdir(path, *args, **kwargs):
    result = _real_mkdir(path, *args, **kwargs)
    if ${JSON.stringify(point)} == "leaf-create":
        os.chmod(${JSON.stringify(fixture.backupRoot)}, 0o770)
        os.rename(path, str(path) + ".retained", src_dir_fd=kwargs.get("dir_fd"), dst_dir_fd=kwargs.get("dir_fd"))
        os.symlink(${JSON.stringify(sentinel)}, path, dir_fd=kwargs.get("dir_fd"))
    return result
os.open, os.mkdir = race_open, race_mkdir
`;
    source = source.replace('import sys\n', 'import sys\n' + instrumentation);
    // Legacy shell mkdir boundary; the Python hook above covers its replacement.
    if (point === 'leaf-create') {
      await writeFile(join(fixture.directory, 'bin/mkdir'), `#!/bin/bash
/usr/bin/mkdir "$@" || exit
chmod 0770 ${JSON.stringify(fixture.backupRoot)}
mv "\${!#}" "\${!#}.retained"
ln -s ${JSON.stringify(sentinel)} "\${!#}"
`, { mode: 0o700 });
    }
  }
  await writeFile(script, source);
  return sentinel;
}

export async function checkAcquisitionRace(makeFixture, run, point) {
  const fixture = await makeFixture();
  try {
    const sentinel = await injectRecoveryRace(join(fixture.directory, 'packaged-recovery.sh'), fixture, point);
    const before = await stat(sentinel);
    const fileBefore = await stat(join(sentinel, 'unrelated'));
    const result = run(fixture);
    assert.notEqual(result.status, 0, `${point}: must refuse`);
    assert.equal(result.error, undefined);
    assert.doesNotMatch(result.stdout, /STATE_DIR=|RESTORED_FROM=/);
    const commands = await readFile(fixture.log, 'utf8').catch(() => '');
    assert.doesNotMatch(commands, /systemctl (enable|disable|stop|start|restart|daemon-reload)|docker (stop|start|update)|install /);
    assert.equal(await readFile(join(sentinel, 'unrelated'), 'utf8'), 'keep me');
    assert.deepEqual(await readdir(sentinel), ['unrelated']);
    for (const key of ['dev', 'ino', 'mode', 'uid', 'gid', 'mtimeMs']) {
      assert.equal((await stat(sentinel))[key], before[key]);
      assert.equal((await stat(join(sentinel, 'unrelated')))[key], fileBefore[key]);
    }
  } finally {
    await chmod(fixture.directory, 0o700);
    await rm(fixture.directory, { recursive: true, force: true });
  }
}
