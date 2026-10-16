// Step 7: rules, the Build view and its stories, and build sessions on a
// branch of their own.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { buildPrompt, designPrompt, permissionArgs } from '../server/agent.js';
import { backlogOf, storyMarkdown } from '../server/backlog.js';
import { createDesign } from '../server/designs.js';
import { canonical, folderId } from '../server/folders.js';
import { listStates } from '../server/host.js';
import { createHosts } from '../server/hosts.js';
import { createServer } from '../server/main.js';
import { readEntries } from '../server/sessions.js';
import { parseRules, ruleWarnings } from '../server/rules.js';
import { createFakeRunner } from './fake-runner.js';

// Commits made in the test need an author, whatever this machine's git config says.
Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' });

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = canonical(mkdtempSync(join(tmpdir(), 'prelude-repo-')));
const fid = folderId(repo);
const runner = createFakeRunner();
const designDir = join(repo, 'prelude', 'borrowers');
let server;
let base;

// No file-system monitor daemons for these throwaway repositories (see builds.js).
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (root, path, text) => {
  const file = join(root, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
};
const until = async check => { for (let i = 0; i < 1200 && !(await check()); i++) await new Promise(r => setTimeout(r, 25)); };   // 30s: git and the check are slow under a full run
const get = path => fetch(base + path, { redirect: 'manual' });
const post = (path, fields) => fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });

const RULES = `# Rules: Borrowers

- **R-k3f.** Only an underwriter sees a borrower's credit score.
  *shown-on: /borrowers/:id/edit @ underwriter*
  *proposed*
- **R-q8m.** Changing a borrower's email sends them a confirmation.
  *proposed*
- **R-z1x.** The list is in name order.
  *shown-on: /borrowers*
- ~~**R-2wd.** Old wording.~~
  *retired: replaced by R-z1x*
- **R-p0p.** Shown somewhere that isn't there.
  *shown-on: /nowhere @ nobody*
`;

