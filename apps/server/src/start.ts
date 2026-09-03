import { createCommandServer, type CompositionOverrides } from './bootstrap';
import type { AppConfig } from './config';

export async function startCommandServer(
  config: AppConfig,
  overrides: CompositionOverrides = {},
) {
  const app = createCommandServer(config, overrides);
  await app.listen({ host: config.host, port: config.port });
  return app;
}
