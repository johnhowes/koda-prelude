import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, test } from 'node:test';

import { designPrompt, permissionArgs } from '../server/agent.js';
import { createDesign } from '../server/designs.js';
import { canonical, folderId } from '../server/folders.js';
import { createServer } from '../server/main.js';
import { createFakeRunner } from './fake-runner.js';

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const other = mkdtempSync(join(tmpdir(), 'prelude-other-'));
const runner = createFakeRunner();
let server;
let base;
const fid = folderId(repo);

before(async () => {
  createDesign(repo, { title: 'Checkout' });
  server = createServer({ home, runner });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await post('/folders', { path: repo });
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function post(path, fields) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(base + path, { method: 'POST', body, headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });
}
const get = path => fetch(base + path, { headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });

test('reads are fenced: no blanket read permission, reference folders by --add-dir', () => {
  const args = permissionArgs('prelude/x', ['C:\\Projects\\Spark']);
  const allowed = args[args.indexOf('--allowedTools') + 1].split(',');
  assert.deepEqual(allowed, ['Edit(prelude/x/**)', 'Write(prelude/x/**)'], 'nothing that would open reads up to the whole machine');
  assert.deepEqual(args.slice(args.indexOf('--add-dir'), args.indexOf('--add-dir') + 2), ['--add-dir', 'C:\\Projects\\Spark']);
  assert.ok(!permissionArgs('prelude/x').includes('--add-dir'));
});

test('the prompt names the reference folders, read-only', () => {
  const prompt = designPrompt({ title: 'X', designPath: 'prelude/x', references: [{ name: 'Spark', path: 'C:\\Projects\\Spark' }] });
  assert.match(prompt, /You may also read these folders.*Spark \(C:\\Projects\\Spark\)/);
  assert.match(prompt, /never write to them/);
  assert.doesNotMatch(designPrompt({ title: 'X', designPath: 'prelude/x' }), /You may also read/);
  // Without one, the agent sends the person to where reading is set, not to copying files.
  assert.match(designPrompt({ title: 'X', designPath: 'prelude/x' }), /ask the person to add it under "What the agent can read" on this folder's page in Prelude/);
});

test('reference folders are added on the folder page, kept on this machine, and removable', async () => {
  assert.equal((await post(`/f/${fid}/references`, { path: `"${other}"` })).status, 303);
  const stored = JSON.parse(readFileSync(join(home, 'references.json'), 'utf8'));
  assert.deepEqual(stored[fid], [canonical(other)], 'canonical, so permissions match the paths the agent uses');

  const page = await (await get(`/f/${fid}`)).text();
  assert.match(page, /What the agent can read/);
  assert.ok(page.includes(canonical(other)));

  const refusals = [
    [join(other, 'nope'), /no folder at that path/],
    [repo, /That’s the project’s own folder/],
    [other, /can already read that folder/],
  ];
  for (const [path, message] of refusals) {
    const res = await post(`/f/${fid}/references`, { path });
    assert.equal(res.status, 422);
    assert.match(await res.text(), message);
  }
});

test('a turn gets the folder’s reference folders', async () => {
  runner.turns.length = 0;
  await post(`/f/${fid}/d/checkout/sessions`, { message: 'Start from the other app’s CSS' });
  const [turn] = runner.turns;
  assert.equal(turn.references[0], canonical(other));
  assert.match(turn.references.at(-1), /@kodalang[\\/]core$/, 'a design made of views may also read Koda’s own guidance');
  assert.ok(turn.systemPrompt.includes(canonical(other)));
  const design = await (await get(`/f/${fid}/d/checkout/sessions/new`)).text();
  assert.match(design, new RegExp(`The agent reads this repository, <span title="[^"]+">${basename(other)}</span>\\. <a href="/f/${fid}#reading">Change what it can read</a>`));

  assert.equal((await post(`/f/${fid}/references/remove`, { path: canonical(other) })).status, 303);
  const page = await (await get(`/f/${fid}`)).text();
  assert.ok(!page.includes(canonical(other)));
});
