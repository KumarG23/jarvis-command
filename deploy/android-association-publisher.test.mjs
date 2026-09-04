import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseScript = join(repositoryRoot, 'deploy', 'release-android-association.sh');
const expectedState = '/var/backups/jarvis-command/association-20260904T170000Z';
const expectedImage = 'sha256:2fd64f267f33feeb6a17a20e37b2a6594e3398817ba114b8ead13bc949cfe654';
const unapprovedImage = `sha256:${'f'.repeat(64)}`;

async function temporaryAssociationStages() {
  return new Set(
    (await readdir('/tmp')).filter((name) => name.startsWith('jarvis-command-association.')),
  );
}

async function makeFixture({ failCleanup = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-association-publisher-'));
  const bin = join(directory, 'bin');
  const key = join(directory, 'release-key');
  const calls = join(directory, 'ssh-calls');
  await mkdir(bin, { mode: 0o700 });
  await writeFile(key, 'fixture key\n', { mode: 0o600 });
  await writeFile(calls, '0\n', { mode: 0o600 });

  const ssh = `#!/usr/bin/env bash
set -Eeuo pipefail
count=$(<"$SSH_CALLS")
count=$((count + 1))
printf '%s\\n' "$count" > "$SSH_CALLS"
input=$(cat)
case "$count" in
  1)
    [[ $input == *'mktemp -d /tmp/jarvis-command-release.'* ]]
    printf '1000:/tmp/jarvis-command-release.AbCdEf1234\\n'
    ;;
  2)
    [[ "$*" == *'sudo -n /usr/bin/bash -s -- apply'* ]]
    [[ $input == '#!/usr/bin/env bash'* ]]
    [[ $input == *'snapshot_release_stage'* ]]
    printf 'ASSOCIATION_STATE_DIR=${expectedState}\\n'
    ;;
  *)
    [[ $input == *'rm -rf -- "$stage"'* ]]
    if [[ $FAIL_CLEANUP == 1 ]]; then
      exit 42
    fi
    ;;
esac
`;
  const scp = `#!/usr/bin/env bash
set -Eeuo pipefail
for argument in "$@"; do
  [[ $argument != */install-android-association.sh ]]
  if [[ $argument == */assetlinks.json || $argument == */app.compose.yaml || $argument == */SHA256SUMS ]]; then
    [[ -f $argument ]]
  fi
done
`;

  await writeFile(join(bin, 'ssh'), ssh, { mode: 0o755 });
  await writeFile(join(bin, 'scp'), scp, { mode: 0o755 });
  await chmod(join(bin, 'ssh'), 0o755);
  await chmod(join(bin, 'scp'), 0o755);

  return {
    calls,
    directory,
    env: {
      ...process.env,
      FAIL_CLEANUP: failCleanup ? '1' : '0',
      PATH: `${bin}:${process.env.PATH}`,
      SSH_CALLS: calls,
    },
    key,
  };
}

function runPublisher(fixture, image = expectedImage) {
  return spawnSync(
    releaseScript,
    ['neal@example.test', fixture.key, image],
    { cwd: repositoryRoot, encoding: 'utf8', env: fixture.env },
  );
}

test('association publisher rejects a different syntactically valid image before SSH', async () => {
  const fixture = await makeFixture();
  try {
    const result = runPublisher(fixture, unapprovedImage);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /approved production image/i);
    assert.equal((await readFile(fixture.calls, 'utf8')).trim(), '0');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('association publisher cleans both stages before emitting its receipt', async () => {
  const fixture = await makeFixture();
  const stagesBefore = await temporaryAssociationStages();
  try {
    const result = runPublisher(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `ASSOCIATION_STATE_DIR=${expectedState}\n`);
    assert.equal((await readFile(fixture.calls, 'utf8')).trim(), '3');
    assert.deepEqual(await temporaryAssociationStages(), stagesBefore);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('association publisher suppresses its receipt when remote cleanup fails', async () => {
  const fixture = await makeFixture({ failCleanup: true });
  const stagesBefore = await temporaryAssociationStages();
  try {
    const result = runPublisher(fixture);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /association release staging cleanup failed/);
    assert.equal((await readFile(fixture.calls, 'utf8')).trim(), '4');
    assert.deepEqual(await temporaryAssociationStages(), stagesBefore);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
