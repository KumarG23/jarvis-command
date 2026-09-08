"""Resumable real candidate model probe; fixture data only, no mocked responses."""
import json
import time
import uuid
import urllib.request
from pathlib import Path

state = Path('/home/neal/code/jarvis-command-candidate-state')
auth = json.loads((state / 'bff/browser-auth.json').read_text())
origin = auth['origin']

def request(path, body=None, binding=True):
    headers = {'cf-access-jwt-assertion': auth['assertion'], 'accept': 'application/json'}
    if binding:
        headers['x-jarvis-history-binding'] = '1'
    if body is not None:
        headers.update({'origin': origin, 'x-jarvis-command': '1', 'content-type': 'application/json'})
    req = urllib.request.Request(origin + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)

if __name__ == '__main__':
    guard = state / 'probe.json'
    if guard.exists():
        attempt = json.loads(guard.read_text())
    else:
        attempt = {'clientRequestId': str(uuid.uuid4()), 'creating': True}
        guard.write_text(json.dumps(attempt))
        attempt['session'] = request('/api/live/sessions', {'title': 'FIXTURE ONLY history binding acceptance'})['session']
        guard.write_text(json.dumps(attempt))
    if 'session' not in attempt:
        raise RuntimeError('reconcile uncertain session creation; do not replay')
    session = attempt['session']['id']
    if 'run' not in attempt:
        attempt['run'] = request('/api/live/runs', {'sessionId': session, 'input': 'Reply exactly: CANDIDATE_HISTORY_OK. Do not use tools.', 'clientRequestId': attempt['clientRequestId']})
        guard.write_text(json.dumps(attempt))
    run = attempt['run']['publicRunId']
    for _ in range(120):
        status = request('/api/live/runs/' + run)
        if status['status'] in ('completed', 'failed', 'cancelled'):
            attempt['terminal'] = status
            attempt['history'] = request('/api/sessions/' + session + '/messages?limit=50&offset=0')
            guard.write_text(json.dumps(attempt, indent=2))
            print(json.dumps(attempt, indent=2))
            if status['status'] != 'completed' or 'historyBinding' not in status:
                raise RuntimeError('real run did not complete with exact history binding')
            assert 'historyBinding' not in request('/api/live/runs/' + run, binding=False)
            break
        time.sleep(2)
    else:
        raise RuntimeError('candidate still nonterminal; resume this same guarded admission')
