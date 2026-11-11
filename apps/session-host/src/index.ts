import { buildSessionHostApp } from './app';
import { loadSessionHostConfig } from './config';
import { buildMcpApp } from './mcp';
import { SessionManager } from './sessions';

const start = async () => {
  const config = loadSessionHostConfig(process.env);
  const manager = new SessionManager(config);
  // Reconcile records left by a previous run before serving: survivors stay running,
  // vanished processes become `lost`. Nothing is relaunched.
  await manager.refresh();
  manager.start();
  const app = buildSessionHostApp(manager);
  await app.listen({ host: config.bind, port: config.port });
  const mcp = config.mcpPort === 0 ? null : buildMcpApp(manager);
  if (mcp) await mcp.listen({ host: config.mcpBind, port: config.mcpPort });
  console.log(`Jarvis Command session host on ${config.bind}:${config.port}${mcp ? `, MCP on ${config.mcpBind}:${config.mcpPort}` : ''} (${config.hostName})`);
  return { app, mcp, manager };
};

const starting = start();
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  // Closing the service detaches viewers only. Agent processes live in tmux and keep running.
  void starting.then(async ({ app, mcp, manager }) => {
    manager.stop();
    await Promise.all([app.close(), mcp?.close()]);
  }).catch(() => { process.exitCode = 1; });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
void starting.catch((error: unknown) => {
  console.error('Jarvis Command session host failed to start:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
