import { loadSessionHostConfig } from './config';

const base = { SESSION_HOST_KEY: 'k'.repeat(40), SESSION_HOST_MCP_KEY: 'm'.repeat(40), HOME: '/home/cockpit' };

it('binds MCP separately only when asked', () => {
  expect(loadSessionHostConfig({ ...base, SESSION_HOST_BIND: '10.0.0.18' })).toMatchObject({ bind: '10.0.0.18', mcpBind: '10.0.0.18' });
  expect(loadSessionHostConfig({ ...base, SESSION_HOST_MCP_BIND: '10.0.0.18' })).toMatchObject({ bind: '127.0.0.1', mcpBind: '10.0.0.18' });
});
