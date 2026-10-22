import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { after, before, test } from 'node:test';

import { createDesign } from '../server/designs.js';
import { folderId } from '../server/folders.js';
import { createServer } from '../server/main.js';
import { createFakeRunner } from './fake-runner.js';

// The design system to read, in a page of the app (prelude/design-system-page),
// and New design's architecture kind.

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const fid = folderId(repo);
let server;
let base;

before(async () => {
  createDesign(repo, { title: 'Sign up' });
  server = createServer({ home, runner: createFakeRunner() });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await post('/folders', { path: repo });
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function post(path, fields) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(base + path, { method: 'POST', body, headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });
}
const get = (path, fragment = true) => fetch(base + path, { headers: fragment ? { 'x-koda-fragment': '1' } : {}, redirect: 'manual' });

/** A GET as a frame on the preview origin makes it (fetch won't let a test set Host). */
function frameGet(path) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { host: `preview.localhost:${server.address().port}`, 'sec-fetch-dest': 'iframe' } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('with no design system, the page says so and offers to make one', async () => {
  const res = await get(`/f/${fid}/system`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /has no design system yet/);
  assert.match(html, new RegExp(`href="/f/${fid}/designs/new\\?kind=system" ko-target="modal\\?"`));
  assert.doesNotMatch(html, /<iframe/);
});

test('the design system’s gallery is framed in the app, to read, a screen at a time', async () => {
  await post(`/f/${fid}/designs`, { title: 'Acme', area: '', kind: 'system' });
  const nothing = await (await get(`/f/${fid}/system`)).text();
  assert.match(nothing, /Nothing in the design system yet/);
  assert.match(nothing, new RegExp(`href="/f/${fid}/d/acme"`), 'its design, to make it');

  const screens = join(repo, 'prelude', 'acme', 'screens');
  mkdirSync(screens, { recursive: true });
  writeFileSync(join(screens, '01-tokens.html'), '<!doctype html><title>Tokens</title><a href="02-components.html">Components</a>');
  writeFileSync(join(screens, '02-components.html'), '<!doctype html><title>Components</title>');

  const port = server.address().port;
  const first = await (await get(`/f/${fid}/system`)).text();
  assert.match(first, /<h1>Acme<\/h1>/);
  assert.match(first, new RegExp(`<iframe title="Tokens" src="http://preview\\.localhost:${port}/f/${fid}/r/acme/screens/01-tokens\\.html"`));
  assert.match(first, new RegExp(`href="/f/${fid}/system\\?screen=01-tokens" aria-current="true">Tokens`));
  assert.match(first, /Change it with the agent/);

  const picked = await (await get(`/f/${fid}/system?screen=02-components`)).text();
  assert.match(picked, /<iframe title="Components" src="[^"]+\/r\/acme\/screens\/02-components\.html"/);

  // A cold load is the page in the app layout, on the design system.
  const page = await (await get(`/f/${fid}/system`, false)).text();
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /class="shell-bar"/);
  assert.match(page, /href="\/system\/components\.css"/);
});

test('reading the gallery (/r/) serves its files and moves no session’s screen', async () => {
  const read = await frameGet(`/f/${fid}/r/acme/screens/02-components.html`);
  assert.equal(read.status, 200);
  assert.match(read.body, /<title>Components<\/title>/);
  assert.match(await (await get(`/f/${fid}/d/acme/preview`)).text(), /<iframe title="Tokens"/, 'the session still shows its own');

  // Shown (/p/), as the session's frame loads it, it does move.
  await frameGet(`/f/${fid}/p/acme/screens/02-components.html`);
  assert.match(await (await get(`/f/${fid}/d/acme/preview`)).text(), /<iframe title="Components"/);
  assert.equal((await frameGet(`/f/${fid}/r/acme/sessions/x/transcript.jsonl`)).status, 404, 'never a session');
});

test('New design offers the architecture until the project has one', async () => {
  assert.match(await (await get(`/f/${fid}/designs/new`)).text(), /value="architecture"/);
  const made = await post(`/f/${fid}/designs`, { title: 'Architecture', area: '', kind: 'architecture' });
  assert.equal(made.status, 303);
  assert.equal(made.headers.get('location'), `/f/${fid}/d/architecture`);
  assert.doesNotMatch(await (await get(`/f/${fid}/designs/new`)).text(), /value="architecture"/);
});
