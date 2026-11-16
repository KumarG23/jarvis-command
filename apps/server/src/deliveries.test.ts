import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRoom } from '@jarvis-command/contracts';
import { DeliveryConflictError, DeliveryStore } from './delivery-store';
import { NotificationStore, deliveryPreview } from './notification-store';
import { createDeliverer, deliveryNotificationId } from './deliverer';
import { createScheduledRunsServer } from './scheduled-runs';
import { ArtifactStore } from './artifact-store';

const ACTOR = 'a'.repeat(64);
const KEY = 'k'.repeat(40);
const RUN_KEY = 'r'.repeat(40);
const ROOM = `room_${'1'.repeat(32)}`;
const LEAD = `jc_${'2'.repeat(32)}`;
const LOOSE = `jc_${'3'.repeat(32)}`;
const ARCHIVED_CHAT = `jc_${'4'.repeat(32)}`;
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function root() {
  const path = await fs.mkdtemp(join(tmpdir(), 'jc-delivery-')); roots.push(path);
  await fs.chmod(path, 0o700);
  return path;
}
const input = { key: 'job1:2026-11-12T17:00', sessionId: LEAD, kind: 'reminder' as const, title: 'Stretch', content: 'Time to stretch.\nThen water.' };

describe('delivery store', () => {
  it('records once per key, replays the same body and refuses a different one', async () => {
    const store = new DeliveryStore(await root());
    const first = await store.record(ACTOR, input);
    expect(first.replayed).toBe(false);
    expect(first.delivery).toMatchObject({ sessionId: LEAD, kind: 'reminder', title: 'Stretch', content: input.content });
    expect(first.delivery.deliveryId).toMatch(/^dlv_[a-f0-9]{32}$/);
    const again = await new DeliveryStore(store.directory).record(ACTOR, input);
    expect(again).toEqual({ delivery: first.delivery, replayed: true });
    await expect(store.record(ACTOR, { ...input, content: 'other' })).rejects.toBeInstanceOf(DeliveryConflictError);
    expect(await store.list(ACTOR, LEAD)).toEqual([first.delivery]);
    expect(await store.list('b'.repeat(64), LEAD)).toEqual([]);
    expect(await store.find(ACTOR, first.delivery.deliveryId)).toEqual(first.delivery);
  });

  it('keeps the newest 300 deliveries', async () => {
    const store = new DeliveryStore(await root());
    for (let index = 0; index < 305; index += 1) await store.record(ACTOR, { ...input, key: `k${index}` });
    const kept = await store.list(ACTOR, LEAD);
    expect(kept).toHaveLength(300);
  }, 30_000);
});

describe('delivery inbox and push', () => {
  it('creates one inbox entry and one push per delivery, never on replay or while the chat is on screen', async () => {
    const directory = await root();
    const notifications = new NotificationStore(directory);
    const deliveries = new DeliveryStore(directory);
    const push = { deliverDelivery: vi.fn(async () => undefined) };
    const visible = vi.fn(() => false);
    const deliver = createDeliverer({ deliveries, notifications, push: push as never, presence: { visible, mark: vi.fn() } as never });
    const result = await deliver(ACTOR, input);
    expect(result).toMatchObject({ sessionId: LEAD, replayed: false });
    const id = deliveryNotificationId(ACTOR, result.deliveryId);
    expect(push.deliverDelivery).toHaveBeenCalledWith(ACTOR, id);
    const item = await notifications.find(ACTOR, id);
    expect(item).toMatchObject({ category: 'delivery', title: 'Stretch', body: 'Time to stretch.', sessionId: LEAD, delivery: { deliveryId: result.deliveryId } });
    expect(item?.publicRunId).toBeUndefined();
    expect(await deliver(ACTOR, input)).toMatchObject({ replayed: true, deliveryId: result.deliveryId });
    expect(push.deliverDelivery).toHaveBeenCalledTimes(1);
    visible.mockReturnValue(true);
    await deliver(ACTOR, { ...input, key: 'second' });
    expect(push.deliverDelivery).toHaveBeenCalledTimes(1);
  });

  it('hides delivery text when reply text is off and titles untitled jobs', async () => {
    const directory = await root();
    const notifications = new NotificationStore(directory);
    await notifications.setPreferences(ACTOR, { categories: { 'run-completed': true, 'run-failed': true, approval: true }, showReplyText: false });
    const deliver = createDeliverer({ deliveries: new DeliveryStore(directory), notifications });
    const result = await deliver(ACTOR, { ...input, title: null, kind: 'cron' });
    expect(await notifications.find(ACTOR, deliveryNotificationId(ACTOR, result.deliveryId))).toMatchObject({ title: 'Scheduled task', body: 'Open the chat to read it.' });
  });

  it('previews the first non-empty line, bounded', () => {
    expect(deliveryPreview('\n\n  **Disk**   check  \nmore')).toBe('**Disk** check');
    expect(deliveryPreview('x'.repeat(400))).toHaveLength(160);
    expect(deliveryPreview(' \n ')).toBe('Open the chat to read it.');
  });
});

