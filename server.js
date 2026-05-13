import { createServer } from 'http';
import app from './app.js';
import {
  env,
  assertSupabaseConfig,
  warnIfTwelveKeyMalformed,
  warnIfFinnhubKeyMissing,
  warnIfSmtpMissing,
} from './config/env.js';
import { initWebsocket } from './websocket/index.js';

try {
  assertSupabaseConfig();
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn(e.message);
}

warnIfTwelveKeyMalformed();
warnIfFinnhubKeyMissing();
warnIfSmtpMissing();

const httpServer = createServer(app);
const { shutdown } = initWebsocket(httpServer);

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`HTTP+WS http://localhost:${env.port}  (api /api/v1)`);
});

function graceful() {
  shutdown?.();
  httpServer.close(() => process.exit(0));
}

process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);
