import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { folderId } from '../server/folders.js';
import { createServer } from '../server/main.js';

let server;
let base;
const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));

before(async () => {
  server = createServer({ home });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.closeAllConnections(); server.close(); });

const get = (path, fragment = false) =>
  fetch(base + path, { headers: fragment ? { 'x-koda-fragment': '1' } : {}, redirect: 'manual' });

const post = (path, fields) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(base + path, { method: 'POST', body, headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });
};

test('one URL, two shapes, with the Koda headers', async () => {
  const page = await get('/');
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /ko-location="\/"/);
  assert.equal(page.headers.get('vary'), 'x-koda-fragment');
  assert.equal(page.headers.get('x-koda'), '1');

  const fragment = await (await get('/', true)).text();
  assert.doesNotMatch(fragment, /<html/);
  assert.match(fragment, /Open a project/);
  assert.ok(html.includes(fragment.trim()), 'the page contains the fragment');
});

test('asked for from a page in another layout, a page comes whole, so the browser lays it out in its own', async () => {
  const from = referer => fetch(`${base}/`, { headers: { 'x-koda-fragment': '1', referer: `${base}${referer}` } }).then(res => res.text());
  assert.doesNotMatch(await from('/f/0123456789'), /<html/, 'from another app page: the fragment');
  assert.match(await from('/f/0123456789/d/loans/sessions/new'), /^<!doctype html>/, 'from a design page (the workspace layout): whole');
  assert.doesNotMatch(await from('/f/0123456789/d/loans/build'), /<html/, 'the Build page is in the app layout');
});

test('Koda and the design system are served', async () => {
  const koda = await get('/koda/koda.js');
  assert.equal(koda.status, 200);
  assert.match(koda.headers.get('content-type'), /javascript/);
  assert.equal((await get('/ds/v1/tokens.css')).status, 200);
  assert.equal((await get('/ds/v1/icons/folder.svg')).status, 200);
  assert.equal((await get('/static/prelude.css')).status, 200);
  assert.equal((await get('/static/../main.js')).status, 404);
});

test('opening a missing folder is refused in place', async () => {
  const res = await post('/folders', { path: join(repo, 'nope') });
  assert.equal(res.status, 422);
  assert.equal(res.headers.get('x-koda'), '1');
  assert.match(await res.text(), /ko-invalid-server="There is no folder at that path."/);
});

test('opening a folder remembers it and lists it', async () => {
  const res = await post('/folders', { path: `"${repo}"` });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/f/${folderId(repo)}`);

  const home = await (await get('/', true)).text();
  assert.ok(home.includes(`/f/${folderId(repo)}`));

  const folder = await (await get(`/f/${folderId(repo)}`)).text();
  assert.match(folder, /No designs yet/);
});

test('creating designs, with an area, shows them grouped', async () => {
  const id = folderId(repo);
  await post('/folders', { path: repo });

  assert.equal((await post(`/f/${id}/designs`, { title: 'Sign up', area: 'onboarding' })).status, 303);
  assert.equal((await post(`/f/${id}/designs`, { title: 'Billing', area: '' })).status, 303);
  assert.ok(existsSync(join(repo, 'prelude', 'onboarding', 'sign-up', 'design.json')));

  const html = await (await get(`/f/${id}`, true)).text();
  assert.match(html, /prelude\/billing/);
  assert.match(html, /<h3 class="area">onboarding<\/h3>/);
  assert.match(html, /prelude\/onboarding\/sign-up/);

  const refused = await post(`/f/${id}/designs`, { title: '', area: 'x' });
  assert.equal(refused.status, 422);
  const body = await refused.text();
  assert.match(body, /ko-invalid-server="Give the design a title."/);
  assert.match(body, /value="x"/, 'keeps what was typed');
});

test('an unknown folder or address is a 404 page', async () => {
  assert.equal((await get('/f/0000000000')).status, 404);
  assert.equal((await get('/nowhere')).status, 404);
});

test('a folder that has gone away can be forgotten', async () => {
  const gone = mkdtempSync(join(tmpdir(), 'prelude-gone-'));
  await post('/folders', { path: gone });
  const id = folderId(gone);
  const { rmSync } = await import('node:fs');
  rmSync(gone, { recursive: true });

  const res = await get(`/f/${id}`, true);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Remove from recent/);
  assert.equal((await post(`/f/${id}/forget`, {})).status, 303);
  assert.ok(!(await (await get('/', true)).text()).includes(id));
});

test('escapes what it shows', async () => {
  const id = folderId(repo);
  writeFileSync(join(repo, 'prelude', 'billing', 'design.json'), JSON.stringify({ title: '<script>x</script>' }));
  const html = await (await get(`/f/${id}`, true)).text();
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the desktop app’s hooks: a relay script, and native-only controls marked', async () => {
  const page = await (await get('/open')).text();
  assert.match(page, /<script type="module" src="\/static\/desktop\.js"><\/script>/);
  assert.match(page, /data-pick-folder data-desktop-only/);
  assert.equal((await get('/static/desktop.js')).status, 200);
});
