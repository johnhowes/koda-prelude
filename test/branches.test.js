// Step 9.5: a build from steps 7 and 8 (one branch per build) becomes its
// design's branch, and its sessions say they're build sessions.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createBranches, designCommitsSince, filesAt, mainBranch, textsOf } from '../server/branches.js';
import { canonical, folderId } from '../server/folders.js';
import { createSession, readSession } from '../server/sessions.js';

Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' });
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('an app build from step 8 becomes the shell’s branch, its sessions build sessions', () => {
  const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
  const repo = canonical(mkdtempSync(join(tmpdir(), 'prelude-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  mkdirSync(join(repo, 'prelude', 'apiary-shell'), { recursive: true });
  writeFileSync(join(repo, 'prelude', 'apiary-shell', 'design.json'), JSON.stringify({ title: 'Apiary Shell', kind: 'shell' }));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Designs');
  const path = join(home, 'worktrees', 'x', 'build-apiary-shell-app');
  git(repo, 'worktree', 'add', '-q', '-b', 'build/apiary-shell-app', path, 'main');
  const designDir = join(path, 'prelude', 'apiary-shell');
  const old = createSession(designDir, { title: 'Build the app.' });
  // The record step 8 kept: one entry per build.
  const id = folderId(path);
  writeFileSync(join(home, 'builds.json'), JSON.stringify({
    [id]: { id, path: canonical(path), parentId: 'p1', parentName: 'Apiary', design: 'apiary-shell', group: '@app', title: 'The app: Apiary Shell', branch: 'build/apiary-shell-app', createdAt: '2026-10-16T03:00:00.000Z' },
  }));

  const branches = createBranches({ home });
  const entry = branches.forDesign('p1', 'apiary-shell');
  assert.equal(entry.branch, 'build/apiary-shell-app', 'its branch is kept');
  assert.deepEqual(entry.building, { group: '@app', title: 'The app: Apiary Shell' });
  assert.deepEqual(readSession(designDir, old.id).build, { group: '@app', title: 'The app: Apiary Shell' }, 'its session is a build session');
  const stored = JSON.parse(readFileSync(join(home, 'builds.json'), 'utf8'))[id];
  assert.equal(stored.group, undefined, 'stored in the new shape, once');
  assert.equal(branches.folderOf(id).branch.design, 'apiary-shell');
  assert.equal(mainBranch(repo), 'main');
  const state = branches.status(entry);
  assert.equal(state.into, 'main');
  assert.equal(state.worked, false, 'nothing of its own yet');
  assert.equal(state.merged, false, 'so not taken for merged work, and kept');
});

test('a baseline’s files are read in one go, and a branch’s status follows it as it moves', () => {
  const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
  const repo = canonical(mkdtempSync(join(tmpdir(), 'prelude-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  mkdirSync(join(repo, 'prelude', 'loans', 'states'), { recursive: true });
  writeFileSync(join(repo, 'prelude', 'loans', 'design.json'), JSON.stringify({ title: 'Loans' }));
  writeFileSync(join(repo, 'prelude', 'loans', 'states', 'typical.json'), '{ "loans": [] }\n');
  writeFileSync(join(repo, 'prelude', 'loans', 'NOTES.md'), 'Notes, with “quotes” and\nlines.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Loans');
  const head = git(repo, 'rev-parse', 'HEAD');

  const files = filesAt(repo, head, 'prelude/loans/');
  assert.deepEqual([...files.keys()].sort(), ['NOTES.md', 'design.json', 'states/typical.json']);
  const texts = textsOf(repo, [...files.values(), 'f'.repeat(40)]);
  assert.equal(texts.get(files.get('NOTES.md')), 'Notes, with “quotes” and\nlines.\n', 'whole, and in UTF-8');
  assert.equal(texts.get(files.get('states/typical.json')), '{ "loans": [] }\n');
  assert.equal(texts.size, 3, 'an id git hasn’t got is left out');
  assert.deepEqual(filesAt(repo, head, 'prelude/loans/'), files, 'the same again, kept');

  const branches = createBranches({ home });
  const folder = { id: folderId(repo), path: repo, name: 'Loans' };
  const { entry } = branches.ensure({ folder, designId: 'loans', title: 'Loans' });
  assert.equal(branches.status(entry).worked, false);
  writeFileSync(join(entry.path, 'prelude', 'loans', 'NOTES.md'), 'Changed.\n');
  writeFileSync(join(entry.path, 'README.md'), 'Also this.\n');
  branches.commit(entry, 'A change');
  const moved = branches.status(entry);
  assert.equal(moved.worked, true, 'a kept answer isn’t used once the branch moves');
  assert.equal(moved.ahead, 1);
  assert.deepEqual(moved.alsoChanges, ['README.md']);
  assert.equal(moved.tip, git(repo, 'rev-parse', `refs/heads/${entry.branch}`));
  assert.equal(designCommitsSince(repo, head, moved.tip, 'loans').length, 1);
  assert.deepEqual(designCommitsSince(repo, head, moved.tip, 'loans'), designCommitsSince(repo, head, entry.branch, 'loans'), 'by id or by name, the same');
});
