import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import { checkAcquisitionRace } from './recovery-fixture.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-recovery-helper-'));
  const backupRoot = join(directory, 'backups');
  await mkdir(backupRoot, { mode: 0o700 });
  await mkdir(join(directory, 'bin'));
  const helper = (await readFile(new URL('trusted-recovery-directory.sh', import.meta.url), 'utf8'))
    .replace('TRUSTED_RECOVERY_UID = 0', `TRUSTED_RECOVERY_UID = ${process.getuid()}`)
    .replace('TRUSTED_RECOVERY_ANCHOR = "/"', `TRUSTED_RECOVERY_ANCHOR = ${JSON.stringify(directory)}`);
  const script = join(directory, 'packaged-recovery.sh');
  await writeFile(script, '#!/bin/bash\nset -Eeuo pipefail\numask 077\n' + helper + '\nrecovery_open "$1"\nrecovery_create cutover-20260905T000000Z\nrecovery_verify\nprintf "STATE_DIR=unexpected\\n"\n', { mode: 0o700 });
  return { directory, backupRoot, log: join(directory, 'commands.log'), env: { PATH: `${directory}/bin:${process.env.PATH}` } };
}

for (const point of ['ancestor-validation', 'handoff', 'leaf-create']) {
  test(`shared helper acquisition race ${point}`, () => checkAcquisitionRace(fixture,
    value => spawnSync(join(value.directory, 'packaged-recovery.sh'), [value.backupRoot],
      { encoding: 'utf8', env: value.env, timeout: 5000 }), point));
}

for (const attack of ['symlink', 'fifo', 'metadata-replacement']) {
  test(`shared helper file acquisition refuses ${attack} after prior validation`, async () => {
    const value = await fixture();
    try {
      const script = join(value.directory, 'packaged-recovery.sh');
      const source = (await readFile(script, 'utf8')).split('\nrecovery_open "$1"')[0];
      const mutation = attack === 'symlink' ? 'ln -s "$2" "$recovery_directory/value"' : attack === 'fifo'
        ? 'mkfifo -m 0600 "$recovery_directory/value"' : 'chmod 0777 "$recovery_directory"; printf "forged\\n" > "$recovery_directory/value"';
      await writeFile(script, source + `
recovery_open "$1"
printf 'true\\n' > "$recovery_directory/value"
recovery_validate_files
mv "$recovery_directory/value" "$recovery_directory/value.retained"
${mutation}
recovery_read value
printf 'STATE_DIR=unexpected\\n'
`);
      const sentinel = join(value.directory, 'sentinel');
      await writeFile(sentinel, 'keep me');
      const result = spawnSync(script, [value.backupRoot, sentinel], { encoding: 'utf8', env: value.env, timeout: 5000 });
      assert.notEqual(result.status, 0);
      assert.equal(result.error, undefined);
      assert.doesNotMatch(result.stdout, /STATE_DIR=/);
      assert.equal(await readFile(sentinel, 'utf8'), 'keep me');
      assert.equal(await readFile(join(value.backupRoot, 'value.retained'), 'utf8'), 'true\n');
    } finally { await rm(value.directory, { recursive: true, force: true }); }
  });
}
