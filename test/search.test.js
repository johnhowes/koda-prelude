import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { createDesign } from '../server/designs.js';
import { folderId } from '../server/folders.js';
import { checkDesign, filterModel } from '../server/host.js';
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

const orders = [
  { id: 1, borrower: { name: 'Harbor Street Bakery' }, status: 'current' },
  { id: 2, borrower: { name: 'Ruiz & Sons' }, status: 'past-due' },
  { id: 3, borrower: { name: 'Harbor Freight' }, status: 'past-due' },
];

before(async () => {
  createDesign(repo, { title: 'Orders' });
  const filters = { search: { q: ['borrower.name', 'id'] }, match: { status: 'status' } };
  write('orders/routes.json', {
    '/orders': { view: 'orders/list', title: 'Orders', data: '', list: 'orders', ...filters },
    '/orders/results': { view: 'orders/_results', data: '', list: 'orders', ...filters },
  });
  write('orders/views/orders/list.eta', '<form method="get" action="/orders"><input name="q" value="<%= it.$query.q ?? "" %>"></form><div id="results"><%~ include("./_results", it) %></div><p class="total"><%= it.orders.length %> of <%= it.all %></p>');
  write('orders/views/orders/_results.eta', '<% if (!it.orders.length) { %><p class="none">No orders match "<%= it.$query.q %>".</p><% } %><ul><% for (const o of it.orders) { %><li><%= o.borrower.name %></li><% } %></ul>');
  write('orders/states/01-typical.json', { orders, all: 3 });

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

function hostGet(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { host: `orders.${fid}.preview.localhost:${port}`, ...headers } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('search and match filter a list, ignoring empty parameters', () => {
  const route = { search: { q: ['borrower.name', 'id'] }, match: { status: 'status' } };
  const names = list => list.map(o => o.borrower.name);
  assert.deepEqual(names(filterModel(orders, route, { q: 'harbor' })), ['Harbor Street Bakery', 'Harbor Freight']);
  assert.deepEqual(names(filterModel(orders, route, { q: 'harbor', status: 'past-due' })), ['Harbor Freight']);
  assert.deepEqual(names(filterModel(orders, route, { q: '2' })), ['Ruiz & Sons'], 'any of the fields');
  assert.equal(filterModel(orders, route, { q: '  ', status: '' }), orders, 'nothing asked, nothing filtered');

  const model = { orders, all: 3 };
  const filtered = filterModel(model, { ...route, list: 'orders' }, { status: 'current' });
  assert.equal(filtered.orders.length, 1);
  assert.equal(model.orders.length, 3, 'the dataset itself is untouched');
});

test('a GET form: the page filtered, the form showing what was asked', async () => {
  const page = (await hostGet('/orders?q=harbor')).body;
  assert.match(page, /<input name="q" value="harbor">/, 'it.$query reaches the view');
  assert.match(page, /<li>Harbor Street Bakery<\/li><li>Harbor Freight<\/li><\/ul>/);
  assert.match(page, /<p class="total">2 of 3<\/p>/, 'the rest of the model is still there');
  assert.ok((await hostGet('/orders?q=nobody')).body.includes('No orders match "nobody"'), 'a partial included in the page sees the query');
  assert.match((await hostGet('/orders')).body, /<input name="q" value="">/);
});

test('search as you type: the results fragment answers alone, with the same filters', async () => {
  const results = await hostGet('/orders/results?q=ruiz', { 'x-koda-fragment': '1' });
  assert.equal(results.body, '<ul><li>Ruiz &amp; Sons</li></ul>');
  const none = await hostGet('/orders/results?q=nobody', { 'x-koda-fragment': '1' });
  assert.ok(none.body.includes('<p class="none">No orders match "nobody".</p>'), 'the partial sees the query too');
});

test('the check asks each filtered route for something nothing matches', async () => {
  const renderers = createRenderers({ appRoot: fileURLToPath(new URL('..', import.meta.url)) });
  const designDir = join(repo, 'prelude', 'orders');
  try {
    assert.deepEqual(await checkDesign({ renderers }, { folder: { path: repo }, design: { id: 'orders' }, designDir }), []);
    // A results view that assumes there is always a first match.
    write('orders/views/orders/_results.eta', '<p><%= it.orders[0].borrower.name %></p>');
    const failures = await checkDesign({ renderers }, { folder: { path: repo }, design: { id: 'orders' }, designDir });
    assert.ok(failures.some(f => f.path.startsWith('/orders/results?q=no-such-thing')), JSON.stringify(failures));
  } finally {
    renderers.closeAll();
  }
});
