// Step 10: stories of the increment - a design's branch compared with main,
// per group; only the change in a changed group's story; unchanged groups
// folded away; build sessions briefed from the change; built views brought
// back for a redesign; the current work in one place on the folder page.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { buildPrompt } from '../server/agent.js';
import { backlogOf, incrementStory } from '../server/backlog.js';
import { baselineOf, createBranches } from '../server/branches.js';
import { createDesign } from '../server/designs.js';
import { canonical, folderId } from '../server/folders.js';
import { incrementOf } from '../server/increment.js';
import { createServer } from '../server/main.js';
import { readEntries } from '../server/sessions.js';
import { createFakeRunner } from './fake-runner.js';

Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' });

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = canonical(mkdtempSync(join(tmpdir(), 'prelude-repo-')));
const fid = folderId(repo);
const runner = createFakeRunner();
let server;
let base;
let worktree;
let wid;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (root, path, text) => {
  const file = join(root, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};
const until = async check => { for (let i = 0; i < 1200 && !(await check()); i++) await new Promise(r => setTimeout(r, 25)); };
const get = path => fetch(base + path, { redirect: 'manual' });
const post = (path, fields) => fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });
const page = async path => (await fetch(base + path)).text();
const unescape = html => html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

before(async () => {
  // A built design on main: Loans (a list, a row, an edit form) and Reports.
  git(repo, 'init', '-q', '-b', 'main');
  createDesign(repo, { title: 'Loans' });
  write(repo, 'prelude/loans/routes.json', {
    '/loans': { view: '@app/app/views/loans/list', title: 'Loans', data: '' },
    '/loans/:id/row': { view: '@app/app/views/loans/_row', data: 'loans/:id' },
    'POST /loans/:id': { update: 'loans/:id', require: ['name'], form: '@app/app/views/loans/_edit', answer: { view: '@app/app/views/loans/_row', data: 'loans/:id' } },
    '/reports': { view: '@app/app/views/reports', title: 'Reports', data: '' },
  });
  write(repo, 'app/views/loans/list.eta', '<ul><% for (const l of it.loans) { %><%~ include("./_row", l) %><% } %></ul>');
  write(repo, 'app/views/loans/_row.eta', '<li><%= it.name %></li>');
  write(repo, 'app/views/loans/_edit.eta', '<form><input name="name" value="<%= it.name %>"></form>');
  write(repo, 'app/views/reports.eta', '<h1>Reports</h1>');
  write(repo, 'prelude/loans/states/01-typical.json', { loans: [{ id: 1, name: 'Harbor Street Bakery' }] });
  write(repo, 'prelude/loans/states/02-empty.json', { loans: [] });
  write(repo, 'prelude/loans/RULES.md', '# Rules: Loans\n\n- **R-abc.** Loans show newest first.\n  *shown-on: /loans*\n- **R-old.** Names are shown in full.\n  *shown-on: /loans*\n');
  write(repo, 'prelude/loans/snapshots/typical/loans.html', '<ul>\n<li>\nHarbor Street Bakery\n</li>\n</ul>\n');
  write(repo, 'prelude/prelude.json', { app: { stack: 'Node, Express, Eta and Koda', path: 'app' } });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Loans, built');

  server = createServer({ home, runner, tidyEvery: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const body = new FormData();
  body.append('path', repo);
  await fetch(`${base}/folders`, { method: 'POST', body, redirect: 'manual' });

  // A design session makes the design's branch; then the design changes on it.
  const started = await post(`/f/${fid}/d/loans/sessions`, { message: 'Add notes to loans' });
  wid = started.headers.get('location').match(/^\/f\/([0-9a-f]+)\//)[1];
  worktree = canonical(git(repo, 'worktree', 'list').split('\n').find(line => line.includes('[prelude/loans]')).split(/\s+/)[0]);
  const [, sid] = started.headers.get('location').match(/\/sessions\/(.+)$/);
  await until(() => readEntries(join(worktree, 'prelude', 'loans'), sid).some(e => e.type === 'note'));

  const table = JSON.parse(readFileSync(join(worktree, 'prelude', 'loans', 'routes.json'), 'utf8'));
  // A redesign of the built list: its view brought back into the design.
  table['/loans'] = { view: 'loans/list', title: 'Loans', data: '', from: '@app/app/views/loans/list' };
  table['/loans/:id/notes'] = { view: 'loans/_notes', title: 'Notes', data: 'loans/:id', over: '/loans', in: 'drawer' };
  table['POST /loans/:id/notes'] = { add: 'loans/:id/notes', require: ['body'], form: 'loans/_notes', answer: { view: 'loans/_notes', data: 'loans/:id' } };
  write(worktree, 'prelude/loans/routes.json', table);
  write(worktree, 'prelude/loans/views/loans/list.eta', '<ul class="redesigned"><% for (const l of it.loans) { %><li><a href="/loans/<%= l.id %>/notes"><%= l.name %></a></li><% } %></ul>');
  write(worktree, 'prelude/loans/views/loans/_notes.eta', '<section><% for (const n of it.notes) { %><p><%= n.body %></p><% } %></section>');
  write(worktree, 'prelude/loans/states/01-typical.json', { loans: [{ id: 1, name: 'Harbor Street Bakery', notes: [{ id: 1, body: 'Called the owner' }] }] });
  write(worktree, 'prelude/loans/states/02-empty.json', { loans: [] });
  write(worktree, 'prelude/loans/states/03-no-notes.json', { loans: [{ id: 1, name: 'Harbor Street Bakery', notes: [] }] });
  write(worktree, 'prelude/loans/RULES.md', '# Rules: Loans\n\n- **R-abc.** Loans show the newest first, then by name.\n  *shown-on: /loans*\n- ~~**R-old.** Names are shown in full.~~\n  *retired: long names wrap now*\n- **R-n0t.** A note says who wrote it.\n  *shown-on: /loans/:id/notes*\n  *proposed*\n');
  write(worktree, 'prelude/loans/snapshots/typical/loans.html', '<ul class="redesigned">\n<li>\n<a href="/loans/1/notes">\nHarbor Street Bakery\n</a>\n</li>\n</ul>\n');
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'Design notes');
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test('the increment: per group, only what the branch changes against main', () => {
  const change = incrementOf({ repo, base: baselineOf(repo, 'prelude/loans'), designId: 'loans', designDir: join(worktree, 'prelude', 'loans') });
  assert.equal(change.designNew, false);
  const loans = change.groups.get('/loans');
  assert.equal(loans.status, 'changed');
  assert.deepEqual(loans.newRoutes.map(r => r.pattern), ['/loans/:id/notes']);
  assert.deepEqual(loans.newPosts.map(p => p.pattern), ['/loans/:id/notes']);
  assert.deepEqual(loans.changedRoutes.map(c => [c.route.pattern, c.what]), [['/loans', ['its view is being redesigned (app/views/loans/list)']]]);
  assert.ok(loans.shape.some(s => s.pattern === '/loans' && s.gained.includes('loans[].notes')), 'its data gains notes');
  assert.deepEqual(loans.screens, [{ page: 'Loans', states: ['typical'] }]);
  assert.deepEqual(loans.rules.added.map(r => r.id), ['R-n0t']);
  assert.deepEqual(loans.rules.reworded.map(r => r.id), ['R-abc']);
  assert.deepEqual(loans.rules.retired.map(r => r.id), ['R-old']);
  assert.deepEqual(loans.statesNew, ['no-notes']);
  assert.ok(loans.states.includes('typical') && loans.states.includes('no-notes'));
  assert.equal(change.groups.get('/reports').status, 'unchanged', 'untouched on the branch');
});

test('a changed group’s story is the change alone; unchanged groups fold away', async () => {
  const view = await page(`/f/${wid}/d/loans/build`);  assert.match(view, /<h2>Loans <span class="pill">Changed<\/span><\/h2>/);
  assert.match(view, /<summary class="muted">Unchanged \(1\): built, and not changed on this branch<\/summary>\s*<ul class="build-routes"><li>Reports<\/li>/);
  assert.doesNotMatch(view, /<h2>Reports/, 'not shown as work');
  const story = unescape(view.match(/<textarea class="story"[^>]*>([\s\S]*?)<\/textarea>/)[1]);
  assert.match(story, /^# Loans: Loans \(change\)/);
  assert.match(story, /## New\n\n- \*\*Notes\*\*, in the `drawer` over `\/loans` at `\/loans\/:id\/notes`/);
  assert.match(story, /- Form `POST \/loans\/:id\/notes`: adds a record to `loans\/:id\/notes`/);
  assert.match(story, /- State \*\*No notes\*\*/);
  assert.match(story, /## Changed\n\n- `\/loans` \(Loans\): its view is being redesigned \(app\/views\/loans\/list\)\. Port it back over `app\/views\/loans\/list`\./);
  assert.match(story, /`\/loans`'s data gains [^\n]*`loans\[\]\.notes`/);
  assert.match(story, /- \*\*Loans\*\* looks different, in Typical\./);
  assert.match(story, /## Rules\n\n- New: \*\*R-n0t\.\*\* A note says who wrote it\.\n- Reworded: \*\*R-abc\.\*\*[^\n]*\n- Retired: \*\*R-old\.\*\*[^\n]*\(long names wrap now\)/);
  assert.match(story, /## Test cases\n\n(- \*\*[^\n]*\n)*- \*\*No notes\*\*/);
  assert.match(story, /The full design is in `prelude\/loans\/`\.$/);
  // Nothing about the existing page that didn't change.
  assert.doesNotMatch(story, /\/loans\/:id\/row/);
  assert.doesNotMatch(story, /POST \/loans\/:id`[^/]/);
  assert.doesNotMatch(story, /Reports/);
  assert.doesNotMatch(story, /Empty/, 'a state the change doesn’t show up in');
});

test('a build of a changed group is briefed from the change', () => {
  const change = incrementOf({ repo, base: baselineOf(repo, 'prelude/loans'), designId: 'loans', designDir: join(worktree, 'prelude', 'loans') }).groups.get('/loans');
  const prompt = buildPrompt({ title: 'Loans', designPath: 'prelude/loans', group: { title: 'Loans', routes: [], posts: [], rules: [] }, change, branch: 'prelude/loans' });
  assert.match(prompt, /"Loans" is already built: this session builds a change to it, and only that\. Everything not listed stays as it is\./);
  assert.match(prompt, /- \/loans\/:id\/notes \(Notes\), an overlay in "drawer" over \/loans: prelude\/loans\/views\/loans\/_notes \(new\)/);
  assert.match(prompt, /- \/loans \(Loans\): prelude\/loans\/views\/loans\/list, redesigned from app\/views\/loans\/list: port it back over that file, and remove the route's "from" \(changed: /);
  assert.match(prompt, /- POST \/loans\/:id\/notes: add loans\/:id\/notes, requiring body \(new\)/);
  assert.match(prompt, /- R-n0t: A note says who wrote it\./);
  assert.doesNotMatch(prompt, /\/loans\/:id\/row/, 'nothing that didn’t change');
});

test('the folder shows the current work in one place, with every story to copy', async () => {
  const folder = await page(`/f/${fid}`);
  assert.match(folder, /<h2>In progress<\/h2>[\s\S]*Loans[\s\S]*<a href="[^"]+\/build">Loans<\/a> <span class="muted">· to build · a change<\/span>/);
  assert.match(folder, /On <code>prelude\/loans<\/code>/);
  const all = unescape(folder.match(/<textarea class="story" ko-as="stories"[^>]*>([\s\S]*?)<\/textarea>/)[1]);
  assert.match(all, /^# Loans: Loans \(change\)/);
  const designs = folder.slice(folder.indexOf('<h2>Designs</h2>'));
  assert.doesNotMatch(designs.slice(0, designs.indexOf('</div>')), /prelude\/loans</, 'the plain list holds only designs without a branch');
});

test('a changed group is built once a build of it finishes, and due again after another design change', async () => {
  const branches = createBranches({ home });
  const entry = branches.forDesign(fid, 'loans');
  // The build's work (by hand): the redesign ported back, the new views in the app.
  write(worktree, 'app/views/loans/list.eta', '<ul class="redesigned"><% for (const l of it.loans) { %><li><a href="/loans/<%= l.id %>/notes"><%= l.name %></a></li><% } %></ul>');
  write(worktree, 'app/views/loans/_notes.eta', '<section><% for (const n of it.notes) { %><p><%= n.body %></p><% } %></section>');
  const table = JSON.parse(readFileSync(join(worktree, 'prelude', 'loans', 'routes.json'), 'utf8'));
  table['/loans'] = { view: '@app/app/views/loans/list', title: 'Loans', data: '' };
  table['/loans/:id/notes'].view = '@app/app/views/loans/_notes';
  table['POST /loans/:id/notes'].form = '@app/app/views/loans/_notes';
  table['POST /loans/:id/notes'].answer.view = '@app/app/views/loans/_notes';
  write(worktree, 'prelude/loans/routes.json', table);
  write(worktree, 'prelude/loans/RULES.md', readFileSync(join(worktree, 'prelude', 'loans', 'RULES.md'), 'utf8').replace('\n  *proposed*', ''));
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'Build the change');
  branches.markBuilt(entry, '/loans');

  const built = await page(`/f/${wid}/d/loans/build`);
  assert.match(built, /<h2>Loans <span class="pill">Changed<\/span> <span class="pill">Built<\/span><\/h2>/, 'still a change against main, now built');
  assert.doesNotMatch(built, /Start a build session/);

  write(worktree, 'prelude/loans/states/01-typical.json', { loans: [{ id: 1, name: 'Harbor Street Bakery', notes: [{ id: 1, body: 'Called the owner', author: 'Dana' }] }] });
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'Notes say who wrote them');
  const due = await page(`/f/${wid}/d/loans/build`);
  assert.doesNotMatch(due, /<span class="pill">Built<\/span>/, 'a design change after the build makes it due again');
  assert.match(due, /Start a build session/);
});

test('server events in the increment: new, changed and gone, by page and design-wide', () => {
  const small = canonical(mkdtempSync(join(tmpdir(), 'prelude-events-')));
  git(small, 'init', '-q', '-b', 'main');
  createDesign(small, { title: 'Home' });
  write(small, 'prelude/home/routes.json', { '/': { view: 'home', title: 'Home', data: '' } });
  write(small, 'prelude/home/views/home.eta', '<section ko-invoke="event:needs-changed"></section>');
  write(small, 'prelude/home/views/_notice.eta', '<p>Notice</p>');
  write(small, 'prelude/home/events.json', {
    'needs-changed': { title: 'Something needs you', send: 'needs-changed' },
    'old-notice': { title: 'An old notice', push: [{ into: 'main', view: 'home' }] },
    'wide-gone': { title: 'Wide and gone', send: 'wide-gone' },
  });
  git(small, 'add', '-A');
  git(small, 'commit', '-q', '-m', 'Home, with events');
  const baseline = git(small, 'rev-parse', 'HEAD');
  write(small, 'prelude/home/events.json', {
    'needs-changed': { title: 'Something needs you', add: 'needs', with: { summary: 'Review' }, send: 'needs-changed' },
    'new-notice': { title: 'A new notice', push: [{ into: 'main', view: 'home' }] },
    'wide-new': { title: 'Wide and new', send: 'wide-new' },
  });

  const designDir = join(small, 'prelude', 'home');
  const change = incrementOf({ repo: small, base: baseline, designId: 'home', designDir });
  const home = change.groups.get('/');
  assert.equal(home.status, 'changed', 'events alone make a page changed');
  assert.deepEqual(home.events.added.map(event => event.name), ['new-notice']);
  assert.deepEqual(home.events.changed.map(({ event, what }) => [event.name, what]), [['needs-changed', ['it now adds a record to needs']]]);
  assert.deepEqual(home.events.removed.map(event => event.name), ['old-notice'], 'gone, and placed by the views it pushed');
  assert.match(home.summary, /a new event, new-notice; the needs-changed event changes; the old-notice event goes/);
  assert.deepEqual(change.designWide.events.added.map(event => event.name), ['wide-new']);
  assert.deepEqual(change.designWide.events.removed.map(event => event.name), ['wide-gone']);

  const group = backlogOf(designDir).groups[0];
  const story = incrementStory({ design: { title: 'Home' }, designPath: 'prelude/home', group, change: home, designEvents: change.designWide.events });
  assert.match(story, /## Server events\n\n- New: When a new notice \(`new-notice`\), the server pushes `prelude\/home\/views\/home` into `main`/);
  assert.match(story, /- Changed \(it now adds a record to needs\): When something needs you \(`needs-changed`\), the server adds a record to `needs` and sends the `needs-changed` event/);
  assert.match(story, /- New: When wide and new \(`wide-new`\)/);
  assert.match(story, /- Gone: the server no longer sends `old-notice` \(An old notice\)\./);
  assert.match(story, /- Gone: the server no longer sends `wide-gone`/);

  const prompt = buildPrompt({ title: 'Home', designPath: 'prelude/home', group, change: home, branch: 'prelude/home' });
  assert.match(prompt, /- When a new notice \(`new-notice`\)[^\n]* \(new\)/);
  assert.match(prompt, /- When something needs you \(`needs-changed`\)[^\n]* \(changed: it now adds a record to needs\)/);
  assert.match(prompt, /- old-notice \(An old notice\) goes: stop sending it/);
});
