import type { CommandBootstrap } from '@jarvis-command/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

const bootstrap: CommandBootstrap = {
  identity: {
    provider: 'cloudflare-access',
  },
  command: {
    version: '0.1.0',
    environment: 'production',
    generatedAt: '2026-09-03T14:30:00.000Z',
  },
  hermes: {
    state: 'online',
    version: '0.21.0',
    model: 'gpt-5.6-sol',
    provider: 'OpenAI Codex',
    gatewayState: 'idle',
    activeAgents: 1,
    capabilities: ['run_events_sse', 'session_resources'],
    readinessChecks: {
      config: 'pass',
      disk: 'pass',
      sessionDb: 'pass',
    },
  },
  sessions: [
    {
      id: 'session_123',
      title: 'Jarvis Command',
      source: 'discord',
      model: 'gpt-5.6-sol',
      lastActive: '2026-09-03T14:29:00.000Z',
      messageCount: 18,
      toolCallCount: 7,
      pinned: true,
    },
  ],
};

describe('Jarvis Command shell', () => {
  it('renders a useful command room from the live bootstrap contract', async () => {
    render(<App loadBootstrap={async () => bootstrap} />);

    expect(screen.getByLabelText('Jarvis Command is loading')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Jarvis Command' })).toBeInTheDocument();
    expect(screen.getAllByText('Hermes available')).toHaveLength(2);
    expect(screen.getByText('gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Codex')).toBeInTheDocument();
    expect(screen.queryByText('Max reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText('272K default')).not.toBeInTheDocument();
    expect(screen.getByText('1 active agent')).toBeInTheDocument();

    const sessions = screen.getByRole('navigation', { name: 'Project rooms' });
    expect(within(sessions).getByText('18 messages · 7 tools')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mission timeline' })).toBeInTheDocument();
    expect(screen.getByText('Operational snapshot')).toBeInTheDocument();
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
    expect(screen.getByText('Static snapshot')).toBeInTheDocument();
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Operations deck' })).toBeInTheDocument();
    const mobileNavigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(mobileNavigation).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search command room' })).not.toBeInTheDocument();
    expect(screen.getByText('Messaging is unavailable in this read-only slice.')).toBeInTheDocument();
    expect(within(sessions).getByRole('button', { name: 'Artifacts' })).toBeDisabled();
    expect(within(mobileNavigation).getByRole('button', { name: 'Agents' })).toBeDisabled();
    expect(within(mobileNavigation).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(mobileNavigation).getByRole('button', { name: 'Artifacts' })).toBeDisabled();
    expect(screen.getByText('Read-only bridge')).toBeInTheDocument();
    expect(screen.getAllByText('Access verified')).toHaveLength(2);
    expect(screen.getByText('Hermes available', { selector: '.state-badge' })).toHaveClass('online');
  });

  it('keeps the command shell honest when Hermes is offline', async () => {
    render(
      <App
        loadBootstrap={async () => ({
          ...bootstrap,
          hermes: {
            ...bootstrap.hermes,
            state: 'offline',
            model: null,
            provider: null,
            gatewayState: 'unknown',
            activeAgents: 0,
            readinessChecks: { hermesBridge: 'fail' },
          },
          sessions: [],
        })}
      />,
    );

    expect((await screen.findAllByText('Hermes unavailable')).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('heading', { name: 'Hermes unavailable' })).toBeInTheDocument();
    expect(screen.getByText('No sessions returned by Hermes.')).toBeInTheDocument();
    expect(screen.getAllByText('Hermes unavailable').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Hermes unavailable', { selector: '.state-badge' })).toHaveClass('offline');
    expect(screen.getByText('Model not reported')).toBeInTheDocument();
    expect(screen.getByText('Provider not reported')).toBeInTheDocument();
  });

  it('labels development authentication without claiming Cloudflare Access', async () => {
    render(<App loadBootstrap={async () => ({
      ...bootstrap,
      identity: { provider: 'development' },
      command: { ...bootstrap.command, environment: 'development' },
    })} />);

    expect(await screen.findAllByText('Development identity')).toHaveLength(2);
    expect(screen.queryByText('Access verified')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Authenticated operator')).toHaveAttribute(
      'title',
      'Development identity verified',
    );
    expect(screen.getByText('Development identity', { selector: '.identity-badge' })).toHaveClass('development');
  });

  it('renders degraded Hermes as reachable but unhealthy', async () => {
    render(<App loadBootstrap={async () => ({
      ...bootstrap,
      hermes: {
        ...bootstrap.hermes,
        state: 'degraded',
        gatewayState: 'unknown',
        readinessChecks: { config: 'pass', disk: 'warn' },
      },
    })} />);

    expect(await screen.findByRole('heading', { name: 'Hermes degraded' })).toBeInTheDocument();
    expect(screen.getByText(/private snapshot arrived, but readiness checks/i)).toBeInTheDocument();
    expect(screen.queryByText(/did not answer the private upstream probe/i)).not.toBeInTheDocument();
  });

  it('shows a bounded failure state when bootstrap authorization fails', async () => {
    render(
      <App
        loadBootstrap={async () => {
          throw new Error('sensitive upstream details');
        }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Jarvis Command could not establish the secure session.',
    );
    expect(screen.queryByText('sensitive upstream details')).not.toBeInTheDocument();
  });
});
