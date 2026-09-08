"""Candidate-only control-plane launcher. Default is containment probes, never admissions.
The existing candidate provider token stays in the protected control plane; no
production credentials/config are read or copied by this launcher.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import yaml

STATE = Path('/home/neal/code/jarvis-command-candidate-state')
SOURCE = Path('/home/neal/code/hermes-history-binding')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve-after-delta-review', action='store_true')
    args = parser.parse_args()
    name = 'jc-history-candidate-runtime'
    existing = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]
    if existing['State']['Running']:
        raise SystemExit('refusing replacement of a running candidate')
    home = STATE / 'home'
    config_path = home / 'config.yaml'
    config = yaml.safe_load(config_path.read_text())
    if config['model'] != {'default': 'gpt-6-astra', 'provider': 'openai-codex'} or config.get('fallback_model'):
        raise SystemExit('candidate provider identity changed; no fallback permitted')
    if config.get('approvals', {}).get('mode') != 'manual':
        raise SystemExit('manual approvals required')
    if config.get('platform_toolsets') != {'api_server': ['terminal']}:
        raise SystemExit('candidate must expose only terminal toolset')
    if not (STATE / 'broker/exec.sock').is_socket():
        raise SystemExit('fixed fixture broker not running')
    config['terminal'] = {'backend': 'candidate_fixture', 'cwd': '/fixtures', 'timeout': 180}
    config_path.write_text(yaml.safe_dump(config, sort_keys=False)); config_path.chmod(0o600)
    venv = Path('/home/neal/.hermes/hermes-agent/venv').resolve()
    python_root = (venv / 'bin/python').resolve().parent.parent.parent
    image = subprocess.check_output(['docker', 'image', 'inspect', 'nikolaik/python-nodejs:python3.11-nodejs20', '--format', '{{.Id}}'], text=True).strip()
    # Preserve the original stopped container as evidence; never reuse its unsafe config.
    old = 'jc-history-candidate-runtime-pre-isolation'
    names = subprocess.check_output(['docker', 'ps', '-a', '--format', '{{.Names}}'], text=True).splitlines()
    if old not in names:
        subprocess.run(['docker', 'rename', name, old], check=True)
    else:
        subprocess.run(['docker', 'rm', name], check=True)
    cmd = ['docker', 'run', '--name', name, '--restart', 'no',
           '--cgroup-parent', 'hermes-heavy.slice', '--memory', '2g', '--memory-swap', '2g', '--cpus', '2', '--pids-limit', '256',
           '--user', f'{os.getuid()}:{os.getgid()}', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
           '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m', '--tmpfs', '/fixtures:rw,nosuid,nodev,size=1m', '-w', '/fixtures',
           '-e', 'HOME=/candidate-home', '-e', 'HERMES_HOME=/candidate-home', '-e', 'PYTHONDONTWRITEBYTECODE=1',
           '-e', f'PYTHONPATH={SOURCE}:{SOURCE}/scripts',
           '--mount', f'type=bind,src={SOURCE},dst={SOURCE},readonly',
           '--mount', f'type=bind,src={venv},dst={venv},readonly',
           '--mount', f'type=bind,src={python_root},dst={python_root},readonly',
           '--mount', f'type=bind,src={home},dst=/candidate-home',
           '--mount', f'type=bind,src={STATE}/broker,dst=/candidate-broker,readonly']
    if args.serve_after_delta_review:
        cmd += ['-d', '-p', '127.0.0.1:18741:18741']
    else:
        cmd += ['--network', 'none']
    entry = 'history_binding_candidate.py' if args.serve_after_delta_review else 'probe_candidate_isolation.py'
    subprocess.run(cmd + [image, str(venv / 'bin/python'), str(SOURCE / 'scripts' / entry)], check=True)


if __name__ == '__main__':
    main()
