import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

class GateTest(unittest.TestCase):
    @unittest.skipUnless(os.geteuid() == 0, 'requires synthetic UID handoff; run separately as root')
    def test_real_uid_gate_atomic_handoff(self):
        helper = Path('deploy/container-chain-gate.mjs').resolve()
        with tempfile.TemporaryDirectory(prefix='jc-gate-') as directory:
            root = Path(directory)
            synthetic = root / 'synthetic'; synthetic.mkdir(mode=0o700); os.chown(synthetic, 10004, 10004)
            # Reproduce inherited 0077 with the actual original Node write options.
            subprocess.run(['/home/neal/.local/bin/node', '--input-type=module', '-e', 'import {writeFileSync} from "node:fs"; process.umask(0o077); writeFileSync(process.argv[1],"{}",{mode:0o644});', str(synthetic/'gate.json')], check=True)
            self.assertEqual((synthetic/'gate.json').stat().st_mode & 0o777, 0o600)
            self.assertEqual((synthetic/'gate.json').stat().st_uid, 0)
            def enter():
                os.chdir(synthetic); os.setgid(10004); os.setuid(10004)
            denied = subprocess.run(['/usr/bin/python3', '-c', 'open("gate.json").read()'], preexec_fn=enter, capture_output=True)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn(b'PermissionError', denied.stderr)
            self.assertTrue(helper.is_file(), 'Missing atomic private cross-UID gate writer')
            for action in ['hold','release','finish']:
                payload = {'run_id':'run_'+'a'*32, 'action':action}
                subprocess.run(['/home/neal/.local/bin/node', '--input-type=module', '-e', 'import {writeGate} from '+json.dumps(helper.as_uri())+'; process.umask(0o077); writeGate(process.argv[1],JSON.parse(process.argv[2]));', str(synthetic), json.dumps(payload)], check=True)
                result = subprocess.run(['/usr/bin/python3', '-c', 'print(open("gate.json").read())'], preexec_fn=enter, capture_output=True, check=True, timeout=2)
                self.assertEqual(json.loads(result.stdout),payload)
                state=(synthetic/'gate.json').stat()
                self.assertEqual((state.st_uid,state.st_gid,state.st_mode & 0o777),(10004,10004,0o600))
                self.assertEqual(root.stat().st_mode & 0o777,0o700)
                self.assertEqual(list(synthetic.iterdir()),[synthetic/'gate.json'])

if __name__ == '__main__': unittest.main()
