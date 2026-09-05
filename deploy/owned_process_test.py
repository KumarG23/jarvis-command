"""Real Linux descendants, cancellation and unrelated-process safety regression."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest

HELPER = Path(__file__).with_name('owned-process.py')

class OwnedProcessTest(unittest.TestCase):
    def test_lifecycle(self):
        self.assertTrue(HELPER.is_file(), 'Missing bounded owned-subprocess lifecycle')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sentinel = subprocess.Popen(['/usr/bin/sleep', '30'])
            try:
                for mode, expected in [('normal', 0), ('failure', 7), ('timeout', 124), ('cancel', 130)]:
                    receipt = root / (mode + '.json')
                    output = root / (mode + '.out')
                    child = root / (mode + '.pid')
                    code = ('import subprocess,time,os; '
                            f'p=subprocess.Popen(["/usr/bin/sleep","30"]); open({str(child)!r},"w").write(str(p.pid)); '
                            'print("progress-before-exit",flush=True); '
                            + ('time.sleep(30)' if mode in ['timeout', 'cancel'] else f'raise SystemExit({expected})'))
                    with output.open('w') as log:
                        worker = subprocess.Popen(['/usr/bin/python3', str(HELPER), str(receipt), '0.5', '--', '/usr/bin/python3', '-c', code], stdout=log, stderr=log, start_new_session=True)
                        if mode == 'cancel':
                            deadline = time.monotonic() + 2
                            while not child.exists():
                                self.assertLess(time.monotonic(), deadline)
                                time.sleep(.01)
                            fd = os.pidfd_open(worker.pid)
                            try: signal.pidfd_send_signal(fd, signal.SIGTERM)
                            finally: os.close(fd)
                        self.assertEqual(worker.wait(timeout=4), expected, output.read_text())
                    data = json.loads(receipt.read_text())
                    self.assertTrue(data['cleanup_verified'], data)
                    self.assertTrue(data['reaped'], data)
                    self.assertFalse(Path('/proc', child.read_text()).exists(), data)
                    self.assertIn('progress-before-exit', output.read_text())
                    self.assertIsNone(sentinel.poll())
            finally:
                sentinel.terminate(); sentinel.wait(timeout=2)

if __name__ == '__main__': unittest.main()
