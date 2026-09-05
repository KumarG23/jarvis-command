import { loadCommandProxyConfig } from './config';
import { startCommandProxy } from './start';

// Register before asynchronous listen; a signal during startup waits for the same
// startup promise rather than racing a second close against a partial server.
const starting = Promise.resolve().then(() => startCommandProxy(loadCommandProxyConfig(process.env)));
let closing = false;
const removeSignals = () => {
  process.off('SIGTERM', shutdown);
  process.off('SIGINT', shutdown);
};
const shutdown = () => {
  if (closing) return;
  closing = true;
  void starting.then(async (app) => {
    await app.close();
  }, () => {
    // Startup failure is reported by the startup handler below.
  }).catch(() => {
    console.error('Jarvis Command command proxy failed to shut down cleanly');
    process.exitCode = 1;
  }).finally(removeSignals);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void starting.catch(() => {
  removeSignals();
  console.error('Jarvis Command command proxy failed to start');
  process.exitCode = 1;
});
