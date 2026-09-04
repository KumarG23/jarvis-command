import { buildReadProxy } from './app';
import { loadReadProxyConfig } from './config';

const config = loadReadProxyConfig(process.env);
const app = buildReadProxy({ config });

app.listen({ host: config.host, port: config.port }).catch(() => {
  console.error('Jarvis Command read proxy failed to start');
  process.exitCode = 1;
});
