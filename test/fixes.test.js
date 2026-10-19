// Step 11: a fix - one problem in a project, outside any one design - on a
// branch of its own, with its own agent and a check over the designs it touches.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { fixPrompt, permissionArgs } from '../server/agent.js';
import { createDesign, findDesign, listDesigns } from '../server/designs.js';
import { createFix, findFix, listFixes } from '../server/fixes.js';
import { canonical, folderId } from '../server/folders.js';
import { createServer } from '../server/main.js';
import { readEntries } from '../server/sessions.js';
import { approve } from './approve.js';
import { createFakeRunner } from './fake-runner.js';

Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' });

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = canonical(mkdtempSync(join(tmpdir(), 'prelude-repo-')));
const fid = folderId(repo);
const runner = createFakeRunner();
let server;
let base;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (root, path, text) => {
  const file = join(root, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};
const until = async check => { for (let i = 0; i < 1200 && !(await check()); i++) await new Promise(r => setTimeout(r, 25)); };
const get = path => fetch(base + path, { redirect: 'manual' });
const post = (path, fields) => fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });
const worktreeOf = branch => canonical(git(repo, 'worktree', 'list').split('\n').find(line => line.includes(`[${branch}]`)).split(/\s+/)[0]);
const settled = (dir, sid, count = 1) => until(() => readEntries(dir, sid).filter(e => e.type === 'turn').length >= count
  && readEntries(dir, sid).filter(e => e.type === 'note' && /^Committed to/.test(e.text)).length >= count);

