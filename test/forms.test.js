import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { createDesign } from '../server/designs.js';
import { folderId } from '../server/folders.js';
import { applyChange, checkDesign, readPostRoutes } from '../server/host.js';
import { createServer } from '../server/main.js';
import { createRenderers } from '../server/renderers.js';
import { createFakeRunner } from './fake-runner.js';

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const fid = folderId(repo);
let server;
let base;
let port;

const write = (path, text) => {
  const file = join(repo, 'prelude', ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};

before(async () => {
  createDesign(repo, { title: 'Orders' });
  write('orders/routes.json', {
    '/orders': { view: 'orders/list', title: 'Orders', data: '' },
    '/orders/:id': { view: 'orders/detail', title: 'Order', data: 'orders/:id' },
    '/orders/:id/edit': { view: 'orders/_edit', title: 'Edit order', data: 'orders/:id', over: '/orders/:id', in: 'drawer' },
    'POST /orders/:id': {
      update: 'orders/:id', require: ['borrower'], form: 'orders/_edit',
      answer: { view: 'orders/_row', data: 'orders/:id', event: 'order-saved', also: [{ into: 'drawer?' }, { into: 'total', view: 'orders/_total', data: '' }] },
    },
    'POST /orders': { add: 'orders', require: ['borrower'], form: 'orders/_new', answer: { redirect: '/orders/:new' } },
    'POST /orders/:id/delete': { remove: 'orders/:id', answer: { redirect: '/orders' } },
    'POST /orders/:id/flag': { update: 'orders/:id', answer: {} },
  });
  write('orders/views/orders/list.eta', '<table><% for (const o of it.orders) { %><%~ include("./_row", o) %><% } %></table>');
  write('orders/views/orders/_row.eta', '<tr id="order-<%= it.id %>"><td><%= it.borrower %></td><td><%= it.amount %></td><td><%= it.urgent %></td></tr>');
  write('orders/views/orders/_total.eta', '<b><%= it.orders.reduce((sum, o) => sum + o.amount, 0) %></b>');
  write('orders/views/orders/detail.eta', '<h1><%= it.borrower %></h1>');
  write('orders/views/orders/_edit.eta', '<form><input name="borrower" value="<%= it.borrower ?? "" %>"<% if (it.$errors?.borrower) { %> ko-invalid-server="<%= it.$errors.borrower %>"<% } %>><input name="amount" value="<%= it.amount ?? "" %>"></form>');
  write('orders/views/orders/_new.eta', '<form class="new"><% if (it.$errors?.borrower) { %><p class="err"><%= it.$errors.borrower %></p><% } %></form>');
  write('orders/states/01-typical.json', { orders: [{ id: 1, borrower: 'Harbor Street Bakery', amount: 250000, urgent: false }, { id: 2, borrower: 'Ruiz & Sons', amount: 80000, urgent: true }] });
  write('orders/states/02-empty.json', { orders: [] });

  server = createServer({ home, runner: createFakeRunner() });
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

/** A request on the design's own origin (fetch won't let a test set Host). */
function host(method, path, fields = null) {
  const body = fields ? new URLSearchParams(fields).toString() : null;
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, {
      method,
      headers: {
        host: `orders.${fid}.preview.localhost:${port}`,
        'x-koda-fragment': '1',
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}),
      },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const prelude = (path, fields) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(base + path, { method: 'POST', body, headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });
};

test('POST routes are read from routes.json beside the GET routes', () => {
  const posts = readPostRoutes(join(repo, 'prelude', 'orders'));
  assert.deepEqual(posts.map(p => [p.pattern, p.verb]), [['/orders/:id', 'update'], ['/orders', 'add'], ['/orders/:id/delete', 'remove'], ['/orders/:id/flag', 'update']]);
  assert.deepEqual(posts[0].require, ['borrower']);
  assert.equal(posts[0].answer.also.length, 2);
});

test('the verbs: update keeps each field’s type, add gives an id, remove takes it out', () => {
  const data = { orders: [{ id: 1, amount: 5, urgent: false, address: { city: 'Bath' } }] };
  applyChange(data, { verb: 'update', at: 'orders/:id' }, { id: '1' }, { amount: '7', urgent: 'on', 'address.city': 'Portland', __proto__: 'x' });
  assert.deepEqual(data.orders[0], { id: 1, amount: 7, urgent: true, address: { city: 'Portland' } });
  const added = applyChange(data, { verb: 'add', at: 'orders' }, {}, { borrower: 'New' });
  assert.equal(added.params.new, '2');
  applyChange(data, { verb: 'remove', at: 'orders/:id' }, { id: '1' }, {});
  assert.deepEqual(data.orders.map(o => o.id), [2]);
  assert.equal(applyChange(data, { verb: 'update', at: 'orders/:id' }, { id: '9' }, {}).missing, 'orders/:id');
});

test('a save answers in place: the row, the drawer closed, the total refreshed, an event', async () => {
  const saved = await host('POST', '/orders/1', { borrower: 'Harbor Street Bakery & Café', amount: '300000' });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers['x-koda'], '1');
  assert.match(saved.body, /^<tr ko-event="order-saved" id="order-1"><td>Harbor Street Bakery &amp; Café<\/td><td>300000<\/td>/);
  assert.match(saved.body, /<div ko-into="drawer\?"><\/div>/, 'the empty envelope closes the drawer');
  assert.match(saved.body, /<div ko-into="total"><b>380000<\/b><\/div>/, 'out of band, from the changed data');

  // Every route reads the working copy now.
  assert.match((await host('GET', '/orders/1')).body, /<h1>Harbor Street Bakery &amp; Café<\/h1>/);
});

test('a refusal changes nothing and re-renders the form with what was typed and the errors', async () => {
  const refused = await host('POST', '/orders/2', { borrower: '  ', amount: '99' });
  assert.equal(refused.status, 422);
  assert.match(refused.body, /<input name="borrower" value="  " ko-invalid-server="This is required.">/);
  assert.match(refused.body, /<input name="amount" value="99">/, 'what was typed, kept');
  assert.match((await host('GET', '/orders/2')).body, /<h1>Ruiz &amp; Sons<\/h1>/, 'nothing changed');
});

test('add redirects to the new record; remove redirects to the list', async () => {
  const added = await host('POST', '/orders', { borrower: 'Pine Ridge Veterinary', amount: '1000' });
  assert.equal(added.status, 303);
  assert.equal(added.headers.location, '/orders/3');
  assert.match((await host('GET', '/orders/3')).body, /<h1>Pine Ridge Veterinary<\/h1>/);

  assert.equal((await host('POST', '/orders', { borrower: '' })).status, 422);
  assert.match((await host('POST', '/orders', {})).body, /<p class="err">This is required.<\/p>/);

  const removed = await host('POST', '/orders/3/delete');
  assert.equal(removed.status, 303);
  assert.equal(removed.headers.location, '/orders');
  assert.equal((await host('GET', '/orders/3')).status, 404);
});

test('an answer with nothing to show leaves the asking region alone', async () => {
  const flagged = await host('POST', '/orders/1/flag', { urgent: 'true' });
  assert.equal(flagged.body, '<div ko-into="prelude-nothing?"></div>');
  assert.match((await host('GET', '/orders')).body, /<tr id="order-1"><td>[^<]+<\/td><td>300000<\/td><td>true<\/td>/, 'the change is kept');
});

test('Reset data, or picking a state, starts again from the file', async () => {
  const surface = await (await fetch(`${base}/f/${fid}/d/orders/preview`, { headers: { 'x-koda-fragment': '1' } })).text();
  assert.match(surface, /Reset data/, 'offered once forms have changed something');

  const reset = await (await prelude(`/f/${fid}/d/orders/reset`, { view: 'inline' })).text();
  assert.doesNotMatch(reset, /Reset data/);
  assert.match((await host('GET', '/orders/1')).body, /<h1>Harbor Street Bakery<\/h1>/);

  await host('POST', '/orders/1', { borrower: 'Changed' });
  await prelude(`/f/${fid}/d/orders/state`, { state: 'empty', view: 'inline' });
  await prelude(`/f/${fid}/d/orders/state`, { state: 'typical', view: 'inline' });
  assert.match((await host('GET', '/orders/1')).body, /<h1>Harbor Street Bakery<\/h1>/, 'a state change dropped the copy');
});

test('the after-turn check posts each POST route: valid answers, empty refusals', async () => {
  const renderers = createRenderers({ appRoot: fileURLToPath(new URL('..', import.meta.url)) });
  const designDir = join(repo, 'prelude', 'orders');
  try {
    assert.deepEqual(await checkDesign({ renderers }, { folder: { path: repo }, design: { id: 'orders' }, designDir }), []);
    write('orders/views/orders/_total.eta', '<%~ include("./_gone", it) %>');
    const failures = await checkDesign({ renderers }, { folder: { path: repo }, design: { id: 'orders' }, designDir });
    assert.ok(failures.some(f => f.path === 'POST /orders/1' && /Could not find template/.test(f.error)));
  } finally {
    renderers.closeAll();
    write('orders/views/orders/_total.eta', '<b><%= it.orders.reduce((sum, o) => sum + o.amount, 0) %></b>');
  }
});

test('the check’s filled-in post fills required fields a state leaves empty', async () => {
  // A first-run state: the record is there, its required field empty.
  const renderers = createRenderers({ appRoot: fileURLToPath(new URL('..', import.meta.url)) });
  const designDir = join(repo, 'prelude', 'orders');
  write('orders/states/03-not-set-up.json', { orders: [{ id: 1, borrower: '', amount: 0, urgent: false }] });
  try {
    const failures = await checkDesign({ renderers }, { folder: { path: repo }, design: { id: 'orders' }, designDir });
    assert.deepEqual(failures.filter(f => f.state === 'Not set up'), []);
  } finally {
    renderers.closeAll();
    rmSync(join(designDir, 'states', '03-not-set-up.json'));
  }
});
