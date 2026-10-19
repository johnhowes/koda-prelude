// Steps 8 and 9: the stack chosen once; the app built on the shell's branch;
// designs made on branches of their own; merging a branch into main and
// tidying it up; features held until the app is on their branch.

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
import { listSessions, readEntries, readSession } from '../server/sessions.js';
import { createFakeRunner } from './fake-runner.js';

Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' });

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const runner = createFakeRunner();
let server;
let base;

// No file-system monitor daemons for these throwaway repositories (see branches.js).
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (root, path, text) => {
  const file = join(root, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};
const until = async check => { for (let i = 0; i < 1200 && !(await check()); i++) await new Promise(r => setTimeout(r, 25)); };
const get = path => fetch(base + path, { redirect: 'manual' });
const post = (path, fields) => fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });
const commitAll = (repo, message) => { git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', message); };
const worktreeOf = (repo, branch) => canonical(git(repo, 'worktree', 'list').split('\n').find(line => line.includes(`[${branch}]`)).split(/\s+/)[0]);
const location = res => res.headers.get('location');

/**
 * The app build a post to /app/build started: it answers with the project's
 * app, so the build is found on the shell's branch. [, worktree id, session id].
 */
function appBuildOf(started, repo, fid, shellId) {
  assert.equal(started.status, 303);
  assert.equal(location(started), `/f/${fid}#app`);
  const shell = worktreeOf(repo, `prelude/${shellId}`);
  return [null, folderId(shell), listSessions(join(shell, 'prelude', shellId))[0].id];
}

async function open(path) {
  const body = new FormData();
  body.append('path', path);
  await fetch(`${base}/folders`, { method: 'POST', body, redirect: 'manual' });
  return folderId(path);
}

/** A repository with nothing but designs, opened in Prelude. */
async function bareRepo() {
  const repo = canonical(mkdtempSync(join(tmpdir(), 'prelude-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  return { repo, fid: await open(repo) };
}

/** Wait for a session's turn to finish: its commit note. */
const settled = (designDir, sid, count = 1) => until(() => readEntries(designDir, sid).filter(e => e.type === 'turn').length >= count
  && readEntries(designDir, sid).filter(e => e.type === 'note' && /^Committed to/.test(e.text)).length >= count);

before(async () => {
  server = createServer({ home, runner });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test('in a repository, a new design is made on a branch of its own; the first design settles the stack', async () => {
  const { repo, fid } = await bareRepo();
  const before = await (await get(`/f/${fid}`)).text();
  assert.match(before, /Design the first feature/);
  assert.doesNotMatch(before, /id="app"/, 'no app card before a stack is chosen');
  assert.match(await (await get(`/f/${fid}/designs/new`)).text(), /The app will be <strong>Node, Express, Eta and Koda<\/strong>/);

  // The design system needs no stack.
  const system = await post(`/f/${fid}/designs`, { title: 'Tokens', kind: 'system' });
  assert.equal(system.status, 303);
  assert.match(location(system), /^\/f\/[0-9a-f]+\/d\/tokens$/);
  assert.doesNotMatch(location(system), new RegExp(`^/f/${fid}/`), 'it opens on its branch’s worktree, not the checkout');
  assert.equal(existsSync(join(repo, 'prelude', 'tokens')), false, 'nothing is written to the person’s checkout');
  const tokens = worktreeOf(repo, 'prelude/tokens');
  assert.ok(existsSync(join(tokens, 'prelude', 'tokens', 'design.json')));
  assert.equal(git(tokens, 'log', '-1', '--format=%s'), 'Tokens: a new design (committed by Prelude)');
  assert.equal(appOf(repo).stack, null);

  assert.equal((await post(`/f/${fid}/designs`, { title: 'Loans', kind: 'design' })).status, 303);
  assert.deepEqual(appOf(repo), { stack: DEFAULT_STACK, custom: false, built: false, path: null, existing: false });
  assert.equal(git(repo, 'status', '--porcelain'), '', 'the stack choice is committed on main');
  assert.equal((await post(`/f/${fid}/designs`, { title: 'Loans', kind: 'design' })).status, 422, 'one design per id, even only on a branch');
  assert.equal((await post(`/f/${fid}/designs`, { title: 'Other tokens', kind: 'system' })).status, 422, 'one design system, even only on a branch');

  const after = await (await get(`/f/${fid}`)).text();
  assert.match(after, /Tokens[\s\S]*<span class="muted"><code>prelude\/tokens<\/code><\/span>/, 'designs only on their branches are in progress, with their branch');
  assert.match(after, /Loans[\s\S]*<span class="muted"><code>prelude\/loans<\/code><\/span>/);
  assert.doesNotMatch(after, /Choose another stack/, 'asked once');
  assert.match(after, /Start the app build/);
});

test('another stack is described, and its app is built first, on the shell’s branch', async () => {
  const { repo, fid } = await bareRepo();
  const refused = await post(`/f/${fid}/designs`, { title: 'Loans', kind: 'design', stack: 'ASP.NET Core MVC with Razor' });
  assert.equal(refused.status, 409);
  assert.match(await refused.text(), /Designs here will be written in ASP\.NET Core MVC with Razor, so its app is built first/);
  assert.deepEqual(appOf(repo), { stack: 'ASP.NET Core MVC with Razor', custom: true, built: false, path: null, existing: false });
  assert.equal((await post(`/f/${fid}/designs`, { title: 'Tokens', kind: 'system' })).status, 303, 'the design system can be designed straight away');

  runner.turns.length = 0;
  const started = await post(`/f/${fid}/app/build`, {});
  const [, wid, sid] = appBuildOf(started, repo, fid, 'app-shell');
  const shell = worktreeOf(repo, 'prelude/app-shell');
  assert.ok(existsSync(join(shell, 'prelude', 'app-shell', 'design.json')), 'the shell was made on its branch: it’s the app’s frame');
  assert.deepEqual(readSession(join(shell, 'prelude', 'app-shell'), sid).build, { group: '@app', title: 'The app' });
  await until(() => runner.turns.length >= 1);
  const turn = runner.turns.at(-1);
  assert.equal(turn.mode, 'build');
  assert.equal(turn.prompt, 'Build the app.');
  assert.match(turn.systemPrompt, /You are building the app itself/);
  assert.match(turn.systemPrompt, /The app's stack is ASP\.NET Core MVC with Razor\./);
  assert.match(turn.systemPrompt, /POST \/__prelude\/render/, 'the contract, from hosts.js');
  assert.match(turn.systemPrompt, /createServer\(\(req, res\) =>/, 'the reference host, to translate');
  await settled(join(shell, 'prelude', 'app-shell'), sid);

  const folder = await (await get(`/f/${fid}`)).text();
  assert.match(folder, /The app is being built on the app shell’s branch, as ASP\.NET Core MVC with Razor\./);
  const session = await (await get(`/f/${wid}/d/app-shell/sessions/${sid}`)).text();
  assert.match(session, /This session builds <strong>The app<\/strong> into the app, on this design’s branch/);
});

test('the app is built on the shell’s branch, merged into main and tidied up; a feature then updates from main and builds', async () => {
  const { repo, fid } = await bareRepo();
  createDesign(repo, { title: 'Tokens', kind: 'system' });
  createDesign(repo, { title: 'Shell', kind: 'shell' });
  // Its gallery, and a page of its own, Settings, which is built like a feature's.
  write(repo, 'prelude/shell/routes.json', { '/': { view: 'gallery/home', title: 'Home', data: '' }, '/settings': { view: 'settings/page', title: 'Settings', data: '' } });
  write(repo, 'prelude/shell/views/gallery/home.eta', '<p>Gallery</p>');
  write(repo, 'prelude/shell/views/settings/page.eta', '<h1>Settings</h1>');
  write(repo, 'prelude/shell/layouts/app.eta', '<html><body class="designed"><%~ it.body %></body></html>');
  write(repo, 'prelude/shell/layouts/app.json', { user: 'Dana' });
  createDesign(repo, { title: 'Loans', kind: 'design' });
  write(repo, 'prelude/loans/routes.json', { '/loans': { view: 'loans/list', title: 'Loans', data: '' } });
  write(repo, 'prelude/loans/views/loans/list.eta', '<h1>Loans</h1>');
  write(repo, 'prelude/prelude.json', { app: { stack: DEFAULT_STACK } });
  commitAll(repo, 'Designs');

  // A design with no branch yet shows main's version; posting to it makes its branch.
  const view = await (await get(`/f/${fid}/d/loans/build`)).text();
  assert.match(view, /Features are built into the app, and there isn’t one yet\./);
  assert.doesNotMatch(view, /Start a build session/);
  const early = await post(`/f/${fid}/d/loans/builds`, { group: '/loans' });
  assert.equal(early.status, 409, 'no app yet');
  assert.ok(worktreeOf(repo, 'prelude/loans'), 'the post made the design’s branch');
  assert.match((await get(`/f/${fid}/d/loans/build`)).headers.get('location'), /^\/f\/[0-9a-f]+\/d\/loans\/build$/, 'its pages now move to its worktree');

  runner.turns.length = 0;
  const started = await post(`/f/${fid}/app/build`, {});
  const [, wid, sid] = appBuildOf(started, repo, fid, 'shell');
  await until(() => runner.turns.length >= 1);
  const prompt = runner.turns.at(-1).systemPrompt;
  assert.match(prompt, /a Node server using Express, rendering Eta views, with Koda in the browser/);
  assert.match(prompt, /The design system, prelude\/tokens\/system\//);
  assert.match(prompt, /write prelude\/shell\/layouts\.json naming each/);

  // The agent's work (here, by hand): the layout moves into the app, the shell
  // names it, and the app is recorded with its design host.
  const shell = worktreeOf(repo, 'prelude/shell');
  const shellDir = join(shell, 'prelude', 'shell');
  await settled(shellDir, sid);
  write(shell, 'app/views/layouts/app.eta', '<html><body class="real-app"><%= it.layout.user %>: <%~ it.body %></body></html>');
  write(shell, 'prelude/shell/layouts.json', { app: '@app/app/views/layouts/app' });
  write(shell, 'prelude/prelude.json', { app: { stack: DEFAULT_STACK, path: 'app' }, host: { start: 'node app/server.js', url: 'http://localhost:59998', views: '.eta' } });
  await new Promise(resolve => setTimeout(resolve, 50));
  const ported = await post(`/f/${wid}/d/shell/sessions/${sid}/messages`, { message: 'Ported' });
  assert.equal(ported.status, 200);
  await settled(shellDir, sid, 2);
  const notes = readEntries(shellDir, sid).filter(e => e.type === 'note').map(e => e.text);
  assert.ok(notes.some(text => /design host needs your approval first/.test(text)), 'an unapproved host waits for the person, failing nothing');
  assert.equal(existsSync(join(shellDir, 'layouts', 'app.eta')), false, 'the shell’s copy is gone');
  assert.ok(existsSync(join(shellDir, 'layouts', 'app.json')), 'its sample data stays');
  assert.equal(appOf(shell).built, true);
  assert.equal(appOf(repo).built, false, 'main has no app until the branch is merged');
  assert.deepEqual(findLayout({ folderPath: shell, designDir: join(shell, 'prelude', 'loans'), shellDir, name: 'app' }), { views: join(shell, 'app', 'views', 'layouts'), template: './app', sample: { user: 'Dana' } });

  const folder = await (await get(`/f/${fid}`)).text();
  assert.match(folder, /The app is built on the app shell’s branch, <code>prelude\/shell<\/code>\. Once that branch is in your main branch/);
  assert.match(folder, new RegExp(`action="/f/${fid}/branches/${wid}/merge"`));

  // Merge: main has the app; the shell's worktree and branch are gone, and the folder says so.
  const merged = await post(`/f/${fid}/branches/${wid}/merge`, {});
  assert.equal(merged.status, 303, await merged.text());
  assert.equal(location(merged), `/f/${fid}`);
  assert.equal(appOf(repo).built, true, 'the app is on main');
  assert.equal(existsSync(shell), false, 'the worktree is gone');
  assert.equal(git(repo, 'branch', '--list', 'prelude/shell'), '', 'and its branch');
  assert.match(git(repo, 'log', '-1', '--format=%s'), /^Merge prelude\/shell: Shell \(merged by Prelude\)$/);
  const afterMerge = await (await get(`/f/${fid}`)).text();
  assert.match(afterMerge, /Merged lately[\s\S]*<code>prelude\/shell<\/code> merged into main just now\./);
  assert.match(afterMerge, /Node, Express, Eta and Koda, in <code>app\/<\/code>/);
  // The design's page says so too: in its header, and in full in its About drawer.
  assert.match(await (await fetch(`${base}/f/${fid}/d/shell`)).text(), /<span class="icon icon-done" aria-hidden="true"><\/span>Merged into main/, 'the design’s page says so too');
  assert.match(await (await fetch(`${base}/f/${fid}/d/shell/about`)).text(), /Its branch, <code>prelude\/shell<\/code>, was merged into main /);

  // The shell's own page is built like a feature's; its gallery never is.
  const shellBuild = await (await get(`/f/${fid}/d/shell/build`)).text();
  assert.match(shellBuild, /<h2>Settings <span class="pill">/);
  assert.doesNotMatch(shellBuild, /<h2>Home /, 'the gallery isn’t built');
  // Approved first (10.9). This app's design host is a stand-in that never runs,
  // so its pages can't render here to be approved: an approved screen is written.
  write(repo, 'prelude/shell/snapshots/_/settings.html', '<h1>Settings</h1>');
  const settings = await post(`/f/${fid}/d/shell/builds`, { group: '/settings' });
  assert.equal(settings.status, 303, await settings.text());
  const [, swid, ssid] = location(settings).match(/^\/f\/([0-9a-f]+)\/d\/shell\/sessions\/(.+)$/);
  const settingsDir = join(worktreeOf(repo, 'prelude/shell'), 'prelude', 'shell');
  assert.deepEqual(readSession(settingsDir, ssid).build, { group: '/settings', title: 'Settings' });
  await until(() => runner.turns.some(turn => turn.prompt.includes('Build Settings.')));
  assert.equal(runner.turns.find(turn => turn.prompt.includes('Build Settings.')).mode, 'build');
  assert.ok(swid);
  await settled(settingsDir, ssid);

  // The feature's branch started before the app: it updates from main, then builds.
  const loans = worktreeOf(repo, 'prelude/loans');
  const lid = folderId(loans);
  const behind = await (await get(`/f/${lid}/d/loans/build`)).text();
  assert.match(behind, /The app is on your main branch, but not on this design’s branch yet/);
  const updated = await post(`/f/${fid}/branches/${lid}/update`, { back: `/f/${lid}/d/loans/build` });
  assert.equal(updated.status, 303);
  assert.equal(appOf(loans).built, true, 'main came in');
  write(loans, 'prelude/loans/snapshots/_/loans.html', '<h1>Loans</h1>');   // approved first (10.9), as for Settings above
  const build = await post(`/f/${lid}/d/loans/builds`, { group: '/loans' });
  assert.equal(build.status, 303, await build.text());
  const [, bsid] = location(build).match(/\/sessions\/(.+)$/);
  assert.deepEqual(readSession(join(loans, 'prelude', 'loans'), bsid).build, { group: '/loans', title: 'Loans' });
  await until(() => runner.turns.some(turn => turn.prompt.includes('Build Loans.')));
  const buildTurn = runner.turns.find(turn => turn.prompt.includes('Build Loans.'));
  assert.equal(buildTurn.mode, 'build');
  assert.match(buildTurn.prompt, /^\(From Prelude, not the person: the main branch was brought into this branch, and these files came in: [^)]*prelude\/prelude\.json/, 'the agent is told what came in');
  await settled(join(loans, 'prelude', 'loans'), bsid);
});

test('a project that already has an app connects it instead of building one (8b)', async () => {
  // An Eta app of its own in server/, a shell, and the default stack recorded by mistake.
  const { repo, fid } = await bareRepo();
  write(repo, 'server/views/layout.eta', '<html><body class="the-real-app"><%~ it.body %></body></html>');
  write(repo, 'server/main.js', '// the app');
  createDesign(repo, { title: 'Shell', kind: 'shell' });
  write(repo, 'prelude/shell/routes.json', { '/': { view: 'gallery/app', title: 'App layout', data: '' } });
  write(repo, 'prelude/shell/views/gallery/app.eta', '<p>Skeleton</p>');
  write(repo, 'prelude/shell/layouts/app.eta', '<html><body class="designed"><%~ it.body %></body></html>');
  write(repo, 'prelude/prelude.json', { app: { stack: DEFAULT_STACK } });
  commitAll(repo, 'An app, and its shell designed');

  const card = await (await get(`/f/${fid}`)).text();
  assert.match(card, /<button class="btn small ghost" type="submit" name="existing" value="true"[^>]*>It already has an app<\/button>/);

  runner.turns.length = 0;
  const started = await post(`/f/${fid}/app/build`, { existing: 'true' });
  const [, wid, sid] = appBuildOf(started, repo, fid, 'shell');
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'prelude', 'prelude.json'), 'utf8')).app, { existing: true }, 'the guessed stack goes: the connection describes the real one');
  const shell = worktreeOf(repo, 'prelude/shell');
  const shellDir = join(shell, 'prelude', 'shell');
  assert.equal(readSession(shellDir, sid).title, 'Connect the app');
  await until(() => runner.turns.length >= 1);
  const turn = runner.turns.at(-1);
  assert.equal(turn.prompt, 'Connect the app.');
  assert.equal(turn.mode, 'build');
  assert.match(turn.systemPrompt, /You are connecting the app this repository already has to its designs \(prelude\/\)\. Don't build an app: it exists\./);
  assert.match(turn.systemPrompt, /A design host, only if it's needed/);
  assert.match(turn.systemPrompt, /link a layout only when the shell's is the app's layout as it is[^.]*\. Where the shell's layout is a redesign[^.]*, don't link it/);
  assert.match(turn.systemPrompt, /name, in prelude\/prelude\.json's "app\.assets", the URLs the app serves its own files at/);
  assert.doesNotMatch(turn.systemPrompt, /You are building the app itself/);
  await settled(shellDir, sid);

  // Designs of views wait for it, as they're written in its language.
  const early = await post(`/f/${fid}/designs`, { title: 'Loans', area: '', kind: 'design' });
  assert.equal(early.status, 409);
  assert.match(await early.text(), /the app this project already has is connected first\. Connect the app, under The app\./);
  assert.match(await (await get(`/f/${fid}`)).text(), /The app is being connected on the app shell’s branch/);

  // The agent's work (here, by hand): the json and layouts.json, nothing else.
  write(shell, 'prelude/prelude.json', { app: { existing: true, path: 'server', stack: 'Node, node:http, Eta and Koda' } });
  write(shell, 'prelude/shell/layouts.json', { app: '@app/server/views/layout' });
  await post(`/f/${wid}/d/shell/sessions/${sid}/messages`, { message: 'Connected' });
  await settled(shellDir, sid, 2);
  assert.equal(appOf(shell).built, true, 'connected: the app is the one it had');
  assert.equal(existsSync(join(shellDir, 'layouts', 'app.eta')), false, 'the shell’s copy of the layout goes');
  assert.deepEqual(findLayout({ folderPath: shell, designDir: shellDir, shellDir, name: 'app' }).views, join(shell, 'server', 'views'), 'designs render in the app’s real layout');
  assert.equal(existsSync(join(shell, 'app')), false, 'no second app');

  // The link was wrong (the shell's layout is a redesign): the agent empties
  // layouts.json, as it can't delete files. Prelude removes it, and brings the
  // shell's layout back as it was. A layout deleted on purpose stays deleted.
  write(shell, 'prelude/shell/layouts/bare.eta', '<html><body class="bare"><%~ it.body %></body></html>');
  commitAll(shell, 'A bare layout');
  git(shell, 'rm', '-q', 'prelude/shell/layouts/bare.eta');
  commitAll(shell, 'No bare layout after all');
  write(shell, 'prelude/shell/layouts.json', {});
  await post(`/f/${wid}/d/shell/sessions/${sid}/messages`, { message: 'Unlink it' });
  await settled(shellDir, sid, 3);
  assert.equal(existsSync(join(shellDir, 'layouts.json')), false, 'an emptied layouts.json is removed');
  assert.equal(readFileSync(join(shellDir, 'layouts', 'app.eta'), 'utf8'), '<html><body class="designed"><%~ it.body %></body></html>', 'the shell’s layout is back, from git');
  assert.equal(existsSync(join(shellDir, 'layouts', 'bare.eta')), false, 'one deleted on purpose isn’t restored');
  assert.match(git(shell, 'show', '--stat', '--format=', 'HEAD'), /prelude\/shell\/layouts\/app\.eta/, 'and committed with the turn');
});

test('the shell’s layouts are built before the pages that render in them (8c)', async () => {
  // An app that exists, a shell whose layouts are a redesign it hasn't got,
  // and a feature whose page renders in the shell's "workspace" layout.
  const { repo, fid } = await bareRepo();
  write(repo, 'server/views/layout.eta', '<html><body class="old"><main id="workspace"><%~ it.body %></main></body></html>');
  createDesign(repo, { title: 'Shell', kind: 'shell' });
  write(repo, 'prelude/shell/routes.json', { '/': { view: 'gallery/app', title: 'App layout', data: '', layout: 'workspace' } });
  write(repo, 'prelude/shell/views/gallery/app.eta', '<p>Skeleton</p>');
  write(repo, 'prelude/shell/layouts/app.eta', '<html><body class="designed"><%~ it.body %></body></html>');
  write(repo, 'prelude/shell/layouts/workspace.eta', '<html><body class="fill"><main id="main"><%~ it.body %></main><aside id="drawer" ko-region></aside></body></html>');
  write(repo, 'prelude/shell/layouts/_regions.eta', '<aside id="drawer" ko-region></aside>');
  createDesign(repo, { title: 'Workspace', kind: 'design' });
  write(repo, 'prelude/workspace/routes.json', {
    '/work': { view: 'work', title: 'Work', data: '', layout: 'workspace' },
    '/work/rules': { view: '_rules', title: 'Rules', data: '', over: '/work', in: 'drawer' },
  });
  write(repo, 'prelude/workspace/views/work.eta', '<p>Work</p>');
  write(repo, 'prelude/workspace/views/_rules.eta', '<p>Rules</p>');
  write(repo, 'prelude/prelude.json', { app: { existing: true, path: 'server', stack: 'Node and Eta' } });
  commitAll(repo, 'An app, a redesigned shell, and a feature');

  // The feature waits for the layout its page renders in.
  const work = await (await get(`/f/${fid}/d/workspace/build`)).text();
  assert.match(work, /Its pages render in the shell’s “workspace” layout, which the app hasn’t got yet\. <a href="\/f\/[0-9a-f]+\/d\/shell\/build">Build the shell’s layouts first<\/a>\./);
  assert.doesNotMatch(work, /Start a build session/);
  const early = await post(`/f/${fid}/d/workspace/builds`, { group: '/work' });
  assert.equal(early.status, 409);
  assert.match(await early.text(), /These pages render in the shell’s “workspace” layout, which the app hasn’t got yet\. Build the shell’s layouts first/);

  // The shell's Build page has its Layouts group: the layouts, not the partials.
  const shellBuild = await (await get(`/f/${fid}/d/shell/build`)).text();
  assert.match(shellBuild, /<h2>The shell’s layouts <span class="pill">To build<\/span><\/h2>/);
  assert.match(shellBuild, /<code>layouts\/app\.eta<\/code>[\s\S]*<code>layouts\/workspace\.eta<\/code>/);
  assert.doesNotMatch(shellBuild, /layouts\/_regions\.eta/);

  runner.turns.length = 0;
  const started = await post(`/f/${fid}/d/shell/builds`, { group: '@layouts' });
  assert.equal(started.status, 303, await started.text());
  const [, wid, sid] = location(started).match(/^\/f\/([0-9a-f]+)\/d\/shell\/sessions\/(.+)$/);
  const shell = worktreeOf(repo, 'prelude/shell');
  const shellDir = join(shell, 'prelude', 'shell');
  await until(() => runner.turns.length >= 1);
  const turn = runner.turns.at(-1);
  assert.equal(turn.prompt, 'Build the shell’s layouts.');
  assert.equal(turn.mode, 'build');
  assert.match(turn.systemPrompt, /You are building the app shell's layouts into this repository's app, in server\//);
  assert.match(turn.systemPrompt, /  - app: prelude\/shell\/layouts\/app\.eta[\s\S]*  - workspace: prelude\/shell\/layouts\/workspace\.eta/);
  assert.match(turn.systemPrompt, /keeping what the app's pages rely on: every region they target/);
  await settled(shellDir, sid);

  // The build's work (by hand): the layouts are the app's, and linked.
  write(shell, 'server/views/layout.eta', '<html><body class="designed"><%~ it.body %></body></html>');
  write(shell, 'server/views/workspace.eta', '<html><body class="fill"><main id="main"><%~ it.body %></main><aside id="drawer" ko-region></aside></body></html>');
  write(shell, 'prelude/shell/layouts.json', { app: '@app/server/views/layout', workspace: '@app/server/views/workspace' });
  await post(`/f/${wid}/d/shell/sessions/${sid}/messages`, { message: 'Ported' });
  await settled(shellDir, sid, 2);
  assert.doesNotMatch(await (await get(`/f/${wid}/d/shell/build`)).text(), /The shell’s layouts/, 'built: every layout is the app’s');
  assert.equal(existsSync(join(shellDir, 'layouts', 'workspace.eta')), false, 'the shell’s copy goes');

  // On the shell's branch the feature's page no longer waits, and its brief names the layout.
  const { createBranches } = await import('../server/branches.js');
  const entry = createBranches({ home }).forDesign(fid, 'shell');
  assert.equal(entry.building, null, 'the Layouts build is done');
  const { layoutsBuildPrompt, buildPrompt } = await import('../server/agent.js');
  assert.ok(layoutsBuildPrompt);
  assert.match(buildPrompt({ title: 'Workspace', designPath: 'prelude/workspace', group: { title: 'Work', routes: [], posts: [], rules: [] }, layouts: [{ name: 'workspace', file: 'server/views/workspace' }], branch: 'prelude/workspace' }),
    /Its pages render in the app's "workspace" layout \(server\/views\/workspace\): a page's markup sits in that layout's main region, and its overlays land in the layout's regions/);
});

test('a new folder, not yet a repository: the app build makes it one, and the shell’s branch', async () => {
  // A folder someone just started designing in: no git, no stack recorded.
  const folderPath = canonical(mkdtempSync(join(tmpdir(), 'prelude-new-')));
  const fid = await open(folderPath);
  createDesign(folderPath, { title: 'Shell', kind: 'shell' });
  createDesign(folderPath, { title: 'Landing', kind: 'design' });
  assert.equal(appOf(folderPath).stack, null);

  const page = await (await get(`/f/${fid}`)).text();
  assert.match(page, /id="app"[\s\S]*It will be Node, Express, Eta and Koda\. There’s no app yet/);
  assert.match(page, /<form class="stack gap-3" action="\/f\/[0-9a-f]+\/app\/build" method="post" ko-target="app">[\s\S]*?<details class="disclosure">\s*<summary>Choose another stack<\/summary>/);
  assert.match(page, /Prelude makes the project a Git repository first, and commits it/);

  runner.turns.length = 0;
  const started = await post(`/f/${fid}/app/build`, { stack: 'ASP.NET Core MVC with Razor' });
  const [, , sid] = appBuildOf(started, folderPath, fid, 'shell');
  assert.equal(appOf(folderPath).stack, 'ASP.NET Core MVC with Razor');
  assert.equal(git(folderPath, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(git(folderPath, 'log', '-1', '--format=%s'), 'The designs so far (committed by Prelude)');
  assert.equal(git(folderPath, 'status', '--porcelain'), '', 'everything was committed');
  assert.equal(readFileSync(join(folderPath, '.gitignore'), 'utf8'), 'node_modules/\n');
  const shell = worktreeOf(folderPath, 'prelude/shell');
  await settled(join(shell, 'prelude', 'shell'), sid);
});

test('a folder inside another repository is left alone, and says why', async () => {
  const { repo } = await bareRepo();
  const inner = join(repo, 'designs');
  mkdirSync(inner);
  const fid = await open(inner);
  createDesign(inner, { title: 'Landing', kind: 'design' });
  const page = await (await get(`/f/${fid}`)).text();
  assert.match(page, /This project’s folder is inside another Git repository\. Open that repository as the project to build here/);
  assert.doesNotMatch(page, /Start the app build/);
});
