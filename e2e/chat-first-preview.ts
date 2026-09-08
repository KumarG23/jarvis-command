/** Isolated, synthetic UI preview. Never imported by the application or deployed. */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const timestamp = '2026-09-08T10:42:00.000Z';
const session = (key: string, title: string) => ({ id: `jc_${key.repeat(32)}`, title, source: 'api_server', ownership: 'command', model: null, lastActive: timestamp, messageCount: 2, toolCallCount: 0, pinned: false });
const sessions = [session('a', 'Designing a calmer workspace'), session('b', 'Mobile navigation'), session('c', 'Weekend plans'), session('d', 'A place for new ideas')];
const rooms = [
  { id: `room_${'a'.repeat(32)}`, name: 'Jarvis Command', goal: 'A focused place to work with Jarvis. Keep the conversation at the center, organize related chats, and bring project details into view when they are useful.', repository: 'https://github.com/KumarG23/jarvis-command', notes: ['Jarvis Command product direction', 'Frontend handoff'], sessionIds: [sessions[0]!.id, sessions[1]!.id], lastSessionId: sessions[0]!.id },
  { id: `room_${'b'.repeat(32)}`, name: 'Homelab', goal: 'Plan and document the home lab.', repository: '', notes: [], sessionIds: [], lastSessionId: null },
  { id: `room_${'c'.repeat(32)}`, name: 'Personal projects', goal: 'A space for small experiments.', repository: '', notes: [], sessionIds: [], lastSessionId: null },
];
const history = new Map(sessions.map(value => [value.id, [
  { id: `question-${value.id}`, sessionId: value.id, role: 'user', content: 'Let’s make this feel like one workspace. I want to focus on the conversation, then open projects and details when I need them.', timestamp, toolName: null, displayKind: null },
  { id: `answer-${value.id}`, sessionId: value.id, role: 'assistant', content: 'The conversation can stay at the center.\n\nYour projects and recent chats share one sidebar. Open a project to see its conversations, or use Project details to bring its goal and references alongside the chat.\n\nOn a phone, navigation and project details open as focused panels, leaving room to read and reply.\n\nThis is a synthetic design preview. No request is sent to Hermes.', timestamp, toolName: null, displayKind: null },
]]));
const runs = new Map<string, { sessionId: string; clientRequestId: string; input: string; done: boolean }>();
const output = 'Preview response received. Your conversation stays selected when you open and close project details. No Hermes tools were called.';
const server = createServer(async (request, response) => {
  const path = new URL(request.url!, 'http://localhost').pathname;
  const json = (body: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
  let body: Record<string, string> = {};
  if (request.method === 'POST') {
    let raw = ''; for await (const chunk of request) raw += String(chunk);
    try { body = JSON.parse(raw || '{}'); } catch { json({}, 400); return; }
  }
  if (path === '/api/bootstrap') return json({ identity: { provider: 'development' }, command: { version: 'synthetic design preview', environment: 'test', generatedAt: timestamp, liveRoom: { enabled: true, externalContinue: false, maxInputCharacters: 16000, maxSteerCharacters: 4000 } }, hermes: { state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse'], readinessChecks: {} }, sessions });
  if (path === '/api/rooms') {
    if (request.method === 'POST') { const room = { ...rooms[0]!, ...body, id: 'room_' + randomBytes(16).toString('hex'), sessionIds: [], lastSessionId: null }; rooms.push(room); return json({ room }); }
    return json({ version: 1, rooms });
  }
  if (path.startsWith('/api/rooms/')) {
    const room = rooms.find(value => value.id === path.split('/')[3]);
    if (!room) return json({}, 404);
    if (path.endsWith('/sessions')) {
      const value = sessions.find(item => item.id === body.sessionId); if (!value) return json({}, 404);
      if (!room.sessionIds.includes(value.id)) room.sessionIds.push(value.id);
      room.lastSessionId = value.id; return json({ room, session: value });
    }
    if (body.name === 'Preview save failure') return json({}, 503);
    Object.assign(room, body); return json({ room });
  }
  if (path === '/api/live/sessions') { const value = { ...session('e', body.title ?? 'New conversation'), id: 'jc_' + randomBytes(16).toString('hex'), messageCount: 0 }; sessions.unshift(value); history.set(value.id, []); return json({ session: value }); }
  if (path.startsWith('/api/live/sessions/')) { const value = sessions.find(item => item.id === path.split('/')[4]); return json({ session: value }, value ? 200 : 404); }
  if (path.startsWith('/api/sessions/') && path.endsWith('/messages')) { const id = path.split('/')[3]!, messages = history.get(id) ?? []; return json({ sessionId: id, messages, pagination: { limit: 50, offset: 0, returned: messages.length, hasMore: false } }); }
  if (path === '/api/live/runs') { const id = 'jcr_' + randomBytes(16).toString('hex'); runs.set(id, { sessionId: body.sessionId!, clientRequestId: body.clientRequestId!, input: body.input!, done: false }); return json({ publicRunId: id, sessionId: body.sessionId, clientRequestId: body.clientRequestId, status: 'running', replayed: false }); }
  if (path.startsWith('/api/live/runs/')) {
    const id = path.split('/')[4]!, run = runs.get(id); if (!run) return json({}, 404);
    if (path.endsWith('/events')) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const emit = (type: string, data: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, publicRunId: id, timestamp, ...data })}\n\n`);
      emit('message.delta', { delta: output });
      run.done = true;
      // Preview retains the local turn to exercise the real history handoff state.
      emit('run.completed', { output, pendingSteer: null, usage: null }); response.end(); return;
    }
    return json({ publicRunId: id, sessionId: run.sessionId, status: run.done ? 'completed' : 'running', updatedAt: timestamp, approval: null, output: run.done ? output : null, error: null, pendingSteer: null, usage: null });
  }
  json({}, 404);
});
server.listen(3000, '127.0.0.1', () => console.log('Synthetic UI fixture on loopback port 3000; no Hermes connection.'));
