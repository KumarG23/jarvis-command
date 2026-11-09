import { describe, expect, it } from 'vitest';

import golden from './fixtures/golden.projection.json?raw';
import { decodeStudioProjection, STUDIO_PROJECTION_MAX_BYTES } from './studioProjection';

// golden.projection.json is the output of the accepted Studio producer (projection.py @ 6339856) over SYNTHETIC inputs.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- mutation helper over arbitrary JSON
const fresh = (): Json => JSON.parse(golden);
const work = (doc: Json, project = 0, index = 0): Json => doc.projects[project].work[index];
const owned = (doc: Json): Json => doc.projects[0].work.find((w: Json) => w.owner);
const rejected = (doc: unknown, kind: string, message?: RegExp) => {
  const result = decodeStudioProjection(doc);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe(kind);
    if (message) expect(result.message).toMatch(message);
  }
};

describe('golden producer document', () => {
  it('decodes the real producer output, text and parsed forms alike', () => {
    const result = decodeStudioProjection(golden);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBeGreaterThan(10_000);
    expect(result.snapshot.projects.map((p) => p.displayName)).toEqual(['Jarvis Command', 'Dev Studio', 'Emberbound']);
    expect(decodeStudioProjection(fresh()).ok).toBe(true);
  });

  it('keeps unknown as unknown: no zero totals, no defaults for the unreachable project', () => {
    const result = decodeStudioProjection(golden);
    if (!result.ok) throw new Error(result.message);
    const { snapshot } = result;
    expect(snapshot.totals.coverage).toEqual({ projects: 3, withCounts: 2, complete: false });
    expect(snapshot.totals.counts.attention).toBeNull();
    const emberbound = snapshot.projects[2]!;
    expect(emberbound.counts).toBeNull();
    expect(emberbound.work).toEqual([]);
    expect(emberbound.sources.github).toBe('unavailable');
    expect(emberbound.progress).toEqual({ kind: 'unknown', reason: 'plan source unavailable' });
  });

  it('carries configured route as configuration and never an executed route', () => {
    const result = decodeStudioProjection(golden);
    if (!result.ok) throw new Error(result.message);
    const owners = result.snapshot.projects.flatMap((p) => p.work.map((w) => w.owner)).filter((o) => o !== null);
    expect(owners.length).toBeGreaterThan(0);
    for (const o of owners) expect(o.executed.state).toBe('unknown');
    const doc = fresh();
    owned(doc).owner.executed = { state: 'known', model: 'gpt-6-sol' };
    rejected(doc, 'malformed', /executed/);
  });

  it('accepts a full-capacity producer document inside the byte bound', () => {
    const doc = fresh();
    const template = doc.projects[0];
    const rows = Array.from({ length: 16 }, (_, i) => {
      const row = structuredClone(template);
      row.id = `p${String.fromCharCode(97 + i)}`;
      row.repo = `Example/synth-${i}`;
      const base = row.work;
      const swap = (text: string) => text.replaceAll('Example/command-synth', row.repo);
      row.work = Array.from({ length: 100 }, (_, n) => JSON.parse(swap(JSON.stringify({ ...base[n % base.length], number: n + 1, id: `Example/command-synth#${n + 1}` }))));
      for (const [n, w] of row.work.entries()) { w.id = `${row.repo}#${n + 1}`; w.number = n + 1; w.prs = []; w.integration = []; w.evidence = [{ label: 'Issue', url: `https://github.com/${row.repo}/issues/${n + 1}` }]; if (w.blocker) w.blocker.dependencies = []; }
      row.unlinked_prs = []; row.delivery = { merged: [], coverage: 'latest 10 merged PRs', release: row.delivery.release };
      row.latest_event = null; row.milestone = null;
      const lanes = ['attention', 'building', 'checking', 'review', 'ready_to_test', 'integrated', 'unverified', 'queued', 'open'];
      row.counts = Object.fromEntries([...lanes.map((l) => [l, row.work.filter((w: Json) => w.lane === l).length]), ['open_issues', 100], ['open_prs', 0],
        ['sessions', 1], ['running', row.work.filter((w: Json) => w.run.observed === 'running').length], ['blocked', row.work.filter((w: Json) => w.state === 'blocked').length], ['ready', row.work.filter((w: Json) => w.state === 'ready').length]]);
      row.sessions = 1; row.running = row.counts.running; row.unmatched_sessions = 1;
      row.errors = row.errors.filter((e: Json) => e.source === 'plan');
      if (row.plan.state === 'read') row.errors = [];
      return row;
    });
    doc.projects = rows;
    doc.errors = rows.flatMap((r) => r.errors.map((e: Json) => ({ project: r.id, ...e })));
    const sum = (k: string) => rows.reduce((s, r) => s + r.counts[k], 0);
    for (const k of Object.keys(doc.totals)) if (k !== 'coverage') doc.totals[k] = k === 'running' ? sum('running') : k === 'sessions' ? 16 : sum(k);
    doc.totals.coverage = { projects: 16, with_counts: 16, complete: true };
    const text = JSON.stringify(doc);
    expect(text.length).toBeGreaterThan(500_000);
    expect(text.length).toBeLessThan(STUDIO_PROJECTION_MAX_BYTES);
    const result = decodeStudioProjection(text);
    if (!result.ok) throw new Error(result.message);
    expect(result.snapshot.projects).toHaveLength(16);
  });
});

