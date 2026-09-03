import { CommandBootstrapSchema } from '@jarvis-command/contracts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { AccessIdentity } from './access-auth';
import { buildApp } from './app';
import type { AppConfig } from './config';
import { HermesUpstreamError, type HermesSnapshot } from './hermes-client';

const config: AppConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3000,
  appVersion: '0.1.0-test',
  authMode: 'cloudflare',
  cloudflare: {
    teamDomain: 'team.cloudflareaccess.com',
    audience: 'a'.repeat(64),
    allowedEmail: 'operator@example.com',
  },
  hermes: {
    baseUrl: 'http://127.0.0.1:18642',
    apiKey: 'server-side-hermes-secret',
    modelLabel: 'gpt-5.6-sol',
    providerLabel: 'OpenAI Codex',
  },
  webDistDir: undefined,
};

const identity: AccessIdentity = {
  email: 'operator@example.com',
  provider: 'cloudflare-access',
};

const snapshot: HermesSnapshot = {
  state: 'online',
  version: '0.21.0',
  model: 'gpt-5.6-sol',
  provider: 'OpenAI Codex',
  gatewayState: 'idle',
  activeAgents: 0,
  capabilities: ['run_events_sse', 'session_resources'],
  readinessChecks: { config: 'pass', disk: 'pass' },
  sessions: [],
};

describe('Jarvis Command server', () => {
  it('exposes a minimal unauthenticated liveness probe', async () => {
    const app = buildApp({
      config,
      verifyAccess: vi.fn(),
      hermes: { readSnapshot: vi.fn() },
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'jarvis-command',
      version: '0.1.0-test',
    });
    await app.close();
  });

  it('rejects bootstrap requests without a valid Access assertion', async () => {
    const verifyAccess = vi.fn().mockRejectedValue(new Error('invalid token details'));
    const app = buildApp({
      config,
      verifyAccess,
      hermes: { readSnapshot: vi.fn() },
    });

    const response = await app.inject({ method: 'GET', url: '/api/bootstrap' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    expect(verifyAccess).toHaveBeenCalledWith(undefined);
    await app.close();
  });

  it('returns a validated, secret-free bootstrap payload', async () => {
    const app = buildApp({
      config,
      verifyAccess: vi.fn().mockResolvedValue(identity),
      hermes: { readSnapshot: vi.fn().mockResolvedValue(snapshot) },
      now: () => new Date('2026-09-03T14:30:00.000Z'),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: { 'cf-access-jwt-assertion': 'signed-token' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(CommandBootstrapSchema.parse(body)).toEqual(body);
    expect(JSON.stringify(body)).not.toContain('server-side-hermes-secret');
    expect(body).toEqual({
      identity,
      command: {
        version: '0.1.0-test',
        environment: 'test',
        generatedAt: '2026-09-03T14:30:00.000Z',
      },
      hermes: {
        state: 'online',
        version: '0.21.0',
        model: 'gpt-5.6-sol',
        provider: 'OpenAI Codex',
        gatewayState: 'idle',
        activeAgents: 0,
        capabilities: ['run_events_sse', 'session_resources'],
        readinessChecks: { config: 'pass', disk: 'pass' },
      },
      sessions: [],
    });
    await app.close();
  });

  it('keeps the shell available when Hermes is temporarily offline', async () => {
    const app = buildApp({
      config,
      verifyAccess: vi.fn().mockResolvedValue(identity),
      hermes: {
        readSnapshot: vi.fn().mockRejectedValue(new HermesUpstreamError()),
      },
      now: () => new Date('2026-09-03T14:30:00.000Z'),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/bootstrap',
      headers: { 'cf-access-jwt-assertion': 'signed-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().hermes).toMatchObject({
      state: 'offline',
      gatewayState: 'unknown',
      readinessChecks: { upstream: 'fail' },
    });
    await app.close();
  });

  it('serves the built web shell and SPA routes when a distribution directory is configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-web-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Jarvis Command</title>');
    const app = buildApp({
      config: { ...config, webDistDir: directory },
      verifyAccess: vi.fn(),
      hermes: { readSnapshot: vi.fn() },
    });

    try {
      const root = await app.inject({ method: 'GET', url: '/' });
      const room = await app.inject({ method: 'GET', url: '/rooms/jarvis-command' });

      expect(root.statusCode).toBe(200);
      expect(root.body).toContain('<title>Jarvis Command</title>');
      expect(room.statusCode).toBe(200);
      expect(room.body).toContain('<title>Jarvis Command</title>');
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
