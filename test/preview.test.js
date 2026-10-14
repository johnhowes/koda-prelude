import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { after, before, test } from 'node:test';

import { createDesign } from '../server/designs.js';
import { folderId } from '../server/folders.js';
import { createServer } from '../server/main.js';
import { listScreens, screenName } from '../server/preview.js';
import { createFakeRunner } from './fake-runner.js';

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
let server;
let base;

const designUrl = `/f/${folderId(repo)}/d/checkout`;
const designDir = join(repo, 'prelude', 'checkout');

before(async () => {
  createDesign(repo, { title: 'Checkout' });
  server = createServer({ home, runner: createFakeRunner() });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const body = new FormData();
  body.append('path', repo);
  await fetch(`${base}/folders`, { method: 'POST', body, redirect: 'manual' });
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const get = (path, fragment = true) =>
  fetch(base + path, { headers: fragment ? { 'x-koda-fragment': '1' } : {}, redirect: 'manual' });

const screen = (file, html) => {
  mkdirSync(join(designDir, 'screens'), { recursive: true });
  writeFileSync(join(designDir, 'screens', file), html);
};

test('screens are listed in order, named by their <title> or their file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prelude-screens-'));
  mkdirSync(join(dir, 'screens'));
  writeFileSync(join(dir, 'screens', '10-done.html'), '<p>done</p>');
  writeFileSync(join(dir, 'screens', '02-pay.html'), '<title> Pay now </title>');
  writeFileSync(join(dir, 'screens', 'notes.txt'), 'x');
  assert.deepEqual(listScreens(dir).map(s => [s.id, s.title]), [['02-pay', 'Pay now'], ['10-done', 'Done']]);
  assert.equal(screenName('01-sign_up-form.html'), 'Sign up form');
});

test('with no screens, the design surface says so', async () => {
  const html = await (await get(`${designUrl}/preview`)).text();
  assert.match(html, /0 screens/);
  assert.match(html, /No screens yet/);
  assert.doesNotMatch(html, /<iframe/);
});

const post = (path, fields) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(base + path, { method: 'POST', body, headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });
};

test('the design surface shows the current screen in a frame, and answers with itself', async () => {
  screen('01-cart.html', '<!doctype html><title>Cart</title><link rel="stylesheet" href="../styles.css"><a href="02-pay.html">Pay</a>');
  screen('02-pay.html', '<!doctype html><title>Pay</title>');

  const first = await (await get(`${designUrl}/preview`)).text();
  assert.match(first, /2 screens/);
  assert.match(first, /<iframe title="Cart" src="[^"]+\/files\/screens\/01-cart\.html\?v=\d+"/, 'the first screen until one is picked');
  assert.match(first, /id="design"[^>]*ko-attach="replace"[^>]*ko-invoke="event:design-changed"/);
  assert.match(first, /target="_blank"/, 'Open in browser leaves Koda alone');

  // Picking a screen is the server's to remember, so every window shows it.
  const picked = await (await post(`${designUrl}/screen`, { screen: '02-pay', view: 'inline' })).text();
  assert.match(picked, /<iframe title="Pay"/);
  assert.match(await (await get(`${designUrl}/preview?view=window`)).text(), /<iframe title="Pay"/, 'another window shows it too');

  const unknown = await (await post(`${designUrl}/screen`, { screen: 'gone', view: 'inline' })).text();
  assert.match(unknown, /<iframe title="Pay"/, 'an unknown screen changes nothing');

  const page = await (await get(`${designUrl}/preview`, false)).text();
  assert.match(page, /^<!doctype html>/, 'a cold load is a whole page');
});

test('pop out: a window of its own, and the inline surface steps aside while it is open', async () => {
  const inline = await (await get(`${designUrl}/preview?view=inline`)).text();
  const popOut = inline.match(/<a [^>]*href="([^"]+\/window)" target="(prelude-[^"]+)"[^>]*>\s*<span class="icon icon-expand"/);
  assert.ok(popOut, 'a Pop out link with a named target, so the same window is reused');

  const window = await (await get(popOut[1], false)).text();
  assert.match(window, /^<!doctype html>/);
  assert.doesNotMatch(window, /class="bar"/, 'no Prelude header');
  assert.match(window, /class="window-page"/);
  assert.match(window, /ko-connect="[^"]+\/live\?view=window"/);
  assert.doesNotMatch(window, /icon-expand/, 'no Pop out inside the pop-out');

  // While the window's channel is open, the inline surface is a strip.
  const controller = new AbortController();
  const channel = await fetch(`${base}${designUrl}/live?view=window`, { signal: controller.signal });
  const reader = channel.body.getReader();
  await reader.read();
  const strip = await (await get(`${designUrl}/preview?view=inline`)).text();
  assert.match(strip, /class="design popped"/);
  assert.match(strip, /Showing in its own window/);
  assert.doesNotMatch(strip, /<iframe/);
  assert.doesNotMatch(await (await get(`${designUrl}/preview?view=window`)).text(), /popped/, 'the window itself is never a strip');

  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(await (await get(`${designUrl}/preview?view=inline`)).text(), /<iframe/, 'back when the window closes');
});