describe('version, schema and framing', () => {
  it('rejects unknown versions explicitly, even when the rest would fit', () => {
    const doc = fresh(); doc.version = 2;
    rejected(doc, 'unsupported_version');
  });
  it('rejects a different schema, non-JSON, arrays and nulls', () => {
    const doc = fresh(); doc.schema = 'studio.other';
    rejected(doc, 'malformed', /schema/);
    rejected('<html>login</html>', 'not_json');
    rejected('[]', 'malformed');
    rejected('null', 'malformed');
  });
  it('recognises the producer unavailable body as such', () => {
    rejected({ schema: 'studio.projection', version: 1, error: 'projection unavailable' }, 'producer_unavailable');
  });
  it('rejects oversized bodies without parsing them', () => {
    rejected('x'.repeat(STUDIO_PROJECTION_MAX_BYTES + 1), 'oversized');
    // Multi-byte characters count by bytes, not UTF-16 units.
    rejected(`"${'é'.repeat(STUDIO_PROJECTION_MAX_BYTES / 2)}"`, 'oversized');
  });
  it('rejects unknown fields at the top and at every depth', () => {
    const top = fresh(); top.extra = 1; rejected(top, 'malformed', /unknown field "extra"/);
    const nested = fresh(); work(nested).run.model = 'gpt'; rejected(nested, 'malformed', /unknown field "model"/);
    const owner = fresh(); owned(owner).owner.model = 'unqualified'; rejected(owner, 'malformed', /unknown field "model"/);
    const proto = JSON.parse(golden.replace('"read_only": true', '"__proto__": {"x": 1}, "read_only": true')); rejected(proto, 'malformed', /unknown field/);
  });
  it('rejects missing fields, wrong types and non-plain objects', () => {
    const missing = fresh(); delete missing.projects[0].goal; rejected(missing, 'malformed', /missing field "goal"/);
    const wrong = fresh(); wrong.projects[0].truncated = 'no'; rejected(wrong, 'malformed', /boolean/);
    expect(decodeStudioProjection(Object.assign(Object.create({ schema: 'studio.projection', version: 1 }), {})).ok).toBe(false);
    const notReadOnly = fresh(); notReadOnly.read_only = false; rejected(notReadOnly, 'malformed', /read_only/);
  });
});

describe('bounds and hostile content', () => {
  it('rejects too many projects, items, and over-long strings', () => {
    const projects = fresh(); projects.projects = Array.from({ length: 17 }, () => projects.projects[0]); rejected(projects, 'malformed', /more than 16/);
    const items = fresh(); items.projects[0].work = Array.from({ length: 101 }, () => work(items)); rejected(items, 'malformed', /more than 100/);
    const longTitle = fresh(); work(longTitle).title = 'a'.repeat(141); rejected(longTitle, 'malformed', /longer than 140/);
    const limits = fresh(); limits.limits.max_projects = 99; rejected(limits, 'malformed', /max_projects/);
  });
  it('rejects control, bidi and invisible characters in display text', () => {
    for (const bad of ['a\u0000b', 'a‮b', 'a​b', 'a b', '\ud800']) {
      const doc = fresh(); work(doc).title = bad; rejected(doc, 'malformed', /control or invisible/);
    }
  });
  it('keeps markup-like text as plain data (it is inert at render time)', () => {
    const doc = fresh(); work(doc).title = '<img src=x onerror=alert(1)>';
    const result = decodeStudioProjection(doc);
    expect(result.ok && result.snapshot.projects[0]!.work[0]!.title).toBe('<img src=x onerror=alert(1)>');
  });
  it('rejects impossible and unzoned dates', () => {
    for (const bad of ['2026-02-30T10:00:00Z', '2026-13-01T10:00:00Z', '2026-11-09T25:00:00Z', '2026-11-09T10:00:00', 'yesterday', '1999-01-01T00:00:00Z', '2026-11-09T10:00:00+25:00']) {
      const doc = fresh(); doc.observed_at = bad; rejected(doc, 'malformed', /observed_at/);
    }
    const item = fresh(); work(item).updated_at = '2026-02-30T10:00:00+00:00'; rejected(item, 'malformed', /updated_at/);
  });
});

