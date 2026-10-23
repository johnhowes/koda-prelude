// The design page's model (prelude/design-workspace): one design as the
// person looks at it, in the shape its views read and its states hold. Built
// from what Prelude already has - the design's files, its sessions, the last
// check, the branch, NOTES.md and RULES.md - and prepared before rendering, as
// the app prepares all its data (times as words, the agent's words as HTML).
//
// The types below are the views' contract: every state in
// prelude/design-workspace/states/ is one of these.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PRELUDE_DIR, findShell } from './designs.js';
import { matchRoute, samplePaths } from './host.js';
import { readRules } from './rules.js';
import { listSessions, readEntries } from './sessions.js';
import { snapshotName, SNAPSHOTS_DIR } from './snapshots.js';
import { presentEntry as presentWords } from './views.js';

/**
 * @typedef {object} DesignPage  the design page, and each of its parts and overlays
 * @property {string} id
 * @property {string} title
 * @property {string|null} area
 * @property {'design'|'system'|'shell'|'fix'} kind
 * @property {Trouble[]} [troubles]  a fix's: what's wrong in the project, to start from (prelude/fix-something)
 * @property {{ id: string, name: string, parentId?: string }} folder
 * @property {{ id: string, title: string }|null} system
 * @property {{ id: string, title: string }|null} shell
 * @property {{ name: string, path: string }[]} references
 * @property {string|null} buildUrl
 * @property {{ branch: string, into: string, when: string }|null} merged
 * @property {Branch|null} branch
 * @property {SessionItem[]} sessions  the design's sessions; on a build session's page, its build sessions
 * @property {{ id: string, title: string }|null} session
 * @property {TurnState} state
 * @property {{ title: string, url: string }[]|null} [changes]  a fix's: the designs its branch changes
 * @property {Entry[]} entries       transcript entries, presented (presentEntry)
 * @property {{ id: string, pieces: Piece[], html?: string }|null} [streaming]  what the agent is writing now: its live entry's id, and the message so far
 * @property {Rule[]} rules
 * @property {{ id: string, text: string, asked: string|null }[]} questions
 * @property {{ title: string, why: string }[]} decisions
 * @property {Dictation} dictation
 * @property {{ id: string, title: string, size: string, says: string }[]} speechModels
 * @property {{ id: string, message: string, images: number }[]} queued
 * @property {Image[]} images        the image an image route shows; empty on the page
 * @property {Draft} draft
 * @property {Surface} surface
 * @property {string} [live]         the page's channel (the app's; no state has one)
 * @property {number} [shown]        the design bar's: the design's version the window's frame loaded (R-v2q)
 *
 * @typedef {object} Branch
 * @property {string} id
 * @property {string} branch
 * @property {string} into
 * @property {'passing'|'failing'|'waiting'|'unchecked'} check
 * @property {number} failures
 * @property {number} behind
 * @property {boolean} worked
 * @property {boolean} remote
 * @property {string[]} alsoChanges
 * @property {{ running: boolean, approved: boolean, url: string, open: string, start: string }|null} running
 * @property {{ from: string, unresolved: string[] }|null} merging
 * @property {string|null} error
 *
 * @typedef {{ id: string, title: string, started: string, lastLine?: string }} SessionItem
 *
 * @typedef {{ icon: string, title: string, says: string, start?: string, message?: string }} Trouble  `start` and `message` when it isn't "Find out why"
 *
 * @typedef {object} TurnState
 * @property {'idle'|'working'|'checking'|'stopping'|'busy'} kind
 * @property {string} [stopUrl]
 * @property {{ says: string, path: string }|null} [step]
 * @property {string} [startedAt]   ISO
 * @property {string} [since]       how long, as words ("6:40")
 * @property {number} [waiting]     messages waiting for the turn to end
 *
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} text
 * @property {'proposed'|'built'|'retired'} status
 * @property {{ page: string, title: string, state: string|null, stateTitle: string|null }|null} shownOn
 * @property {string} [retired]     why
 *
 * @typedef {{ status: 'none'|'downloading'|'ready', model?: string, progress?: number, switchingTo?: string|null, error?: string }} Dictation
 * @typedef {{ id: string, base: string, name: string, url: string, sent: string|null }} Image
 * @typedef {{ base: string, message?: string, attachments: { id: string, name: string, url: string }[] }} Draft
 *
 * @typedef {object} Surface
 * @property {'inline'|'window'} view
 * @property {string} size
 * @property {string} client
 * @property {{ width: number, height: number }} [custom]
 * @property {string} origin        where the page on show is served (+ current)
 * @property {{ start: string, approved: boolean, approve: string }|null} host
 * @property {boolean} popped
 * @property {string|null} notice
 * @property {string} [reset]       a state's file changed under the forms' changes: said once
 * @property {{ id: string, title: string, ported?: boolean }[]} screens
 * @property {string|null} current
 * @property {{ id: string, title: string, file: string }[]} states
 * @property {string|null} state
 * @property {boolean} changed
 * @property {{ name: string, title: string }[]} events
 * @property {number} approved
 * @property {{ failures: PageNamed[], differ: PageNamed[] }} review
 * @property {{ id: string, title: string, says?: string, width?: number, height?: number }[]} sizes
 * @property {{ id: string, title: string, says: string, attributes?: object }[]} clients
 * @property {number} [version]     the design's version: the frame loads it, and the bar says when the frame is behind it
 * @property {boolean} [screensOnly] a design of plain screens/*.html, not views
 *
 * @typedef {{ path: string, title: string, state: string|null, stateTitle: string|null, error?: string }} PageNamed
 *
 * @typedef {object} Entry         one transcript entry, by its type, presented
 * @property {number|string} [id]
 * @property {'user'|'text'|'tool'|'tool-result'|'parts'|'check'|'note'|'turn'} type
 * @property {string} [message]    the person's
 * @property {string} [lookingAt]
 * @property {{ id: string, name: string, url: string }[]} [images]
 * @property {string} [html]       the agent's words, whole
 * @property {Piece[]} [pieces]    the agent's words and visuals, in the order written (R-6jw)
 * @property {string} [name]       a tool's
 * @property {string} [summary]
 * @property {string} [text]
 * @property {boolean|string|null} [error]   a tool's failed; a turn's, why
 * @property {number} [files]     parts: how many of the app's files the turn changed
 * @property {VisualMap} [map]     parts: the map of them (R-c1y)
 * @property {boolean} [failed]   a note's
 * @property {number} [rendered]   a check's, with what it found
 * @property {PageNamed[]} [failures]
 * @property {PageNamed[]} [differ]
 * @property {string[]} [warnings]
 * @property {string[]} [ahead]
 * @property {{ title: string, url: string }[]} [designs]   a fix's check: the designs it rendered
 * @property {{ title: string, url: string, count: number }[]} [differDesigns]
 * @property {boolean} [ok]        a turn's end
 * @property {boolean} [stopped]
 *
 * @typedef {object} Piece         a piece of an agent's message (_message.eta)
 * @property {'text'|'flow'|'map'|'drawing'|'unread'} kind
 * @property {string} [html]       text
 * @property {VisualFlow} [flow]
 * @property {VisualMap} [map]
 * @property {'flow'|'map'} [of]   drawing: what it's drawing (R-w5g)
 * @property {string} [tag]        unread: the block as written, and why it wasn't drawn (R-x2a, R-f7c)
 * @property {string} [code]
 * @property {string} [why]
 *
 * @typedef {object} VisualFlow    a flow (_visual-flow.eta)
 * @property {string} [title]
 * @property {number} lanes
 * @property {boolean} many
 * @property {{ title: string, url: string, series: number }[]} parts
 * @property {{ lane: number, series: number, part: { title: string, url: string }, html: string }[]} steps
 *
 * @typedef {object} VisualMap     a map of the parts (_visual-map.eta, R-k9u)
 * @property {string} label
 * @property {'named'|'touched'} [mark]
 * @property {number} count
 * @property {{ title: string, parts: { id: string, title: string, url: string, summary: string, marked?: boolean, note?: string, outside?: boolean }[] }[]} layers
 */