describe('POST /v1/deliveries', () => {
  const room = (overrides: Partial<ProjectRoom> = {}) => ({ id: ROOM, name: 'Homelab', sessionIds: [LEAD], lastSessionId: LEAD, leadSessionId: LEAD, archived: false, ...overrides }) as unknown as ProjectRoom;
  const rooms = [room(), room({ id: `room_${'5'.repeat(32)}`, sessionIds: [ARCHIVED_CHAT], lastSessionId: ARCHIVED_CHAT, leadSessionId: null, archived: true })];
  function setup(home: string | null = null) {
    const deliver = vi.fn(async (_actor: string, request: { sessionId: string }) => ({ deliveryId: `dlv_${'6'.repeat(32)}`, sessionId: request.sessionId, replayed: false }));
    const getSession = vi.fn(async (_subject: unknown, sessionId: string) => {
      if (sessionId === `jc_${'9'.repeat(32)}`) throw Object.assign(new Error('missing'), { statusCode: 404 });
      return { session: { id: sessionId } };
    });
    const logs: unknown[] = [];
    const app = createScheduledRunsServer({
      config: { host: '127.0.0.1', port: 0, key: RUN_KEY, deliveriesKey: KEY, ownerActor: ACTOR, home },
      liveRoom: () => ({ getSession }) as never,
      rooms: () => ({ list: async () => rooms }),
      log: fields => { logs.push(fields); },
      deliver,
    });
    return { app, deliver, logs };
  }
  const headers = { authorization: `Bearer ${KEY}` };
  const body = { id: '6f1c1b8e-3d2a-4c55-9a3e-0b1c2d3e4f50', chatId: ROOM, content: 'Secret reminder text', title: 'Stretch', kind: 'reminder' };

  it('refuses every delivery when no deliveries key is configured', async () => {
    const app = createScheduledRunsServer({ config: { host: '127.0.0.1', port: 0, key: RUN_KEY, ownerActor: ACTOR }, liveRoom: () => undefined, rooms: () => undefined, log: () => undefined });
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: body, headers: { authorization: `Bearer ${RUN_KEY}` } })).statusCode).toBe(401);
    await app.close();
  });

  it('delivers to a project chat, a loose chat and home, as the owner', async () => {
    const { app, deliver, logs } = setup(LOOSE);
    const project = await app.inject({ method: 'POST', url: '/v1/deliveries', payload: body, headers });
    expect(project.statusCode).toBe(200);
    expect(project.json()).toEqual({ deliveryId: `dlv_${'6'.repeat(32)}`, sessionId: LEAD, replayed: false });
    expect(deliver).toHaveBeenCalledWith(ACTOR, { key: body.id, sessionId: LEAD, kind: 'reminder', title: 'Stretch', content: body.content });
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, chatId: LOOSE }, headers })).json()).toMatchObject({ sessionId: LOOSE });
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, chatId: 'home' }, headers })).json()).toMatchObject({ sessionId: LOOSE });
    expect(JSON.stringify(logs)).not.toContain('Secret');
    expect(JSON.stringify(logs)).not.toContain('Stretch');
    await app.close();
  });

  it('refuses bad keys, bad bodies, unknown or archived targets and an unset home', async () => {
    const { app, deliver } = setup();
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: body })).statusCode).toBe(401);
    // Keys are scoped: the runs key can't deliver, and the deliveries key can't list or start runs.
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: body, headers: { authorization: `Bearer ${RUN_KEY}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/scheduled-runs/targets', headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/scheduled-runs', payload: {}, headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, id: 'has space' }, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, kind: 'other' }, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, content: 'x'.repeat(16_001) }, headers })).statusCode).toBe(400);
    const home = await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, chatId: 'home' }, headers });
    expect([home.statusCode, home.json()]).toEqual([404, { error: 'home_not_set' }]);
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, chatId: ARCHIVED_CHAT }, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, chatId: `room_${'5'.repeat(32)}` }, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/v1/deliveries', payload: { ...body, chatId: `jc_${'9'.repeat(32)}` }, headers })).statusCode).toBe(404);
    expect(deliver).not.toHaveBeenCalled();
    deliver.mockRejectedValueOnce(new DeliveryConflictError());
    const conflict = await app.inject({ method: 'POST', url: '/v1/deliveries', payload: body, headers });
    expect([conflict.statusCode, conflict.json()]).toEqual([409, { error: 'conflict' }]);
    await app.close();
  });
});

describe('/v1/files', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  async function setup() {
    const directory = await root();
    const artifactStore = new ArtifactStore({ root: directory, maxFileBytes: 4096, maxTotalBytes: 65_536, maxArtifacts: 20 });
    const app = createScheduledRunsServer({
      config: { host: '127.0.0.1', port: 0, key: RUN_KEY, deliveriesKey: KEY, ownerActor: ACTOR },
      liveRoom: () => undefined, rooms: () => undefined, log: () => undefined, artifactStore, maxFileBytes: 4096,
    });
    return { app, artifactStore };
  }
  const headers = { authorization: `Bearer ${KEY}` };

  it('stores a file Jarvis sends and returns Markdown that shows it in a chat', async () => {
    const { app } = await setup();
    const sent = await app.inject({ method: 'POST', url: `/v1/files?name=report.tar.gz&chatId=${LEAD}&id=job1.fire1`, payload: Buffer.from('tarball bytes'), headers: { ...headers, 'content-type': 'application/gzip' } });
    expect(sent.statusCode).toBe(200);
    const file = sent.json();
    expect(file).toMatchObject({ type: 'file', name: 'report.tar.gz', version: 1, size: 13 });
    expect(file.markdown).toBe(`[report.tar.gz](/api/artifacts/${file.artifactId}/versions/1/download)`);
    const again = await app.inject({ method: 'POST', url: `/v1/files?name=report.tar.gz&chatId=${LEAD}&id=job1.fire1`, payload: Buffer.from('tarball bytes'), headers: { ...headers, 'content-type': 'application/gzip' } });
    expect(again.json().artifactId).toBe(file.artifactId);
    const image = (await app.inject({ method: 'POST', url: '/v1/files?name=graph.png', payload: PNG, headers: { ...headers, 'content-type': 'image/png' } })).json();
    expect(image.markdown).toBe(`![graph.png](/api/artifacts/${image.artifactId}/versions/1/blob)`);
    // A file that claims to be an image but isn't one is still stored, as a plain file.
    const fake = (await app.inject({ method: 'POST', url: '/v1/files?name=fake.png', payload: Buffer.from('not a png'), headers: { ...headers, 'content-type': 'image/png' } })).json();
    expect(fake.type).toBe('file');
    const text = (await app.inject({ method: 'POST', url: '/v1/files?name=notes.txt', payload: 'plain notes', headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } })).json();
    expect(text).toMatchObject({ type: 'file', size: 11 });
    const fetched = await app.inject({ method: 'GET', url: `/v1/files/${file.artifactId}/1`, headers });
    expect([fetched.statusCode, fetched.body]).toEqual([200, 'tarball bytes']);
    await app.close();
  });

  it('needs the deliveries key and refuses bad input', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/v1/files?name=a.txt', payload: Buffer.from('x'), headers: { authorization: `Bearer ${RUN_KEY}`, 'content-type': 'text/plain' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/v1/files/art_${'a'.repeat(32)}/1` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/files?name=../a', payload: Buffer.from('x'), headers: { ...headers, 'content-type': 'text/plain' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/files?name=a.bin', payload: Buffer.alloc(5000), headers: { ...headers, 'content-type': 'application/octet-stream' } })).statusCode).toBe(413);
    expect((await app.inject({ method: 'GET', url: `/v1/files/art_${'a'.repeat(32)}/1`, headers })).statusCode).toBe(404);
    await app.close();
  });
});