describe('links and identities', () => {
  it('only accepts rebuilt github.com links for registered repos', () => {
    for (const url of ['http://github.com/Example/command-synth/issues/1', 'https://evil.example/Example/command-synth/issues/2', 'javascript:alert(1)', 'https://github.com.evil.example/Example/command-synth/issues/2', 'https://github.com/Other/repo/issues/2']) {
      const doc = fresh(); work(doc).evidence[0].url = url; rejected(doc, 'malformed', /link|allowed/);
    }
    const failing = fresh();
    const item = work(failing, 0, 0);
    item.prs[0].links[1].url = 'https://github.com/Unregistered/repo/actions/runs/1';
    item.evidence[2].url = 'https://github.com/Unregistered/repo/actions/runs/1';
    rejected(failing, 'malformed', /registered project/);
    const query = fresh(); work(query).evidence.push({ label: 'x', url: 'https://github.com/Example/command-synth/issues/1?x=1' }); rejected(query, 'malformed', /allowed/);
  });
  it('requires repo-qualified ids to match number, repo and link', () => {
    const id = fresh(); work(id).id = 'Example/command-synth#99'; rejected(id, 'malformed', /id/);
    const bare = fresh(); work(bare).id = '#2'; rejected(bare, 'malformed', /id/);
    const url = fresh(); work(url).evidence[0].url = 'https://github.com/Example/command-synth/issues/3'; rejected(url, 'malformed', /link/);
    const dup = fresh(); dup.projects[1].id = 'command'; rejected(dup, 'malformed', /duplicate|total|coverage|project/);
  });
  it('accepts qualified cross-repo dependencies only for registered repos', () => {
    const doc = fresh();
    const blocked = work(doc, 0, 1);
    expect(blocked.blocker.dependencies.map((d: Json) => d.id)).toContain('Example/studio-synth#9');
    expect(decodeStudioProjection(doc).ok).toBe(true);
    blocked.blocker.dependencies[0] = { id: 'Other/repo#9', repo: 'Other/repo', number: 9, url: 'https://github.com/Other/repo/issues/9' };
    rejected(doc, 'malformed', /dependency repo/);
  });
});

describe('internal consistency', () => {
  it('rejects counts that disagree with the work items they summarise', () => {
    const doc = fresh(); doc.projects[0].counts.attention += 1; doc.projects[0].counts.open_issues += 1; rejected(doc, 'malformed', /disagree|open_issues|coverage/);
    const sum = fresh(); sum.projects[0].counts.attention += 1; rejected(sum, 'malformed', /sum/);
  });
  it('rejects totals that conflict with rows or hide unknown coverage as a number', () => {
    const wrong = fresh(); wrong.totals.coverage.projects = 4; rejected(wrong, 'malformed', /coverage/);
    const hidden = fresh(); hidden.totals.attention = 3; rejected(hidden, 'malformed', /total/);
    const complete = fresh(); complete.totals.coverage.complete = true; rejected(complete, 'malformed', /coverage/);
  });
  it('rejects ages that contradict their timestamps and stale flags that contradict ages', () => {
    const age = fresh(); work(age).age_seconds += 600; rejected(age, 'malformed', /age/);
    const stale = fresh(); work(stale).stale = true; rejected(stale, 'malformed', /stale/);
    const event = fresh(); event.projects[0].latest_event.age_seconds += 600; rejected(event, 'malformed', /age/);
  });
  it('rejects error entries that disagree with unknown sources, and a silent unknown source', () => {
    const doc = fresh(); doc.projects[2].errors = []; doc.errors = doc.errors.filter((e: Json) => e.project !== 'creature-gba'); rejected(doc, 'malformed', /error entries/);
    const top = fresh(); top.errors.pop(); rejected(top, 'malformed', /top-level errors/);
  });
  it('rejects GitHub-unavailable rows that still carry work, and presence-only sessions claimed as running', () => {
    const doc = fresh(); doc.projects[2].running = 1; rejected(doc, 'malformed', /work evidence/);
    const run = fresh(); const w = work(run, 0, 5); expect(w.run.observed).toBe('running'); w.run.session = false; rejected(run, 'malformed', /session presence/);
  });
  it('rejects blocker presence that disagrees with lane/state and ambiguous milestone contradictions', () => {
    const doc = fresh(); work(doc, 0, 0).blocker = null; rejected(doc, 'malformed', /blocker/);
    const ms = fresh(); ms.projects[0].milestone.ambiguous = true; rejected(ms, 'malformed', /ambiguity/);
  });
  it('keeps plan checklist progress honest', () => {
    const doc = fresh(); doc.projects[0].progress.done = 9; rejected(doc, 'malformed', /integer/);
    const pct = fresh(); pct.projects[0].progress.percent = 33; rejected(pct, 'malformed', /unknown field "percent"/);
  });
  it('accepts a per-project scoped document and rejects a mismatched scope', () => {
    const doc = fresh();
    doc.projects = [doc.projects[0]]; doc.errors = []; doc.scope = { project: 'command', note: 'totals cover all projects' };
    expect(decodeStudioProjection(doc).ok).toBe(true);
    doc.scope.project = 'studio'; rejected(doc, 'malformed', /scope/);
  });
});
