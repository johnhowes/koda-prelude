// A design approved once, then changed, isn't approved as it is now: it isn't
// ready to build, and Build says why (prelude/build, R-q3d; R-r6b).

import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { appendEntry, createSession } from '../server/sessions.js';
import { writeSnapshots } from '../server/snapshots.js';
import { render } from '../server/views.js';
import { changedSinceApproved, reviewOf } from '../server/workspace.js';

const later = seconds => new Date(Date.now() + seconds * 1000).toISOString();
const context = { base: '/f/p/d/d', routes: [], states: [], datasetOf: () => ({}) };

test('a design changed since it was approved: its own sessions’ check says so, a build’s doesn’t', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prelude-approved-'));
  const design = createSession(dir, { title: 'Design it' });
  const build = createSession(dir, { title: 'Build: Home', build: { group: '/home', title: 'Home' } });

  assert.equal(changedSinceApproved(dir), false, 'never approved: nothing to have changed from');
  appendEntry(dir, design.id, { at: later(-1), type: 'check', failures: [], rendered: 1, differ: ['typical/home'] });
  assert.equal(changedSinceApproved(dir), false, 'pages differ only once there are approved screens');

  writeSnapshots(dir, new Map([['typical/home', '<h1>Home</h1>']]));
  assert.equal(changedSinceApproved(dir), false, 'the check before the approval is stale');

  // A build session's check is the build's: its port differing isn't the design changing.
  appendEntry(dir, build.id, { at: later(1), type: 'check', failures: [], rendered: 1, differ: ['typical/home'] });
  assert.equal(changedSinceApproved(dir), false);
  assert.deepEqual(reviewOf(dir, context).differ, [], 'nor does the design page’s review strip show it');

  appendEntry(dir, design.id, { at: later(2), type: 'check', failures: [], rendered: 1, differ: ['typical/home'] });
  assert.equal(changedSinceApproved(dir), true);
  assert.equal(reviewOf(dir, context).differ.length, 1);

  appendEntry(dir, design.id, { at: later(3), type: 'check', failures: [], rendered: 1, differ: [] });
  assert.equal(changedSinceApproved(dir), false, 'every page matches again');
});

const buildPage = extra => ({
  id: 'd', title: 'Loan offers', folder: { id: 'p', name: 'p' }, base: '/f/p/d/d', branch: 'prelude/d',
  app: { built: true, onBranch: true, stack: '', url: '/f/p#app' },
  approved: false, building: null, writing: false, updateUrl: null, sessions: [], unchanged: [],
  groups: [{ id: 'home', key: '/home', title: 'Home', kind: 'new', url: '/f/p/d/d/build/stories/home', writing: false, changes: [], session: null, story: null }],
  ...extra,
});

test('Build says the design changed since it was approved, and offers no build until it’s approved again', () => {
  const changed = render('./_build', buildPage({ changed: true }));
  assert.match(changed, /<strong>The design changed since you approved it\.<\/strong>/);
  assert.match(changed, /<a class="btn small primary" href="\/f\/p\/d\/d">Show what changed<\/a>/);
  assert.match(changed, /<form action="\/f\/p\/d\/d\/approve" method="post">[\s\S]*Approve again<\/button>/);
  assert.doesNotMatch(changed, /Approve the design before building it|Start a build session/);

  const never = render('./_build', buildPage({}));
  assert.match(never, /Approve the design before building it\./);
  assert.doesNotMatch(never, /changed since you approved it|Start a build session/);

  assert.match(render('./_build', buildPage({ approved: true })), /Start a build session/);
});

test('the project’s Designs: changed since approved isn’t ready to build', () => {
  const html = render('./projects/_designs', {
    id: 'p', app: { status: 'built' },
    designs: [{ id: 'd', title: 'Loan offers', kind: 'design', area: null, pages: 3, approved: 0, built: 0, stage: 'designing', changedSinceApproved: true, changed: null }],
  });
  assert.match(html, /3 pages, changed since approved/);
  assert.doesNotMatch(html, /Ready to build|all approved/);
});
