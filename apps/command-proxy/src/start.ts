import { buildCommandProxy, type CommandProxyDependencies } from './app';
import type { CommandProxyConfig } from './config';

export async function startCommandProxy(
  config: CommandProxyConfig,
  overrides: Omit<CommandProxyDependencies, 'config'> = {},
) {
  const app = buildCommandProxy({ config, ...overrides });
  await app.listen({ host: config.host, port: config.port });
  return app;
}
