import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProjectRosterSchema } from '@jarvis-command/contracts';
import { createCommandServer } from './bootstrap';
import { loadConfig } from './config';
import { ProjectRoomStore } from './project-room-store';

it('binds the roster after real factory onReady, retaining one projection gate and read-only bounds across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jc-roster-bootstrap-'));
  await chmod(directory, 0o700);
  const ids = Array.from({ length: 6 }, (_, i) => 'jc_' + String(i).repeat(32));
  const project = { id: 'room_' + 'a'.repeat(32), name: 'SYNTHETIC lifecycle fixture', goal: 'Read-only composition regression', repository: '', notes: [], sessionIds: ids, lastSessionId: ids[0]! };
  const timestamp = '2026-10-31T19:00:00.000Z';
  const session = (id: string) => ({ id, title: 'SYNTHETIC session', source: 'web', ownership: 'command', model: null, lastActive: timestamp, messageCount: 3, toolCallCount: 0, pinned: false });
  const requests: string[] = [];
  const held: Array<() => void> = [];
  let holdSessions = false;
  let entered!: () => void;
  const bothEntered = new Promise<void>(resolve => { entered = resolve; });
  const release = () => { holdSessions = false; for (const done of held.splice(0)) done(); };
  const proxy = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url!, 'http://synthetic.invalid');
    const match = url.pathname.match(/^\/api\/sessions\/(jc_[0-5]{32})(\/messages)?$/);
    if (req.method === 'GET' && match) {
      const id = match[1]!;
      if (match[2] && url.search === '?limit=2&offset=0') {
        res.end(JSON.stringify({ sessionId: id, messages: ['user', 'assistant'].map((role, index) => ({ id: `synthetic-${index}`, sessionId: id, role, content: 'x'.repeat(500), timestamp, toolName: null, displayKind: null })), pagination: { limit: 2, offset: 0, returned: 2, hasMore: true } }));
        return;
      }
      if (!match[2]) {
        const respond = () => res.end(JSON.stringify({ session: session(id) }));
        if (holdSessions) { held.push(respond); if (held.length === 2) entered(); }
        else respond();
        return;
      }
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address(); if (!address || typeof address === 'string') throw Error('SYNTHETIC server unavailable');
  const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', HERMES_COMMAND_API_BASE_URL: `http://127.0.0.1:${address.port}`, HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), PUBLIC_ORIGIN: 'https://command.example', COMMAND_AUDIT_LOG_PATH: join(directory, 'audit.jsonl'), ARTIFACTS_MODE: 'disabled' });
  const factory = () => createCommandServer(config, { hermes: { readSnapshot: async () => { throw Error('SYNTHETIC unused'); } } });
  let app = factory();
  try {
    await new ProjectRoomStore(directory).update(() => [project]);
    // This uses bootstrap's actual lazy service getter and onReady ledger/service
    // initialization, rather than passing an eagerly built service to buildApp.
    await app.ready();
    const registryBefore = await readFile(join(directory, 'project-rooms.json'));
    const auditBefore = await readFile(config.command!.auditLogPath);
    expect((await app.inject('/api/rooms')).statusCode).toBe(200);
    expect((await app.inject(`/api/live/sessions/${ids[0]}`)).statusCode).toBe(200);
    const url = `/api/rooms/${project.id}/roster`;
    const first = await app.inject(url);
    expect({ status: first.statusCode, body: first.json() }).toMatchObject({ status: 200, body: { total: 6, omitted: 2, partial: true } });
    const roster = ProjectRosterSchema.parse(first.json());
    expect(roster.items).toHaveLength(4);
    expect(roster.items.every(item => item.status === 'idle' && !item.messagesUnavailable && item.messagesTruncated && item.messages.every(message => message.text.length === 240 && message.truncated))).toBe(true);
    expect(first.headers['cache-control']).toBe('no-store');

    holdSessions = true;
    const reading = app.inject(url).then(response => response);
    await bothEntered;
    const countBefore = requests.length;
    // A reader per request would bypass the singleton gate and start more reads.
    const competing = await app.inject(url);
    expect(competing.statusCode).toBeGreaterThanOrEqual(500);
    expect(requests).toHaveLength(countBefore);
    expect(held).toHaveLength(2);
    release();
    expect((await reading).statusCode).toBe(200);
    expect((await app.inject(url)).statusCode).toBe(200);
    expect(await readFile(join(directory, 'project-rooms.json'))).toEqual(registryBefore);
    expect(await readFile(config.command!.auditLogPath)).toEqual(auditBefore);

    await app.close(); app = factory();
    expect((await app.inject(url)).statusCode).toBe(200);
    expect(await readFile(join(directory, 'project-rooms.json'))).toEqual(registryBefore);
    expect(await readFile(config.command!.auditLogPath)).toEqual(auditBefore);
    expect(requests.every(request => request.startsWith('GET ') && !request.includes('/v1/runs'))).toBe(true);
    expect(requests.some(request => ids.slice(4).some(id => request.includes(id)))).toBe(false);
  } finally {
    release();
    await app.close();
    await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
