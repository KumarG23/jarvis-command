"""Regenerate golden.projection.json by running the accepted Studio producer over SYNTHETIC inputs.

usage: python3 -I generate_golden.py <dir containing dev-studio dashboard/projection.py> <out.json>

Producer: KumarG23/dev-studio dashboard/projection.py at 6339856aae28f03cddcd2996b5c1c4ec770388d7.
Every title, repo state and receipt below is invented; nothing is read from a live Studio, GitHub or host.
"""
import importlib.util
import json
import sys
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('studio_projection', sys.argv[1].rstrip('/') + '/projection.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

NOW = datetime(2026, 11, 9, 15, 0, 0, tzinfo=timezone.utc).timestamp()
iso = lambda hours_ago: datetime.fromtimestamp(NOW - hours_ago * 3600, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
REPOS = ['Example/command-synth', 'Example/studio-synth', 'Example/emberbound-synth']
PROFILES = {'sonnet': ('claude-sonnet-5-5', 'claude'), 'sol': ('gpt-6-sol', 'openai')}


def ci_state(checks):
    if not isinstance(checks, list) or not checks:
        return 'unknown'
    states = [x.get('conclusion') or x.get('state') or x.get('status') for x in checks if isinstance(x, dict)]
    if any(x in ('FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'CANCELLED') for x in states):
        return 'failed'
    if any(x in ('PENDING', 'QUEUED', 'IN_PROGRESS', 'REQUESTED', 'WAITING', 'EXPECTED') for x in states):
        return 'pending'
    return 'passed' if all(x in ('SUCCESS', 'NEUTRAL', 'SKIPPED') for x in states) else 'unknown'


def issue(n, title, hours, labels=(), body=''):
    return {'number': n, 'title': title, 'updatedAt': iso(hours), 'labels': [{'name': x} for x in labels], 'body': body}


def pr(n, issue_n, title, hours, checks, review='', draft=False, merged=None):
    out = {'number': n, 'title': title, 'isDraft': draft, 'updatedAt': iso(hours), 'headRefName': f'team/x/issue-{issue_n}',
           'reviewDecision': review, 'statusCheckRollup': checks}
    if merged:
        out.update(mergedAt=iso(merged), mergeCommit={'oid': 'ab' * 20})
    return out


ok = lambda: [{'name': 'validate', 'conclusion': 'SUCCESS'}]
bad = lambda: [{'name': 'validate', 'conclusion': 'FAILURE', 'detailsUrl': 'https://github.com/Example/command-synth/actions/runs/1/job/2'}]
pending = lambda: [{'name': 'validate', 'status': 'IN_PROGRESS'}]
plan_block = lambda m: f'```studio-plan\n{{"milestone":"{m}"}}\n```'

command_issues = [
    issue(1, 'SYNTHETIC running worker', 1, ['team:in-progress'], plan_block('P14 consumer')),
    issue(2, 'SYNTHETIC failing checks', 3, [], plan_block('P14 consumer')),
    issue(3, 'SYNTHETIC checks pending', 2, [], plan_block('P14 consumer')),
    issue(4, 'SYNTHETIC awaiting review', 5, [], plan_block('P14 consumer')),
    issue(5, 'SYNTHETIC ready to test', 4, ['ready-to-test']),
    issue(6, 'SYNTHETIC blocked on dependency', 30, ['team:blocked', 'needs:neal'], 'blocked by Example/studio-synth#9 and #1'),
    issue(7, 'SYNTHETIC merged awaiting release', 6, []),
    issue(8, 'SYNTHETIC session without activity', 2, ['team:in-progress']),
]
command_prs = [
    pr(11, 2, 'SYNTHETIC failing PR', 3, bad()), pr(12, 3, 'SYNTHETIC pending PR', 2, pending()),
    pr(13, 4, 'SYNTHETIC reviewable PR', 5, ok(), 'REVIEW_REQUIRED'),
    pr(14, 7, 'SYNTHETIC merged PR', 6, ok(), 'APPROVED', merged=6),
]
studio_issues = [issue(9, 'SYNTHETIC draft work', 1, [], plan_block('Projection')), issue(10, 'SYNTHETIC queued', 8, ['team:ready'])]
studio_prs = [pr(21, 9, 'SYNTHETIC draft PR', 1, [], draft=True), pr(22, 10, 'SYNTHETIC merged in release', 20, ok(), 'APPROVED', merged=20)]
PLAN = {'state': 'read', 'reason': None, 'unreadable': [], 'base_commit': 'c' * 40, 'base_committed_at': iso(4),
        'files': {'MASTER_PLAN.md': {'text': '# Plan\n\n## Goal\n\nSYNTHETIC goal: show crew progress honestly.\n\n- [x] one\n- [ ] two\n- [ ] three\n',
                                    'commit': 'd' * 40, 'committed_at': iso(4)}}}
ROADMAP = {'state': 'partial', 'reason': 'some plan files unreadable', 'unreadable': ['ROADMAP.md'], 'base_commit': 'e' * 40,
           'base_committed_at': iso(9),
           'files': {'ROADMAP.yaml': {'text': 'milestones:\n  - id: P14\n    title: SYNTHETIC consumer\n    # Current status: live unavailable; phone check pending\n',
                                      'commit': 'f' * 40, 'committed_at': iso(9)}}}


def release(sha):
    return {'state': 'in_live_scheduler_release', 'live_sha': '1234567890ab'}


STUDIO_RELEASE = {'project': {'state': 'known', 'kind': 'studio_scheduler_release', 'live_sha': '1234567890ab',
                              'activated_at': iso(2), 'note': 'scheduler release only; the dashboard is deployed separately'},
                  'check': release}


def project(name, repo, display):
    return {'name': name, 'repo': repo, 'registered_repos': REPOS, 'display_name': display}


rows = []
rows.append(mod.build_project(project('command', REPOS[0], 'Jarvis Command'), (command_issues, command_prs[:3]), [command_prs[3]], {1},
            {1: {'profile': 'sonnet', 'route_effort': 'high'}, 6: {'profile': 'sol', 'blocked': {'blocked_reason': 'usage_limit'}}},
            {1: (None, NOW - 120), 8: (NOW - 7200, None)}, None, mod.plan_summary(PLAN), PROFILES, ci_state, NOW)[0])
rows.append(mod.build_project(project('studio', REPOS[1], 'Dev Studio'), (studio_issues, studio_prs[:1]), [studio_prs[1]], set(),
            {}, {}, {'kind': 'transient', 'resume_at': iso(-1)}, mod.plan_summary(ROADMAP), PROFILES, ci_state, NOW, STUDIO_RELEASE)[0])
rows.append(mod.build_project(project('creature-gba', REPOS[2], 'Emberbound'), None, None, None, {}, {}, None,
            mod.plan_summary(None), PROFILES, ci_state, NOW)[0])
json.dump(mod.build(rows, NOW), open(sys.argv[2], 'w'), indent=1, sort_keys=False)
