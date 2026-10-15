// Step 8: how a first build creates the app - the stack chosen once, the
// app build on a branch of its own, features held until the app exists, and
// shell layouts that name the app's files.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { DEFAULT_STACK, appOf } from '../server/app-config.js';
import { createDesign } from '../server/designs.js';
import { canonical, folderId } from '../server/folders.js';
import { findLayout } from '../server/host.js';
import { createServer } from '../server/main.js';
import { readEntries } from '../server/sessions.js';
import { createFakeRunner } from './fake-runner.js';

Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' });

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const runner = createFakeRunner();
let server;
let base;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const write = (root, path, text) => {
  const file = join(root, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};
const until = async check => { for (let i = 0; i < 1200 && !(await check()); i++) await new Promise(r => setTimeout(r, 25)); };
const get = path => fetch(base + path, { redirect: 'manual' });
const post = (path, fields) => fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });
const commitAll = (repo, message) => { git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', message); };

/** A repository with nothing but designs, opened in Prelude. */
async function bareRepo() {
  const repo = canonical(mkdtempSync(join(tmpdir(), 'prelude-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  const body = new FormData();
  body.append('path', repo);
  await fetch(`${base}/folders`, { method: 'POST', body, redirect: 'manual' });
  return { repo, fid: folderId(repo) };
}

before(async () => {
  server = createServer({ home, runner });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test('the first design settles the stack: the default, in one click', async () => {
  const { repo, fid } = await bareRepo();
  const before = await (await get(`/f/${fid}`)).text();
  assert.match(before, /The app will be <strong>Node, Express, Eta and Koda<\/strong>/);
  assert.match(before, /<summary class="muted">Choose another stack<\/summary>/);
  assert.doesNotMatch(before, /id="app"/, 'no app card before a stack is chosen');

  // The design system needs no stack.
  assert.equal((await post(`/f/${fid}/designs`, { title: 'Tokens', kind: 'system' })).status, 303);
  assert.equal(appOf(repo).stack, null);

  assert.equal((await post(`/f/${fid}/designs`, { title: 'Loans', kind: 'design' })).status, 303);
  assert.deepEqual(appOf(repo), { stack: DEFAULT_STACK, custom: false, built: false, path: null });
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'prelude', 'prelude.json'), 'utf8')), { app: { stack: DEFAULT_STACK } });

  const after = await (await get(`/f/${fid}`)).text();
  assert.doesNotMatch(after, /Choose another stack/, 'asked once');
  assert.match(after, /<h2>The app<\/h2>[\s\S]*It will be Node, Express, Eta and Koda\. There’s no app yet/);
  assert.match(after, /Start the app build/);
});

test('another stack is described, and its app is built before any design of views', async () => {
  const { repo, fid } = await bareRepo();
  const refused = await post(`/f/${fid}/designs`, { title: 'Loans', kind: 'design', stack: 'ASP.NET Core MVC with Razor' });
  assert.equal(refused.status, 409);
  assert.match(await refused.text(), /Designs here will be written in ASP\.NET Core MVC with Razor, so its app is built first/);
  assert.deepEqual(appOf(repo), { stack: 'ASP.NET Core MVC with Razor', custom: true, built: false, path: null });
  assert.equal(existsSync(join(repo, 'prelude', 'loans')), false);
  assert.equal((await post(`/f/${fid}/designs`, { title: 'Tokens', kind: 'system' })).status, 303, 'the design system can be designed straight away');

  // The app build makes the folder's shell, which must be committed first, like the rest of prelude/.
  const first = await post(`/f/${fid}/app/build`, {});
  assert.equal(first.status, 409);
  assert.match(await first.text(), /The designs have changes that aren’t committed\. Commit prelude\/ first/);
  assert.ok(existsSync(join(repo, 'prelude', 'app-shell', 'design.json')), 'the shell was made: it’s the app’s frame');

  commitAll(repo, 'Designs so far');
  const started = await post(`/f/${fid}/app/build`, {});
  assert.equal(started.status, 303, await started.text());
  const [, wid, sid] = started.headers.get('location').match(/^\/f\/([0-9a-f]+)\/d\/app-shell\/sessions\/(.+)$/);
  await until(() => runner.turns.length >= 1);
  const turn = runner.turns.at(-1);
  assert.equal(turn.mode, 'build');
  assert.equal(turn.prompt, 'Build the app.');
  assert.match(turn.systemPrompt, /You are building the app itself/);
  assert.match(turn.systemPrompt, /The app's stack is ASP\.NET Core MVC with Razor\./);
  assert.match(turn.systemPrompt, /The app is its own design host/);
  assert.match(turn.systemPrompt, /POST \/__prelude\/render/, 'the contract, from hosts.js');
  assert.match(turn.systemPrompt, /createServer\(\(req, res\) =>/, 'the reference host, to translate');
  assert.match(git(repo, 'branch', '--list', 'build/*'), /build\/app-shell-app/);

  const folder = await (await get(`/f/${fid}`)).text();
  assert.match(folder, /App build[\s\S]*build\/app-shell-app/);
  const session = await (await get(`/f/${wid}/d/app-shell/sessions/${sid}`)).text();
  assert.match(session, new RegExp(`<a href="/f/${fid}#app">Back to Build</a>`));
});

test('features wait for the app; the default app build ports the shell and serves the system', async () => {
  const { repo, fid } = await bareRepo();
  createDesign(repo, { title: 'Tokens', kind: 'system' });
  createDesign(repo, { title: 'Shell', kind: 'shell' });
  write(repo, 'prelude/shell/routes.json', { '/': { view: 'home', title: 'Home', data: '' } });
  write(repo, 'prelude/shell/views/home.eta', '<p>Gallery</p>');
  write(repo, 'prelude/shell/layouts/app.eta', '<html><body class="designed"><%~ it.body %></body></html>');
  write(repo, 'prelude/shell/layouts/app.json', { user: 'Dana' });
  assert.equal((await post(`/f/${fid}/designs`, { title: 'Loans', kind: 'design' })).status, 303);
  write(repo, 'prelude/loans/routes.json', { '/loans': { view: 'loans/list', title: 'Loans', data: '' } });
  write(repo, 'prelude/loans/views/loans/list.eta', '<h1>Loans</h1>');
  commitAll(repo, 'Designs');

  const view = await (await get(`/f/${fid}/d/loans/build`)).text();
  assert.match(view, /Features are built into the app, and there isn’t one yet\. <a href="\/f\/[0-9a-f]+#app">Build the app first<\/a>/);
  assert.doesNotMatch(view, /Start a build session/);
  assert.match(view, /Copy as story/, 'stories can be copied already');
  assert.equal((await post(`/f/${fid}/d/loans/builds`, { group: '/loans' })).status, 409);

  runner.turns.length = 0;
  const started = await post(`/f/${fid}/app/build`, {});
  assert.equal(started.status, 303, await started.text());
  const [, wid, sid] = started.headers.get('location').match(/^\/f\/([0-9a-f]+)\/d\/shell\/sessions\/(.+)$/);
  await until(() => runner.turns.length >= 1);
  const prompt = runner.turns.at(-1).systemPrompt;
  assert.match(prompt, /a Node server using Express, rendering Eta views, with Koda in the browser/);
  assert.match(prompt, /The design system, prelude\/tokens\/system\//);
  assert.match(prompt, /- Loans \(prelude\/loans\)/);
  assert.match(prompt, /write prelude\/shell\/layouts\.json naming each/);

  // The agent's work (here, by hand): the layout moves into the app, the shell names it,
  // and the app is recorded with its design host.
  const worktree = canonical(git(repo, 'worktree', 'list').split('\n').find(line => line.includes('build/shell-app')).split(/\s+/)[0]);
  const workDir = join(worktree, 'prelude', 'shell');
  await until(() => readEntries(workDir, sid).some(e => e.type === 'note'));
  write(worktree, 'app/views/layouts/app.eta', '<html><body class="real-app"><%= it.layout.user %>: <%~ it.body %></body></html>');
  write(worktree, 'prelude/shell/layouts.json', { app: '@app/app/views/layouts/app' });
  write(worktree, 'prelude/prelude.json', { app: { stack: DEFAULT_STACK, path: 'app' }, host: { start: 'node app/server.js', url: 'http://localhost:59998', views: '.eta' } });
  await post(`/f/${wid}/d/shell/sessions/${sid}/messages`, { message: 'Ported' });
  await until(() => readEntries(workDir, sid).filter(e => e.type === 'note').length >= 3);
  const notes = readEntries(workDir, sid).filter(e => e.type === 'note').map(e => e.text);
  assert.ok(notes.some(text => /design host needs your approval first/.test(text)), 'an unapproved host waits for the person, failing nothing');
  assert.equal(readEntries(workDir, sid).filter(e => e.type === 'check').length, 1, 'only the first turn’s check, before there was a host');
  assert.equal(existsSync(join(workDir, 'layouts', 'app.eta')), false, 'the shell’s copy is gone');
  assert.ok(existsSync(join(workDir, 'layouts', 'app.json')), 'its sample data stays');
  assert.equal(appOf(worktree).built, true);
  assert.equal(appOf(repo).built, false, 'main has no app until the branch is merged');

  // Every design now renders in the app's own layout, with the shell's sample data.
  const found = findLayout({ folderPath: worktree, designDir: join(worktree, 'prelude', 'loans'), shellDir: workDir, name: 'app' });
  assert.deepEqual(found, { views: join(worktree, 'app', 'views', 'layouts'), template: './app', sample: { user: 'Dana' } });
  write(worktree, 'prelude/loans/views/layouts/app.eta', '<html><%~ it.body %></html>');
  assert.equal(findLayout({ folderPath: worktree, designDir: join(worktree, 'prelude', 'loans'), shellDir: workDir, name: 'app' }).views, join(worktree, 'prelude', 'loans', 'views', 'layouts'), 'a design’s own draft still comes first');
});