before(async () => {
  git(repo, 'init', '-q', '-b', 'main');
  createDesign(repo, { title: 'Borrowers' });
  write(repo, 'prelude/borrowers/routes.json', {
    '/borrowers': { view: 'borrowers/list', title: 'Borrowers', data: '' },
    '/borrowers/:id/row': { view: 'borrowers/_row', data: 'borrowers/:id' },
    '/borrowers/:id/edit': { view: 'borrowers/_edit', title: 'Edit borrower', data: 'borrowers/:id', over: '/borrowers', in: 'drawer' },
    'POST /borrowers/:id': { update: 'borrowers/:id', require: ['name', 'email'], form: 'borrowers/_edit', answer: { view: 'borrowers/_row', data: 'borrowers/:id', also: [{ into: 'drawer?' }] } },
    '/reports': { view: 'reports', title: 'Reports', data: '' },
  });
  write(repo, 'prelude/borrowers/views/borrowers/list.eta', '<ul><% for (const b of it.borrowers) { %><%~ include("./_row", b) %><% } %></ul>');
  write(repo, 'prelude/borrowers/views/borrowers/_row.eta', '<li><%= it.name %></li>');
  write(repo, 'prelude/borrowers/views/borrowers/_edit.eta', '<form><input name="name" value="<%= it.name %>"></form>');
  write(repo, 'prelude/borrowers/views/reports.eta', '<h1>Reports</h1>');
  write(repo, 'prelude/borrowers/states/01-typical.json', { borrowers: [{ id: 1, name: 'Maria Delgado', email: 'maria@example.com' }] });
  write(repo, 'prelude/borrowers/states/02-underwriter.json', { borrowers: [{ id: 1, name: 'Maria Delgado', email: 'maria@example.com' }] });
  write(repo, 'prelude/borrowers/RULES.md', RULES);
  // The app exists (step 8): features are built into app/.
  write(repo, 'prelude/prelude.json', { app: { stack: 'Node, Express, Eta and Koda', path: 'app' } });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Design borrowers');

  server = createServer({ home, runner });
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

test('RULES.md: ids, text, markers, where each is shown, and warnings for what points at nothing', () => {
  const rules = parseRules(RULES);
  assert.deepEqual(rules.map(rule => rule.id), ['R-k3f', 'R-q8m', 'R-z1x', 'R-2wd', 'R-p0p']);
  assert.deepEqual(rules[0], { id: 'R-k3f', text: 'Only an underwriter sees a borrower\'s credit score.', proposed: true, retired: false, shownOn: [{ route: '/borrowers/:id/edit', state: 'underwriter' }], note: null });
  assert.equal(rules[2].proposed, false, 'no marker: built');
  assert.equal(rules[3].retired, true);
  assert.equal(rules[3].note, 'replaced by R-z1x');

  const warnings = ruleWarnings(rules, { routes: ['/borrowers', '/borrowers/:id/edit'], states: listStates(designDir) }).map(w => w.warning);
  assert.deepEqual(warnings, [
    'R-p0p is shown on /nowhere, which isn\'t a route of this design.',
    'R-p0p is shown in the "nobody" state, which this design doesn\'t have.',
  ]);
});

test('the design agent is told how to write rules; the system and shell aren’t', () => {
  const prompt = designPrompt({ title: 'Borrowers', designPath: 'prelude/borrowers', format: 'views' });
  assert.match(prompt, /prelude\/borrowers\/RULES\.md holds the design's rules/);
  assert.match(prompt, /R- and three random lowercase letters and digits, never a sequence/);
  assert.match(prompt, /Write every new rule as \*proposed\*/);
  assert.doesNotMatch(designPrompt({ title: 'Shell', designPath: 'prelude/shell', format: 'views', kind: 'shell' }), /RULES\.md/);
});

test('what’s left to build, by page: overlays, fragments and forms with their page, rules where they’re shown', () => {
  const { groups, designWide } = backlogOf(designDir);
  assert.deepEqual(groups.map(g => [g.title, g.slug, g.built]), [['Borrowers', 'borrowers', false], ['Reports', 'reports', false]]);
  const [borrowers] = groups;
  assert.deepEqual(borrowers.routes.map(r => r.pattern), ['/borrowers', '/borrowers/:id/row', '/borrowers/:id/edit']);
  assert.deepEqual(borrowers.posts.map(p => p.pattern), ['/borrowers/:id']);
  assert.deepEqual(borrowers.rules.map(r => r.id), ['R-k3f', 'R-z1x']);
  assert.deepEqual(designWide.map(r => r.id), ['R-q8m', 'R-p0p'], 'no shown-on, or shown nowhere real: design-wide');

  const story = storyMarkdown({ design: { title: 'Borrowers' }, designPath: 'prelude/borrowers', group: borrowers, designWide, states: listStates(designDir) });
  assert.match(story, /^# Borrowers: Borrowers\n/);
  assert.match(story, /- \*\*Edit borrower\*\*, in the `drawer` over `\/borrowers` at `\/borrowers\/:id\/edit` \(`prelude\/borrowers\/views\/borrowers\/_edit`\)/);
  assert.match(story, /- `POST \/borrowers\/:id` refuses an empty `name` or `email`: it answers 422 with `prelude\/borrowers\/views\/borrowers\/_edit` showing what was typed/);
  assert.match(story, /then answers with `prelude\/borrowers\/views\/borrowers\/_row` for `borrowers\/:id` and closes the `drawer`\./);
  assert.match(story, /- \*\*R-k3f\.\*\* Only an underwriter sees a borrower's credit score\. \(shown on `\/borrowers\/:id\/edit` in underwriter\)/);
  assert.match(story, /- \*\*R-z1x\.\*\* The list is in name order\. \(shown on `\/borrowers`\) \(already built\)/);
  assert.match(story, /## Test cases[\s\S]*- \*\*Typical\*\* \(`01-typical\.json`\)\n- \*\*Underwriter\*\* \(`02-underwriter\.json`\)/);
});

test('the Build view lists the groups, each copied as a story, with a build session to start', async () => {
  const page = await (await get(`/f/${fid}/d/borrowers/build`)).text();
  assert.match(page, /<h2>Borrowers <span class="pill">To build<\/span><\/h2>/);
  assert.match(page, /<h2>Reports <span class="pill">To build<\/span><\/h2>/);
  assert.match(page, /<textarea class="story"[^>]*># Borrowers: Borrowers/);
  assert.match(page, /Start a build session/);
  assert.match(page, /Design-wide rules/);
  const session = await (await get(`/f/${fid}/d/borrowers/sessions/new`)).text();
  assert.match(session, /href="\/f\/[0-9a-f]+\/d\/borrowers\/build">Build<\/a>/);
});

test('a build session: a branch and worktree, its own instructions and permissions, each turn committed', async () => {
  const started = await post(`/f/${fid}/d/borrowers/builds`, { group: '/borrowers' });
  assert.equal(started.status, 303, await started.text());
  const location = started.headers.get('location');
  const [, wid, sid] = location.match(/^\/f\/([0-9a-f]+)\/d\/borrowers\/sessions\/(.+)$/);
  assert.notEqual(wid, fid, 'the worktree is a folder of its own');

  const branches = git(repo, 'branch', '--list', 'build/*');
  assert.match(branches, /build\/borrowers-borrowers/);
  const worktree = git(repo, 'worktree', 'list').split('\n').find(line => line.includes('build/borrowers-borrowers')).split(/\s+/)[0];
  const workDir = join(worktree, 'prelude', 'borrowers');

  await until(() => runner.turns.length >= 1);
  const turn = runner.turns.at(-1);
  assert.equal(canonical(turn.cwd), canonical(worktree));
  assert.equal(turn.mode, 'build');
  assert.match(turn.systemPrompt, /You are building part of a design into this repository's app: "Borrowers" of the design "Borrowers"/);
  assert.match(turn.systemPrompt, /on the branch build\/borrowers-borrowers/);
  assert.match(turn.systemPrompt, /- \/borrowers\/:id\/edit \(Edit borrower\), an overlay in "drawer" over \/borrowers: prelude\/borrowers\/views\/borrowers\/_edit/);
  assert.match(turn.systemPrompt, /- POST \/borrowers\/:id: update borrowers\/:id, requiring name, email/);
  assert.match(turn.systemPrompt, /- R-k3f: Only an underwriter sees/);
  assert.doesNotMatch(turn.systemPrompt, /R-z1x/, 'only proposed rules are to be made true');
  assert.equal(turn.prompt, 'Build Borrowers.');

  // The first turn is committed to the branch, transcript and all.
  await until(() => readEntries(workDir, sid).some(e => e.type === 'note'));
  const note = readEntries(workDir, sid).find(e => e.type === 'note');
  assert.match(note.text, /^Committed to build\/borrowers-borrowers \([0-9a-f]+\)\.$/);
  assert.match(git(worktree, 'log', '-1', '--format=%s'), /^Borrowers: Build Borrowers\.$/);
  assert.match(git(worktree, 'show', '--stat', '--format=', 'HEAD'), /prelude\/borrowers\/sessions\//);
  assert.equal(git(repo, 'log', '-1', '--format=%s', 'main'), 'Design borrowers', 'main is untouched');

  const session = await (await get(location)).text();
  assert.match(session, /A build session, on the branch <code>build\/borrowers-borrowers<\/code>/);
  assert.match(session, /Committed to build\/borrowers-borrowers/);

  // The agent ports everything (here, by hand): the design's copies of the views go.
  write(worktree, 'app/views/borrowers/list.eta', '<ul><% for (const b of it.borrowers) { %><%~ include("./_row", b) %><% } %></ul>');
  write(worktree, 'app/views/borrowers/_row.eta', '<li><%= it.name %></li>');
  write(worktree, 'app/views/borrowers/_edit.eta', '<form><input name="name" value="<%= it.name %>"></form>');
  write(worktree, 'app/views/reports.eta', '<h1>Reports</h1>');
  const table = JSON.parse(readFileSync(join(workDir, 'routes.json'), 'utf8'));
  for (const route of Object.values(table)) {
    for (const key of ['view', 'form']) if (route[key]) route[key] = `@app/app/views/${route[key]}`;
    if (route.answer?.view) route.answer.view = `@app/app/views/${route.answer.view}`;
  }
  write(worktree, 'prelude/borrowers/routes.json', table);
  await post(`/f/${wid}/d/borrowers/sessions/${sid}/messages`, { message: 'Ported' });
  await until(() => readEntries(workDir, sid).filter(e => e.type === 'note').length === 2);
  const check = readEntries(workDir, sid).filter(e => e.type === 'check').at(-1);
  assert.deepEqual(check.failures, []);
  assert.deepEqual(check.warnings, ['R-p0p is shown on /nowhere, which isn\'t a route of this design.', 'R-p0p is shown in the "nobody" state, which this design doesn\'t have.']);
  assert.equal(existsSync(join(workDir, 'views')), false, 'every route is the app’s now, so the design’s copies are gone');
  assert.match(git(worktree, 'show', '--stat', '--no-renames', '--format=', 'HEAD'), /app\/views\/borrowers\/list\.eta/);
  assert.match(git(worktree, 'status', '--porcelain'), /^M prelude\/borrowers\/sessions\/[^\n]+\/transcript\.jsonl$/, 'only the last note is left to commit');

  // The Build view shows the build, and the group as built on its branch.
  const view = await (await get(`/f/${fid}/d/borrowers/build`)).text();
  assert.match(view, /Build sessions[\s\S]*branch <code>build\/borrowers-borrowers<\/code>/);
  const onBranch = await (await get(`/f/${wid}/d/borrowers/build`)).text();
  assert.doesNotMatch(onBranch, /Start a build session/, 'no builds from a build');
});

test('a build commits the design first, so its branch starts from it as it is now', async () => {
  write(repo, 'prelude/borrowers/NOTES.md', 'Uncommitted.');
  write(repo, 'scratch.txt', 'someone else’s work in progress');
  const started = await post(`/f/${fid}/d/borrowers/builds`, { group: '/reports' });
  assert.equal(started.status, 303, await started.text());
  assert.equal(git(repo, 'log', '-1', '--format=%s', 'main'), 'Borrowers, before building Reports (committed by Prelude)');
  assert.match(git(repo, 'show', '--stat', '--format=', 'main'), /prelude\/borrowers\/NOTES\.md/);
  assert.match(git(repo, 'status', '--porcelain'), /\?\? scratch\.txt/, 'only the design is committed, nothing else');
  // Let the build's first turn finish (its check and commit) before the server closes.
  const [, sid] = started.headers.get('location').match(/\/sessions\/(.+)$/);
  const worktree = canonical(git(repo, 'worktree', 'list').split('\n').find(line => line.includes('build/borrowers-reports')).split(/\s+/)[0]);
  await until(() => readEntries(join(worktree, 'prelude', 'borrowers'), sid).some(e => e.type === 'note'));
});

test('a build agent writes the app, but not the design it builds from', () => {
  const args = permissionArgs('prelude/borrowers', [], 'build');
  const allowed = args[args.indexOf('--allowedTools') + 1];
  const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
  assert.equal(allowed, 'Edit(**),Write(**)');
  for (const kept of ['prelude/borrowers/views/**', 'prelude/borrowers/states/**', 'prelude/borrowers/snapshots/**', 'prelude/borrowers/sessions/**', '.git/**']) {
    assert.ok(denied.includes(`Edit(${kept})`) && denied.includes(`Write(${kept})`), kept);
  }
  assert.equal(permissionArgs('prelude/borrowers')[permissionArgs('prelude/borrowers').indexOf('--allowedTools') + 1], 'Edit(prelude/borrowers/**),Write(prelude/borrowers/**)');
  const prompt = buildPrompt({ title: 'X', designPath: 'prelude/x', group: { title: 'X', routes: [], posts: [], rules: [] }, branch: 'build/x', stack: { ext: '.cshtml', guide: 'prelude/HOST.md' } });
  assert.match(prompt, /Read prelude\/HOST\.md/);
  assert.match(prompt, /Never change the design's views, states, approved screens/);
});

test('a build’s worktree has the folder’s host approval', () => {
  const hosts = createHosts({ home: mkdtempSync(join(tmpdir(), 'prelude-approvals-')) });
  const config = { fingerprint: 'abc' };
  hosts.approve({ id: 'parent' }, config);
  assert.equal(hosts.approved({ id: 'worktree', build: { parentId: 'parent' } }, config), true);
  assert.equal(hosts.approved({ id: 'other' }, config), false);
});
