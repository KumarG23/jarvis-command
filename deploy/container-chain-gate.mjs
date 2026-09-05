import assert from 'node:assert/strict';
import { openSync, closeSync, writeFileSync, fchownSync, fchmodSync, fsyncSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Only the fixture-owned synthetic directory is writable; root/secrets stay 0700.
export function writeGate(directory, value) {
  const owner = lstatSync(directory);
  assert.ok(owner.isDirectory() && !owner.isSymbolicLink());
  assert.equal(owner.mode & 0o777, 0o700);
  assert.equal(owner.uid, 10004); assert.equal(owner.gid, 10004);
  assert.match(value.run_id, /^run_[a-f0-9]{32}$/);
  assert.ok(['hold', 'release', 'finish'].includes(value.action));
  const temporary = directory + '/gate-' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  const errors = [];
  try {
    writeFileSync(fd, JSON.stringify(value));
    fchownSync(fd, 10004, 10004); fchmodSync(fd, 0o600); fsyncSync(fd);
  } catch (error) { errors.push(error); }
  try { closeSync(fd); } catch (error) { errors.push(error); }
  if (!errors.length) {
    try { renameSync(temporary, directory + '/gate.json'); } catch (error) { errors.push(error); }
  }
  try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Gate write and cleanup failed');
}
