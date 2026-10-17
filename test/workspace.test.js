import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createDesignState } from '../server/design-state.js';
import { createDictation } from '../server/dictation.js';
import { createDrafts, imageType } from '../server/drafts.js';
import { parseNotes, pixels, sinceWords, sizesAndClients, startedWords, stepOf, whenWords } from '../server/workspace.js';

const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('timed out');
};

test('times are said as the page says them', () => {
  const now = new Date(2026, 9, 17, 14, 0);
  assert.equal(startedWords(new Date(2026, 9, 17, 9, 12), now), 'Today, 09:12');
  assert.equal(startedWords(new Date(2026, 9, 16, 15, 30), now), 'Yesterday, 15:30');
  assert.equal(startedWords(new Date(2026, 9, 15, 11, 4), now), '15 Oct, 11:04');
  assert.equal(whenWords(new Date(2026, 9, 17, 9, 41), now), 'today at 09:41');
  assert.equal(whenWords(new Date(2026, 9, 15, 9, 41), now), '15 Oct');
  assert.equal(sinceWords(400000), '6:40');
  assert.equal(stepOf('Edit', 'src/views/offers/compare.eta').says, 'Editing compare.eta');
  assert.equal(stepOf('Edit', 'src/views/offers/compare.eta').path, 'src/views/offers/compare.eta');
});

test('NOTES.md: open questions and decisions are its bullets', () => {
  const notes = parseNotes([
    '# X - notes',
    '',
    '## Decisions',
    '',
    '- **Lowest APR first** (the person, 15 Oct): the cheapest',
    '  offer first.',
    '- No lead here.',
    '',
    '## Open questions',
    '',
    '- Can a borrower compare `three` offers?',
    '',
    '- Should an expired offer',
    '  stay?',
    '',
    '## Something else',
    '- not a question',
  ].join('\n'));
  assert.deepEqual(notes.questions.map(q => [q.line, q.text]), [[11, 'Can a borrower compare `three` offers?'], [13, 'Should an expired offer stay?']]);
  assert.deepEqual(notes.decisions.map(d => d.text), ['**Lowest APR first** (the person, 15 Oct): the cheapest offer first.', 'No lead here.']);
});

test('sizes and clients are the shell’s, Fit the panel first (R-h9x); a custom size is 200 to 4000 (R-e5n)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'prelude-sizes-'));
  assert.deepEqual(sizesAndClients(repo).sizes.map(s => s.id), ['fit'], 'no shell: Fit alone');
  assert.deepEqual(sizesAndClients(repo).clients.map(c => c.id), ['browser']);
  mkdirSync(join(repo, 'prelude', 'shell'), { recursive: true });
  writeFileSync(join(repo, 'prelude', 'shell', 'design.json'), JSON.stringify({ title: 'Shell', kind: 'shell' }));
  writeFileSync(join(repo, 'prelude', 'shell', 'clients.json'), JSON.stringify({
    sizes: [{ id: 'phone', title: 'Phone', width: 390, height: 844 }, { id: 'huge', title: 'Huge', width: 9000, height: 9000 }],
    clients: [{ id: 'browser', title: 'Browser', says: 'As a browser shows it', attributes: {} }, { id: 'app', title: 'Mobile app', says: 'In the app', attributes: { 'data-app': '' } }],
  }));
  const { sizes, clients } = sizesAndClients(repo);
  assert.deepEqual(sizes.map(s => s.id), ['fit', 'phone'], 'Fit first; an impossible size is left out');
  assert.deepEqual(clients[1].attributes, { 'data-app': '' });
  assert.equal(pixels('390'), 390);
  assert.equal(pixels(150), null);
  assert.equal(pixels(4001), null);
});

test('a state’s file changing drops the forms’ changes, said once (R-a6x)', () => {
  const published = [];
  const designs = createDesignState({ live: { publish: (key, message) => published.push(message) } });
  designs.setCopy('k', 'typical', { changed: true });
  designs.dropCopy('k', 'Typical’s file changed.');
  assert.equal(designs.copy('k'), null);
  assert.equal(designs.takeReset('k'), 'Typical’s file changed.');
  assert.equal(designs.takeReset('k'), null, 'once');
});

test('drafts: only images, a marked-up copy in the original’s place (R-m2s, R-u6p)', () => {
  const home = mkdtempSync(join(tmpdir(), 'prelude-drafts-'));
  const drafts = createDrafts({ home });
  const folder = { id: 'f1', path: home };
  const design = { id: 'area/design' };
  const png = Buffer.from('89504e470d0a1a0a00', 'hex');
  assert.equal(imageType(png), 'image/png');
  assert.equal(imageType(Buffer.from('hello')), null);
  assert.ok(drafts.addImage(folder, design, null, { name: 'notes.txt', bytes: Buffer.from('hello') }).error);
  const first = drafts.addImage(folder, design, null, { name: 'a.png', bytes: png }).attachment;
  const second = drafts.addImage(folder, design, null, { name: 'b.png', bytes: png }).attachment;
  const marked = drafts.addImage(folder, design, null, { name: 'a (marked up).png', bytes: png }, { replacing: first.id }).attachment;
  assert.deepEqual(drafts.read(folder, design, null).attachments.map(a => a.id), [marked.id, second.id]);
  assert.equal(drafts.find(folder, design, join(home, 'prelude', 'area', 'design'), marked.id).draft, 'new');
  drafts.setMessage(folder, design, '20261017-0912-k2pd', 'Kept');
  assert.equal(drafts.read(folder, design, '20261017-0912-k2pd').message, 'Kept');
  assert.equal(drafts.read(folder, design, null).message, '', 'each session its own (R-d3v)');
});

test('dictation: a model downloads once, telling every page; changing keeps the old until the new is in (R-f2y, R-h4u)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'prelude-dictation-'));
  const said = [];
  const gates = [];
  const fetched = [];
  // A model, as Hugging Face sends it: held open until the test lets it finish.
  const fetcher = async url => {
    fetched.push(url);
    let finish;
    gates.push(() => finish());
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(50));
        finish = () => { controller.enqueue(new Uint8Array(50)); controller.close(); };
      },
    });
    return new Response(body, { headers: { 'content-length': '100' } });
  };
  const dictation = createDictation({ home, live: { publish: (key, message) => said.push([key, message]) }, fetcher });
  assert.equal(dictation.state().status, 'none');

  dictation.choose('small');
  assert.equal(dictation.state().status, 'downloading');
  assert.match(fetched[0], /^https:\/\/huggingface\.co\/.*ggml-small\.bin$/, 'the one download');
  await until(() => gates.length === 1);
  gates[0]();
  await until(() => dictation.state().status === 'ready');
  assert.equal(dictation.state().model, 'small');
  assert.ok(said.some(([key, message]) => key === 'dictation' && message === 'dictation-changed'));
  assert.ok(existsSync(join(home, 'speech-models', 'ggml-small.bin')));

  dictation.switchTo('base.en');
  await until(() => gates.length === 2);
  assert.equal(dictation.state().status, 'ready', 'the old one still works');
  assert.equal(dictation.state().model, 'small');
  assert.equal(dictation.state().switchingTo, 'base.en');
  gates[1]();
  await until(() => dictation.state().model === 'base.en');
  assert.equal(existsSync(join(home, 'speech-models', 'ggml-small.bin')), false, 'then the old one goes');

  dictation.remove();
  assert.equal(dictation.state().status, 'none');
});
