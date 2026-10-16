// Server events (plan, 6e): declared in a design's events.json, sent from the
// design bar down a live channel on the design's origin, changing the working
// copy of the state; checked like answers; in stories and build briefs.

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { buildPrompt } from '../server/agent.js';
import { backlogOf, storyMarkdown } from '../server/backlog.js';
import { createDesign } from '../server/designs.js';
import { parseEvents } from '../server/events.js';
import { folderId } from '../server/folders.js';
import { createServer } from '../server/main.js';
import { createFakeRunner } from './fake-runner.js';

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const fid = folderId(repo);
const runner = createFakeRunner();
const designDir = join(repo, 'prelude', 'home');
let server;
let base;
let port;

const write = (path, text) => {
  const file = join(repo, 'prelude', ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};

before(async () => {
  createDesign(repo, { title: 'Home' });
  write('home/routes.json', { '/': { view: 'home', title: 'Home', data: '' } });
  write('home/views/home.eta', '<section id="needs" ko-source="/" ko-invoke="event:needs-changed"><% for (const n of it.needs) { %><p><%= n.summary %></p><% } %></section>');
  write('home/views/_notice.eta', '<p class="notice"><%= it.summary %></p>');
  write('home/views/_broken.eta', '<%~ include("./_nope", it) %>');
  write('home/states/01-typical.json', { needs: [{ id: 1, summary: 'Apiary needs review' }] });
  write('home/events.json', {
    'needs-changed': { title: 'A pull request needs review', add: 'needs', with: { summary: 'Landing Page is ready to merge' }, send: 'needs-changed', push: [{ into: 'notice?', view: '_notice', data: 'needs/:new' }] },
    'projects-changed': { title: 'A branch was merged elsewhere', send: 'projects-changed' },
  });
  createDesign(repo, { title: 'Quiet' });
  write('quiet/routes.json', { '/': { view: 'home', title: 'Home', data: '' } });
  write('quiet/views/home.eta', '<p>No events here</p>');

  server = createServer({ home, runner });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  const body = new FormData();
  body.append('path', repo);
  await fetch(`${base}/folders`, { method: 'POST', body, redirect: 'manual' });
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const hostGet = (design, path) => new Promise((resolve, reject) => {
  const req = request(`${base}${path}`, { headers: { host: `${design}.${fid}.preview.localhost:${port}` } }, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

/** Open the design's live channel; collects what arrives until closed. */
const listen = design => new Promise((resolve, reject) => {
  const heard = [];
  const req = request(`${base}/_prelude/live`, { headers: { host: `${design}.${fid}.preview.localhost:${port}` } }, res => {
    res.setEncoding('utf8');
    res.on('data', chunk => heard.push(chunk));
    resolve({ status: res.statusCode, type: res.headers['content-type'], text: () => heard.join(''), close: () => req.destroy() });
  });
  req.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
  req.end();
});

const until = async check => { for (let i = 0; i < 400 && !(await check()); i++) await new Promise(r => setTimeout(r, 25)); };

test('events.json: each event has a title, an optional change, and something to send', () => {
  const events = parseEvents({
    ok: { title: 'Ok', update: 'settings', with: { theme: 'dark' }, send: 'saved:1' },
    'no-send': { title: 'Nothing to say' },
    'bad name!': { send: 'x' },
    push: { push: [{ into: 'notice?', view: '_notice' }, { nope: true }] },
  });
  assert.deepEqual(events.map(event => event.name), ['ok', 'push']);
  assert.deepEqual(events[0], { name: 'ok', title: 'Ok', verb: 'update', at: 'settings', with: { theme: 'dark' }, send: 'saved:1', push: [] });
  assert.equal(events[1].title, 'push', 'the name, without a title');
  assert.deepEqual(events[1].push, [{ into: 'notice?', view: '_notice', data: '' }]);
});

test('a design with events opens its channel in the layout; one without opens nothing', async () => {
  assert.match((await hostGet('home', '/')).body, /<div hidden ko-connect="\/_prelude\/live"><\/div>/);
  assert.doesNotMatch((await hostGet('quiet', '/')).body, /ko-connect/, 'no approved screen moves');
});

test('Send event: the change goes to the working copy, and the messages to every window', async () => {
  const one = await listen('home');
  const two = await listen('home');
  assert.equal(one.type, 'text/event-stream');

  const surface = await (await fetch(`${base}/f/${fid}/d/home/preview`, { headers: { 'x-koda-fragment': '1' } })).text();
  assert.match(surface, /<summary class="btn small ghost">Send event<\/summary>[\s\S]*ko-target="event-status"[\s\S]*value="needs-changed"[\s\S]*A pull request needs review/);
  assert.match(surface, /<span id="event-status" ko-region role="status"><\/span>/);

  const sent = await fetch(`${base}/f/${fid}/d/home/events`, { method: 'POST', headers: { 'x-koda-fragment': '1' }, body: new URLSearchParams({ event: 'needs-changed' }) });
  assert.match(await sent.text(), /<span class="muted">Sent: A pull request needs review\.<\/span>/, 'a line for the status, never the frame');
  for (const window of [one, two]) {
    await until(() => window.text().includes('ko-into'));
    assert.match(window.text(), /data: needs-changed\n\n/);
    assert.match(window.text(), /data: <div ko-into="notice\?"><p class="notice">Landing Page is ready to merge<\/p>\n?<\/div>/);
  }
  assert.match((await hostGet('home', '/')).body, /<p>Apiary needs review<\/p><p>Landing Page is ready to merge<\/p>/, 'the page reloads into the changed data');
  one.close();
  two.close();
});

test('the check renders each event’s markup in every state', async () => {
  const { checkDesign } = await import('../server/host.js');
  const { createRenderers } = await import('../server/renderers.js');
  const { fileURLToPath } = await import('node:url');
  const renderers = createRenderers({ appRoot: fileURLToPath(new URL('..', import.meta.url)) });
  write('home/events.json', { broken: { title: 'Broken', push: [{ into: 'notice?', view: '_broken' }] }, gone: { title: 'Gone', update: 'nowhere', with: { a: 1 }, send: 'gone' } });
  try {
    const failures = await checkDesign({ renderers }, { folder: { path: repo }, design: { id: 'home' }, designDir });
    assert.deepEqual(failures.map(failure => failure.path), ['event broken (_broken)'], 'a data path with nothing there is skipped, not failed');
  } finally {
    renderers.closeAll();
    write('home/events.json', { 'needs-changed': { title: 'A pull request needs review', add: 'needs', with: { summary: 'Landing Page is ready to merge' }, send: 'needs-changed', push: [{ into: 'notice?', view: '_notice', data: 'needs/:new' }] }, 'projects-changed': { title: 'A branch was merged elsewhere', send: 'projects-changed' } });
  }
});

test('stories and build briefs say what the server sends, and when', () => {
  const { groups, events } = backlogOf(designDir);
  assert.deepEqual(groups[0].events.map(event => event.name), ['needs-changed'], 'it pushes into, and is listened for on, the Home page');
  assert.deepEqual(events.map(event => event.name), ['projects-changed'], 'no page listens for it: design-wide');
  const story = storyMarkdown({ design: { title: 'Home' }, designPath: 'prelude/home', group: groups[0], designEvents: events });
  assert.match(story, /## Server events\n\nSent by the server on its own/);
  assert.match(story, /- When a pull request needs review \(`needs-changed`\), the server adds a record to `needs`, sends the `needs-changed` event and pushes `prelude\/home\/views\/_notice` into `notice`, down the page's channel\./);
  assert.match(story, /- When a branch was merged elsewhere \(`projects-changed`\), the server sends the `projects-changed` event/);
  const prompt = buildPrompt({ title: 'Home', designPath: 'prelude/home', group: groups[0], designEvents: events, branch: 'prelude/home' });
  assert.match(prompt, /and has the server send these events on its own \(prelude\/home\/events\.json\):\n  - When a pull request needs review/);
  assert.match(prompt, /Send each server event from where it happens in the app/);
});