test('following a link inside a screen changes the screen on show, in every window', async () => {
  await post(`${designUrl}/screen`, { screen: '01-cart', view: 'inline' });
  const frameGet = (file, dest) => new Promise((resolve, reject) => {
    const req = request(`${base}${designUrl}/files/screens/${file}`, {
      headers: { host: `preview.localhost:${server.address().port}`, 'sec-fetch-dest': dest },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end();
  });

  await frameGet('02-pay.html', 'document');
  assert.match(await (await get(`${designUrl}/preview`)).text(), /<iframe title="Cart"/, 'a tab of its own changes nothing');

  await frameGet('02-pay.html', 'iframe');
  assert.match(await (await get(`${designUrl}/preview`)).text(), /<iframe title="Pay"/);
});

/** A GET as a browser on the preview origin makes it (fetch won't let a test set Host). */
function previewGet(path) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { host: `preview.localhost:${server.address().port}` } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the design’s files are served as written, on the preview origin only; sessions never', async () => {
  writeFileSync(join(designDir, 'styles.css'), 'body { color: red; }');
  const css = await previewGet(`${designUrl}/files/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);

  const html = await previewGet(`${designUrl}/files/screens/01-cart.html`);
  assert.equal(html.status, 200);
  assert.match(html.body, /href="\.\.\/styles\.css"/);

  mkdirSync(join(designDir, 'sessions', 'x'), { recursive: true });
  writeFileSync(join(designDir, 'sessions', 'x', 'transcript.jsonl'), '{}');
  assert.equal((await previewGet(`${designUrl}/files/sessions/x/transcript.jsonl`)).status, 404);
  assert.equal((await previewGet(`${designUrl}/files/.git/config`)).status, 404);
  assert.equal((await previewGet(`${designUrl}/files/screens/nope.html`)).status, 404);

  // The preview origin serves nothing of Prelude's, and Prelude serves no design files.
  assert.equal((await previewGet('/')).status, 404);
  assert.equal((await previewGet(`${designUrl}/preview`)).status, 404);
  assert.equal((await get(`${designUrl}/files/styles.css`, false)).status, 404);

  // The frame and Open in browser point at the preview origin.
  const surface = await (await get(`${designUrl}/preview`)).text();
  assert.ok(surface.includes(`src="http://preview.localhost:${server.address().port}${designUrl}/files/screens/`));
});

test('changes are refused from any origin but Prelude’s own', async () => {
  const port = server.address().port;
  const attempt = headers => fetch(`${base}${designUrl}/sessions`, { method: 'POST', body: new URLSearchParams({ message: 'hi' }), headers, redirect: 'manual' });
  assert.equal((await attempt({ origin: `http://preview.localhost:${port}` })).status, 403, 'a screen');
  assert.equal((await attempt({ origin: 'https://example.com' })).status, 403, 'another site');
  assert.equal((await attempt({ origin: 'null' })).status, 403, 'a sandboxed page');
  assert.equal((await attempt({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.notEqual((await attempt({ origin: base })).status, 403, 'Prelude itself');
});

test('the session page shows the chat beside the design, listening for changes', async () => {
  const html = await (await get(`${designUrl}/sessions/new`)).text();
  assert.match(html, /class="workspace"/);
  assert.match(html, /id="design"/);
  assert.match(html, new RegExp(`ko-connect="${designUrl}/live"`));
});

test('a change to the design’s files is announced; a change to its sessions is not', async () => {
  const before = await (await post(`${designUrl}/screen`, { screen: '01-cart', view: 'inline' })).text();
  const version = Number(before.match(/\?v=(\d+)"/)[1]);
  const controller = new AbortController();
  const res = await fetch(`${base}${designUrl}/live`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let pending = null;   // one read at a time: a second would steal the first one's chunk
  const read = async ms => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      pending ??= reader.read();
      const chunk = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), end - Date.now()))]);
      if (!chunk) break;
      pending = null;
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
  };

  await read(200);   // the stream is open and the watch is set
  writeFileSync(join(designDir, 'sessions', 'x', 'transcript.jsonl'), '{"more":1}');
  await read(500);
  assert.doesNotMatch(text, /design-changed/, 'transcript writes are ignored');

  screen('01-cart.html', '<!doctype html><title>Cart, again</title>');
  await read(1000);
  controller.abort();
  assert.ok(text.includes(`data: design-changed:${version + 1}`));

  const html = await (await get(`${designUrl}/preview`)).text();
  assert.ok(html.includes(`?v=${version + 1}"`), 'the frame’s address changes with the version');
  assert.match(html, /Cart, again/);
});