// --- times, as the page says them -------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const dayDiff = (date, now) => Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
const clock = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** When a session started: "Today, 09:12", "Yesterday, 15:30", "15 Oct, 11:04". */
export function startedWords(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const days = dayDiff(date, now);
  return `${days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${date.getDate()} ${MONTHS[date.getMonth()]}`}, ${clock(date)}`;
}

/** When something was asked or sent: "today at 09:41", "yesterday at 15:52", "15 Oct". */
export function whenWords(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const days = dayDiff(date, now);
  return days === 0 ? `today at ${clock(date)}` : days === 1 ? `yesterday at ${clock(date)}` : `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** How long, as a clock: "6:40", "1:02:05". */
export function sinceWords(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// --- sizes and clients (R-h9x) ----------------------------------------------

export const FIT = { id: 'fit', title: 'Fit the panel', says: 'As wide and tall as the panel' };
export const BROWSER = { id: 'browser', title: 'Browser', says: 'As a browser shows it', attributes: {} };

/**
 * What every design in the project offers to look at its pages with: Fit the
 * panel first, then the sizes the app shell declares (its clients.json), and
 * the clients it declares, the browser if none. The same for every design.
 */
export function sizesAndClients(folderPath) {
  const shell = findShell(folderPath);
  let declared = {};
  if (shell) {
    try { declared = JSON.parse(readFileSync(join(folderPath, PRELUDE_DIR, ...shell.id.split('/'), 'clients.json'), 'utf8')) ?? {}; } catch { /* none declared */ }
  }
  const pixels = value => Number.isInteger(value) && value >= 200 && value <= 4000;
  const sizes = (Array.isArray(declared.sizes) ? declared.sizes : [])
    .filter(size => size && typeof size.id === 'string' && size.id !== 'fit' && size.id !== 'custom' && typeof size.title === 'string' && pixels(size.width) && pixels(size.height))
    .map(({ id, title, width, height }) => ({ id, title, width, height }));
  const clients = (Array.isArray(declared.clients) ? declared.clients : [])
    .filter(client => client && typeof client.id === 'string' && typeof client.title === 'string')
    .map(({ id, title, says, attributes }) => ({ id, title, says: typeof says === 'string' ? says : '', attributes: attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {} }));
  return { sizes: [FIT, ...sizes], clients: clients.length ? clients : [BROWSER] };
}

/** A custom size's side, when it's one (200 to 4000 pixels, R-e5n); else null. */
export function pixels(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 200 && n <= 4000 ? n : null;
}

// --- NOTES.md: open questions and decisions ---------------------------------

/** Markdown's emphasis, code and links, as plain words. */
const plain = text => String(text)
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/`([^`]*)`/g, '$1')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1$2')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * NOTES.md's "Open questions" and "Decisions": the bullets of each section,
 * with the line each starts on. [{ line, text }] each, text as written.
 */
export function parseNotes(markdown) {
  const found = { questions: [], decisions: [] };
  let section = null;
  let current = null;
  String(markdown).split(/\r?\n/).forEach((raw, index) => {
    const heading = raw.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const name = heading[1].trim().toLowerCase();
      section = name.startsWith('open question') ? 'questions' : name.startsWith('decision') ? 'decisions' : null;
      current = null;
      return;
    }
    if (!section) return;
    const bullet = raw.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      current = { line: index + 1, text: bullet[1].trim() };
      found[section].push(current);
    } else if (current && /^\s+\S/.test(raw)) {
      current.text += ` ${raw.trim()}`;
    } else if (raw.trim()) {
      current = null;   // a paragraph between bullets belongs to none of them
    }
  });
  return found;
}

/** When each line of a file was committed (git blame): Map(line -> Date). Empty outside git. */
function blameTimes(folderPath, file) {
  const times = new Map();
  let out;
  try {
    out = execFileSync('git', ['-c', 'core.fsmonitor=false', 'blame', '--line-porcelain', '--', file], { cwd: folderPath, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  } catch { return times; }
  let line = null;
  for (const text of out.split('\n')) {
    const header = text.match(/^[0-9a-f]{40} \d+ (\d+)/);
    if (header) { line = Number(header[1]); continue; }
    const time = text.match(/^author-time (\d+)/);
    if (time && line) times.set(line, new Date(Number(time[1]) * 1000));
  }
  return times;
}

/**
 * The design's open questions and its decisions so far, from NOTES.md. A
 * question's date is that of the commit that added its bullet; NOTES.md stays
 * as it is. A decision's bold lead is its title.
 */
export function notesOf(folderPath, designDir, designId, now = new Date()) {
  let markdown;
  try { markdown = readFileSync(join(designDir, 'NOTES.md'), 'utf8'); } catch { return { questions: [], decisions: [] }; }
  const { questions, decisions } = parseNotes(markdown);
  const times = questions.length ? blameTimes(folderPath, `${PRELUDE_DIR}/${designId}/NOTES.md`) : new Map();
  return {
    questions: questions.map(question => {
      const text = plain(question.text);
      const asked = times.get(question.line);
      return { id: `q-${createHash('sha1').update(text).digest('hex').slice(0, 6)}`, text, asked: asked ? whenWords(asked, now) : null };
    }),
    decisions: decisions.map(decision => {
      const lead = decision.text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      return lead
        ? { title: plain(lead[1]).replace(/[.:]$/, ''), why: plain(lead[2]).replace(/^[:.–-]\s*/, '') }
        : { title: plain(decision.text), why: '' };
    }),
  };
}

// --- RULES.md (R-j8w) -------------------------------------------------------

/** A state named in RULES.md or by the check ("typical", "Typical", "01-typical.json"). */
export function findState(states, name) {
  if (!name) return null;
  const wanted = String(name).toLowerCase();
  return states.find(state => [state.id, state.title, state.file, state.file.replace(/\.json$/i, '')].some(known => known.toLowerCase() === wanted)) ?? null;
}

/**
 * The design's rules, as the Rules drawer lists them: each with whether it's
 * built, and where it's shown - a page of the design, with sample ids from the
 * state named (as the page menu fills them), and that state.
 *   datasetOf(state) is the state's data.
 */
export function rulesOf(designDir, { routes, states, datasetOf }) {
  return readRules(designDir).map(rule => {
    const place = rule.retired ? null : rule.shownOn[0] ?? null;
    let shownOn = null;
    if (place) {
      const state = findState(states, place.state);
      const route = routes.find(candidate => candidate.pattern === place.route);
      const sample = route && samplePaths([route], datasetOf(state ?? states[0] ?? null))[0];
      shownOn = { page: sample?.path ?? place.route, title: route?.title ?? place.route, state: state?.id ?? null, stateTitle: state?.title ?? null };
    }
    return {
      id: rule.id,
      text: rule.text,
      status: rule.retired ? 'retired' : rule.proposed ? 'proposed' : 'built',
      shownOn,
      ...(rule.retired ? { retired: rule.note ?? '' } : {}),
    };
  });
}

// --- the check's findings ---------------------------------------------------

/** A page the check named, as the page can show it: its path, title and state. */
function namedPage({ path, stateName, error, url }, { routes, states }) {
  const clean = String(path).replace(/\s+\(alone\)$/, '');
  const state = findState(states, stateName);
  const route = matchRoute(routes, clean)?.route;
  // `url`: a page of another design, as a fix's check names it (step 11).
  return { path: clean, title: route?.title ?? clean, state: state?.id ?? null, stateTitle: state?.title ?? stateName ?? null, ...(error !== undefined ? { error } : {}), ...(url ? { url } : {}) };
}

/**
 * A page that differs, from its snapshot's name ("typical/offers_compare"):
 * the path is found again among the state's pages.
 */
function differPage(name, { routes, states, datasetOf }) {
  if (name && typeof name === 'object') return name;
  const [stateId, slug] = String(name).split('/');
  const state = findState(states, stateId);
  const sample = state && samplePaths(routes, datasetOf(state)).find(candidate => snapshotName(candidate.path) === slug);
  // A refused form's render is kept as "POST_<path>".
  const refused = String(slug ?? '').match(/^POST_(.*)$/);
  const path = sample?.path ?? (refused ? `POST /${refused[1].replace(/_/g, '/')}` : `/${String(slug ?? '').replace(/_/g, '/')}`);
  return { path, title: sample?.route.title ?? path, state: state?.id ?? stateId ?? null, stateTitle: state?.title ?? stateId ?? null };
}

/** A check entry's failures and differences as pages, each with what Show needs. */
export function presentCheck(entry, context) {
  return {
    ...entry,
    failures: (entry.failures ?? []).map(failure => namedPage({ path: failure.path, stateName: failure.state, error: failure.error, url: failure.url }, context)),
    differ: (entry.differ ?? []).map(name => differPage(name, context)),
  };
}

/** When the design's screens were last approved (ms), or 0. */
function approvedAt(designDir) {
  try { return statSync(join(designDir, SNAPSHOTS_DIR)).mtimeMs; } catch { return 0; }
}

/**
 * The last check of the design in its own sessions. A build session's check
 * is the build's (prelude/build): what differs there is the app's port, not
 * the design.
 */
function lastCheck(designDir) {
  let last = null;
  for (const session of listSessions(designDir)) {
    if (session.build) continue;
    for (const entry of readEntries(designDir, session.id)) {
      if (entry.type === 'check' && (!last || entry.at > last.at)) last = entry;
    }
  }
  return last;
}

/**
 * Whether the design was approved and has changed since: its last check,
 * after the approval, found pages that differ from the approved screens.
 * Such a design isn't approved as it is now, so it isn't ready to build
 * until it's approved again.
 */
export function changedSinceApproved(designDir) {
  const at = approvedAt(designDir);
  const last = at ? lastCheck(designDir) : null;
  return Boolean(last && Date.parse(last.at) >= at && last.differ?.length);
}

/**
 * What the last check of the design found, in its own sessions, as the
 * review strip shows it: pages that don't render, and pages that differ from
 * the approved screens - until they're approved again.
 */
export function reviewOf(designDir, context) {
  const last = lastCheck(designDir);
  if (!last) return { failures: [], differ: [], rendered: 0 };
  const check = presentCheck(last, context);
  const stale = Date.parse(last.at) < approvedAt(designDir);
  // rendered: how many pages the check compared with the approved screens,
  // for "all match" (10.9); none when it ran before the last approval.
  return { failures: check.failures, differ: stale ? [] : check.differ, rendered: stale ? 0 : last.rendered ?? 0 };
}

// --- transcript entries -----------------------------------------------------

/**
 * An entry ready for _entry.eta: the agent's words as their pieces (words
 * and visuals), the person's message with its images' addresses, a check's
 * pages with their states, and the parts a turn changed as a map.
 *   context: { base, routes, states, datasetOf, architecture? }
 * `architecture()`, if given, is what visuals are drawn with: the session's
 * branch's parts as they stand now (visualsArchitecture, architecture.js).
 */
export function presentEntry(entry, context) {
  if (entry.type === 'user') {
    return {
      ...entry,
      message: entry.text ?? '',
      images: (entry.images ?? []).map(image => ({ id: image.id, name: image.name, url: `${context.base}/images/${image.id}/file` })),
    };
  }
  if (entry.type === 'check') return presentCheck(entry, context);
  return presentWords(entry, { architecture: context.architecture?.() ?? null });
}

/** A session's last line from the agent, for "Carry on from…": plain words, one sentence or so. */
export function lastLineOf(entries) {
  const text = entries.findLast(entry => entry.type === 'text' && String(entry.text ?? '').trim())?.text;
  if (!text) return null;
  const paragraph = String(text).trim().split(/\n\s*\n/).filter(part => part.trim()).at(-1);
  const line = plain(paragraph.replace(/^#+\s*|^[-*]\s+/gm, ''));
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

/** A tool's use as the status line says it: "Editing compare.eta", the whole path kept. */
export function stepOf(name, summary) {
  const path = String(summary ?? '');
  const file = path.split('/').pop();
  const verb = {
    Read: 'Reading', Write: 'Writing', Edit: 'Editing', MultiEdit: 'Editing', NotebookEdit: 'Editing',
    Grep: 'Searching for', Glob: 'Looking for', Bash: 'Running', WebFetch: 'Reading', WebSearch: 'Searching the web for',
  }[name];
  if (!verb) return { says: `Using ${name}`, path };
  if (name === 'Bash') return { says: 'Running a command', path };
  return { says: `${verb} ${name === 'Grep' || name === 'Glob' ? path.split(' in ')[0] : file}`.trim(), path };
}
