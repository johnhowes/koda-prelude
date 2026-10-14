import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { designPrompt } from '../server/agent.js';
import { createDesign } from '../server/designs.js';
import { folderId } from '../server/folders.js';
import { createServer } from '../server/main.js';
import { createFakeRunner } from './fake-runner.js';

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const runner = createFakeRunner();
let server;
let base;
const fid = folderId(repo);

before(async () => {
  createDesign(repo, { title: 'Sign up', area: 'onboarding' });
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

test('before there is a system, a design is told it has none', async () => {
  const page = await (await get(`/f/${fid}`)).text();
  assert.match(page, /This is the folder’s design system/);
  runner.turns.length = 0;
  await post(`/f/${fid}/d/onboarding/sign-up/sessions`, { message: 'Hello' });
  assert.match(runner.turns[0].systemPrompt, /no design system yet/);
});

test('the folder’s design system is made from New design, and only one', async () => {
  const made = await post(`/f/${fid}/designs`, { title: 'Acme', area: '', kind: 'system' });
  assert.equal(made.status, 303);
  assert.equal(made.headers.get('location'), `/f/${fid}/d/acme`);

  const page = await (await get(`/f/${fid}`)).text();
  assert.match(page, /Acme<span class="pill">Design system<\/span>/);
  assert.doesNotMatch(page, /This is the folder’s design system/, 'no second system offered');
  assert.match(page, /Designs here use the folder’s design system/);

  const second = await post(`/f/${fid}/designs`, { title: 'Other', area: '', kind: 'system' });
  assert.equal(second.status, 422);
  assert.match(await second.text(), /already has a design system: &quot;Acme&quot;/);
});

test('a session on the system is told to keep system/ and its gallery', async () => {
  runner.turns.length = 0;
  await post(`/f/${fid}/d/acme/sessions`, { message: 'Draft it from the app’s CSS' });
  const prompt = runner.turns[0].systemPrompt;
  assert.match(prompt, /design system "Acme"/);
  assert.match(prompt, /prelude\/acme\/system/);
  assert.match(prompt, /@layer tokens, base, components, host;/);
  assert.match(prompt, /light-dark\(\)/);
  assert.match(prompt, /bring the gallery up to date/);

  const page = await (await get(`/f/${fid}/d/acme/sessions/new`)).text();
  assert.match(page, /The folder’s design system/);
});

test('every other design uses it: told where it is and how to link it', async () => {
  runner.turns.length = 0;
  await post(`/f/${fid}/d/onboarding/sign-up/sessions`, { message: 'Design the screen' });
  const prompt = runner.turns[0].systemPrompt;
  assert.match(prompt, /design system, "Acme", in prelude\/acme\/system/);
  // From prelude/onboarding/sign-up/screens/ to prelude/acme/system/
  assert.match(prompt, /\.\.\/\.\.\/\.\.\/acme\/system\/tokens\.css, \.\.\/\.\.\/\.\.\/acme\/system\/components\.css/);
  assert.doesNotMatch(prompt, /icons\.css/, 'no icons until the system has them');
  assert.match(prompt, /Don't change the design system from here/);

  const page = await (await get(`/f/${fid}/d/onboarding/sign-up/sessions/new`)).text();
  assert.match(page, new RegExp(`Uses <a href="/f/${fid}/d/acme">Acme</a>`));
});

test('the link the agent is told resolves to the system on the preview host', () => {
  const prompt = designPrompt({
    title: 'Sign up', designPath: 'prelude/onboarding/sign-up',
    system: { title: 'Acme', path: 'prelude/acme', href: '../../../acme/system', hasIcons: true },
  });
  assert.match(prompt, /icons\.css/);
  const href = '../../../acme/system/tokens.css';
  const screen = `http://preview.localhost/f/${fid}/p/onboarding/sign-up/screens/01-sign-up.html`;
  assert.equal(new URL(href, screen).pathname, `/f/${fid}/p/acme/system/tokens.css`);
});

test('a change to the system reloads the designs that use it', async () => {
  mkdirSync(join(repo, 'prelude', 'acme', 'system'), { recursive: true });
  const controller = new AbortController();
  const res = await fetch(`${base}/f/${fid}/d/onboarding/sign-up/live`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let pending = null;
  const read = async ms => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      pending ??= reader.read();
      const chunk = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), end - Date.now()))]);
      if (!chunk) break;
      pending = null;
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
  };
  await read(200);
  writeFileSync(join(repo, 'prelude', 'acme', 'system', 'tokens.css'), ':root { --accent: teal; }');
  await read(1000);
  controller.abort();
  assert.match(text, /data: design-changed:\d+/);
});
