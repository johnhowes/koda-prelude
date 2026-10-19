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
import { appendEntry, createSession, listSessions, readEntries } from '../server/sessions.js';
import { createAsked } from '../server/asked.js';
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

test('Asked lately: a conversation with no branch is kept on this computer, listed on the project page, and moves onto its branch whole', async () => {
  const asked = createAsked({ home });
  const folder = { id: fid, path: repo };
  const { fix } = asked.create(folder, { title: 'Which designs show borrowers?' });
  const dir = fix.dir;
  assert.equal(fix.id, 'fixes/which-designs-show-borrowers');
  assert.ok(!existsSync(join(repo, 'prelude', 'fixes', fix.slug)), 'not in the project (R-2qz)');
  const session = createSession(dir, { title: fix.title });
  appendEntry(dir, session.id, { type: 'user', message: 'Which designs show borrowers?' });
  appendEntry(dir, session.id, { type: 'text', text: 'Only Borrowers. Shall I look at Reports too?' });
  appendEntry(dir, session.id, { type: 'turn', ok: true });

  const page = await (await get(`/f/${fid}`)).text();
  assert.match(page, /Asked lately/);
  assert.ok(page.includes(`href="/f/${fid}/d/fixes/which-designs-show-borrowers"`), 'it opens the conversation');
  assert.match(page, /Which designs show borrowers\?<span class="pill accent">Asking you<\/span>/);
  assert.match(page, /Shall I look at Reports too\?/);

  // Fixed on a branch, its sessions go with it, and it's no longer asked (R-x8d).
  const worktree = mkdtempSync(join(tmpdir(), 'prelude-asked-'));
  const moved = asked.moveOnto(folder, fix.slug, worktree, { title: 'Borrowers on every design' });
  assert.equal(JSON.parse(readFileSync(join(moved.dir, 'fix.json'), 'utf8')).title, 'Borrowers on every design');
  assert.equal(readEntries(moved.dir, session.id).length, 3);
  assert.equal(findFix(worktree, ['fixes', fix.slug]).design.id, fix.id);
  assert.deepEqual(asked.list(folder), []);
  assert.doesNotMatch(await (await get(`/f/${fid}/work`)).text(), /Asked lately/, 'nothing to list, no card');
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

test('a conversation with no branch only reads: its agent has no tool that writes (R-h7w)', () => {
  const args = permissionArgs('prelude/fixes/rows', ['/home/asked/rows'], 'ask');
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.ok(!args.includes('--allowedTools'));
  assert.ok(args.includes('/home/asked/rows'), 'it may read its own folder, where the images are');
});

test('Ask or fix: a conversation that only reads, kept on this computer, then fixed on its own branch, its agent, a check across the designs it touched, and merged from the project page', async () => {
  const page = await (await get(`/f/${fid}`)).text();
  assert.ok(page.includes(`href="/f/${fid}/d/fixes/new" title=`), 'Ask or fix, on the project page, as a page of its own');
  const ask = await (await get(`/f/${fid}/d/fixes/new`)).text();
  assert.match(ask, /<h1>Ask or fix<\/h1>/);
  assert.match(ask, /<strong>Reading only<\/strong> · Ask about this project/);
  assert.match(ask, /A new conversation/);
  assert.doesNotMatch(ask, /Fix it on a branch…|New session|Rename/);
  assert.match(ask, /Ask how something works/);
  assert.match(ask, /placeholder="Ask about the project, or say what’s wrong and where/);
  assert.doesNotMatch(ask, /lookingAt\.include/, 'no chip: no page on show');

  const refused = await post(`/f/${fid}/d/fixes/new/sessions`, { message: '' });
  assert.equal(refused.status, 422);
  assert.match(await refused.text(), /This is required\./);

  // The first message makes the conversation, on this computer, and its agent only reads (R-h7w, R-2qz, R-m5c).
  runner.queue([{ type: 'text', text: 'The names are in capitals on the borrowers list. I’d change list.eta.' }]);
  const asked = await post(`/f/${fid}/d/fixes/new/sessions`, { message: 'Names are shouted on the borrowers list. Why?' });
  assert.equal(asked.status, 303, await asked.text());
  assert.equal(asked.headers.get('location'), `/f/${fid}/d/fixes/names-are-shouted-on-the-borrowers-list-why`);
  const keptDir = join(home, 'asked', fid, 'names-are-shouted-on-the-borrowers-list-why');
  await until(() => readEntries(keptDir, listSessions(keptDir)[0]?.id ?? 'none').some(e => e.type === 'turn'));
  const reading = runner.turns.at(-1);
  assert.equal(canonical(reading.cwd), repo);
  assert.equal(reading.mode, 'ask');
  assert.match(reading.systemPrompt, /You only read/);
  assert.ok(!existsSync(join(repo, 'prelude', 'fixes')), 'nothing written to the project');
  const { id: sid, claudeSessionId: agentSession } = listSessions(keptDir)[0];

  const conversation = await (await get(`/f/${fid}/d/fixes/names-are-shouted-on-the-borrowers-list-why`)).text();
  assert.match(conversation, /<h1>Names are shouted on the borrowers list. Why\?<\/h1>/);
  assert.match(conversation, /Fix it on a branch…/);
  assert.match(await (await get(`/f/${fid}`)).text(), /Asked lately/);

  // Renamed: the person's name from now on.
  const renamedEmpty = await post(`/f/${fid}/d/fixes/names-are-shouted-on-the-borrowers-list-why/rename`, { title: ' ' });
  assert.equal(renamedEmpty.status, 422);
  assert.equal((await post(`/f/${fid}/d/fixes/names-are-shouted-on-the-borrowers-list-why/rename`, { title: 'Shouting names' })).status, 303);
  assert.match(await (await get(`/f/${fid}/d/fixes/names-are-shouted-on-the-borrowers-list-why`)).text(), /<h1>Shouting names<\/h1>/);

  // Fix it on a branch (R-x8d): the branch is named after the fix's name, and the conversation moves onto it.
  const branchAsk = await (await get(`/f/${fid}/d/fixes/names-are-shouted-on-the-borrowers-list-why/branch`)).text();
  assert.match(branchAsk, /value="Shouting names"/);
  assert.equal((await post(`/f/${fid}/d/fixes/names-are-shouted-on-the-borrowers-list-why/branch`, { title: '' })).status, 422);
  const branched = await post(`/f/${fid}/d/fixes/names-are-shouted-on-the-borrowers-list-why/branch`, { title: 'Names are shouted' });
  assert.equal(branched.status, 303, await branched.text());
  const location = branched.headers.get('location');
  const [, wid] = location.match(/^\/f\/([0-9a-f]+)\/d\/fixes\/names-are-shouted$/);
  assert.notEqual(wid, fid);
  assert.ok(!existsSync(keptDir), 'no longer kept on this computer');
  const worktree = worktreeOf('prelude/fix-names-are-shouted');
  const fixDir = join(worktree, 'prelude', 'fixes', 'names-are-shouted');
  assert.equal(JSON.parse(readFileSync(join(fixDir, 'fix.json'), 'utf8')).title, 'Names are shouted');
  assert.ok(readEntries(fixDir, sid).some(e => e.type === 'user'), 'its sessions moved with it');
  assert.match(readEntries(fixDir, sid).at(-1).text, /^Fixing this on prelude\/fix-names-are-shouted, made from main/);
  assert.ok(git(worktree, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').includes(`prelude/fixes/names-are-shouted/sessions/${sid}/transcript.jsonl`), 'committed on the branch');
  assert.ok(!existsSync(join(repo, 'prelude', 'fixes')), 'nothing written to the checkout');
  const projectNow = await (await get(`/f/${fid}`)).text();
  assert.doesNotMatch(projectNow, /Asked lately/, 'it left Asked lately');
  assert.match(projectNow, /Names are shouted<span class="pill">Fix<\/span>/, 'for In progress');

  // The agent's own conversation is carried to the worktree, to resume there.
  assert.deepEqual(runner.carried.map(c => ({ ...c, from: canonical(c.from), to: canonical(c.to) })), [{ sessionId: agentSession, from: repo, to: worktree }]);

  // It resumes; and when it can't after all, it starts afresh, told what was said.
  // The agent's turn waits while the test makes its changes, as the agent would.
  runner.queue([{ type: 'lost' }], [{ type: 'wait' }, { type: 'text', text: 'Fixed.' }]);
  const sent = await post(`/f/${wid}/d/fixes/names-are-shouted/sessions/${sid}/messages`, { message: 'Every name on the borrowers list should be quieter.' });
  assert.equal(sent.status, 200, await sent.text());

  await until(() => runner.turns.length >= 3);
  const resumed = runner.turns.at(-2);
  assert.equal(resumed.resume, true);
  assert.equal(resumed.sessionId, agentSession, 'the same conversation, carried on');
  assert.match(resumed.prompt, /It's now fixed on prelude\/fix-names-are-shouted, and you can change the project/);
  assert.doesNotMatch(resumed.prompt, /What was said so far/);
  const turn = runner.turns.at(-1);
  assert.equal(turn.resume, false);
  assert.notEqual(turn.sessionId, agentSession);
  assert.equal(canonical(turn.cwd), worktree);
  assert.equal(turn.mode, 'fix');
  assert.deepEqual(turn.shared, []);
  assert.match(turn.systemPrompt, /You are fixing one problem in this project: "Names are shouted"/);
  assert.match(turn.systemPrompt, /on the branch prelude\/fix-names-are-shouted/);
  assert.match(turn.prompt, /What was said so far:/);
  assert.match(turn.prompt, /The person: Names are shouted on the borrowers list\. Why\?/);
  assert.match(turn.prompt, /You: The names are in capitals on the borrowers list\. I’d change list\.eta\./);
  assert.match(turn.prompt, /Every name on the borrowers list should be quieter\.$/);
  assert.equal(readEntries(fixDir, sid).filter(e => e.type === 'user').length, 2, 'the message is in the transcript once');

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
  await until(() => runner.turns.length >= 4);
  assert.match(runner.turns.at(-1).prompt, /\/reports/);
  assert.doesNotMatch(runner.turns.at(-1).prompt, /began before it had a branch/, 'told once');
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
