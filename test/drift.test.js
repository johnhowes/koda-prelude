// Step 6d: porting points a route at the app's own view; states become its
// fixtures; approved snapshots catch a page that renders differently.

import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { designPrompt, permissionArgs } from '../server/agent.js';
import { createDesign } from '../server/designs.js';
import { folderId } from '../server/folders.js';
import { pickable, readRoutes, viewOf } from '../server/host.js';
import { createServer } from '../server/main.js';
import { readEntries } from '../server/sessions.js';
import { compareSnapshots, diff, normalise, snapshotName, writeSnapshots } from '../server/snapshots.js';
import { createFakeRunner } from './fake-runner.js';

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const fid = folderId(repo);
const runner = createFakeRunner();
const designDir = join(repo, 'prelude', 'loans');
let server;
let base;
let port;

const write = (path, text) => {
  const file = join(repo, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};

before(async () => {
  createDesign(repo, { title: 'Loans' });
  write('prelude/loans/routes.json', {
    '/loans': { view: '@app/app/views/loans/list', title: 'Loans', data: '' },
    '/loans/:id': { view: 'loans/detail', title: 'Loan', data: 'loans/:id' },
    '/loans/:id/edit': { view: '@app/app/views/loans/_edit', title: 'Edit loan', data: 'loans/:id', over: '/loans/:id', in: 'drawer' },
    'POST /loans/:id': { update: 'loans/:id', require: ['borrower'], form: '@app/app/views/loans/_edit', answer: { view: '@app/app/views/loans/_row', data: 'loans/:id' } },
    '/gone': { view: '@app/app/views/nothing-here', title: 'Gone', data: '' },
    '/escape': { view: '@app/../outside', title: 'Escape', data: '' },
  });
  // The app's own views, ported from the design: partials beside them.
  write('app/views/loans/list.eta', '<ul><% for (const l of it.loans) { %><%~ include("./_row", l) %><% } %></ul>');
  write('app/views/loans/_row.eta', '<li id="loan-<%= it.id %>"><%= it.borrower %></li>');
  write('app/views/loans/_edit.eta', '<form><input name="Borrower" value="<%= it.borrower %>"><% if (it.$errors?.borrower) { %><span class="error"><%= it.$errors.borrower %></span><% } %></form>');
  write('prelude/loans/views/loans/detail.eta', '<h1><%= it.borrower %></h1>');
  write('prelude/loans/states/01-typical.json', { loans: [{ id: 1, borrower: 'Harbor Street Bakery' }, { id: 2, borrower: 'Ruiz & Sons' }] });

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

function onDesign(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, {
      method,
      headers: { host: `loans.${fid}.preview.localhost:${port}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

const post = (path, fields) => fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });
const until = async check => { for (let i = 0; i < 200 && !(await check()); i++) await new Promise(r => setTimeout(r, 25)); };

test('a ported route names the app’s own view, read in place', () => {
  const routes = readRoutes(designDir);
  assert.equal(routes.find(r => r.pattern === '/loans').ported, true);
  assert.equal(routes.find(r => r.pattern === '/loans/:id').ported, false);
  assert.deepEqual(viewOf({ folderPath: repo, designDir, view: '@app/app/views/loans/list' }), { views: join(repo, 'app', 'views', 'loans'), template: './list' });
  assert.deepEqual(viewOf({ folderPath: repo, designDir, view: 'loans/detail' }), { views: join(designDir, 'views'), template: './loans/detail' });
  assert.match(viewOf({ folderPath: repo, designDir, view: '@app/../outside' }).error, /outside the repository/);
  assert.match(viewOf({ folderPath: repo, designDir, view: '@app/app/views/nothing-here' }).error, /no view at @app\/app\/views\/nothing-here/);

  const picks = pickable(routes, JSON.parse(readFileSync(join(designDir, 'states', '01-typical.json'), 'utf8')));
  assert.equal(picks.find(p => p.id === '/loans').ported, true);
  assert.equal(picks.find(p => p.id === '/loans/1/edit').ported, true);
  assert.equal(picks.find(p => p.id === '/loans/1').ported, false);
});

test('ported views render with the state, partials and all, alone and over their page', async () => {
  const list = await onDesign('GET', '/loans', { headers: { 'x-koda-fragment': '1' } });
  assert.equal(list.body, '<ul><li id="loan-1">Harbor Street Bakery</li><li id="loan-2">Ruiz &amp; Sons</li></ul>');
  const overlay = await onDesign('GET', '/loans/1/edit');
  assert.match(overlay.body, /<h1>Harbor Street Bakery<\/h1>[\s\S]*<form><input name="Borrower"/, 'the design’s page beneath, the app’s form over it');
  const gone = await onDesign('GET', '/gone', { headers: { 'x-koda-fragment': '1' } });
  assert.equal(gone.status, 500);
  assert.match(gone.body, /no view at @app\/app\/views\/nothing-here/);
});

test('a ported form posts the app’s field names; they match the state’s, ignoring case', async () => {
  const refused = await onDesign('POST', '/loans/1', { headers: { 'x-koda-fragment': '1' }, body: 'Borrower=' });
  assert.equal(refused.status, 422);
  assert.match(refused.body, /<span class="error">This is required.<\/span>/);
  const saved = await onDesign('POST', '/loans/1', { headers: { 'x-koda-fragment': '1' }, body: 'Borrower=Harbor%20Light' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body, '<li id="loan-1">Harbor Light</li>', 'merged into "borrower", not a new "Borrower"');
  await post(`/f/${fid}/d/loans/reset`, { view: 'inline' });
});

test('snapshots compare normalised HTML: whitespace and attribute order don’t count', () => {
  assert.equal(normalise('<p  class="a"   id=x>\n  Hello   there </p>'), normalise('<p id="x" class="a">Hello there</p>'));
  assert.notEqual(normalise('<p class="a">Hello</p>'), normalise('<p class="b">Hello</p>'));
  assert.equal(normalise('<!DOCTYPE html><br/>'), '<!DOCTYPE html>\n<br>\n');
  assert.equal(snapshotName('/loans/1/edit'), 'loans_1_edit');
  assert.equal(snapshotName('/'), 'index');
  assert.equal(snapshotName('/loans/1', { post: true }), 'POST_loans_1');

  const changed = diff(normalise('<ul><li>a</li><li>b</li><li>c</li></ul>'), normalise('<ul><li>a</li><li>B</li><li>c</li></ul>'));
  assert.match(changed, /^  <li>\n- b\n\+ B\n  <\/li>/m);

  const dir = mkdtempSync(join(tmpdir(), 'prelude-snapshots-'));
  assert.deepEqual(compareSnapshots(dir, new Map([['typical/x', '<p>x</p>']])), { approved: false, differ: [] }, 'nothing differs before the first approval');
  assert.equal(writeSnapshots(dir, new Map([['typical/x', '<p>x</p>'], ['typical/broken', null]])), 1, 'a page that didn’t render isn’t approved');
  assert.deepEqual(compareSnapshots(dir, new Map([['typical/x', '<p>\n  x</p>'], ['typical/broken', null]])).differ, []);
  const later = compareSnapshots(dir, new Map([['typical/x', '<p>y</p>'], ['typical/new', '<p>n</p>']]));
  assert.deepEqual(later.differ.map(d => d.name), ['typical/x', 'typical/new']);
  assert.equal(compareSnapshots(dir, new Map()).differ[0].diff, 'approved, but no longer rendered');
  writeFileSync(join(dir, 'snapshots', 'typical', 'x.html'), normalise('<p>x</p>').replace(/\n/g, '\r\n'));
  assert.deepEqual(compareSnapshots(dir, new Map([['typical/x', '<p>x</p>']])).differ, [], 'a CRLF checkout still matches');
});

test('the design bar marks ported routes and approves screens; the check then notices a change', async () => {
  const surface = await (await fetch(`${base}/f/${fid}/d/loans/preview`, { headers: { 'x-koda-fragment': '1' } })).text();
  assert.match(surface, /the app’s own view/);
  assert.match(surface, /4 of 5 routes ported/);
  assert.match(surface, /Approve these screens/);

  // /gone and /escape don't render, so approving is refused until they do.
  const refused = await (await post(`/f/${fid}/d/loans/approve`, { view: 'inline' })).text();
  assert.match(refused, /Not approved: 2 pages don’t render/);
  assert.equal(existsSync(join(designDir, 'snapshots')), false);

  const table = JSON.parse(readFileSync(join(designDir, 'routes.json'), 'utf8'));
  delete table['/gone'];
  delete table['/escape'];
  write('prelude/loans/routes.json', table);
  const approved = await (await post(`/f/${fid}/d/loans/approve`, { view: 'inline' })).text();
  assert.match(approved, /Approved 4 pages in 1 state\./);
  assert.match(approved, /Approve again/);
  assert.ok(existsSync(join(designDir, 'snapshots', 'typical', 'loans_1_edit.html')));
  assert.ok(existsSync(join(designDir, 'snapshots', 'typical', 'POST_loans_1.html')), 'a refused form is kept too');

  // A turn changes nothing: the check passes, and says so.
  const first = await post(`/f/${fid}/d/loans/sessions`, { message: 'Look it over' });
  const id = first.headers.get('location').split('/').at(-1);
  await until(() => readEntries(designDir, id).some(e => e.type === 'turn'));
  const check = readEntries(designDir, id).find(e => e.type === 'check');
  assert.deepEqual(check.failures, []);
  assert.deepEqual(check.differ, []);
  assert.equal(check.rendered, 4);
  assert.match(await (await fetch(`${base}/f/${fid}/d/loans/sessions/${id}`)).text(), /Prelude rendered every page and form in every state \(4\), and they all render\./);

  // The app's row changes: shown to the person, not told to the agent.
  write('app/views/loans/_row.eta', '<li id="loan-<%= it.id %>"><strong><%= it.borrower %></strong></li>');
  await post(`/f/${fid}/d/loans/sessions/${id}/messages`, { message: 'And again' });
  await until(() => readEntries(designDir, id).filter(e => e.type === 'check').length === 2);
  const second = readEntries(designDir, id).filter(e => e.type === 'check')[1];
  assert.deepEqual(second.failures, []);
  assert.deepEqual(second.differ, ['typical/loans']);
  assert.match(await (await fetch(`${base}/f/${fid}/d/loans/sessions/${id}`)).text(), /1 page differs from the approved screens/);
  await until(() => readEntries(designDir, id).filter(e => e.type === 'turn').length === 2);
  await post(`/f/${fid}/d/loans/sessions/${id}/messages`, { message: 'Once more' });
  await until(() => runner.turns.length >= 3);
  assert.doesNotMatch(runner.turns.at(-1).prompt, /From Prelude/);
  await until(() => readEntries(designDir, id).filter(e => e.type === 'turn').length === 3);
});

test('prelude check fails on a changed page, with a diff, and --approve accepts it', async () => {
  const tool = fileURLToPath(new URL('../tools/check.js', import.meta.url));
  const run = (...args) => new Promise(resolve => {
    execFile(process.execPath, [tool, repo, ...args], { timeout: 60000 }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout }));
  });
  const failing = await run();
  assert.equal(failing.code, 1, failing.stdout);
  assert.match(failing.stdout, /ok {3}loans: every page renders in every state \(4 pages and forms\)/);
  assert.match(failing.stdout, /FAIL loans: every page matches its approved snapshot/);
  assert.match(failing.stdout, /typical\/loans:[\s\S]*\+ <strong>/);

  const approving = await run('--approve');
  assert.equal(approving.code, 0, approving.stdout);
  assert.match(approving.stdout, /loans: approved 4 pages/);
  const passing = await run();
  assert.equal(passing.code, 0, passing.stdout);
  assert.match(passing.stdout, /Everything passes/);
});

test('the agent leaves ported views and approved snapshots alone', () => {
  const prompt = designPrompt({ title: 'Loans', designPath: 'prelude/loans', format: 'views' });
  assert.match(prompt, /"@app\/<path>" has been ported/);
  assert.match(prompt, /don't change it, copy it back into the design/);
  assert.match(prompt, /never inside a design's sessions\/ or snapshots\/ \(the screens the person approved\)/);
  const args = permissionArgs('prelude/loans');
  const denied = args[args.indexOf('--disallowedTools') + 1];
  assert.match(denied, /Write\(prelude\/loans\/snapshots\/\*\*\)/);
  assert.match(denied, /Edit\(prelude\/loans\/snapshots\/\*\*\)/);
});
