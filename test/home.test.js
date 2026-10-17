import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { folderId } from '../server/folders.js';
import { ago } from '../server/home.js';
import { createServer } from '../server/main.js';

let server;
let base;
const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const older = mkdtempSync(join(tmpdir(), 'prelude-older-'));
const newer = mkdtempSync(join(tmpdir(), 'prelude-newer-'));

before(async () => {
  server = createServer({ home });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.closeAllConnections(); server.close(); });

const get = (path, fragment = false) =>
  fetch(base + path, { headers: fragment ? { 'x-koda-fragment': '1' } : {}, redirect: 'manual' });

const post = (path, fields, fragment = true) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(base + path, { method: 'POST', body, headers: fragment ? { 'x-koda-fragment': '1' } : {}, redirect: 'manual' });
};

/** A design with one session whose turn ended at `at`, its last words `words`. */
function sessionWith(folder, { design = 'billing', title = 'Billing', id = '20261016-1200-abcd', words, at }) {
  const dir = join(folder, 'prelude', design);
  mkdirSync(join(dir, 'sessions', id), { recursive: true });
  writeFileSync(join(dir, 'design.json'), JSON.stringify({ title }));
  writeFileSync(join(dir, 'sessions', id, 'session.json'), JSON.stringify({ title: 'A session', started: true, startedAt: at, updatedAt: at }));
  const entries = [
    { at, type: 'user', text: 'Go on.' },
    { at, type: 'text', text: words },
    { at, type: 'turn', ok: true, stopped: false, error: null },
  ];
  writeFileSync(join(dir, 'sessions', id, 'transcript.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  return `/f/${folderId(folder)}/d/${design}/sessions/${id}`;
}

test('times are said as people say them', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const before = minutes => new Date(now - minutes * 60000).toISOString();
  assert.equal(ago(before(0.5), now), 'just now');
  assert.equal(ago(before(1), now), '1 minute ago');
  assert.equal(ago(before(4), now), '4 minutes ago');
  assert.equal(ago(before(180), now), '3 hours ago');
  assert.equal(ago(before(30 * 60), now), 'yesterday');
  assert.equal(ago(before(5 * 24 * 60), now), '5 days ago');
  assert.equal(ago(before(65 * 24 * 60), now), '2 months ago');
});

test('first run: the page is the way to open a project, and Open is a modal over it', async () => {
  const page = await (await get('/', true)).text();
  assert.match(page, /Open your first project/);
  assert.match(page, /href="\/open" ko-target="modal\?"/);

  const modal = await (await get('/open', true)).text();
  assert.match(modal, /<h2>Open a project<\/h2>/);
  assert.doesNotMatch(modal, /<html/);

  // A cold load is the home page with the modal already in its region.
  const cold = await (await get('/open')).text();
  assert.match(cold, /Open your first project/);
  assert.match(cold, /id="modal" ko-region ko-focus="region" tabindex="-1" ko-location="\/open">\s*<div class="stack gap-4">/);
  assert.match(cold, /ko-connect="\/live"/);
  assert.match(cold, /href="\/system\/components\.css"/);
});

test('opening nothing is refused in the modal, with what was typed', async () => {
  const empty = await post('/folders', { path: '' });
  assert.equal(empty.status, 422);
  assert.equal(empty.headers.get('x-koda'), '1');
  assert.match(await empty.text(), /ko-invalid-server="Enter the path of a folder."/);

  const nope = await post('/folders', { path: join(older, 'nope') });
  assert.equal(nope.status, 422);
  const html = await nope.text();
  assert.match(html, /<span class="error" id="open-path-error">There is no folder at that path.<\/span>/);
  assert.ok(html.includes(`value="${join(older, 'nope')}"`));
});

test('the page arrives with the projects’ names; the regions read the rest, most recently changed first', async () => {
  sessionWith(older, { words: 'Done.', at: new Date(Date.now() - 3 * 3600000).toISOString() });
  sessionWith(newer, { words: 'Done.', at: new Date(Date.now() - 60000).toISOString() });
  assert.equal((await post('/folders', { path: newer })).status, 303);
  assert.equal((await post('/folders', { path: older })).status, 303);

  // The older was opened last, but the newer changed last.
  const page = await (await get('/', true)).text();
  assert.match(page, /ko-source="\/home\/projects"/);
  assert.ok(page.indexOf(`/f/${folderId(newer)}`) < page.indexOf(`/f/${folderId(older)}`));

  const projects = await (await get('/home/projects', true)).text();
  assert.ok(projects.indexOf(`/f/${folderId(newer)}`) < projects.indexOf(`/f/${folderId(older)}`));
  assert.match(projects, /1 design · No app yet · changed 1 minute ago/);
  assert.match(projects, /changed 3 hours ago/);
});

test('a finished turn needs the person until they open its session', async () => {
  const url = sessionWith(newer, { design: 'invoices', title: 'Invoices', id: '20261016-1300-efgh', words: 'The invoice list now pages. Look at it.', at: new Date(Date.now() - 120000).toISOString() });
  let needs = await (await get('/home/needs-you', true)).text();
  assert.match(needs, /Invoices<span class="pill ">Turn finished<\/span>/);
  assert.match(needs, /The agent finished its turn: The invoice list now pages./);
  assert.ok(needs.includes(`href="${url}"`));

  assert.equal((await get(url)).status, 200);
  needs = await (await get('/home/needs-you', true)).text();
  assert.doesNotMatch(needs, /Invoices/);
});

test('a finished turn over a week old has left', async () => {
  sessionWith(older, { design: 'reports', title: 'Reports', id: '20261001-1300-ijkl', words: 'Done.', at: new Date(Date.now() - 8 * 24 * 3600000).toISOString() });
  const needs = await (await get('/home/needs-you', true)).text();
  assert.doesNotMatch(needs, /Reports/);
});

test('a question stays until it’s answered, newest first, and the bar counts it', async () => {
  sessionWith(older, { design: 'loans', title: 'Loans', id: '20261016-1400-mnop', words: 'I made the list. Should an expired offer stay visible?', at: new Date().toISOString() });
  const url = `/f/${folderId(older)}/d/loans/sessions/20261016-1400-mnop`;
  assert.equal((await get(url)).status, 200);   // opened, but not answered

  const needs = await (await get('/home/needs-you', true)).text();
  assert.match(needs, /Loans<span class="pill accent">Asking you<\/span>/);
  assert.match(needs, /The agent asks: Should an expired offer stay visible\?/);
  assert.ok(needs.indexOf('Loans') < needs.indexOf('Billing'), 'newest first');

  const projects = await (await get('/home/projects', true)).text();
  assert.match(projects, /<span class="pill accent">1 waiting on you<\/span>/);

  const page = await (await get('/')).text();
  assert.match(page, /<div id="waiting" class="shell-waiting" ko-region ko-focus="none">\s*<a class="btn small ghost" href="\/">Needs you<span class="pill accent">\d+<\/span><\/a>/);
});

test('a project whose folder has gone says so, and removing it leaves the disk alone', async () => {
  const gone = mkdtempSync(join(tmpdir(), 'prelude-gone-'));
  await post('/folders', { path: gone });
  const id = folderId(gone);
  rmSync(gone, { recursive: true });

  const projects = await (await get('/home/projects', true)).text();
  assert.match(projects, /This folder isn’t there any more/);
  assert.ok(projects.includes(`action="/folders/${id}/remove"`));

  const removed = await post(`/folders/${id}/remove`, {});
  assert.equal(removed.status, 200);
  const after = await removed.text();
  assert.match(after, /^\s*<div class="grid"/);
  assert.ok(!after.includes(id));
  assert.ok(existsSync(newer), 'the others are untouched');

  // Removing one that's still there takes it off the list, and only that.
  await post(`/folders/${folderId(older)}/remove`, {});
  assert.ok(existsSync(join(older, 'prelude', 'billing', 'design.json')));
  assert.ok(!JSON.parse(readFileSync(join(home, 'folders.json'), 'utf8')).some(folder => folder.id === folderId(older)));
});

test('the app’s live channel is an event stream', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/live`, { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  controller.abort();
});