before(async () => {
  git(repo, 'init', '-q', '-b', 'main');
  createDesign(repo, { title: 'Borrowers' });
  write(repo, 'prelude/borrowers/routes.json', { '/borrowers': { view: 'list', title: 'Borrowers', data: '' } });
  write(repo, 'prelude/borrowers/views/list.eta', '<ul><% for (const b of it.borrowers) { %><li><%= b.name %></li><% } %></ul>');
  write(repo, 'prelude/borrowers/states/01-typical.json', { borrowers: [{ id: 1, name: 'Maria Delgado' }] });
  createDesign(repo, { title: 'Reports' });
  write(repo, 'prelude/reports/routes.json', { '/reports': { view: 'reports', title: 'Reports', data: '' } });
  write(repo, 'prelude/reports/views/reports.eta', '<h1>Reports</h1>');
  write(repo, 'prelude/reports/states/01-typical.json', {});
  createDesign(repo, { title: 'Settings' });
  write(repo, 'prelude/settings/routes.json', { '/settings': { view: 'settings', title: 'Settings', data: '' } });
  write(repo, 'prelude/settings/views/settings.eta', '<h1>Settings</h1>');
  write(repo, 'prelude/settings/states/01-typical.json', {});
  approve(repo);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Designs');

  server = createServer({ home, runner, tidyEvery: 0 });
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

test('a fix is a folder in prelude/fixes/, found as a design of kind fix but not listed with the designs', () => {
  const folder = mkdtempSync(join(tmpdir(), 'prelude-fixes-'));
  assert.deepEqual(createFix(folder, { title: '  ' }).errors, { title: 'Say what’s wrong, in a few words.' });
  const { fix, dir } = createFix(folder, { title: 'Rows are cut off' });
  assert.equal(fix.id, 'fixes/rows-are-cut-off');
  assert.equal(fix.kind, 'fix');
  assert.equal(JSON.parse(readFileSync(join(dir, 'fix.json'), 'utf8')).title, 'Rows are cut off');
  assert.match(readFileSync(join(dir, 'NOTES.md'), 'utf8'), /^# Fix: Rows are cut off/);
  assert.equal(createFix(folder, { title: 'Rows are cut off' }).fix.slug, 'rows-are-cut-off-2', 'a second with the same title');
  assert.deepEqual(listFixes(folder).map(f => f.slug).sort(), ['rows-are-cut-off', 'rows-are-cut-off-2']);
  assert.equal(findDesign(folder, ['fixes', 'rows-are-cut-off']).design.title, 'Rows are cut off');
  assert.equal(findFix(folder, ['fixes', 'nothing']), null);
  assert.deepEqual(listDesigns(folder), [], 'a fix isn’t a design');
});

test('a fix’s agent may write the app and every design, but no one’s sessions, approved screens or .git', () => {
  const args = permissionArgs('prelude/fixes/rows', [], 'fix');
  const allowed = args[args.indexOf('--allowedTools') + 1];
  const refused = args[args.indexOf('--disallowedTools') + 1];
  assert.equal(allowed, 'Edit(**),Write(**)');
  assert.match(refused, /Edit\(prelude\/\*\*\/sessions\/\*\*\)/);
  assert.match(refused, /Write\(prelude\/\*\*\/snapshots\/\*\*\)/);
  assert.match(refused, /Edit\(\.git\/\*\*\)/);
  const prompt = fixPrompt({ title: 'Rows', fixPath: 'prelude/fixes/rows', designs: [{ id: 'borrowers', title: 'Borrowers', kind: 'design' }], branch: 'prelude/fix-rows' });
  assert.match(prompt, /Find the cause, and say what it is in the chat, before changing anything/);
  assert.match(prompt, /The designs stay the specification/);
  assert.match(prompt, /Write prelude\/fixes\/rows\/NOTES\.md as you go/);
  assert.match(prompt, /- Borrowers \(prelude\/borrowers\)/);
});

test('Fix something: a fix on its own branch, its agent, a check across the designs it touched, and merged from the project page', async () => {
  const page = await (await get(`/f/${fid}`)).text();
  assert.ok(page.includes(`href="/f/${fid}/fixes/new" ko-target="modal?"`), 'Fix something, on the project page');
  const ask = await get(`/f/${fid}/fixes/new`);
  assert.equal(ask.status, 200);
  assert.match(await ask.text(), /Fix something/);

  const refused = await post(`/f/${fid}/fixes`, { title: '', message: '' });
  assert.equal(refused.status, 422);

  // The agent's turn waits while the test makes its changes, as the agent would.
  runner.queue([{ type: 'wait' }, { type: 'text', text: 'Fixed.' }]);
  const started = await post(`/f/${fid}/fixes`, { title: 'Names are shouted', message: 'Every name on the borrowers list should be quieter.' });
  assert.equal(started.status, 303, await started.text());
  const location = started.headers.get('location');
  const [, wid, sid] = location.match(/^\/f\/([0-9a-f]+)\/d\/fixes\/names-are-shouted\/sessions\/(.+)$/);
  assert.notEqual(wid, fid);
  const worktree = worktreeOf('prelude/fix-names-are-shouted');
  const fixDir = join(worktree, 'prelude', 'fixes', 'names-are-shouted');
  assert.ok(existsSync(join(fixDir, 'fix.json')));
  assert.ok(!existsSync(join(repo, 'prelude', 'fixes')), 'nothing written to the checkout');

  await until(() => runner.turns.length >= 1);
  const turn = runner.turns.at(-1);
  assert.equal(canonical(turn.cwd), worktree);
  assert.equal(turn.mode, 'fix');
  assert.deepEqual(turn.shared, []);
  assert.match(turn.systemPrompt, /You are fixing one problem in this project: "Names are shouted"/);
  assert.match(turn.systemPrompt, /on the branch prelude\/fix-names-are-shouted/);
  assert.equal(turn.prompt, 'Every name on the borrowers list should be quieter.');

  // One design changed on purpose, one broken by mistake, one left alone.
  write(worktree, 'prelude/borrowers/views/list.eta', '<ul><% for (const b of it.borrowers) { %><li class="quiet"><%= b.name %></li><% } %></ul>');
  write(worktree, 'prelude/borrowers/NOTES.md', 'Names are quieter (the fix "Names are shouted").');
  write(worktree, 'prelude/reports/views/reports.eta', '<h1><%= it.missing.title %></h1>');
  runner.release();
  await settled(fixDir, sid);

  const check = readEntries(fixDir, sid).find(e => e.type === 'check');
  assert.deepEqual(check.designs.map(d => d.title).sort(), ['Borrowers', 'Reports'], 'only the designs it touched');
  assert.equal(check.failures.length, 1);
  assert.match(check.failures[0].path, /^Reports \(prelude\/reports\): \/reports/);
  assert.equal(check.failures[0].url, `/f/${wid}/d/reports`);
  assert.deepEqual(check.differDesigns, [{ title: 'Borrowers', url: `/f/${wid}/d/borrowers`, count: 1 }], 'differences listed per design, for the person');
  assert.equal(check.told.length, 1, 'only what doesn’t render is told to the agent');
  assert.match(git(worktree, 'log', '-1', '--format=%s'), /^Names are shouted: Every name on the borrowers list/);

  // The fix's page: the chat, no design surface, the designs it changed, and its check.
  const session = await (await get(location)).text();
  assert.match(session, /<h1>Names are shouted<\/h1>/);
  assert.ok(session.includes(`<a href="/f/${wid}/d/borrowers">Borrowers</a>`), 'links to the designs it changed');
  assert.doesNotMatch(session, /<section id="design"/, 'no design surface');
  assert.match(session, /1 design has pages that differ from the approved screens/);
  assert.ok(session.includes(`<code>Reports (prelude/reports): /reports</code>`));
  assert.ok(session.includes(`<a href="/f/${wid}/d/reports">Open</a>`));

  // The next message tells the agent what doesn't render.
  runner.queue([{ type: 'text', text: 'Fixed the report too.' }]);
  write(worktree, 'prelude/reports/views/reports.eta', '<h1>Reports</h1>');
  const next = await post(`/f/${wid}/d/fixes/names-are-shouted/sessions/${sid}/messages`, { message: 'Carry on.' });
  assert.ok([200, 303].includes(next.status), String(next.status));
  await until(() => runner.turns.length >= 2);
  assert.match(runner.turns.at(-1).prompt, /\/reports/);
  await settled(fixDir, sid, 2);

  // In progress on the project page, then merged into main from there.
  const project = await (await get(`/f/${fid}`)).text();
  assert.match(project, /Names are shouted<span class="pill">Fix<\/span>/);
  assert.match(project, /<code>prelude\/fix-names-are-shouted<\/code>/);
  assert.ok(project.includes(`action="/f/${fid}/branches/${wid}/merge"`));
  const merged = await post(`/f/${fid}/branches/${wid}/merge`, {});
  assert.ok(merged.status < 400, String(merged.status));
  assert.ok(git(repo, 'ls-tree', '-r', '--name-only', 'main').split('\n').includes('prelude/fixes/names-are-shouted/fix.json'));
  assert.match(git(repo, 'show', 'main:prelude/borrowers/views/list.eta'), /class="quiet"/);
});
