import { expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import type { createLiveRoomService } from './live-room-service';

it.each([
  { enabled: false, ready: true, composed: true, advertised: false },
  { enabled: true, ready: true, composed: true, advertised: true },
  { enabled: true, ready: false, composed: true, advertised: false },
  { enabled: true, ready: true, composed: false, advertised: false },
])('advertises only the configured ready BFF reaction capability: %j', async ({ enabled, ready, composed, advertised }) => {
  const config = loadConfig({ NODE_ENV: 'test', HERMES_READ_PROXY_KEY: 'r'.repeat(32), COMMAND_MODE: 'enabled', REACTIONS_MODE: enabled ? 'enabled' : 'disabled', PUBLIC_ORIGIN: 'https://command.example', HERMES_COMMAND_API_BASE_URL: 'http://127.0.0.1:18643', HERMES_COMMAND_PROXY_KEY: 'c'.repeat(32), COMMAND_AUDIT_LOG_PATH: '/tmp/SYNTHETIC-never-opened/events.jsonl', ARTIFACTS_MODE: 'disabled' });
  const app = buildApp({ config,
    verifyAccess: async () => ({ subject: 'synthetic-actor', provider: 'development' }),
    hermes: { readSnapshot: async () => ({ state: 'online', version: null, model: null, provider: null, gatewayState: 'idle', activeAgents: 0, capabilities: ['run_events_sse', 'message_reactions'], readinessChecks: {}, sessions: [] }) },
    liveRoom: composed ? {} as ReturnType<typeof createLiveRoomService> : undefined,
    checkLiveRoom: vi.fn(async () => { if (!ready) throw Error('SYNTHETIC unavailable'); }),
  });
  try {
    const response = await app.inject('/api/bootstrap'); expect(response.statusCode).toBe(200);
    expect(response.json().hermes.capabilities.includes('message_reactions')).toBe(advertised);
    expect(response.json().hermes.capabilities).toContain('run_events_sse');
    expect(config.reactionsEnabled).toBe(enabled);
  } finally { await app.close(); }
});
