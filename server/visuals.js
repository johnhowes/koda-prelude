// Visuals: the pictures an agent draws in its messages (D-v3x). A visual is
// a fenced block tagged `prelude-<kind>-<version>`:
//
//   ```prelude-flow-1                 ```prelude-map-1
//   # Comparing two offers            offer-pages: The total over the term
//   1. offer-pages: Takes the two     pricing: Every fee in the total
//   2. offers: Loads both             offers
//   ```                               ```
//
// A flow is an optional "# title", then numbered steps "<part id>: <what it
// does>", as the architecture's flows/*.md are written (the same parser reads
// both). A map names parts, one per line, each with an optional ": " and a
// note; it's drawn on the whole map of the project's parts.
//
// Here: the registry of kinds and their versions, splitting a message on its
// top-level fences (Koda's fence rule), reading and checking a block into the
// model its partial prints (_visual-<kind>.eta), and the vocabulary's lines
// for the agent's prompts. It imports nothing: the architecture's parts and
// layers are given to it, and views renders what it returns.
//
// The architecture, as given: { project, layers: [{ title, parts: [{ id,
// title, url, summary, outside? }] }] } - `layers` empty when the project
// has none written yet.

/** A fence, as Koda's markdown opens one: ``` and a tag of [A-Za-z0-9_-], alone on its line. */
const FENCE = /^```\s*([A-Za-z0-9_-]*)\s*$/;
const CLOSE = /^```/;
const TAG = /^prelude-([a-z]+)-(\d+)$/;
const STEP = /^\s*\d+[.)]\s+([\w-]+):\s*(.*)$/;
const MAP_LINE = /^\s*([\w-]+)\s*(?::\s*(.*))?$/;
const SERIES = 5;

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = text => `<code>${escape(text)}</code>`;
const and = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** A flow's step, from one line ("1. pricing: Works out the total"): { part, text }, or null. */
export function flowStep(line) {
  const step = String(line).match(STEP);
  return step ? { part: step[1], text: step[2].trim() } : null;
}

// --- the kinds -----------------------------------------------------------

const FLOW_FORMAT = 'A flow takes an optional “# ” title, then one “1. part: what it does” per line.';
const MAP_FORMAT = 'A map takes one part per line, each with an optional “: ” and a note.';

/** prelude-flow-1: { title, steps: [{ part, text }] }, or { wrong } (why, as HTML). */
function readFlow1(lines) {
  let title = null;
  const steps = [];
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const heading = line.match(/^#\s+(.*)$/);
    if (heading && title === null && !steps.length) { title = heading[1].trim(); continue; }
    const step = flowStep(line);
    if (!step) return { wrong: `line ${i + 1}, ${code(line.trim())}, isn’t a step. ${FLOW_FORMAT}` };
    steps.push(step);
  }
  if (!steps.length) return { wrong: `it has no steps. ${FLOW_FORMAT}` };
  return { title, steps, names: steps.map(step => step.part) };
}

/** prelude-map-1: { marks: Map(id -> note) }, or { wrong }. */
function readMap1(lines) {
  const marks = new Map();
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const named = line.match(MAP_LINE);
    if (!named) return { wrong: `line ${i + 1}, ${code(line.trim())}, isn’t one part. ${MAP_FORMAT}` };
    if (!marks.has(named[1])) marks.set(named[1], named[2]?.trim() || null);
  }
  if (!marks.size) return { wrong: `it names no parts. ${MAP_FORMAT}` };
  return { marks, names: [...marks.keys()] };
}

/**
 * The kinds Prelude draws, each with a reader per version it has shipped
 * (transcripts are committed, so an old version is read for as long as one
 * might be shown), the model its partial prints, and its current version's
 * lines for the agent.
 */
const KINDS = {
  flow: {
    current: 1,
    versions: { 1: readFlow1 },
    model: (read, architecture) => flowOf(read, architecture),
    describe: [
      '```prelude-flow-1',
      '# What the flow is (optional)',
      '1. <part id>: what that part does at this step',
      '2. <part id>: ...',
      '```',
      'A flow: the steps something takes through the parts, in order, one per line, as the architecture\'s flows/ are written. A part may come back in a later step.',
    ],
  },
  map: {
    current: 1,
    versions: { 1: readMap1 },
    model: (read, architecture) => mapOf(architecture, read.marks, 'named'),
    describe: [
      '```prelude-map-1',
      '<part id>: a note on what it has to do with this (optional)',
      '<part id>',
      '```',
      'A map: the whole map of the project\'s parts, layer by layer, with the parts you name picked out, each with its note.',
    ],
  },
};

const drawn = () => Object.entries(KINDS).map(([kind, { current }]) => code(`prelude-${kind}-${current}`));

// --- models --------------------------------------------------------------

const partsOf = architecture => new Map(architecture.layers.flatMap(layer => layer.parts).map(part => [part.id, part]));

/**
 * A flow's model, for _visual-flow.eta: its parts in the order they first
 * come, one lane and one series colour each (five colours, then round
 * again); five parts or more are `many`, which stay a list at any width
 * (R-9tz). Each step's `text` is markdown, which views renders as `html`.
 */
