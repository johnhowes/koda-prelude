import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { acceptProposed, architectureOf, checkAfterTurn, createArchitectureChecks, importsOf } from '../server/architecture.js';
import { createDesign } from '../server/designs.js';

const write = (root, path, text) => {
  const file = join(root, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/** A project with an architecture of three parts in two layers, and its code. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'prelude-architecture-'));
  createDesign(root, { title: 'Architecture', kind: 'architecture' });
  const at = 'prelude/architecture/architecture';
  write(root, `${at}/overview.md`, '# Demo architecture\n\nA small server.\n\n## Layers\n\n1. Server\n2. Storage\n\n## Principles\n\n- **The folder is the database.** Nothing is lost.\n');
  write(root, `${at}/parts/routes.md`, '# Routes\n\nlayer: Server\nkind: module\nshort: Every URL\nfiles: server/main.js\nuses: files\n\nEvery URL it answers.\n\n## Responsible for\n\n- Matching URLs\n');
  write(root, `${at}/parts/host.md`, '# Design host\n\nlayer: Server\nfiles: server/host.js, server/gone.js\nuses: files\n\nServes designs.\n');
  write(root, `${at}/parts/files.md`, '# Project files\n\nlayer: Storage\nfiles: server/store/**\n\nEverything under prelude/.\n');
  write(root, `${at}/decisions/D-a1b.md`, '# Older\n\nstatus: superseded\ndate: 2026-10-15\nparts: routes\n\n## Context\n\nThen.\n');
  write(root, `${at}/decisions/D-c2d.md`, '# Newer\n\nstatus: accepted\ndate: 2026-10-22\nparts: routes, host\nsupersedes: D-a1b\n\n## Decision\n\nNow **this**.\n');
  write(root, `${at}/flows/turn.md`, '# A turn\n\ndecisions: D-c2d\n\nFrom a message to its check.\n\n1. routes: The message is posted.\n2. files: It is kept.\n');
  write(root, 'server/main.js', "import { serve } from './host.js';\nimport { read } from './store/files.js';\n");
  write(root, 'server/host.js', "import { routes } from './main.js';\n");
  write(root, 'server/store/files.js', "import { join } from 'node:path';\nimport { up } from '../main.js';\n");
  write(root, 'server/stray.js', '');
  const app = { branches: { of: () => [] }, architectureChecks: createArchitectureChecks() };
  return { root, app, folder: { id: 'abc', name: 'Demo', path: root } };
}

test('a file’s imports are read from import, export … from, import() and require()', () => {
  const text = "import a from './a.js';\nimport {\n  b,\n} from \"../b\";\nexport * from './c.js';\nimport './d.css';\nconst e = await import('./e.js');\nconst f = require('f');";
  assert.deepEqual(importsOf(text).sort(), ['../b', './a.js', './c.js', './d.css', './e.js', 'f']);
});

test('the architecture is read from its files, newest decision first, with the map and what’s derived', () => {
  const { app, folder } = project();
  const a = architectureOf(app, folder);
  assert.equal(a.summary, 'A small server.');
  assert.deepEqual(a.principles, [{ title: 'The folder is the database.', why: 'Nothing is lost.' }]);
  assert.deepEqual(a.design, { title: 'Architecture', url: '/f/abc/d/architecture', path: 'prelude/architecture/architecture' });
  assert.deepEqual(a.layers.map(layer => [layer.title, layer.parts.map(part => part.id)]), [['Server', ['host', 'routes']], ['Storage', ['files']]]);
  assert.equal(a.layers[0].parts[1].summary, 'Every URL');
  assert.deepEqual(a.decisions.map(decision => [decision.id, decision.date, decision.status]), [['D-c2d', '22 Oct 2026', 'accepted'], ['D-a1b', '15 Oct 2026', 'superseded']]);
  assert.deepEqual(a.decisions[1].supersededBy, { id: 'D-c2d', title: 'Newer' });
  assert.match(a.decisions[0].decision, /<strong>this<\/strong>/);
  const files = a.parts.find(part => part.id === 'files');
  assert.deepEqual(files.usedBy.map(part => part.id), ['host', 'routes']);
  assert.deepEqual(a.parts.find(part => part.id === 'routes').responsible, ['Matching URLs']);
  assert.deepEqual(a.flows[0].steps, [{ part: { id: 'routes', title: 'Routes' }, text: 'The message is posted.' }, { part: { id: 'files', title: 'Project files' }, text: 'It is kept.' }]);
  assert.deepEqual(a.flows[0].decisions, [{ id: 'D-c2d', title: 'Newer' }]);
});

test('the check reports undeclared uses, uses of a layer above, files no part names and named files that aren’t there', () => {
  const { app, folder } = project();
  const { check, layers } = architectureOf(app, folder);
  assert.equal(check.checked, 'just now');
  assert.equal(check.files, 4);
  assert.deepEqual(check.findings.map(finding => finding.text).sort(), [
    'Design host names server/gone.js, which isn’t there.',
    'Design host uses Routes, which it doesn’t say it may.',
    'Project files uses Routes, a layer above it.',
    'Routes uses Design host, which it doesn’t say it may.',
    'server/stray.js belongs to no part.',
  ]);
  assert.equal(layers[0].parts.find(part => part.id === 'host').findings, 2);
});

test('decisions filter by ?q= and ?status= where the route says so', () => {
  const { app, folder } = project();
  assert.deepEqual(architectureOf(app, folder, { query: { status: 'accepted' }, filter: true }).decisions.map(d => d.id), ['D-c2d']);
  assert.deepEqual(architectureOf(app, folder, { query: { q: 'older' }, filter: true }).decisions.map(d => d.id), ['D-a1b']);
  assert.equal(architectureOf(app, folder, { query: { q: 'older' } }).decisions.length, 2);
});

test('a decision is proposed only on the branch that proposed it; in main it is accepted, and merging accepts it in its file (R-7tq)', () => {
  const main = project();
  const branch = project();
  const at = 'prelude/architecture/architecture/decisions';
  write(branch.root, `${at}/D-e3f.md`, '# Proposed here\n\nstatus: proposed\ndate: 2026-10-23\nparts: host\n');
  // Merged by a pull request without its status changed: in main, it's accepted.
  write(branch.root, `${at}/D-g4h.md`, '# Merged before\n\nstatus: proposed\ndate: 2026-10-21\n');
  write(main.root, `${at}/D-g4h.md`, '# Merged before\n\nstatus: proposed\ndate: 2026-10-21\n');
  const entry = { id: 'def', parentId: 'abc', path: branch.root, design: 'architecture', branch: 'prelude/architecture' };
  const app = { ...branch.app, folders: { get: id => (id === 'abc' ? main.folder : null) } };
  const onBranch = architectureOf(app, { id: 'def', name: 'Demo · prelude/architecture', path: branch.root, branch: entry });
  assert.deepEqual(onBranch.decisions.map(d => [d.id, d.status]), [['D-e3f', 'proposed'], ['D-c2d', 'accepted'], ['D-g4h', 'accepted'], ['D-a1b', 'superseded']]);
  assert.deepEqual(onBranch.decisions[0].proposedIn, { title: 'Architecture', branch: 'prelude/architecture' });
  assert.equal(onBranch.decisions[2].proposedIn, undefined);
  assert.equal(architectureOf(main.app, main.folder).decisions.find(d => d.id === 'D-g4h').status, 'accepted');
  // Agents on other branches don't see it: it's in no file but this branch's.
  assert.equal(architectureOf(main.app, main.folder).decisions.some(d => d.id === 'D-e3f'), false);

  assert.equal(acceptProposed(branch.root), 2);
  assert.match(readFileSync(join(branch.root, ...`${at}/D-e3f.md`.split('/')), 'utf8'), /^status: accepted$/m);
  assert.equal(acceptProposed(branch.root), 0);
});

test('a project with no architecture written has none to show, and a turn’s check finds nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'prelude-architecture-'));
  const app = { branches: { of: () => [] }, architectureChecks: createArchitectureChecks() };
  const folder = { id: 'abc', name: 'Demo', path: root };
  const a = architectureOf(app, folder);
  assert.equal(a.design, null);
  assert.deepEqual(a.check, { checked: 'not yet', files: 0, findings: [] });
  assert.deepEqual(checkAfterTurn(app, folder, ['server/main.js']), []);
});

test('after a turn that changes code, the findings in its files are told, and the check announced', () => {
  const { app, folder } = project();
  let announced = 0;
  const told = checkAfterTurn(app, folder, ['server/host.js', 'prelude/architecture/NOTES.md'], { announce: () => announced++ });
  assert.equal(announced, 1);
  assert.deepEqual(told.map(finding => finding.text), ['Design host uses Routes, which it doesn’t say it may.']);
  // A turn that changed only designs changed no code: nothing is checked.
  assert.deepEqual(checkAfterTurn(app, folder, ['prelude/architecture/NOTES.md'], { announce: () => announced++ }), []);
  assert.equal(announced, 1);
});
