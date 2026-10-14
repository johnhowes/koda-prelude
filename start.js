// npm start: Prelude's server on one port (PORT, default 4200).

import { createServer, defaultHome } from './server/main.js';

const port = Number(process.env.PORT ?? 4200);

createServer().listen(port, '127.0.0.1', () => {
  console.log(`Prelude on http://localhost:${port} (machine-local state in ${defaultHome()})`);
});
