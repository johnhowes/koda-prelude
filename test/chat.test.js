import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { createStreamReader, designPrompt, permissionArgs, toolSummary } from '../server/agent.js';
import { createDesign } from '../server/designs.js';
import { canonical, folderId } from '../server/folders.js';
import { createServer } from '../server/main.js';
import { readEntries, titleFrom } from '../server/sessions.js';
import { createFakeRunner } from './fake-runner.js';

const home = mkdtempSync(join(tmpdir(), 'prelude-home-'));
const repo = mkdtempSync(join(tmpdir(), 'prelude-repo-'));
const runner = createFakeRunner();
let server;
let base;

const fid = folderId(repo);
const designUrl = `/f/${fid}/d/onboarding/sign-up`;
const designDir = join(repo, 'prelude', 'onboarding', 'sign-up');

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

const get = (path, fragment = true) =>
  fetch(base + path, { headers: fragment ? { 'x-koda-fragment': '1' } : {}, redirect: 'manual' });

function post(path, fields) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(base + path, { method: 'POST', body, headers: { 'x-koda-fragment': '1' }, redirect: 'manual' });
}

const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('timed out');
};

/** Read an event stream's messages until `done(messages)` says enough. */
async function readStream(path, done) {
  const controller = new AbortController();
  const res = await fetch(base + path, { signal: controller.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const messages = () => text.split('\n\n')
    .map(block => block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n'))
    .filter(Boolean);
  try {
    while (!done(messages())) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      text += decoder.decode(value);
    }
    return messages();
  } finally {
    controller.abort();
  }
}

test('stream-json becomes plain events', () => {
  const events = [];
  const read = createStreamReader(e => events.push(e));
  read({ type: 'system', subtype: 'init' });
  read({ type: 'assistant', message: { content: [
    { type: 'text', text: 'Looking.' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x' } },
  ] } });
  read({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'denied' }] }] } });
  const result = read({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01 });

  assert.deepEqual(events.map(e => e.type), ['init', 'text', 'tool', 'tool-result']);
  assert.equal(events[3].isError, true);
  assert.deepEqual(result, { ok: true, costUsd: 0.01, error: null });
});

test('partial messages stream text; the whole message does not repeat it', () => {
  const events = [];
  const read = createStreamReader(e => events.push(e));
  read({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  read({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } });
  read({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } } });
  read({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
  read({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } });
  assert.deepEqual(events, [
    { type: 'text-start' },
    { type: 'text-delta', text: 'Hel' },
    { type: 'text-delta', text: 'lo' },
    { type: 'text', text: 'Hello' },
  ]);
});

test('the agent may write only in its design, never in its sessions', () => {
  const args = permissionArgs('prelude/onboarding/sign-up');
  const value = flag => args[args.indexOf(flag) + 1];
  assert.equal(value('--tools'), 'Read,Glob,Grep,Write,Edit');
  assert.match(value('--allowedTools'), /Edit\(prelude\/onboarding\/sign-up\/\*\*\)/);
  assert.match(value('--disallowedTools'), /Write\(prelude\/onboarding\/sign-up\/sessions\/\*\*\)/);
  assert.equal(value('--permission-mode'), 'dontAsk');
  assert.match(designPrompt({ title: 'Sign up', designPath: 'prelude/onboarding/sign-up' }), /NOTES\.md/);
});

test('tool summaries show paths relative to the folder', () => {
  assert.equal(toolSummary('Read', { file_path: 'C:\\repo\\prelude\\a\\NOTES.md' }, 'C:\\repo'), 'prelude/a/NOTES.md');
  assert.equal(toolSummary('Glob', { pattern: '**/*.html', path: 'C:\\repo\\src' }, 'C:\\repo'), '**/*.html in src');
});

test('titles come from the first line of the first message', () => {
  assert.equal(titleFrom('Design a sign-up flow\nwith email'), 'Design a sign-up flow');
  assert.ok(titleFrom('word '.repeat(30)).length <= 61);
});

