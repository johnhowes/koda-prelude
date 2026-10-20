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
import { approve } from './approve.js';
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
  assert.match(shell, /A layout is the document around the page, and in a Koda app a click swaps only the main region, never the document\./, 'pages that share the chrome share a layout');
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

test('the Build page lists the pages, each with what it changes and no story until asked, with a build session to start', async () => {
  const page = await (await get(`/f/${fid}/d/borrowers/build`)).text();
  assert.match(page, /<h3 class="page-title" id="page-borrowers">Borrowers<\/h3>\s*<span class="pill">Not built yet<\/span>/);
  assert.match(page, /<h3 class="page-title" id="page-reports">Reports<\/h3>/);
  // What changes, in plain lines: no routes, and no rule that's built (R-c9r).
  assert.match(page, /<span>New page: Borrowers<\/span>/);
  assert.match(page, /<span>New: Edit borrower, in a drawer over Borrowers<\/span>/);
  assert.match(page, /<span>1 new form<\/span>/);
  assert.match(page, /<span>New rule R-k3f: Only an underwriter sees a borrower&#39;s credit score\.<\/span>/);
  assert.doesNotMatch(page, /R-z1x|\/borrowers\/:id/);
  // Design-wide rules are a page of their own, so no page repeats them.
  assert.match(page, /<h3 class="page-title" id="page-across">Across the design<\/h3>[\s\S]*<span>New rule R-q8m: /);
  // A story only when someone asks (R-w3n).
  assert.match(page, /<span class="muted">No story yet<\/span>/);
  assert.match(page, /Write every story/);
  assert.doesNotMatch(page, /Story written/);
  // A build is checked against the approved screens, so it waits for them (10.9).
  assert.match(page, /Approve the design before building it\./);
  assert.doesNotMatch(page, /Start a build session/);
  const designing = await (await get(`/f/${fid}/d/borrowers/sessions/new`)).text();
  assert.match(designing, /<p class="stage secondary"><strong>Designing<\/strong> · approve it when it’s what you want built<\/p>/, 'the header says where the design stands');
  assert.match(designing, /When the design is what you want built, approve it/);
  approve(repo);
  assert.match(await (await get(`/f/${fid}/d/borrowers/sessions/new`)).text(), /<strong>Approved<\/strong> · ready to build/);
  const approved = await (await get(`/f/${fid}/d/borrowers/build`)).text();
  assert.match(approved, /Start a build session/, 'a design with no branch yet can start one: starting makes its branch');
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
  assert.match(await (await get(location)).text(), /<strong>Building Borrowers<\/strong> · checked against the approved design/);

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
  assert.match(view, /Building <strong>Borrowers<\/strong> on <code>prelude\/borrowers<\/code>, in <a href="\/f\/[0-9a-f]+\/d\/borrowers\/sessions\/[^"]+">Build: Borrowers<\/a>\. Other pages wait until it’s built\./);
  assert.match(view, /<h3 class="page-title" id="page-borrowers">Borrowers<\/h3>\s*<span class="pill">Not built yet<\/span>\s*<span class="pill accent">Building<\/span>/);
  assert.doesNotMatch(view, /Start a build session/, 'one page at a time');
  // Its build session is easy to get back to: from its page, the sessions menu, and In progress.
  assert.ok(view.includes(`Last built in <a href="/f/${wid}/d/borrowers/sessions/${sid}">Build: Borrowers</a>`));
  assert.equal(view.match(/Last built in /g).length, 1, 'only the page that has one');
  const folderPage = await (await get(`/f/${fid}`)).text();
  assert.ok(folderPage.includes(`<a class="muted" href="/f/${wid}/d/borrowers/sessions/${sid}">Build session</a>`));

  const session = await (await get(location)).text();
  assert.match(session, /<span class="item-title">Build: Borrowers <span class="pill">Build<\/span><\/span>/);
  assert.match(session, /<div class="notice" role="note">\s*<p>This session builds <strong>Borrowers<\/strong> into the app, on this design’s branch\./, 'a notice at the top of the chat');
  // The header names the branch; its state and actions are in the About drawer.
  assert.match(session, /<span class="icon icon-push" aria-hidden="true"><\/span><code>prelude\/borrowers<\/code>/);
  const about = await (await get(`/f/${wid}/d/borrowers/about`)).text();
  assert.match(about, /Works on <code>prelude\/borrowers<\/code>, building Borrowers\./);
  assert.match(about, /Merge into main/, 'no remote: finished by merging here');
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
  assert.match(folder, /<summary>Also changes 1 file outside the design<\/summary>[\s\S]*?<code>prelude\/tokens\/system\/tokens\.css<\/code>/);
});

test('stories are written by the agent only when asked, kept with the design on its branch, and say when they’re out of date', async () => {
  assert.equal(existsSync(join(workDir, 'stories')), false, 'none until someone asks (R-w3n)');
  runner.turns.length = 0;
  runner.queue([{ type: 'wait' }]);
  const asked = await post(`/f/${wid}/d/borrowers/build/stories`, { writing: 'true' });
  assert.equal(asked.status, 303);
  assert.equal(asked.headers.get('location'), `/f/${wid}/d/borrowers/build`);
  await until(() => runner.turns.length >= 1);
  const [turn] = runner.turns;
  assert.equal(turn.mode, 'design', 'it writes in the design, not the app');
  assert.equal(turn.prompt, 'Write the story for Borrowers.');
  assert.match(turn.systemPrompt, /You are writing a story for a team's tracker, in Prelude: the page "Borrowers" of the design "Borrowers"/);
  assert.match(turn.systemPrompt, /- New rule R-k3f: Only an underwriter sees/);
  assert.match(turn.systemPrompt, /Write the story to prelude\/borrowers\/stories\/borrowers\/1-<slug>\.md/);
  assert.doesNotMatch(turn.systemPrompt, /R-z1x/, 'no built rule (R-c9r)');
  assert.doesNotMatch(turn.systemPrompt, /R-q8m/, 'nor a design-wide one: that’s Across the design’s');
  const writing = await (await get(`/f/${wid}/d/borrowers/build`)).text();
  assert.match(writing, /The agent is writing its story…/);
  assert.doesNotMatch(writing, /Write every story/, 'once is enough');

  // The agent's story (by hand), then the turn ends; the other pages' agents write nothing.
  write(worktree, 'prelude/borrowers/stories/borrowers/1-edit-a-borrower.md', '# Edit a borrower\n\nUnderwriters keep borrowers’ details right.\n\n## What changes\n\n- Edit borrower opens beside the list.\n\n## For developers\n\n- A form at `/borrowers/:id`.\n');
  runner.release();
  await until(() => runner.turns.length >= 3 && existsSync(join(workDir, 'stories', 'borrowers', 'story.json')));
  await until(async () => !/The agent is writing/.test(await (await get(`/f/${wid}/d/borrowers/build`)).text()));
  const page = await (await get(`/f/${wid}/d/borrowers/build`)).text();
  assert.match(page, /Story written today at \d\d:\d\d/);
  assert.match(page, /Open the story/);
  assert.doesNotMatch(page, /Out of date/);
  assert.match(git(worktree, 'log', '--stat', '--format=%s', '-1', '--', 'prelude/borrowers/stories'), /a story, written by the agent[\s\S]*stories\/borrowers\/1-edit-a-borrower\.md/, 'committed to its branch (R-u6t)');
  const pages = await (await fetch(`${base}/f/${wid}/d/borrowers/build/pages`, { headers: { 'x-koda-fragment': '1', referer: `${base}/f/${wid}/d/borrowers/build` } })).text();
  assert.match(pages, /^<div class="stack gap-3">/, 'the pages alone, for the region that reloads on story-written');

  // The design changes after it: out of date (R-b5k).
  write(worktree, 'prelude/borrowers/views/borrowers/_edit.eta', '<form><input name="name" value="<%= it.name %>"><input name="email" value="<%= it.email %>"></form>');
  assert.match(await (await get(`/f/${wid}/d/borrowers/build`)).text(), /<span class="pill warn">Out of date<\/span>/);
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
  // Built, and the strip says the check matched (10.9), rather than offering approval.
  const builtPage = await (await get(`/f/${wid}/d/borrowers/sessions/${buildSession.id}`)).text();
  assert.match(builtPage, /<strong>Built<\/strong> · merge into main/);
  assert.match(builtPage, /<strong>All \d+ pages match<\/strong> the approved design\./);
  assert.doesNotMatch(builtPage, /Approve these screens/);
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
  const refused = await post(`/f/${fid}/branches/${wid}/merge`, {});
  assert.equal(refused.status, 409);
  const page = await refused.text();
  assert.match(page, /<code>prelude\/borrowers<\/code>[\s\S]*?<div class="notice danger" role="alert"><p>git couldn’t merge prelude\/borrowers into main, so nothing changed: [^<]*app\/views\/reports\.eta[^<]*<\/p><\/div>\s*<div class="cluster actions">/);
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
  const clashed = () => post(`/f/${fid}/branches/${wid}/update`, {});

  // Abandoned: the branch is as it was.
  assert.equal((await clashed()).status, 303);
  assert.match(readFileSync(join(worktree, 'app', 'views', 'reports.eta'), 'utf8'), /^<<<<<<< /m, 'left with git’s markers');
  const folder = await (await get(`/f/${fid}`)).text();
  assert.match(folder, /<strong>main is half brought in\.<\/strong>\s*<p>This file clashes: <code>app\/views\/reports\.eta<\/code>\./);
  assert.match(folder, new RegExp(`action="/f/${fid}/branches/${wid}/abandon"`));
  assert.doesNotMatch(folder, new RegExp(`action="/f/${fid}/branches/${wid}/merge"`), 'no merging into main meanwhile');
  const refused = await post(`/f/${fid}/branches/${wid}/merge`, {});
  assert.equal(refused.status, 409);
  assert.equal((await post(`/f/${fid}/branches/${wid}/abandon`, {})).status, 303);
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

  // Asked first, in the modal over the page (R-k4n): by its link, or a post that didn't say yes.
  const link = await (await get(`/f/${fid}`)).text();
  assert.ok(link.includes(`href="/f/${fid}/branches/${wid}/publish" ko-target="modal?"`));
  const opened = await (await get(`/f/${fid}/branches/${wid}/publish`)).text();
  assert.match(opened, new RegExp(`id="modal" ko-region ko-focus="region" tabindex="-1" ko-location="/f/${fid}/branches/${wid}/publish">`));
  const asked = await post(`/f/${fid}/branches/${wid}/publish`, {});
  assert.equal(asked.status, 200);
  const question = await asked.text();
  assert.match(question, /Push Borrowers\?/);
  assert.match(question, /pushes <code>prelude\/borrowers<\/code> to <code>origin<\/code>, where others can see it/);
  assert.equal(git(remote, 'branch', '--list', 'prelude/borrowers'), '', 'nothing pushed before the person says yes');

  const pushed = await post(`/f/${fid}/branches/${wid}/publish`, { confirm: 'yes' });
  assert.equal(pushed.status, 200);
  const said = await pushed.text();
  assert.match(said, /<div id="notice" ko-region ko-focus="none" aria-live="polite" ko-location="[^"]+">\s*<p role="status">Pushed <code>prelude\/borrowers<\/code> and opened its pull request\./);
  assert.match(said, /<span class="pill">Pull request open<\/span>/);
  assert.match(git(remote, 'branch', '--list', 'prelude/borrowers'), /prelude\/borrowers/);

  // The pull request is merged on the server (here, by hand, in a clone).
  const clone = canonical(mkdtempSync(join(tmpdir(), 'prelude-clone-')));
  git(clone, 'clone', '-q', remote, '.');
  git(clone, 'merge', '-q', '--no-ff', '-m', 'Merge pull request', 'origin/prelude/borrowers');
  git(clone, 'push', '-q', 'origin', 'main');

  // The page answers at once; the fetch runs beside it, and the tidy follows
  // (then the page's regions reload, told down the channel).
  await get(`/f/${fid}`);
  await until(() => !existsSync(worktree));
  const after = await (await get(`/f/${fid}`)).text();
  assert.match(after, /Merged lately[\s\S]*<code>prelude\/borrowers<\/code> merged into main just now\./);
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

test('the app on a branch (10.7): running with Open it, stopped with Start it, or waiting for approval', () => {
  const work = running => ({
    branch: 'prelude/x', check: 'passing', failures: 0, behind: 0, worked: true, alsoChanges: [], into: 'main', remote: null, pushed: false,
    building: null, merging: null, finishError: null, stories: [], url: '/f/w/d/x', buildUrl: '/f/w/d/x/build', finish: '/f/p/branches/w', running,
  });
  const app = { url: 'http://localhost:5300', open: '/f/w/host/open', approved: true };
  const on = render('./projects/_branch', work({ ...app, running: true }));
  assert.match(on, /The app on this branch is running at <code>http:\/\/localhost:5300<\/code> · <a href="\/f\/w\/host\/open" target="_blank">Open it/);
  const off = render('./projects/_branch', work({ ...app, running: false }));
  assert.match(off, /The app on this branch isn’t running\./);
  assert.match(off, /<form class="cluster gap-2" action="\/f\/p\/branches\/w\/start" method="post" ko-target="work">/);
  assert.match(off, />Start it<\/button>/);
  const waiting = render('./projects/_branch', work({ ...app, running: false, approved: false }));
  assert.match(waiting, /needs your approval first, on the design’s page/);
  assert.doesNotMatch(waiting, /Start it/);
  const none = render('./projects/_branch', work(null));
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
