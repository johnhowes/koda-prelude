import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer as createNet } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkRun, createRuns, projectRunOf } from '../server/runs.js';

const freePort = () => new Promise(resolve => {
  const probe = createNet().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

const project = run => {
  const path = mkdtempSync(join(tmpdir(), 'prelude-run-'));
  mkdirSync(join(path, 'prelude'), { recursive: true });
  writeFileSync(join(path, 'prelude', 'prelude.json'), JSON.stringify({ app: { stack: 'Node', path: 'app' }, ...(run ? { run } : {}) }));
  return { id: 'p1', path };
};

const until = async (ok, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (ok()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('timed out');
};

test('the project says how its app runs; a change here is kept on this computer only (R-p7c)', () => {
  const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
  const folder = project({ start: 'npm start --prefix app', url: 'http://localhost:3100' });
  const runs = createRuns({ home });
  assert.deepEqual(projectRunOf(folder.path), { command: 'npm start --prefix app', url: 'http://localhost:3100' });
  assert.deepEqual(runs.of(folder), { command: 'npm start --prefix app', url: 'http://localhost:3100', state: 'stopped', log: null });

  runs.save(folder, { command: 'node app/server.js', url: 'http://localhost:3200/' });
  assert.deepEqual(runs.of(folder), { command: 'node app/server.js', url: 'http://localhost:3200', state: 'stopped', log: null });
  assert.deepEqual(projectRunOf(folder.path), { command: 'npm start --prefix app', url: 'http://localhost:3100' });
});

test('an app connected before says nothing about running', () => {
  const runs = createRuns({ home: mkdtempSync(join(tmpdir(), 'prelude-home-')) });
  assert.deepEqual(runs.of(project(null)), { command: null, url: null, state: 'stopped', log: null });
});

test('the address is its own, on this computer: never the design host’s or Prelude’s (R-h2w)', () => {
  const checks = { host: 'http://localhost:5300', prelude: 'localhost:4000' };
  assert.deepEqual(checkRun({ command: 'npm start', url: 'http://localhost:3100' }, checks), {});
  assert.ok(checkRun({ command: '', url: 'http://localhost:3100' }, checks).command);
  assert.ok(checkRun({ command: 'npm start', url: '' }, checks).url);
  assert.ok(checkRun({ command: 'npm start', url: 'http://example.com:3100' }, checks).url);
  assert.match(checkRun({ command: 'npm start', url: 'http://localhost:5300' }, checks).url, /design host/);
  assert.match(checkRun({ command: 'npm start', url: 'http://127.0.0.1:4000' }, checks).url, /Prelude/);
});

test('run, it opens once it answers, without PRELUDE_HOST and on its own PORT; stopped, it’s gone (R-5tj)', async () => {
  const port = await freePort();
  // Quoted for cmd and sh alike: single quotes inside, and no > or $.
  const script = "require('http').createServer(function (q, s) { s.end(process.env.PRELUDE_HOST ? 'host' : 'app') }).listen(Number(process.env.PORT))";
  const folder = project({ start: `node -e "${script}"`, url: `http://localhost:${port}` });
  const opened = [];
  const runs = createRuns({ home: mkdtempSync(join(tmpdir(), 'prelude-home-')), open: url => opened.push(url) });
  const previous = process.env.PRELUDE_HOST;
  process.env.PRELUDE_HOST = '1';
  try {
    runs.start(folder);
    assert.equal(runs.of(folder).state, 'starting');
    await until(() => runs.of(folder).state === 'running');
    assert.deepEqual(opened, [`http://localhost:${port}`]);
    const said = await fetch(`http://localhost:${port}`).then(answer => answer.text());
    assert.equal(said, 'app');
  } finally {
    runs.closeAll();
    if (previous === undefined) delete process.env.PRELUDE_HOST; else process.env.PRELUDE_HOST = previous;
  }
  assert.equal(runs.of(folder).state, 'stopped');
});

test('one that stops before it answers failed, with the last of what it said', async () => {
  const port = await freePort();
  const folder = project({ start: 'node -e "console.error(\'no such module\'); process.exit(3)"', url: `http://localhost:${port}` });
  const runs = createRuns({ home: mkdtempSync(join(tmpdir(), 'prelude-home-')), open: () => {} });
  runs.start(folder);
  await until(() => runs.of(folder).state === 'failed');
  assert.match(runs.of(folder).log, /no such module/);
  runs.closeAll();
});
