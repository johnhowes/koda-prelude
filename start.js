// npm start: Prelude's server on one port (PORT, default 4200).
//
// The desktop app starts it this way too when no server is running, and says
// so with PRELUDE_PARENT_PID: the server then stops when the app does, even if
// the app is killed rather than closed, so no server, renderer or design host
// is left behind.

import { createServer, defaultHome } from './server/main.js';

const port = Number(process.env.PORT ?? 4200);
const server = createServer();

server.listen(port, '127.0.0.1', () => {
  console.log(`Prelude on http://localhost:${port} (machine-local state in ${defaultHome()})`);
});

// Closing the server stops its renderers and design hosts (main.js).
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const parent = Number(process.env.PRELUDE_PARENT_PID);
if (parent) {
  setInterval(() => {
    try { process.kill(parent, 0); } catch { stop(); }
  }, 2000).unref();
}
