import { loadConfig } from './config';
import { startCommandServer } from './start';

const config = loadConfig(process.env);

startCommandServer(config).then((app) => {
  const shutdown = () => {
    void app.close().then(() => {
      process.off('SIGTERM', shutdown);
      process.off('SIGINT', shutdown);
    }).catch(() => {
      console.error('Jarvis Command failed to shut down cleanly');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}).catch(() => {
  console.error('Jarvis Command failed to start');
  process.exitCode = 1;
});
