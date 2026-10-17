// Step 7: rules, the Build view and its stories, and build sessions on a
// branch of their own.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { listSessions, readEntries, readSession } from '../server/sessions.js';
import { parseRules, ruleWarnings } from '../server/rules.js';
import { render } from '../server/views.js';
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

// No file-system monitor daemons for these throwaway repositories (see branches.js).
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
  // A design system, which a feature may change on its branch (step 9).
  createDesign(repo, { title: 'Tokens', kind: 'system' });
  write(repo, 'prelude/tokens/system/tokens.css', ':root { --accent: teal; }');
  // The app exists (step 8): features are built into app/.
  write(repo, 'prelude/prelude.json', { app: { stack: 'Node, Express, Eta and Koda', path: 'app' } });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Design borrowers');

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
  const shell = designPrompt({ title: 'Shell', designPath: 'prelude/shell', format: 'views', kind: 'shell' });
  assert.doesNotMatch(shell, /RULES\.md/);
  assert.match(shell, /The layout's own parts[^.]*are real, rendered from the layout's sample data/);
  assert.match(shell, /What a design will put in a region[^.]*is skeleton content: grey bars and blocks in the shape of a typical page/, 'the gallery shows which part is the layout');
  assert.match(shell, /Keep the gallery's views in prelude\/shell\/views\/gallery\/\. A page the shell itself owns[^.]*\(Settings, say/, 'a shell’s own pages are built; its gallery isn’t');
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

const worktreeOf = branch => canonical(git(repo, 'worktree', 'list').split('\n').find(line => line.includes(`[${branch}]`)).split(/\s+/)[0]);
const settled = (designDir, sid, count = 1) => until(() => readEntries(designDir, sid).filter(e => e.type === 'turn').length >= count
  && readEntries(designDir, sid).filter(e => e.type === 'note' && /^Committed to/.test(e.text)).length >= count);

test('the Build view lists the groups, each copied as a story, with a build session to start', async () => {
  const page = await (await get(`/f/${fid}/d/borrowers/build`)).text();
  assert.match(page, /<h2>Borrowers <span class="pill">To build<\/span><\/h2>/);
  assert.match(page, /<h2>Reports <span class="pill">To build<\/span><\/h2>/);
  assert.match(page, /<textarea class="story"[^>]*># Borrowers: Borrowers/);
  assert.match(page, /Start a build session/, 'a design with no branch yet can start one: starting makes its branch');
  assert.match(page, /Design-wide rules/);
  const session = await (await get(`/f/${fid}/d/borrowers/sessions/new`)).text();
  assert.match(session, /href="\/f\/[0-9a-f]+\/d\/borrowers\/build"><span class="icon icon-code" aria-hidden="true"><\/span>Build<\/a>/);
});

let wid;
let workDir;
let worktree;

test('a build works on the design’s own branch: a build session, its own instructions, each turn committed', async () => {
  // Anything designed in the checkout before branches is committed on main first.
  write(repo, 'prelude/borrowers/NOTES.md', 'Designed before branches.');
  const started = await post(`/f/${fid}/d/borrowers/builds`, { group: '/borrowers' });
  assert.equal(started.status, 303, await started.text());
  const location = started.headers.get('location');
  const match = location.match(/^\/f\/([0-9a-f]+)\/d\/borrowers\/sessions\/(.+)$/);
  wid = match[1];
  const sid = match[2];
  assert.notEqual(wid, fid, 'the worktree is a folder of its own');
  assert.equal(git(repo, 'log', '-1', '--format=%s', 'main'), 'Borrowers, as designed so far (committed by Prelude)');
  worktree = worktreeOf('prelude/borrowers');
  workDir = join(worktree, 'prelude', 'borrowers');
  assert.deepEqual(readSession(workDir, sid).build, { group: '/borrowers', title: 'Borrowers' });

  await until(() => runner.turns.length >= 1);
  const turn = runner.turns.at(-1);
  assert.equal(canonical(turn.cwd), worktree);
  assert.equal(turn.mode, 'build');
  assert.match(turn.systemPrompt, /You are building part of a design into this repository's app: "Borrowers" of the design "Borrowers"/);
  assert.match(turn.systemPrompt, /on the branch prelude\/borrowers/);
  assert.match(turn.systemPrompt, /- POST \/borrowers\/:id: update borrowers\/:id, requiring name, email/);
  assert.match(turn.systemPrompt, /- R-k3f: Only an underwriter sees/);
  assert.doesNotMatch(turn.systemPrompt, /R-z1x/, 'only proposed rules are to be made true');
  assert.equal(turn.prompt, 'Build Borrowers.');

  await settled(workDir, sid);
  assert.match(git(worktree, 'log', '-1', '--format=%s'), /^Borrowers: Build Borrowers\.$/);
  // What's next (10.7): the group isn't built yet, so carry on. No design host, so no app line.
  await until(() => readEntries(workDir, sid).some(e => e.type === 'next'));
  const next = readEntries(workDir, sid).find(e => e.type === 'next');
  assert.equal(next.built, false);
  assert.equal(next.app, null);
  assert.equal(next.firstPorted, false);
  assert.match(git(worktree, 'show', '--stat', '--format=', 'HEAD'), /prelude\/borrowers\/sessions\//);

  // Groups are built one at a time.
  const second = await post(`/f/${wid}/d/borrowers/builds`, { group: '/reports' });
  assert.equal(second.status, 409);
  assert.match(await second.text(), /This design is building Borrowers now\. Groups are built one at a time\./);
  const view = await (await get(`/f/${wid}/d/borrowers/build`)).text();
  assert.match(view, /Building <strong>Borrowers<\/strong> on this design’s branch, in <a href="\/f\/[0-9a-f]+\/d\/borrowers\/sessions\/[^"]+">Build: Borrowers<\/a>/);
  // Its build session is easy to get back to: from its group, the sessions menu, and In progress.
  assert.ok(view.includes(`Build session: <a href="/f/${wid}/d/borrowers/sessions/${sid}">Build: Borrowers</a>`));
  assert.equal(view.match(/Build session: /g).length, 1, 'only the group that has one');
  const folderPage = await (await get(`/f/${fid}`)).text();
  assert.ok(folderPage.includes(`<a href="/f/${wid}/d/borrowers/sessions/${sid}">build session</a>`));

  const session = await (await get(location)).text();
  assert.match(session, /<span class="item-title">Build: Borrowers <span class="pill">Build<\/span><\/span>/);
  assert.match(session, /A build session: it builds Borrowers into the app, on this design’s branch/);
  assert.match(session, /On <code>prelude\/borrowers<\/code>\s*· building Borrowers/);
  assert.match(session, /Merge into main/, 'no remote: finished by merging here');
});

test('a design session on the branch may change the design system; the change travels with the design, and shows', async () => {
  runner.turns.length = 0;
  const started = await post(`/f/${wid}/d/borrowers/sessions`, { message: 'Add a badge colour to the system' });
  assert.equal(started.status, 303);
  const [, sid] = started.headers.get('location').match(/\/sessions\/(.+)$/);
  await until(() => runner.turns.length >= 1);
  const turn = runner.turns.at(-1);
  assert.equal(turn.mode, 'design');
  assert.deepEqual(turn.shared, ['prelude/tokens'], 'it may write the design system');
  assert.match(turn.systemPrompt, /This design works on a branch of its own, and may change the design system \(prelude\/tokens\/\)/);
  // The agent's change (by hand), committed with the turn.
  write(worktree, 'prelude/tokens/system/tokens.css', ':root { --accent: teal; --badge: gold; }');
  await settled(workDir, sid);
  const folder = await (await get(`/f/${fid}`)).text();
  assert.match(folder, /Also changes, outside the design: <code>prelude\/tokens\/system\/tokens\.css<\/code>/);
});

test('a build ports the views; the design’s copies go, and the build is done', async () => {
  // The build agent's work (by hand): the views move into the app.
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
  write(worktree, 'prelude/borrowers/RULES.md', readFileSync(join(workDir, 'RULES.md'), 'utf8').replace(/\n  \*proposed\*/g, ''));
  const buildSession = listSessions(workDir).find(session => session.build);
  await post(`/f/${wid}/d/borrowers/sessions/${buildSession.id}/messages`, { message: 'Ported' });
  await settled(workDir, buildSession.id, 2);
  const check = readEntries(workDir, buildSession.id).filter(e => e.type === 'check').at(-1);
  assert.deepEqual(check.failures, []);
  assert.equal(existsSync(join(workDir, 'views')), false, 'every route is the app’s now, so the design’s copies are gone');
  assert.match(git(worktree, 'show', '--stat', '--no-renames', '--format=', 'HEAD'), /app\/views\/borrowers\/list\.eta/);
  const view = await (await get(`/f/${wid}/d/borrowers/build`)).text();
  assert.doesNotMatch(view, /Building <strong>/, 'the group is built, so the branch is free for the next');
  // What's next (10.7): built and checked, so finish the branch; the design window shows the app's views now.
  const next = readEntries(workDir, buildSession.id).filter(e => e.type === 'next').at(-1);
  assert.equal(next.built, true);
  assert.equal(next.checked, true);
  assert.equal(next.firstPorted, true);
  assert.deepEqual(next.finish, { url: `/f/${fid}`, label: 'Merge into main' });
  const session = await (await get(`/f/${wid}/d/borrowers/sessions/${buildSession.id}`)).text();
  assert.match(session, /The design window now shows the app’s own views/);
  assert.match(session, /<strong>Next:<\/strong>\s*When you’re happy with it,\s*finish the branch on <a href="\/f\/[0-9a-f]+">the project page<\/a>: Merge into main\./);
  assert.match(session, /· the app’s own view/, 'the page menu says so too');
});

test('a merge git refuses changes nothing, and says why beside the branch’s buttons', async () => {
  // An untracked file in the checkout where the branch adds one: git won't overwrite it.
  write(repo, 'app/views/reports.eta', 'mine');
  // The worktree opened as a plain folder too (as a step 8 build's was): it's still the branch.
  const body = new FormData();
  body.append('path', worktree);
  await fetch(`${base}/folders`, { method: 'POST', body, redirect: 'manual' });
  const main = git(repo, 'rev-parse', 'main');
  const refused = await post(`/f/${fid}/branches/${wid}/merge`, { back: `/f/${fid}` });
  assert.equal(refused.status, 409);
  const page = await refused.text();
  assert.match(page, /<div class="branch">[\s\S]*?<p class="err" role="alert">git couldn’t merge prelude\/borrowers into main, so nothing changed: [^<]*app\/views\/reports\.eta[^<]*<\/p>\s*<div class="rowbtns">/);
  assert.equal(git(repo, 'rev-parse', 'main'), main, 'main is where it was');
  assert.equal(readFileSync(join(repo, 'app', 'views', 'reports.eta'), 'utf8'), 'mine');
  rmSync(join(repo, 'app'), { recursive: true });
});

test('an update from main that clashes is left for the agent to resolve, then committed; or abandoned', async () => {
  // Main changes a file the branch also made.
  write(repo, 'app/views/reports.eta', '<h1>Reports, from main</h1>');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Reports on main');
  const branchTip = git(worktree, 'rev-parse', 'HEAD');
  const clashed = () => post(`/f/${fid}/branches/${wid}/update`, { back: `/f/${fid}` });

  // Abandoned: the branch is as it was.
  assert.equal((await clashed()).status, 303);
  assert.match(readFileSync(join(worktree, 'app', 'views', 'reports.eta'), 'utf8'), /^<<<<<<< /m, 'left with git’s markers');
  const folder = await (await get(`/f/${fid}`)).text();
  assert.match(folder, /main is half brought in\. This file clashes: <code>app\/views\/reports\.eta<\/code>\./);
  assert.match(folder, new RegExp(`action="/f/${fid}/branches/${wid}/abandon"`));
  assert.doesNotMatch(folder, new RegExp(`action="/f/${fid}/branches/${wid}/merge"`), 'no merging into main meanwhile');
  const refused = await post(`/f/${fid}/branches/${wid}/merge`, { back: `/f/${fid}` });
  assert.equal(refused.status, 409);
  assert.equal((await post(`/f/${fid}/branches/${wid}/abandon`, { back: `/f/${fid}` })).status, 303);
  assert.equal(git(worktree, 'rev-parse', 'HEAD'), branchTip);
  assert.equal(readFileSync(join(worktree, 'app', 'views', 'reports.eta'), 'utf8'), '<h1>Reports</h1>');

  // Resolved by the agent: told with the next message, committed once no marker is left.
  await clashed();
  const session = listSessions(workDir)[0];
  const turnsBefore = readEntries(workDir, session.id).filter(e => e.type === 'turn').length;
  runner.turns.length = 0;
  await post(`/f/${wid}/d/borrowers/sessions/${session.id}/messages`, { message: 'Carry on' });
  await until(() => readEntries(workDir, session.id).filter(e => e.type === 'turn').length > turnsBefore && readEntries(workDir, session.id).some(e => e.type === 'note' && /still half brought in/.test(e.text)));
  assert.match(runner.turns.at(-1).prompt, /^\(From Prelude, not the person: main is half brought into this branch, and these files clash: app\/views\/reports\.eta\./);
  assert.ok(git(worktree, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'), 'the fake agent changed nothing, so nothing was committed');

  write(worktree, 'app/views/reports.eta', '<h1>Reports, from main</h1>\n<p>And this branch’s change.</p>');
  await post(`/f/${wid}/d/borrowers/sessions/${session.id}/messages`, { message: 'Resolved' });
  await until(() => readEntries(workDir, session.id).some(e => e.type === 'note' && /That finishes bringing main in: every clash is resolved\./.test(e.text)));
  assert.equal(git(worktree, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'the merge is committed');
  assert.match(git(worktree, 'log', '-1', '--format=%s'), /^Update from main \(merged by Prelude; the clashes resolved by the agent\)$/);
  assert.match((await (await get(`/f/${fid}`)).text()), new RegExp(`action="/f/${fid}/branches/${wid}/merge"`), 'the branch can be finished again');
});

test('with a remote, finishing pushes the branch after asking, and a merge on the server is tidied up here', async () => {
  const remote = canonical(mkdtempSync(join(tmpdir(), 'prelude-remote-')));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'main');

  const asked = await post(`/f/${fid}/branches/${wid}/publish`, { back: `/f/${fid}` });
  assert.equal(asked.status, 200);
  const question = await asked.text();
  assert.match(question, /Push Borrowers\?/);
  assert.match(question, new RegExp(`pushes <code>prelude/borrowers</code> to <code>${remote.replace(/\\/g, '\\\\')}</code>`));
  assert.equal(git(remote, 'branch', '--list', 'prelude/borrowers'), '', 'nothing pushed before the person says yes');

  const pushed = await post(`/f/${fid}/branches/${wid}/publish`, { back: `/f/${fid}`, confirm: 'yes' });
  assert.equal(pushed.status, 200);
  assert.match(await pushed.text(), /Pushed <code>prelude\/borrowers<\/code>\.[\s\S]*Open the pull request on your Git server/);
  assert.match(git(remote, 'branch', '--list', 'prelude/borrowers'), /prelude\/borrowers/);

  // The pull request is merged on the server (here, by hand, in a clone).
  const clone = canonical(mkdtempSync(join(tmpdir(), 'prelude-clone-')));
  git(clone, 'clone', '-q', remote, '.');
  git(clone, 'merge', '-q', '--no-ff', '-m', 'Merge pull request', 'origin/prelude/borrowers');
  git(clone, 'push', '-q', 'origin', 'main');

  const after = await (await get(`/f/${fid}`)).text();
  assert.match(after, /Merged lately[\s\S]*<code>prelude\/borrowers<\/code> was merged into main/);
  assert.equal(existsSync(worktree), false, 'its worktree is gone');
  assert.equal(git(repo, 'branch', '--list', 'prelude/borrowers'), '', 'and its branch');
});

test('a build agent writes the app, but not the design it builds from', () => {
  const args = permissionArgs('prelude/borrowers', [], 'build');
  const allowed = args[args.indexOf('--allowedTools') + 1];
  const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
  assert.equal(allowed, 'Edit(**),Write(**)');
  for (const kept of ['prelude/borrowers/views/**', 'prelude/borrowers/states/**', 'prelude/borrowers/snapshots/**', 'prelude/borrowers/sessions/**', '.git/**']) {
    assert.ok(denied.includes(`Edit(${kept})`) && denied.includes(`Write(${kept})`), kept);
  }
  const design = permissionArgs('prelude/borrowers', [], 'design', ['prelude/tokens']);
  assert.equal(design[design.indexOf('--allowedTools') + 1], 'Edit(prelude/borrowers/**),Write(prelude/borrowers/**),Edit(prelude/tokens/**),Write(prelude/tokens/**)');
  assert.ok(design[design.indexOf('--disallowedTools') + 1].split(',').includes('Write(prelude/tokens/snapshots/**)'), 'never a shared design’s approved screens');
  const prompt = buildPrompt({ title: 'X', designPath: 'prelude/x', group: { title: 'X', routes: [], posts: [], rules: [] }, branch: 'prelude/x', stack: { ext: '.cshtml', guide: 'prelude/HOST.md' } });
  assert.match(prompt, /Read prelude\/HOST\.md/);
  assert.match(prompt, /Never change the design's views, states, approved screens/);
  assert.match(prompt, /a view at app\/views\/orders\/list\.cshtml is "@app\/app\/views\/orders\/list"/);
});

test('a design’s worktree has the folder’s host approval', () => {
  const hosts = createHosts({ home: mkdtempSync(join(tmpdir(), 'prelude-approvals-')) });
  const config = { fingerprint: 'abc' };
  hosts.approve({ id: 'parent' }, config);
  assert.equal(hosts.approved({ id: 'worktree', branch: { parentId: 'parent' } }, config), true);
  assert.equal(hosts.approved({ id: 'other' }, config), false);
});

test('the app on a branch (10.7): running with Open, stopped with Start it, or waiting for approval', () => {
  const work = running => ({ branch: 'prelude/x', check: 'passing', behind: 0, worked: true, alsoChanges: [], into: 'main', remote: false, running });
  const app = { url: 'http://localhost:5300', open: '/f/w/host/open', start: '/f/w/host/start', approved: true };
  const on = render('./_branch', { work: work({ ...app, running: true }), finish: '/f/p/branches/w', back: '/f/p' });
  assert.match(on, /The app on this branch, with its own data, is running at <code>http:\/\/localhost:5300<\/code> · <a href="\/f\/w\/host\/open" target="_blank">Open/);
  const off = render('./_branch', { work: work({ ...app, running: false }), finish: '/f/p/branches/w', back: '/f/p' });
  assert.match(off, /The app on this branch isn’t running\./);
  assert.match(off, /<form class="app-line" action="\/f\/w\/host\/start" method="post">\s*<input type="hidden" name="back" value="\/f\/p">/);
  assert.match(off, />Start it<\/button>/);
  const waiting = render('./_branch', { work: work({ ...app, running: false, approved: false }), finish: '/f/p/branches/w', back: '/f/p' });
  assert.match(waiting, /needs your approval first, in the design bar/);
  assert.doesNotMatch(waiting, /Start it/);
  const none = render('./_branch', { work: work(null), finish: '/f/p/branches/w', back: '/f/p' });
  assert.doesNotMatch(none, /The app on this branch/, 'no app built, or no design host: nothing to say');
});

test('after a build turn (10.7): what’s next, from the turn’s check', () => {
  const next = extra => render('./_entry', { entry: { type: 'next', group: 'Home', built: true, checked: true, failures: 0, differ: 0, app: null, firstPorted: false, finish: { url: '/f/p', label: 'Push and open a pull request' }, ...extra } });
  assert.match(next({ built: false }), /Home isn’t built yet\. Send the next message to carry on\./);
  assert.match(next({ failures: 2 }), /2 pages don’t render yet\. The agent is told with your next message\./);
  assert.match(next({ differ: 1 }), /1 page differs from the approved screens: look at them in the design window, and if they’re right, Approve again in the design bar\. Then\s*finish the branch on <a href="\/f\/p">the project page<\/a>: Push and open a pull request\./);
  assert.match(next({ checked: false }), /Prelude didn’t check the pages this turn/);
  assert.match(next({ app: { url: 'http://localhost:5300', running: true, open: '/f/w/host/open' } }), /running at <code>http:\/\/localhost:5300<\/code> · <a href="\/f\/w\/host\/open" target="_blank">Open/);
  assert.doesNotMatch(next({ app: { url: 'http://localhost:5300', running: false, open: '/f/w/host/open' } }), /running at/);
});
