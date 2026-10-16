import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer as createNet } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { designPrompt } from '../server/agent.js';
import { createDesign } from '../server/designs.js';
import { folderId } from '../server/folders.js';
import { forHost, readHostConfig } from '../server/hosts.js';
import { createServer } from '../server/main.js';
import { createFakeRunner } from './fake-runner.js';

const reference = fileURLToPath(new URL('../tools/reference-host.js', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const fid = folderId(repo);
const runner = createFakeRunner();
let server;
let base;
let port;
let hostPort;

const write = (path, text) => {
  const file = join(repo, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};

const freePort = () => new Promise(resolve => {
  const probe = createNet().listen(0, '127.0.0.1', () => { const { port: p } = probe.address(); probe.close(() => resolve(p)); });
});

before(async () => {
  hostPort = await freePort();
  write('prelude/prelude.json', { host: { start: `node "${reference}" ${hostPort}`, url: `http://localhost:${hostPort}`, views: '.eta', guide: 'prelude/HOST.md' } });
  write('prelude/HOST.md', '# How views are written here');
  write('public/site.css', 'body { color: teal; }');
  createDesign(repo, { title: 'Loans' });
  write('prelude/loans/routes.json', {
    '/loans': { view: 'loans/list', title: 'Loans', data: '' },
    'POST /loans/:id': { update: 'loans/:id', require: ['name'], form: 'loans/_edit', answer: { redirect: '/loans' } },
  });
  write('prelude/loans/views/loans/list.eta', '<h1>Loans</h1><% for (const l of it.loans) { %><p><%= l.name %></p><% } %>');
  write('prelude/loans/views/loans/_edit.eta', '<form><input name="name" value="<%= it.name %>"></form>');
  write('prelude/loans/states/01-typical.json', { loans: [{ id: 1, name: 'Harbor Street Bakery' }] });

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

function hostGet(path) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { host: `loans.${fid}.preview.localhost:${port}` }, timeout: 60000 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const get = path => fetch(base + path, { headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });

test('prelude.json names a host on this machine, with its view extension and guide', () => {
  const config = readHostConfig(repo);
  assert.equal(config.url, `http://localhost:${hostPort}`);
  assert.equal(config.views, '.eta');
  assert.equal(config.guide, 'prelude/HOST.md');
  assert.match(config.fingerprint, /^[0-9a-f]{16}$/);

  const elsewhere = mkdtempSync(join(tmpdir(), 'prelude-elsewhere-'));
  mkdirSync(join(elsewhere, 'prelude'));
  writeFileSync(join(elsewhere, 'prelude', 'prelude.json'), JSON.stringify({ host: { start: 'x', url: 'http://example.com' } }));
  assert.equal(readHostConfig(elsewhere), null, 'never a host on another machine');
});

test('a render job is made relative to the repository for the host', () => {
  const job = forHost(repo, {
    page: { views: join(repo, 'prelude', 'loans', 'views'), template: './loans/list', data: { a: 1 } },
    layout: { views: 'x', template: 'y', builtIn: true, data: { title: 'T' } },
    regions: { drawer: { views: join(repo, 'prelude', 'loans', 'views'), template: './loans/_edit', data: {}, location: '/loans/1/edit' } },
    query: { q: 'h' },
  });
  assert.deepEqual(job.page, { views: 'prelude/loans/views', template: 'loans/list', data: { a: 1 } });
  assert.deepEqual(job.layout, { default: true, data: { title: 'T' } });
  assert.equal(job.regions.drawer.location, '/loans/1/edit');
  assert.deepEqual(job.query, { q: 'h' });
});

test('until it is approved, the host doesn’t start, and the design bar asks', async () => {
  const page = await hostGet('/loans');
  assert.equal(page.status, 500);
  assert.match(page.body, /hasn’t been approved/);
  const surface = await (await get(`/f/${fid}/d/loans/preview`)).text();
  assert.match(surface, /This repository has its own design host/);
  assert.match(surface, /Approve and start it/);
});

test('once approved, it starts, renders through the host, and serves the app’s assets', async () => {
  const approved = await fetch(`${base}/f/${fid}/host/approve`, { method: 'POST', body: new URLSearchParams({ back: `/f/${fid}/d/loans` }), redirect: 'manual' });
  assert.equal(approved.status, 303);
  assert.equal(approved.headers.get('location'), `/f/${fid}/d/loans`);

  const page = await hostGet('/loans');
  assert.equal(page.status, 200, page.body);
  assert.match(page.body, /<h1>Loans<\/h1><p>Harbor Street Bakery<\/p>/);
  assert.match(page.body, /<main id="main" ko-scope="\/"/, 'the host’s default layout, as there is no shell');

  const css = await hostGet('/site.css');
  assert.equal(css.status, 200);
  assert.match(css.body, /teal/);

  const surface = await (await get(`/f/${fid}/d/loans/preview`)).text();
  assert.doesNotMatch(surface, /Approve and start it/);
  assert.match(surface, /Design host log/);
});

test('the real app in the design surface (10.8): Design or App, the same screen, each window its own', async () => {
  // The app is built here (its host is the repository's own), so the switch shows.
  const design = await (await get(`/f/${fid}/d/loans/preview?view=inline`)).text();
  assert.match(design, /<a class="btn small ghost" href="\/f\/[0-9a-f]+\/d\/loans\/preview\?view=inline" ko-target="design" aria-current="true"[^>]*>Design<\/a>/);
  assert.match(design, new RegExp(`<iframe title="Loans" src="http://loans\\.${fid}\\.preview\\.localhost:${port}/loans`));

  const app = await (await get(`/f/${fid}/d/loans/preview?view=inline&mode=app`)).text();
  assert.match(app, /href="\/f\/[0-9a-f]+\/d\/loans\/preview\?view=inline&amp;mode=app" ko-target="design" aria-current="true"[^>]*>App<\/a>/);
  assert.match(app, new RegExp(`<iframe title="Loans \\(the app\\)" src="http://localhost:${hostPort}/loans"></iframe>`), 'the app itself, at the same path');
  assert.match(app, /The app, with its own data/);
  assert.doesNotMatch(app, /Approve these screens|Approve again/, 'the design’s states and approval step aside');
  assert.match(app, /ko-source="\/f\/[0-9a-f]+\/d\/loans\/preview\?view=inline&amp;mode=app"/, 'the mode is in the surface’s URL, so the window keeps it');
  assert.match(app, /<input type="hidden" name="mode" value="app">/, 'and its forms carry it');

  // Picking a screen in App mode stays in App mode.
  const picked = await fetch(`${base}/f/${fid}/d/loans/screen`, { method: 'POST', headers: { 'x-koda-fragment': '1' }, body: new URLSearchParams({ view: 'inline', mode: 'app', screen: '/loans' }) });
  assert.match(await picked.text(), /\(the app\)" src="http:\/\/localhost:\d+\/loans"/);
});

test('the agent is told to write views in the repo’s own language, after reading its guide', async () => {
  runner.turns.length = 0;
  await fetch(`${base}/f/${fid}/d/loans/sessions`, { method: 'POST', body: new URLSearchParams({ message: 'Hi' }), redirect: 'manual' });
  const prompt = runner.turns[0].systemPrompt;
  assert.match(prompt, /files ending \.eta, rendered by the repository's design host/);
  assert.match(prompt, /Read prelude\/HOST\.md before writing any view/);

  const plain = designPrompt({ title: 'X', designPath: 'prelude/x', format: 'views' });
  assert.doesNotMatch(plain, /design host/);
});

test('the host check runs a folder’s designs through its host', async () => {
  const { execFile } = await import('node:child_process');
  const tool = fileURLToPath(new URL('../tools/check.js', import.meta.url));
  // A host of its own for the check, on another port, so it doesn't meet the server's.
  const checkPort = await freePort();
  write('prelude/prelude.json', { host: { start: `node "${reference}" ${checkPort}`, url: `http://localhost:${checkPort}`, views: '.eta' } });
  try {
    const output = await new Promise(resolve => {
      execFile(process.execPath, [tool, repo], { timeout: 60000 }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout }));
    });
    assert.equal(output.code, 0, output.stdout);
    assert.match(output.stdout, /ok {3}the host starts and answers \/__prelude\/health/);
    assert.match(output.stdout, /ok {3}loans: every page renders in every state/);
  } finally {
    write('prelude/prelude.json', { host: { start: `node "${reference}" ${hostPort}`, url: `http://localhost:${hostPort}`, views: '.eta', guide: 'prelude/HOST.md' } });
  }
});

test('a host gets the port of its own url as PORT, never Prelude’s', async () => {
  const { createHosts } = await import('../server/hosts.js');
  const port = await freePort();
  const folder = { id: 'portcheck', path: repo };
  // No port on the command line: the host listens on PORT, as an app would.
  const config = { start: `node "${reference}"`, url: `http://localhost:${port}`, views: '.eta', fingerprint: 'p' };
  const hosts = createHosts({ home: mkdtempSync(join(tmpdir(), 'prelude-port-')) });
  const was = process.env.PORT;
  process.env.PORT = '1';   // Prelude's own PORT, which the host must not inherit
  try {
    hosts.approve(folder, config);
    const { html } = await hosts.render(folder, config, { page: { views: join(repo, 'prelude', 'loans', 'views'), template: './loans/list', data: { loans: [] } } });
    assert.equal(html, '<h1>Loans</h1>');
  } finally {
    if (was === undefined) delete process.env.PORT; else process.env.PORT = was;
    hosts.closeAll();
  }
});

test('the app on a branch (10.7): Open goes to the host’s url, and Start it starts the host, once approved', async () => {
  const { createHosts } = await import('../server/hosts.js');
  const open = await get(`/f/${fid}/host/open`);
  assert.equal(open.status, 303);
  assert.equal(open.headers.get('location'), `http://localhost:${hostPort}/`);

  // Starting needs approval, as rendering does.
  const port = await freePort();
  const folder = { id: 'startcheck', path: repo };
  const config = { start: `node "${reference}" ${port}`, url: `http://localhost:${port}`, views: '.eta', fingerprint: 's' };
  const hosts = createHosts({ home: mkdtempSync(join(tmpdir(), 'prelude-start-')) });
  try {
    await assert.rejects(hosts.start(folder, config), /hasn’t been approved/);
    assert.equal(hosts.status(folder, config).running, false);
    hosts.approve(folder, config);
    await hosts.start(folder, config);
    assert.equal(hosts.status(folder, config).running, true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/__prelude/health`)).status, 200);
  } finally {
    hosts.closeAll();
  }

  // The route comes back where it was pressed, and never leaves Prelude.
  const started = await fetch(`${base}/f/${fid}/host/start`, { method: 'POST', body: new URLSearchParams({ back: `/f/${fid}/d/loans` }), redirect: 'manual' });
  assert.equal(started.status, 303);
  assert.equal(started.headers.get('location'), `/f/${fid}/d/loans`);
  const elsewhere = await fetch(`${base}/f/${fid}/host/start`, { method: 'POST', body: new URLSearchParams({ back: 'https://example.com/' }), redirect: 'manual' });
  assert.equal(elsewhere.headers.get('location'), `/f/${fid}`);
});
