import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { createDesign } from '../server/designs.js';
import { folderId } from '../server/folders.js';
import { designHostOf, findLayout, listStates, lookup, matchRoute, readRoutes } from '../server/host.js';
import { createServer } from '../server/main.js';
import { createFakeRunner } from './fake-runner.js';

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const fid = folderId(repo);
const runner = createFakeRunner();
let server;
let base;
let port;

const write = (path, text) => {
  const file = join(repo, 'prelude', ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};

before(async () => {
  createDesign(repo, { title: 'Acme', kind: 'system' });
  write('acme/system/tokens.css', ':root { --accent: teal; }');
  createDesign(repo, { title: 'Shell', kind: 'shell' });
  write('shell/layouts/app.eta', '<html><title><%= it.title %></title><nav><%= it.layout.user %> · <%= it.layout.unread %></nav><main id="main" ko-scope="/" ko-location="<%= it.location %>" ko-history><%~ it.body %></main></html>');
  write('shell/layouts/app.json', { user: 'Dana Ruiz', unread: 3 });

  createDesign(repo, { title: 'Orders' });
  write('orders/routes.json', {
    '/orders': { view: 'orders/list', title: 'Orders', data: '' },
    '/orders/:id': { view: 'orders/detail', title: 'Order', data: 'orders/:id' },
    '/orders/:id/row': { view: 'orders/_row', data: 'orders/:id' },
    '/wizard': { view: 'wizard', title: 'Wizard', data: '', layout: 'bare' },
    '/real': { view: 'wizard', title: 'Real shell', data: '', layout: '@app/src/views/layout' },
    '/sneaky': { view: 'sneaky', title: 'Sneaky', data: '' },
    '/vandal': { view: 'vandal', title: 'Vandal', data: '' },
  });
  write('orders/views/orders/list.eta', '<ul id="orders"><% for (const o of it.orders) { %><%~ include("./_row", o) %><% } %></ul><% if (!it.orders.length) { %><p class="empty">No orders yet.</p><% } %>');
  write('orders/views/orders/_row.eta', '<li id="order-<%= it.id %>" ko-region><%= it.borrower %>: <%= it.amount %></li>');
  write('orders/views/orders/detail.eta', '<h1><%= it.borrower %></h1>');
  write('orders/views/wizard.eta', '<p>Step one</p>');
  write('orders/views/layouts/bare.eta', '<html><body class="bare"><%~ it.body %></body></html>');
  write('orders/views/sneaky.eta', "<%= process.getBuiltinModule('node:fs').readFileSync('" + join(home, 'folders.json').replace(/\\/g, '/') + "', 'utf8') %>");
  write('orders/views/vandal.eta', "<% process.getBuiltinModule('node:fs').writeFileSync('" + join(repo, 'vandal.txt').replace(/\\/g, '/') + "', 'x') %>written");
  write('orders/states/01-typical.json', { orders: [{ id: 1, borrower: 'Harbor Street Bakery', amount: 250000 }, { id: 2, borrower: 'Ruiz & Sons', amount: 80000 }] });
  write('orders/states/02-empty.json', { orders: [], layout: { unread: 0 } });
  mkdirSync(join(repo, 'src', 'views'), { recursive: true });
  writeFileSync(join(repo, 'src', 'views', 'layout.eta'), '<html><body class="real-app"><%~ it.body %></body></html>');

  createDesign(repo, { title: 'Loop' });
  write('loop/routes.json', { '/': { view: 'home', title: 'Home', data: '' } });
  write('loop/views/home.eta', '<% while (true) {} %>');

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

/** A GET on a design's own origin (fetch won't let a test set Host). */
function hostGet(designLabel, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { host: `${designLabel}.${fid}.preview.localhost:${port}`, ...headers } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const post = (path, fields) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(base + path, { method: 'POST', body, headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });
};
const get = path => fetch(base + path, { headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });

test('routes match in order; data paths walk lists by id; states order by file name', () => {
  const routes = [{ pattern: '/orders' }, { pattern: '/orders/:id' }, { pattern: '/orders/:id/row' }];
  assert.deepEqual(matchRoute(routes, '/orders/42/row'), { route: routes[2], params: { id: '42' } });
  assert.equal(matchRoute(routes, '/nowhere'), null);

  const data = { orders: [{ id: 7, lines: [{ id: 'a', qty: 2 }] }] };
  assert.equal(lookup(data, 'orders/:id/lines/:line', { id: '7', line: 'a' }).qty, 2);
  assert.equal(lookup(data, '', {}), data);
  assert.equal(lookup(data, 'orders/:id', { id: '8' }), undefined);

  assert.deepEqual(listStates(join(repo, 'prelude', 'orders')).map(s => [s.id, s.title]), [['typical', 'Typical'], ['empty', 'Empty']]);
  assert.deepEqual(readRoutes(join(repo, 'prelude', 'orders'))[3].layout, 'bare');
  assert.deepEqual(designHostOf({ headers: { host: `orders.${fid}.preview.localhost:4200` } }), { designLabel: 'orders', folderId: fid });
  assert.equal(designHostOf({ headers: { host: 'preview.localhost:4200' } }), null);
});

test('layouts come from the design, then the shell, then the repo, then nothing', () => {
  const folderPath = repo;
  const designDir = join(repo, 'prelude', 'orders');
  const shellDir = join(repo, 'prelude', 'shell');
  assert.ok(findLayout({ folderPath, designDir, shellDir, name: 'bare' }).views.endsWith(join('orders', 'views', 'layouts')));
  const app = findLayout({ folderPath, designDir, shellDir, name: 'app' });
  assert.ok(app.views.endsWith(join('shell', 'layouts')));
  assert.equal(app.sample.user, 'Dana Ruiz');
  assert.ok(findLayout({ folderPath, designDir, shellDir, name: '@app/src/views/layout' }).views.endsWith(join('src', 'views')));
  assert.equal(findLayout({ folderPath, designDir, shellDir, name: '@app/../outside' }), null, 'never outside the folder');
  assert.equal(findLayout({ folderPath, designDir, shellDir, name: 'nope' }), null);
});

test('one URL, two shapes: the page in its layout, or the fragment alone', async () => {
  const page = await hostGet('orders', '/orders');
  assert.equal(page.status, 200);
  assert.equal(page.headers['x-koda'], '1');
  assert.equal(page.headers.vary, 'x-koda-fragment');
  assert.match(page.body, /<title>Orders<\/title>/);
  assert.match(page.body, /<nav>Dana Ruiz · 3<\/nav>/, 'the shell, with its sample data');
  assert.match(page.body, /ko-location="\/orders"/);
  assert.match(page.body, /<li id="order-1" ko-region>Harbor Street Bakery: 250000<\/li>/, 'the partial, included');

  const fragment = await hostGet('orders', '/orders/2/row', { 'x-koda-fragment': '1' });
  assert.equal(fragment.body, '<li id="order-2" ko-region>Ruiz &amp; Sons: 80000</li>', 'the same partial answers alone');
  assert.equal((await hostGet('orders', '/orders/2')).body.includes('<h1>Ruiz &amp; Sons</h1>'), true);

  assert.equal((await hostGet('orders', '/orders/99')).status, 404, 'no such record in this state');
  assert.equal((await hostGet('orders', '/nowhere')).status, 404);
});

test('a route picks its layout: the design’s own, a real one in the repo', async () => {
  assert.match((await hostGet('orders', '/wizard')).body, /<body class="bare"><p>Step one<\/p>/);
  assert.match((await hostGet('orders', '/real')).body, /<body class="real-app"><p>Step one<\/p>/);
});

test('without a shell, the built-in layout loads the system and Koda', async () => {
  createDesign(repo, { title: 'Standalone' });
  write('standalone/routes.json', { '/': { view: 'home', title: 'Home', data: '' } });
  write('standalone/views/home.eta', '<p>Hello</p>');
  const shellJson = join(repo, 'prelude', 'shell', 'design.json');
  writeFileSync(shellJson, JSON.stringify({ title: 'Shell (parked)' }));   // not a shell for a moment
  try {
    const page = (await hostGet('standalone', '/')).body;
    assert.match(page, /href="\/_prelude\/system\/tokens\.css"/);
    assert.match(page, /"@kodalang\/core": "\/_prelude\/koda\/koda\.js"/);
    assert.match(page, /<main id="main" ko-scope="\/" ko-location="\/" ko-history>\s*<p>Hello<\/p>/);
  } finally {
    writeFileSync(shellJson, JSON.stringify({ title: 'Shell', kind: 'shell' }));
  }
});

test('a design-wide state: every route reads it, and it can override the shell’s data', async () => {
  const picked = await post(`/f/${fid}/d/orders/state`, { state: 'empty', view: 'inline' });
  assert.match(await picked.text(), /State: Empty/);
  const page = (await hostGet('orders', '/orders')).body;
  assert.match(page, /<p class="empty">No orders yet\.<\/p>/);
  assert.match(page, /<nav>Dana Ruiz · 0<\/nav>/, 'the state’s layout data wins over the sample');
  assert.equal((await hostGet('orders', '/orders/1')).status, 404, 'the detail agrees: there are no orders');
  await post(`/f/${fid}/d/orders/state`, { state: 'typical', view: 'inline' });
});

test('/_prelude/ serves Koda, the system, the shell and the design, never sessions', async () => {
  assert.equal((await hostGet('orders', '/_prelude/koda/koda.js')).status, 200);
  assert.match((await hostGet('orders', '/_prelude/system/tokens.css')).body, /teal/);
  assert.equal((await hostGet('orders', '/_prelude/shell/layouts/app.json')).status, 200);
  write('orders/styles.css', '.x {}');
  assert.equal((await hostGet('orders', '/_prelude/design/styles.css')).status, 200);
  write('orders/sessions/s/transcript.jsonl', '{}');
  assert.equal((await hostGet('orders', '/_prelude/design/sessions/s/transcript.jsonl')).status, 404);
  assert.equal((await hostGet('orders', '/_prelude/design/../../shell/design.json')).status, 404);
});

test('the preview offers the design’s pages and states, framed on its own origin', async () => {
  const surface = await (await get(`/f/${fid}/d/orders/preview`)).text();
  assert.match(surface, /5 pages/, 'titled routes without parameters');
  assert.ok(surface.includes(`src="http://orders.${fid}.preview.localhost:${port}/orders?v=`));
  assert.match(surface, /State: Typical/);
  assert.match(surface, /value="\/wizard"/);

  // Following a link inside the design moves every window to that page.
  await hostGet('orders', '/orders/2', { 'sec-fetch-dest': 'iframe' });
  const moved = await (await get(`/f/${fid}/d/orders/preview`)).text();
  assert.ok(moved.includes(`preview.localhost:${port}/orders/2?v=`));
  assert.match(moved, /<summary class="btn small ghost"><span class="icon icon-screen" aria-hidden="true"><\/span>Order<\/summary>/);
  // A region loading a fragment changes nothing.
  await hostGet('orders', '/orders/1/row', { 'sec-fetch-dest': 'empty', 'x-koda-fragment': '1' });
  assert.ok((await (await get(`/f/${fid}/d/orders/preview`)).text()).includes('/orders/2?v='));
});

test('views render sandboxed: no reading outside the folder, no writing at all', async () => {
  const sneaky = await hostGet('orders', '/sneaky');
  assert.equal(sneaky.status, 500);
  assert.match(sneaky.body, /restricted|ERR_ACCESS_DENIED|denied/i);
  assert.doesNotMatch(sneaky.body, /prelude-repo-/, 'Prelude’s own state stays unread');

  const vandal = await hostGet('orders', '/vandal');
  assert.equal(vandal.status, 500);
  const { existsSync } = await import('node:fs');
  assert.ok(!existsSync(join(repo, 'vandal.txt')));
});

test('a view that never finishes is stopped, and the next render still works', async () => {
  const looping = await hostGet('loop', '/');
  assert.equal(looping.status, 500);
  assert.match(looping.body, /longer than 5s/);
  assert.equal((await hostGet('orders', '/orders')).status, 200);
});

test('after a turn, every route is rendered; what fails is shown, and told to the agent next time', async () => {
  const { samplePaths } = await import('../server/host.js');
  const { withFindings } = await import('../server/turns.js');
  const routes = readRoutes(join(repo, 'prelude', 'orders'));
  const paths = samplePaths(routes, { orders: [{ id: 1 }] }).map(p => `${p.path}${p.fragment ? ' (fragment)' : ''}`);
  assert.ok(paths.includes('/orders/1'));
  assert.ok(paths.includes('/orders/1/row (fragment)'));
  assert.ok(!samplePaths(routes, { orders: [] }).some(p => p.path.startsWith('/orders/')), 'no records, no sample');
  assert.equal(withFindings([], 'Hi'), 'Hi');
  assert.match(withFindings([{ path: '/x', state: 'Empty', error: 'boom' }], 'Hi'), /^\(From Prelude.*\n- \/x \(state "Empty"\): boom\n\nHi$/s);

  // A design whose list includes a partial that isn't there.
  createDesign(repo, { title: 'Broken' });
  write('broken/routes.json', { '/': { view: 'home', title: 'Home', data: '' } });
  write('broken/views/home.eta', '<%~ include("./_missing", it) %>');
  write('broken/states/01-typical.json', {});

  const send = message => post(`/f/${fid}/d/broken/sessions`, { message });
  const first = await send('Make the home page');
  const sessionUrl = first.headers.get('location');
  const { readEntries } = await import('../server/sessions.js');
  const sessionDir = join(repo, 'prelude', 'broken');
  const id = sessionUrl.split('/').at(-1);
  const until = async check => { for (let i = 0; i < 200 && !(await check()); i++) await new Promise(r => setTimeout(r, 25)); };
  await until(() => readEntries(sessionDir, id).some(e => e.type === 'check'));
  const check = readEntries(sessionDir, id).find(e => e.type === 'check');
  assert.equal(check.failures[0].path, '/');
  assert.match(check.failures[0].error, /Could not find template/);
  assert.match(await (await get(sessionUrl)).text(), /1 page doesn’t render/);

  await until(() => readEntries(sessionDir, id).filter(e => e.type === 'turn').length === 1);
  await post(`${sessionUrl}/messages`, { message: 'Fix it' });
  await until(() => runner.turns.length >= 2);
  assert.match(runner.turns.at(-1).prompt, /^\(From Prelude[\s\S]*Could not find template[\s\S]*Fix it$/);
});