function flowOf({ title, steps }, architecture) {
  const parts = partsOf(architecture);
  const order = [...new Set(steps.map(step => step.part))];
  const series = id => (order.indexOf(id) % SERIES) + 1;
  const ref = id => ({ title: parts.get(id).title, url: parts.get(id).url });
  return {
    ...(title ? { title } : {}),
    lanes: order.length,
    many: order.length >= 5,
    parts: order.map(id => ({ ...ref(id), series: series(id) })),
    steps: steps.map(step => ({ lane: order.indexOf(step.part) + 1, series: series(step.part), part: ref(step.part), text: step.text })),
  };
}

/**
 * A map's model, for _visual-map.eta: every part of the project, layer by
 * layer, those in `marks` (id -> note, or null) picked out (R-k9u). `mark`
 * is 'named' for the agent's map, 'touched' for Prelude's map of what a
 * turn changed: only that one says "Changed".
 */
export function mapOf(architecture, marks, mark) {
  const parts = partsOf(architecture);
  return {
    label: `${architecture.project}’s parts`,
    mark,
    count: [...marks.keys()].filter(id => parts.has(id)).length,
    layers: architecture.layers.map(layer => ({
      title: layer.title,
      parts: layer.parts.map(part => ({
        id: part.id,
        title: part.title,
        url: part.url,
        summary: part.summary,
        ...(part.outside ? { outside: true } : {}),
        ...(marks.has(part.id) ? { marked: true, ...(marks.get(part.id) ? { note: marks.get(part.id) } : {}) } : {}),
      })),
    })),
  };
}

// --- reading a message ---------------------------------------------------

/**
 * A message as the agent wrote it, split on its top-level fences, as Koda's
 * markdown reads them: [{ text }] for the words between (code blocks that
 * aren't visuals stay in them, fences and all), and { tag, code, open } for
 * each block tagged prelude-…. `open`: its closing fence hasn't come (only
 * while the agent is still writing it, or a message cut off).
 */
export function splitMessage(message) {
  const lines = String(message ?? '').replace(/\r\n?/g, '\n').split('\n');
  const pieces = [];
  let words = [];
  const flush = () => { if (words.join('\n').trim()) pieces.push({ text: words.join('\n') }); words = []; };
  for (let at = 0; at < lines.length; at++) {
    const fence = lines[at].match(FENCE);
    if (!fence) { words.push(lines[at]); continue; }
    let end = at + 1;
    while (end < lines.length && !CLOSE.test(lines[end])) end++;
    if (fence[1].startsWith('prelude-')) {
      flush();
      pieces.push({ tag: fence[1], code: lines.slice(at + 1, end).join('\n'), open: end >= lines.length });
    } else {
      words.push(...lines.slice(at, end + 1));
    }
    at = end;
  }
  flush();
  return pieces;
}

/** The kind of a block still being written, when Prelude draws it: 'flow', 'map', or null. */
export function drawingOf(tag) {
  const kind = String(tag).match(TAG)?.[1];
  return kind && Object.hasOwn(KINDS, kind) ? kind : null;
}

/**
 * A block, read and checked against the architecture as it stands:
 * { kind: 'flow', flow } or { kind: 'map', map }, ready for its partial, or
 * { kind: 'unread', tag, code, why } - shown as the agent wrote it, with why
 * (HTML, its names in <code>): a kind or version Prelude doesn't draw
 * (R-f7c), a line not in the kind's format (R-f7c), a project with no
 * architecture yet (R-m4v), or parts the architecture doesn't have (R-x2a,
 * R-0hq). The agent isn't told (R-b8s).
 */
export function readBlock({ tag, code: lines }, architecture) {
  const unread = why => ({ kind: 'unread', tag, code: lines, why });
  const [, kind, version] = String(tag).match(TAG) ?? [];
  const read = kind && Object.hasOwn(KINDS, kind) ? KINDS[kind].versions[Number(version)] : null;
  if (!read) return unread(`Prelude doesn’t know ${code(tag)}. It draws ${and(drawn())}.`);
  const result = read(String(lines).split('\n'));
  if (result.wrong) return unread(result.wrong);
  if (!architecture?.layers?.length) return unread(`${escape(architecture?.project ?? 'This project')} has no architecture yet, so there are no parts to draw it with.`);
  const parts = partsOf(architecture);
  const missing = [...new Set(result.names.filter(id => !parts.has(id)))];
  if (missing.length) {
    return unread(`${and(missing.map(code))} ${missing.length === 1 ? 'isn’t a part' : 'aren’t parts'} in ${escape(architecture.project)}’s architecture.`);
  }
  return { kind, [kind]: KINDS[kind].model(result, architecture) };
}

/** What the agent is told it may draw with: the current version of each kind. */
export function vocabulary() {
  return `You can draw in your messages, when a picture says it better than words: a flow of how something moves through the project's parts, or a map of the parts something touches. Write a fenced block, tagged as below, between your words, and the chat draws it with the project's design system. Name parts by their ids in the architecture's parts/ (the file's name), and only parts that are there.

${Object.values(KINDS).map(kind => kind.describe.join('\n')).join('\n\n')}

Keep to these formats: a block that isn't in one, or that names a part the architecture doesn't have, shows as you wrote it.`;
}