test('a design with no sessions shows an empty chat', async () => {
  const html = await (await get(designUrl)).text();
  assert.match(html, /no sessions yet/);
  assert.match(html, new RegExp(`action="${designUrl}/sessions"`));
  assert.ok(!html.includes('/live?from='), 'no session channel until there is a session');
});

test('the first message starts a session; the agent runs in the folder', async () => {
  runner.turns.length = 0;
  const res = await post(`${designUrl}/sessions`, { message: 'Design a sign-up screen' });
  assert.equal(res.status, 303);
  const sessionUrl = res.headers.get('location');
  assert.match(sessionUrl, new RegExp(`^${designUrl}/sessions/\\d{8}-\\d{4}-[a-z0-9]{4}$`));
  const id = sessionUrl.split('/').at(-1);

  await until(() => readEntries(designDir, id).some(e => e.type === 'turn'));
  const [turn] = runner.turns;
  assert.equal(turn.cwd, canonical(repo), 'the long, canonical path, so path-scoped permissions match');
  assert.equal(turn.resume, false);
  assert.equal(turn.designPath, 'prelude/onboarding/sign-up');
  assert.equal(turn.prompt, 'Design a sign-up screen');

  const meta = JSON.parse(readFileSync(join(designDir, 'sessions', id, 'session.json'), 'utf8'));
  assert.equal(meta.title, 'Design a sign-up screen');
  assert.equal(meta.started, true);
  assert.deepEqual(readEntries(designDir, id).map(e => e.type), ['user', 'text', 'turn']);

  // The design page goes to its latest session while its turn is unseen...
  assert.equal((await get(designUrl)).headers.get('location'), sessionUrl);
  const html = await (await get(sessionUrl)).text();
  assert.match(html, /Design a sign-up screen/);
  assert.match(html, /ko-connect="[^"]+\/sessions\/[^/]+\/live\?from=3"/);

  // ...and, once it's been opened, is a new session (R-o4s).
  const opened = await get(designUrl);
  assert.equal(opened.status, 200);
  assert.match(await opened.text(), /A new session/);
});

test('later messages resume the conversation; events stream to the page', async () => {
  const id = readdirSync(join(designDir, 'sessions'))[0];
  const sessionUrl = `${designUrl}/sessions/${id}`;
  const from = readEntries(designDir, id).length;

  runner.turns.length = 0;
  const script = [
    { type: 'wait' },
    { type: 'tool', id: 't1', name: 'Write', input: { file_path: join(designDir, 'screens', '01-sign-up.html') } },
    { type: 'tool-result', id: 't1', isError: false, text: 'ok' },
    { type: 'text', text: 'Made 01-sign-up.html.' },
  ];
  runner.queue(script);

  const reply = await post(`${sessionUrl}/messages`, { message: 'Now the screen' });
  assert.equal(reply.status, 200);
  const composer = await reply.text();
  assert.match(composer, /id="composer"/);
  assert.match(composer, /<textarea[^>]*><\/textarea>/, 'the box comes back empty');
  assert.equal(runner.turns[0].resume, true);

  assert.match(composer, /Send when it’s done/, 'while it works, a message waits');

  // While it works, another message waits (R-z4k), and can be taken back; a
  // new session is refused.
  const busy = await post(`${sessionUrl}/messages`, { message: 'Hurry' });
  assert.equal(busy.status, 200);
  const waiting = await busy.text();
  assert.match(waiting, /<div ko-into="queued"><li class="entry user">\s*<div class="bubble">Hurry<\/div>/);
  const cancel = waiting.match(/action="([^"]+\/queued\/[^"]+\/cancel)"/)[1];
  assert.doesNotMatch(await (await post(cancel, {})).text(), /Hurry/, 'cancelled');
  assert.equal((await post(`${designUrl}/sessions`, { message: 'Parallel' })).status, 409);

  const streaming = readStream(`${sessionUrl}/live?from=${from}`, ms => ms.some(m => m.includes('Made 01-sign-up.html')) && ms.at(-1).includes('ko-into="agent-status"></div>'));
  setTimeout(() => runner.release(), 50);
  const messages = await streaming;

  assert.ok(messages.some(m => m.includes('ko-into="transcript"') && m.includes('Now the screen')), 'catches up on the user message');
  assert.ok(messages.some(m => m.includes('Working…')));
  assert.ok(messages.some(m => m.includes('prelude/onboarding/sign-up/screens/01-sign-up.html')));
  assert.ok(!messages.some(m => /ko-into="transcript"[^>]*>\s*<\/div>/.test(m)), 'never pushes an empty envelope');
});

