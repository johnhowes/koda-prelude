// How the desktop app starts and stops this machine's server: it asks
// /health to know a Prelude server is on the port, and starts start.js with
// PRELUDE_PARENT_PID so the server stops when the app does.

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { connect, createServer as createNet } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const start = fileURLToPath(new URL('../start.js', import.meta.url));
const freePort = () => new Promise(resolve => {
  const probe = createNet().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const until = async (check, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await new Promise(r => setTimeout(r, 100)); }
  return false;
};

/** The shell's own request: raw HTTP/1.1, read to the end. */
const ask = port => new Promise(resolve => {
  const socket = connect(port, '127.0.0.1', () => socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
  let answer = '';
  socket.on('data', chunk => { answer += chunk; });
  socket.on('end', () => resolve(answer));
  socket.on('error', () => resolve(''));
});

test('the server says it is Prelude, with a length the shell can read, and stops when its parent goes', async () => {
  const port = await freePort();
  // A stand-in for the desktop app: a process that will die.
  const parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  const server = spawn(process.execPath, [start], {
    env: { ...process.env, PORT: String(port), PRELUDE_HOME: mkdtempSync(join(tmpdir(), 'prelude-home-')), PRELUDE_PARENT_PID: String(parent.pid) },
    stdio: 'ignore',
  });
  try {
    assert.ok(await until(async () => (await ask(port)).startsWith('HTTP/1.1 200')), 'the server answers');
    const answer = await ask(port);
    assert.match(answer, /\r\ncontent-length: 7\r\n/i);
    assert.ok(answer.endsWith('\r\n\r\nprelude'), JSON.stringify(answer.slice(-40)));

    const exited = new Promise(resolve => server.on('exit', resolve));
    parent.kill();
    assert.ok(await Promise.race([exited.then(() => true), new Promise(r => setTimeout(() => r(false), 10000))]), 'the server stops when its parent does');
  } finally {
    parent.kill();
    server.kill();
  }
});
