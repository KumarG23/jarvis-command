import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import web from '../apps/web/vite.config.ts';

// Candidate-only: teardown keepalive requests can outlive Playwright routing.
// Never inherit the ordinary preview's live BFF proxy as their fallback.
export default defineConfig({ ...web, root: resolve('apps/web'),
  preview: { host: '127.0.0.1', port: 3197, strictPort: true, proxy: {} },
  plugins: [...web.plugins, { name: 'issue-96-fixture-api-only', configurePreviewServer(server) {
    server.middlewares.use('/api', (_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'synthetic_fixture_api_not_intercepted' }));
    });
  } }],
});
