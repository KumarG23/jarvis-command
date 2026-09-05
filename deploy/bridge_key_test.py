"""Installer behavior on a rewritten private copy ONLY; never execute host installer."""
import base64
import pathlib
import shutil
import subprocess
import tempfile
import unittest

DEPLOY = pathlib.Path(__file__).resolve().parent
BLOB = base64.b64encode(b'\0\0\0\x0bssh-ed25519\0\0\0\x20' + bytes(range(32))).decode()
KEY = 'ssh-ed25519 ' + BLOB
OPTIONS = 'restrict,port-forwarding,permitlisten="127.0.0.1:18642",permitlisten="127.0.0.1:18643"'


class BridgeKeyTest(unittest.TestCase):
    def invoke(self, key):
        with tempfile.TemporaryDirectory(prefix='jarvis-bridge-key-') as temp:
            root = pathlib.Path(temp)
            # Exact replacements fail closed if installer paths change. No root execution.
            script = (DEPLOY / 'install-bridge-account.sh').read_text()
            replacements = {
                '${EUID} -ne 0': '0 -ne 0',
                'home=/var/lib/jarvis-bridge': f'home={root}/home',
                '/etc/ssh/sshd_config.d/60-jarvis-bridge.conf': str(root / 'sshd.conf'),
                '/usr/sbin/sshd -t': 'fixture_sshd -t',
            }
            for old, new in replacements.items():
                self.assertEqual(script.count(old), 1, old)
                script = script.replace(old, new)
            self.assertNotIn('/etc/ssh/', script)
            self.assertNotIn('/var/lib/', script)
            self.assertNotIn('/usr/sbin/sshd', script)
            # Shell functions intercept every mutator even if host PATH differs.
            mocks = f'''\nfixture_log={root}/calls
id() {{ return 1; }}
useradd() {{ printf 'useradd\\n' >> "$fixture_log"; }}
install() {{ printf 'install\\n' >> "$fixture_log"; }}
chown() {{ printf 'chown\\n' >> "$fixture_log"; }}
fixture_sshd() {{ printf 'sshd\\n' >> "$fixture_log"; }}
systemctl() {{ printf 'reload\\n' >> "$fixture_log"; }}
'''
            script = script.replace('set -euo pipefail', 'set -euo pipefail' + mocks)
            (root / 'home/.ssh').mkdir(parents=True)
            (root / 'installer.sh').write_text(script)
            helper = DEPLOY / 'render-bridge-key.py'
            if helper.exists():
                shutil.copyfile(helper, root / helper.name)
            (root / 'key.pub').write_bytes(key)
            result = subprocess.run(['/bin/bash', str(root / 'installer.sh'), str(root / 'key.pub')], capture_output=True, timeout=5)
            calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
            target = root / 'home/.ssh/authorized_keys'
            return result, calls, target.read_text() if target.exists() else ''

    def test_malformed_keys_never_reach_mutation(self):
        malformed = [
            b'ssh-ed25519 bogus\n', (KEY + '\n' + KEY + '\n').encode(),
            ('restrict ' + KEY).encode(), (KEY + '\r\n').encode(),
            (KEY + '\n\n').encode(), (KEY + '\tcomment').encode(),
            (KEY + '\x00comment').encode(), (KEY + ' \x1bcomment').encode(),
            b'ssh-rsa ' + BLOB.encode(), ('ssh-ed25519 ' + BLOB[:-4]).encode(),
            b'ssh-ed25519 ' + base64.b64encode(b'\0\0\0\x07ssh-rsa\0\0\0\x20' + bytes(32)),
            b'ssh-ed25519 ' + base64.b64encode(b'\0\0\0\x0bssh-ed25519\0\0\0\x21' + bytes(33)),
            b'ssh-ed25519 ' + base64.b64encode(b'\0\0\0\x0bssh-ed25519\0\0\0\x20' + bytes(33)),
            (KEY + ' other ' + KEY).encode(), b'', (KEY + ' ' + 'x' * 5000).encode(),
        ]
        for key in malformed:
            with self.subTest(key=repr(key[:40])):
                result, calls, output = self.invoke(key)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, '')
                self.assertEqual(output, '')

    def test_valid_key_renders_only_exact_options_and_discards_comment(self):
        for suffix in ['', '\n', ' fixture@disposable\n']:
            result, calls, output = self.invoke((KEY + suffix).encode())
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output, OPTIONS + ' ' + KEY + '\n')
            self.assertIn('useradd\n', calls)
            self.assertIn('reload\n', calls)


if __name__ == '__main__':
    unittest.main()