test('words stream into a live entry, which becomes markdown when finished', async () => {
  const id = readdirSync(join(designDir, 'sessions'))[0];
  const sessionUrl = `${designUrl}/sessions/${id}`;
  runner.queue([
    { type: 'text-start' },
    { type: 'text-delta', text: 'Here is <i>**the' },
    { type: 'wait' },
    { type: 'text-delta', text: ' plan** <b>x</b>' },
    { type: 'text', text: 'Here is <i>**the plan** <b>x</b>' },
  ]);
  assert.equal((await post(`${sessionUrl}/messages`, { message: 'Plan?' })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 150));

  // A page joining mid-message gets the live entry with what has been sent so far.
  const from = readEntries(designDir, id).length;
  const streaming = readStream(`${sessionUrl}/live?from=${from}`, ms => ms.some(m => m.includes('ko-attach="replace"')));
  setTimeout(() => runner.release(), 50);
  const messages = await streaming;

  const joined = messages.find(m => m.includes('class="entry agent live"'));
  assert.ok(joined, 'the live entry');
  assert.ok(joined.includes('Here is &lt;i&gt;**the<'), 'with the text sent so far, escaped');
  const final = messages.find(m => m.includes('ko-attach="replace"'));
  assert.ok(final.includes('<strong>the plan</strong>'));
  assert.ok(final.includes('&lt;b&gt;x&lt;/b&gt;'), 'raw HTML from the agent stays text');

  // Saved once, as the finished message; the page renders it as markdown.
  await until(() => readEntries(designDir, id).at(-1)?.type === 'turn');
  assert.equal(readEntries(designDir, id).filter(e => e.text === 'Here is <i>**the plan** <b>x</b>').length, 1);
  const html = await (await get(sessionUrl)).text();
  assert.ok(html.includes('<div class="prose"><p>Here is &lt;i&gt;<strong>the plan</strong>'));
});

test('stop ends the turn; what waited goes back in the box, not to the agent', async () => {
  const id = readdirSync(join(designDir, 'sessions'))[0];
  const sessionUrl = `${designUrl}/sessions/${id}`;
  runner.queue([{ type: 'text-start' }, { type: 'text-delta', text: 'Half a' }, { type: 'wait' }, { type: 'text-delta', text: 'never said' }]);
  assert.equal((await post(`${sessionUrl}/messages`, { message: 'Long job' })).status, 200);
  assert.equal((await post(`${sessionUrl}/queue`, { message: 'And then this' })).status, 200);
  const turnsBefore = runner.turns.length;
  const stop = await post(`${sessionUrl}/stop`, {});
  assert.match(await stop.text(), /Stopping/);
  await until(() => readEntries(designDir, id).at(-1)?.type === 'turn');
  assert.equal(readEntries(designDir, id).at(-1).stopped, true);
  assert.equal(readEntries(designDir, id).at(-2).text, 'Half a', 'a message cut off by Stop is kept as far as it got');
  assert.ok(!readEntries(designDir, id).some(e => e.text?.includes('never said')));

  // R-9cn: the waiting message wasn't sent; it's in the session's draft.
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(runner.turns.length, turnsBefore);
  const page = await (await get(sessionUrl)).text();
  assert.match(page, /<textarea[^>]*>And then this<\/textarea>/);
});

