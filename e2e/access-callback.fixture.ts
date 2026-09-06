import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

// LOCAL routing fixture only. No Cloudflare auth, tokens, cookies or Hermes calls.
export async function accessFixture(initialRoot = resolve('apps/web/dist')) {
  let root = initialRoot;
  let blockWorker = false;
  let workerRoot: string | undefined;
  let bootstrapStatus = 401;
  const hits: string[] = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    hits.push(pathname); // Deliberately never record query/fragment values.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (pathname === '/sw.js' && blockWorker) {
      response.writeHead(403).end('LOCAL worker update blocked');
      return;
    }
    if (/^\/cdn-cgi(?:\/|$)/.test(pathname)) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<h1>LOCAL edge reached</h1>');
      return;
    }
    if (pathname === '/api/auth/recover') {
      response.writeHead(302, { Location: '/cdn-cgi/access/authorized?fixture=harmless-local' }).end();
      return;
    }
    if (/^\/api(?:\/|$)/.test(pathname) && pathname !== '/api/local-current-shell') {
      response.writeHead(pathname === '/api/bootstrap' ? bootstrapStatus : 404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'LOCAL fixture response' }));
      return;
    }
    try {
      // The network-only shell is test-only: exercise new UI with an OLD controller.
      const file = pathname === '/' || pathname === '/api/local-current-shell' ? '/index.html' : pathname;
      const content = await readFile(resolve(pathname === '/sw.js' && workerRoot ? workerRoot : root, `.${file}`))
        .catch((error: unknown) => {
          if (!workerRoot) throw error;
          return readFile(resolve(workerRoot, `.${file}`));
        });
      response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream');
      response.end(content);
    } catch {
      // Ordinary app routes must come from the SW, never this network server.
      response.writeHead(404).end('LOCAL network missing');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address missing');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    hits,
    setRoot(value: string) { root = value; },
    useWorkerFrom(value: string) { workerRoot = value; },
    blockWorker() { blockWorker = true; },
    bootstrapStatus(value: number) { bootstrapStatus = value; },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    },
  };
}
