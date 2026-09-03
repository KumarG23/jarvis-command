import { loadConfig } from './config';
import { startCommandServer } from './start';

const config = loadConfig(process.env);

startCommandServer(config).catch(() => {
  console.error('Jarvis Command failed to start');
  process.exitCode = 1;
});