test('each session keeps its own draft; images only, kept until sent', async () => {
  const id = readdirSync(join(designDir, 'sessions'))[0];
  const sessionUrl = `${designUrl}/sessions/${id}`;
  assert.equal((await post(`${sessionUrl}/draft`, { message: 'Half-written' })).status, 200);
  assert.match(await (await get(sessionUrl)).text(), /<textarea[^>]*>Half-written<\/textarea>/, 'kept after a reload (R-d3v)');
  assert.match(await (await get(`${designUrl}/sessions/new`)).text(), /<textarea[^>]*><\/textarea>/, 'another session has its own');

  // A PNG is taken; anything else isn't (R-m2s).
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
  const upload = new FormData();
  upload.append('image', new Blob([png], { type: 'image/png' }), 'sketch.png');
  upload.append('image', new Blob(['not an image'], { type: 'image/png' }), 'notes.png');
  const tray = await (await fetch(`${base}${sessionUrl}/attachments`, { method: 'POST', body: upload, headers: { 'x-koda-fragment': '1' } })).text();
  assert.equal((tray.match(/<li class="attachment">/g) ?? []).length, 1);
  const imageId = tray.match(/name="attachments" value="(img-[a-z0-9]+)"/)[1];
  const file = await fetch(`${base}${designUrl}/images/${imageId}/file`);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.match(await (await get(`${designUrl}/images/${imageId}`)).text(), /<h2 class="image-name">sketch\.png<\/h2>[\s\S]*Not sent yet/);

  // Images alone are a message (R-b6d); the agent is told where they are.
  runner.turns.length = 0;
  const sent = await post(`${sessionUrl}/messages`, { message: '', attachments: imageId });
  assert.equal(sent.status, 200);
  await until(() => runner.turns.length === 1);
  assert.match(runner.turns[0].prompt, new RegExp(`prelude/onboarding/sign-up/sessions/${id}/images/${imageId}-sketch\\.png`));
  await until(() => readEntries(designDir, id).at(-1)?.type === 'turn');
  assert.match(await (await get(`${designUrl}/images/${imageId}`)).text(), /Sent /, 'kept with the session');
  assert.match(await (await get(sessionUrl)).text(), /<textarea[^>]*><\/textarea>/, 'sending empties the draft');
});

test('what the person is looking at goes with the message, unless they turn it off', async () => {
  const id = readdirSync(join(designDir, 'sessions'))[0];
  const sessionUrl = `${designUrl}/sessions/${id}`;
  runner.turns.length = 0;
  await post(`${sessionUrl}/messages`, { message: 'Make this one shorter', 'lookingAt.include': 'true', 'lookingAt.page': '01-sign-up.html', 'lookingAt.state': '', 'lookingAt.size': 'Laptop' });
  await until(() => runner.turns.length === 1);
  assert.match(runner.turns[0].prompt, /looking at .*\(01-sign-up\.html\), shown as Laptop/);
  await until(() => readEntries(designDir, id).at(-1)?.type === 'turn');
  const told = readEntries(designDir, id).findLast(e => e.type === 'user');
  assert.match(told.lookingAt, / · Laptop$/);

  runner.turns.length = 0;
  await post(`${sessionUrl}/messages`, { message: 'Something else', 'lookingAt.include': 'false', 'lookingAt.page': '01-sign-up.html' });
  await until(() => runner.turns.length === 1);
  assert.equal(runner.turns[0].prompt, 'Something else');
  await until(() => readEntries(designDir, id).at(-1)?.type === 'turn');
});

test('messages written while the agent works go together, in order, when its turn ends', async () => {
  const id = readdirSync(join(designDir, 'sessions'))[0];
  const sessionUrl = `${designUrl}/sessions/${id}`;
  const turnsBefore = readEntries(designDir, id).filter(e => e.type === 'turn').length;
  runner.turns.length = 0;
  runner.queue([{ type: 'wait' }, { type: 'text', text: 'One.' }]);
  await post(`${sessionUrl}/messages`, { message: 'Long job' });
  await post(`${sessionUrl}/queue`, { message: 'First' });
  await post(`${sessionUrl}/messages`, { message: 'Second' });
  assert.equal(runner.turns.length, 1, 'nothing more goes while it works');
  runner.release();
  await until(() => runner.turns.length === 2);
  assert.equal(runner.turns[1].prompt, 'First\n\nSecond');
  await until(() => readEntries(designDir, id).filter(e => e.type === 'turn').length === turnsBefore + 2);
  assert.deepEqual(readEntries(designDir, id).filter(e => e.type === 'user').slice(-2).map(e => e.text), ['First', 'Second'], 'each shown as written');
});

test('a file the agent empties is deleted when its turn ends', async () => {
  const id = readdirSync(join(designDir, 'sessions'))[0];
  const sessionUrl = `${designUrl}/sessions/${id}`;
  const turnsBefore = readEntries(designDir, id).filter(e => e.type === 'turn').length;
  // As the agent names them: under the folder's canonical path, its working directory.
  const dir = join(canonical(repo), 'prelude', 'onboarding', 'sign-up');
  const gone = join(dir, '_unused.eta');
  const rewritten = join(dir, '_rewritten.eta');
  const refused = join(dir, '_refused.eta');
  const untouched = join(dir, '_empty.eta');
  // The fake runner writes nothing, so the files are as the agent would leave them.
  writeFileSync(gone, '');
  writeFileSync(rewritten, 'written again');
  writeFileSync(refused, '');
  writeFileSync(untouched, '');
  const write = (tid, file, content, isError = false) => [
    { type: 'tool', id: tid, name: 'Write', input: { file_path: file, content } },
    { type: 'tool-result', id: tid, isError, text: isError ? 'denied' : 'ok' },
  ];
  runner.turns.length = 0;
  runner.queue([
    ...write('d1', gone, ''),
    ...write('d2', rewritten, ''),
    ...write('d3', rewritten, 'written again'),
    ...write('d4', refused, '', true),
    { type: 'text', text: 'Removed the unused partial.' },
  ]);
  await post(`${sessionUrl}/messages`, { message: 'Tidy up' });
  await until(() => readEntries(designDir, id).filter(e => e.type === 'turn').length === turnsBefore + 1);

  assert.match(runner.turns[0].systemPrompt, /To delete a file, write it empty/, 'the agent is told how');
  assert.ok(!existsSync(gone), 'emptied, so deleted');
  assert.ok(existsSync(rewritten), 'written again after it was emptied');
  assert.ok(existsSync(refused), 'the write was refused');
  assert.ok(existsSync(untouched), 'an empty file the agent never emptied stays');
  for (const file of [rewritten, refused, untouched]) rmSync(file);
});

test('answering a question starts a message after what is typed, and sends nothing', async () => {
  const id = readdirSync(join(designDir, 'sessions'))[0];
  const sessionUrl = `${designUrl}/sessions/${id}`;
  await get(sessionUrl);   // the chat shows this session
  await post(`${sessionUrl}/draft`, { message: 'First, thanks.' });
  const answer = await (await post(`${designUrl}/questions/q-x/answer`, { message: 'About “Which colour?”: ' })).text();
  assert.match(answer, /<textarea[^>]*>First, thanks\.\n\nAbout “Which colour\?”: <\/textarea>/);
  assert.match(answer, /<div ko-into="drawer\?"><\/div>/, 'and the drawer closes');
});

test('a new session is listed in the switcher, newest first', async () => {
  const html = await (await get(`${designUrl}/sessions/new`)).text();
  assert.match(html, /A new session/);
  assert.match(html, /class="menu-list"/);
  assert.equal((await get(`${designUrl}/sessions/20990101-0000-zzzz`)).status, 404);
  assert.equal((await get(`/f/${fid}/d/onboarding/nope`)).status, 404);
  assert.equal((await get(`/f/${fid}/d/onboarding/sign-up/sessions/../../x`)).status, 404);
});

