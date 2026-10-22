// A project's architecture (prelude/architecture): a design of "kind":
// "architecture", one per project (R-p0j), kept as markdown files that agents
// read before they change anything (R-c2m) and that Prelude reads to show
// them on the project's Architecture pages (D-e8y). Nothing is written twice:
// the files are the one source, and what's derived (each part's "used by",
// decisions and findings, the map's layers) is prepared here.
//
// The files, in the design's architecture/ folder (the format the drafting
// agent is told: architecturePrompt in agent.js):
//
//   overview.md          # title, a summary, "## Layers" (a numbered list, top
//                        to bottom) and "## Principles" ("- **Title.** Why.")
//   parts/<id>.md        # title, then a header of "key: value" lines (layer,
//                        kind: module | process | outside, short, files: globs,
//                        uses: part ids), a summary, and "## Responsible for",
//                        "## Not its job", "## Owns" lists
//   decisions/<id>.md    # title, a header (status, date, parts, supersedes),
//                        then "## Context", "## Decision", "## Consequences"
//   flows/<id>.md        # title, a summary, numbered steps "part-id: text",
//                        and an optional "decisions:" header
//
// The check (R-4vx, R-k5e; D-r0k): after every turn that changes code, the
// code is read again - each file's imports (JavaScript and TypeScript, so
// far), each file mapped to its part by `files` - and these are reported: a
// use a part doesn't say it may make, a use of a part in a layer above, a
// code file no part names, and a named file that isn't there. A file is
// expected to belong to a part when it's under a folder a part's glob names
// (server/views/** covers server/views/, recursively), or beside a file a
// part names (server/main.js covers server/'s own files).

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { renderMarkdown } from '@kodalang/core';

import { PRELUDE_DIR, findKind, listDesigns } from './designs.js';
import { headOf } from './branches.js';
import { ago } from './words.js';
import { filterModel } from './host.js';

/**
 * @typedef {object} ProjectRef
 * @property {string} id
 * @property {string} name
 *
 * @typedef {object} PartRef
 * @property {string} id
 * @property {string} title
 *
 * @typedef {object} DecisionRef
 * @property {string} id
 * @property {string} title
 * @property {'proposed' | 'accepted' | 'superseded'} [status]
 *
 * @typedef {object} Finding       Something in the code that doesn't match the architecture.
 * @property {PartRef} [part]      the part it's about, when it has one
 * @property {string} text
 * @property {string} file         repository-relative
 * @property {string} next         what to do about it
 *
 * @typedef {object} Check         How the code compared with it, when last read.
 * @property {string} checked      "2 minutes ago", or "not yet"
 * @property {number} files        how many files were read
 * @property {Finding[]} findings
 *
 * @typedef {object} Principle
 * @property {string} title
 * @property {string} why
 *
 * @typedef {object} MapNode       A part on the map.
 * @property {string} id
 * @property {string} title
 * @property {string} summary      a few words
 * @property {boolean} [outside]   outside the project (a tool, a service)
 * @property {number} findings
 *
 * @typedef {object} Layer
 * @property {string} title
 * @property {MapNode[]} parts
 *
 * @typedef {object} Part
 * @property {string} id
 * @property {string} title
 * @property {'module' | 'process' | 'outside'} kind
 * @property {string} layer
 * @property {ProjectRef} project
 * @property {string} source       its file
 * @property {string} summary
 * @property {string[]} responsible
 * @property {string[]} not
 * @property {string[]} owns
 * @property {string[]} files      globs
 * @property {PartRef[]} uses
 * @property {PartRef[]} usedBy
 * @property {DecisionRef[]} decisions
 * @property {Omit<Finding, 'part'>[]} findings
 *
 * @typedef {object} Decision
 * @property {string} id           D- and three characters
 * @property {string} title
 * @property {'proposed' | 'accepted' | 'superseded'} status
 * @property {string} date         "22 Oct 2026"
 * @property {ProjectRef} project
 * @property {string} source
 * @property {{ title: string, branch: string }} [proposedIn]   the branch it's proposed on
 * @property {DecisionRef} [supersedes]
 * @property {DecisionRef} [supersededBy]
 * @property {PartRef[]} parts
 * @property {string} context       HTML
 * @property {string} decision      HTML
 * @property {string} consequences  HTML
 *
 * @typedef {object} Step
 * @property {PartRef} part
 * @property {string} text
 *
 * @typedef {object} Flow
 * @property {string} id
 * @property {string} title
 * @property {string} summary
 * @property {ProjectRef} project
 * @property {string} source
 * @property {Step[]} steps
 * @property {DecisionRef[]} decisions
 *
 * @typedef {object} Architecture  The Architecture pages' model.
 * @property {ProjectRef} project
 * @property {{ title: string, url: string, path: string } | null} design   null before there's one
 * @property {string} summary
 * @property {Principle[]} principles
 * @property {Layer[]} layers
 * @property {Part[]} parts
 * @property {Decision[]} decisions    newest first; as ?q= and ?status= leave them, where a route filters
 * @property {Flow[]} flows
 * @property {Check} check
 */

export const ARCHITECTURE_DIR = 'architecture';

/** How the decisions' routes filter them: by ?q= (id or title) and ?status=, as routes.json says. */
export const DECISIONS_FILTER = { list: 'decisions', search: { q: ['id', 'title'] }, match: { status: 'status' } };

const CODE = /\.(m?js|cjs|jsx|ts|tsx|mts|cts)$/;
const STATUSES = ['proposed', 'accepted', 'superseded'];
const KINDS = ['module', 'process', 'outside'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Where a folder's architecture is: its design's, in this folder or, for a
 * project whose architecture is still on its own branch, in that branch's
 * worktree. { design, dir, path, branch } - `path` repository-relative, with
 * / - or null with none.
 */
export function findArchitecture(app, folder) {
  const here = findKind(folder.path, 'architecture');
  if (here) return { design: here, dir: join(folder.path, PRELUDE_DIR, ...here.id.split('/')), path: `${PRELUDE_DIR}/${here.id}`, branch: folder.branch ?? null };
  if (folder.branch) return null;
  for (const entry of app.branches.of(folder.id)) {
    const design = listDesigns(entry.path).find(candidate => candidate.id === entry.design && candidate.kind === 'architecture');
    if (design) return { design, dir: join(entry.path, PRELUDE_DIR, ...design.id.split('/')), path: `${PRELUDE_DIR}/${design.id}`, branch: entry };
  }
  return null;
}

/** Whether an architecture design has anything written yet: its overview. */
export const isWritten = found => Boolean(found) && existsSync(join(found.dir, ARCHITECTURE_DIR, 'overview.md'));

// --- Reading the files ---------------------------------------------------

const read = file => { try { return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n'); } catch { return null; } };
const idsIn = value => String(value ?? '').split(/[,\s]+/).map(id => id.trim()).filter(Boolean);
const markdown = text => (text.trim() ? renderMarkdown(text.trim()).html : '');
const listItems = text => text.split('\n').map(line => line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/)?.[1]?.trim()).filter(Boolean);

/**
 * One markdown file: its "# title", the "key: value" lines straight after
 * it (unless it has no `header`), the text before the first "## " section,
 * and each section by its heading (lower-case). Null if it isn't there.
 */
function readDoc(file, { header: withHeader = true } = {}) {
  const text = read(file);
  if (text === null) return null;
  const lines = text.split('\n');
  let at = 0;
  while (at < lines.length && !lines[at].trim()) at++;
  const title = lines[at]?.match(/^#\s+(.*)$/)?.[1]?.trim() ?? '';
  if (title) at++;
  while (at < lines.length && !lines[at].trim()) at++;
  const header = {};
  for (; withHeader && at < lines.length; at++) {
    const field = lines[at].match(/^([A-Za-z][\w -]*):\s*(.*)$/);
    if (!field) break;
    header[field[1].trim().toLowerCase()] = field[2].trim();
  }
  const sections = {};
  let name = '';
  const body = [];
  for (const line of lines.slice(at)) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      sections[name] = body.splice(0).join('\n').trim();
      name = heading[1].trim().toLowerCase();
    } else {
      body.push(line);
    }
  }
  sections[name] = body.join('\n').trim();
  return { title, header, intro: sections[''] ?? '', sections };
}

/** Each .md file in a folder, by its id (its name), in order. */
function readDocs(dir) {
  let names;
  try { names = readdirSync(dir).filter(name => name.endsWith('.md')).sort(); } catch { return []; }
  return names.map(name => ({ id: name.slice(0, -3), file: name, doc: readDoc(join(dir, name)) })).filter(item => item.doc);
}

/** "2026-10-22" as "22 Oct 2026"; anything else as it's written. */
function dateWords(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}` : String(value ?? '');
}

/**
 * The architecture as written, before the check: { summary, layers: [title],
 * principles, parts, decisions, flows }, with parts and decisions keyed and
 * referring to each other by id.
 */
export function readArchitecture(found, project) {
  const root = join(found.dir, ARCHITECTURE_DIR);
  const source = rel => `${found.path}/${ARCHITECTURE_DIR}/${rel}`;
  const overview = readDoc(join(root, 'overview.md'), { header: false });
  const layers = listItems(overview?.sections.layers ?? '');
  const principles = listItems(overview?.sections.principles ?? '').map(item => {
    const bold = item.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    return bold ? { title: bold[1].trim(), why: bold[2].trim() } : { title: item, why: '' };
  });

  const parts = readDocs(join(root, 'parts')).map(({ id, file, doc }) => ({
    id,
    title: doc.title || id,
    kind: KINDS.includes(doc.header.kind) ? doc.header.kind : 'module',
    layer: doc.header.layer ?? '',
    short: doc.header.short ?? '',
    project,
    source: source(`parts/${file}`),
    summary: doc.intro.replace(/\s+/g, ' '),
    responsible: listItems(doc.sections['responsible for'] ?? ''),
    not: listItems(doc.sections['not its job'] ?? ''),
    owns: listItems(doc.sections.owns ?? ''),
    files: idsIn(doc.header.files),
    uses: idsIn(doc.header.uses),
  }));

  const decisions = readDocs(join(root, 'decisions')).map(({ id, file, doc }) => ({
    id,
    title: doc.title || id,
    status: STATUSES.includes(doc.header.status) ? doc.header.status : 'proposed',
    sortDate: doc.header.date ?? '',
    date: dateWords(doc.header.date),
    project,
    source: source(`decisions/${file}`),
    supersedes: doc.header.supersedes || null,
    parts: idsIn(doc.header.parts),
    context: markdown(doc.sections.context ?? ''),
    decision: markdown(doc.sections.decision ?? ''),
    consequences: markdown(doc.sections.consequences ?? ''),
  }));

  const flows = readDocs(join(root, 'flows')).map(({ id, file, doc }) => {
    const steps = doc.intro.split('\n').map(line => line.match(/^\s*\d+[.)]\s+([\w-]+):\s*(.*)$/)).filter(Boolean);
    const summary = doc.intro.split('\n').filter(line => !/^\s*\d+[.)]\s/.test(line)).join(' ').replace(/\s+/g, ' ').trim();
    return {
      id,
      title: doc.title || id,
      summary,
      project,
      source: source(`flows/${file}`),
      steps: steps.map(step => ({ part: step[1], text: step[2].trim() })),
      decisions: idsIn(doc.header.decisions),
    };
  });

  return { summary: (overview?.intro ?? '').replace(/\s+/g, ' ').trim(), layers, principles, parts, decisions, flows };
}

// --- The check -----------------------------------------------------------

/** A glob as a regular expression: ** for any folders, * within one. */
function globRegex(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; pattern += '(?:.*/)?'; } else pattern += '.*';
    } else if (c === '*') pattern += '[^/]*';
    else if (c === '?') pattern += '[^/]';
    else pattern += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

const hasWildcard = glob => /[*?]/.test(glob);

/** The code files under a folder of the repository, recursively or not ([] for one that isn't there). */
function codeFiles(root, rel, recursive) {
  const found = [];
  const walk = (dir, at) => {
    let entries;
    try { entries = readdirSync(join(root, ...dir.split('/').filter(Boolean)), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = at ? `${at}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (recursive) walk(path, path); } else if (CODE.test(entry.name)) found.push(path);
    }
  };
  walk(rel, rel);
  return found;
}

/** What a file imports, as written: the specifiers of import, export … from, import() and require(). */
export function importsOf(text) {
  const found = new Set();
  const patterns = [
    /(?:^|[^\w$.])(?:import|export)\s+(?:type\s+)?[^'"`;]*?\sfrom\s*['"]([^'"\n]+)['"]/g,
    /(?:^|[^\w$.])import\s*['"]([^'"\n]+)['"]/g,
    /(?:^|[^\w$.])import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /(?:^|[^\w$.])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

/** A relative import, from a file, as the repository's file it names; null if it names none (a package, say). */
function resolveImport(root, from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (base.startsWith('..')) return null;
  const candidates = [base, ...['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].map(ext => `${base}${ext}`), `${base}/index.js`, `${base}/index.ts`];
  if (/\.js$/.test(base)) candidates.push(base.replace(/\.js$/, '.ts'));
  return candidates.find(candidate => { try { return statSync(join(root, ...candidate.split('/'))).isFile(); } catch { return false; } }) ?? null;
}

/**
 * Check the code at `root` against the architecture as written (readArchitecture's).
 * { files: how many were read, findings: [Finding] }.
 */
export function checkCode(root, written) {
  const parts = written.parts.filter(part => part.kind !== 'outside');
  const byId = new Map(written.parts.map(part => [part.id, part]));
  const layerOf = part => written.layers.indexOf(part.layer);
  const matchers = parts.map(part => ({ part, globs: part.files.map(globRegex) }));
  const partOf = file => matchers.find(({ globs }) => globs.some(glob => glob.test(file)))?.part ?? null;
  const ref = part => ({ id: part.id, title: part.title });

  // The files expected to belong to a part.
  const universe = new Set();
  for (const part of parts) {
    for (const glob of part.files) {
      if (hasWildcard(glob)) {
        const segments = glob.split('/');
        for (const file of codeFiles(root, segments.slice(0, segments.findIndex(hasWildcard)).join('/'), true)) universe.add(file);
      } else {
        for (const file of codeFiles(root, posix.dirname(glob) === '.' ? '' : posix.dirname(glob), false)) universe.add(file);
      }
    }
  }

  const findings = [];
  // A named file that isn't there.
  for (const part of parts) {
    for (const glob of part.files) {
      if (hasWildcard(glob) || existsSync(join(root, ...glob.split('/')))) continue;
      findings.push({ part: ref(part), text: `${part.title} names ${glob}, which isn’t there.`, file: glob, next: 'Take it out of the part’s files, or name the file that took its place.' });
    }
  }

  const files = [...universe].sort();
  for (const file of files) {
    const part = partOf(file);
    if (!part) {
      findings.push({ text: `${file} belongs to no part.`, file, next: 'Name it in a part’s files.' });
      continue;
    }
    const text = read(join(root, ...file.split('/')));
    if (text === null) continue;
    const reported = new Set();
    for (const specifier of importsOf(text)) {
      const target = resolveImport(root, file, specifier);
      const used = target && partOf(target);
      if (!used || used.id === part.id || reported.has(used.id)) continue;
      reported.add(used.id);
      const above = layerOf(used) >= 0 && layerOf(part) >= 0 && layerOf(used) < layerOf(part);
      if (above) {
        findings.push({ part: ref(part), text: `${part.title} uses ${used.title}, a layer above it.`, file, next: 'Pass it what it needs instead, or move the use into a part in a layer above, or propose a decision that changes the layers.' });
      } else if (!part.uses.includes(used.id)) {
        // A part this one may use, that may use the other, is where the use could go.
        const via = part.uses.map(id => byId.get(id)).find(other => other?.uses.includes(used.id));
        findings.push({ part: ref(part), text: `${part.title} uses ${used.title}, which it doesn’t say it may.`, file, next: `Add ${used.title} to what it may use${via ? `, or move the use into ${via.title}` : ', or move the use into a part that may'}.` });
      }
    }
  }
  return { files: files.length, findings };
}

/**
 * Each project's last check, in memory: folder id -> { head, at, files,
 * findings }. A page that finds the code moved on since (another commit)
 * reads it again.
 */
export function createArchitectureChecks() {
  const checks = new Map();
  return {
    get: id => checks.get(id) ?? null,
    set(id, check) { checks.set(id, check); return check; },
  };
}

/** Check a folder's code now, keep it as the folder's last check, and return it. */
export function runCheck(app, folder, found, written = readArchitecture(found, { id: folder.id, name: folder.name })) {
  const { files, findings } = checkCode(folder.path, written);
  return app.architectureChecks.set(folder.id, { head: headOf(folder.path), at: new Date().toISOString(), files, findings });
}

/**
 * What doesn't match in a folder's code now, from its last check (read again
 * when its commit has moved): [] with no architecture written.
 * @returns {Finding[]}
 */
export function findingsOf(app, folder) {
  const found = findArchitecture(app, folder);
  if (!isWritten(found)) return [];
  const last = app.architectureChecks.get(folder.id);
  return (last?.head && last.head === headOf(folder.path) ? last : runCheck(app, folder, found)).findings;
}

/**
 * After a turn that changed code (R-4vx): the files it changed are checked
 * against the architecture, the project's check is updated, and the pages
 * showing it are told (architecture-checked). Returns the findings in the
 * files the turn changed, for the agent's next message ([] for none, or with
 * no architecture).
 */
export function checkAfterTurn(app, folder, changed, { announce = () => {} } = {}) {
  const code = changed.filter(path => !path.startsWith(`${PRELUDE_DIR}/`));
  if (!code.length) return [];
  const found = findArchitecture(app, folder);
  if (!isWritten(found)) return [];
  const check = runCheck(app, folder, found);
  announce();
  const touched = new Set(changed);
  return check.findings.filter(finding => touched.has(finding.file));
}

/**
 * Merging a branch accepts the decisions it proposed (R-7tq): in the
 * branch's own files, before the merge, so main has them accepted. Returns
 * how many it accepted.
 */
export function acceptProposed(path) {
  const design = findKind(path, 'architecture');
  if (!design) return 0;
  const dir = join(path, PRELUDE_DIR, ...design.id.split('/'), ARCHITECTURE_DIR, 'decisions');
  let accepted = 0;
  for (const { file, doc } of readDocs(dir)) {
    if (doc.header.status !== 'proposed') continue;
    const at = join(dir, file);
    writeFileSync(at, read(at).replace(/^(status:[ \t]*)proposed[ \t]*$/im, '$1accepted'));
    accepted++;
  }
  return accepted;
}

// --- The model -----------------------------------------------------------

/**
 * The Architecture pages' model, for a folder (a project, or a branch's
 * worktree): read from its architecture design's files, with the check of
 * its code. `query` filters the decisions where the route says so (filter).
 * @returns {Architecture}
 */
export function architectureOf(app, folder, { query = {}, filter = false, now = Date.now() } = {}) {
  const project = { id: folder.id, name: folder.branch?.parentName ?? folder.name };
  const found = findArchitecture(app, folder);
  const design = found && { title: found.design.title, url: `/f/${folder.id}/d/${found.design.id}`, path: `${found.path}/${ARCHITECTURE_DIR}` };
  if (!isWritten(found)) {
    return { project, design, summary: '', principles: [], layers: [], parts: [], decisions: [], flows: [], check: { checked: 'not yet', files: 0, findings: [] }, $query: query };
  }

  const written = readArchitecture(found, project);
  let last = app.architectureChecks.get(folder.id);
  if (!last?.head || last.head !== headOf(folder.path)) last = runCheck(app, folder, found, written);

  const partsById = new Map(written.parts.map(part => [part.id, part]));
  const partRef = id => ({ id, title: partsById.get(id)?.title ?? id });
  const decisionsById = new Map(written.decisions.map(decision => [decision.id, decision]));
  const findingsOf = id => last.findings.filter(finding => finding.part?.id === id);

  // A proposed decision is accepted once it's in main (R-7tq): one merged by
  // a pull request may still say "proposed". It's still proposed only on the
  // branch that proposed it, said with the design that branch is for.
  const mainPath = found.branch && (app.folders.get(found.branch.parentId)?.path ?? null);
  const proposing = found.branch && {
    title: listDesigns(found.branch.path).find(candidate => candidate.id === found.branch.design)?.title ?? found.design.title,
    branch: found.branch.branch,
  };
  const stillProposed = decision => decision.status === 'proposed' && Boolean(proposing)
    && !(mainPath && existsSync(join(mainPath, ...decision.source.split('/'))));

  // Newest first (R-w8d); on one day, by id.
  const decisions = [...written.decisions].sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.id.localeCompare(b.id)).map(decision => {
    const supersedes = decision.supersedes && decisionsById.get(decision.supersedes);
    const supersededBy = written.decisions.find(other => other.supersedes === decision.id);
    const proposed = stillProposed(decision);
    return {
      id: decision.id,
      title: decision.title,
      status: decision.status === 'proposed' && !proposed ? 'accepted' : decision.status,
      date: decision.date,
      project,
      source: decision.source,
      ...(proposed ? { proposedIn: proposing } : {}),
      ...(decision.supersedes ? { supersedes: { id: decision.supersedes, title: supersedes?.title ?? decision.supersedes } } : {}),
      ...(supersededBy ? { supersededBy: { id: supersededBy.id, title: supersededBy.title } } : {}),
      parts: decision.parts.map(partRef),
      context: decision.context,
      decision: decision.decision,
      consequences: decision.consequences,
    };
  });

  const parts = written.parts.map(part => ({
    id: part.id,
    title: part.title,
    kind: part.kind,
    layer: part.layer,
    project,
    source: part.source,
    summary: part.summary,
    responsible: part.responsible,
    not: part.not,
    owns: part.owns,
    files: part.files,
    uses: part.uses.map(partRef),
    usedBy: written.parts.filter(other => other.uses.includes(part.id)).map(other => ({ id: other.id, title: other.title })),
    decisions: decisions.filter(decision => decision.parts.some(ref => ref.id === part.id)).map(({ id, title, status }) => ({ id, title, status })),
    findings: findingsOf(part.id).map(({ text, file, next }) => ({ text, file, next })),
  }));

  // The map: each layer in order, with the parts in it; a part in no layer
  // the overview lists comes last, in a layer of its own.
  const titles = [...written.layers, ...new Set(parts.map(part => part.layer).filter(layer => !written.layers.includes(layer)))];
  const layers = titles.map(title => ({
    title: title || 'Elsewhere',
    parts: parts.filter(part => part.layer === title).map(part => ({
      id: part.id,
      title: part.title,
      summary: partsById.get(part.id).short || part.summary,
      ...(part.kind === 'outside' ? { outside: true } : {}),
      findings: part.findings.length,
    })),
  })).filter(layer => layer.parts.length);

  const flows = written.flows.map(flow => ({
    ...flow,
    steps: flow.steps.map(step => ({ part: partRef(step.part), text: step.text })),
    decisions: flow.decisions.map(id => ({ id, title: decisionsById.get(id)?.title ?? id })),
  }));

  const model = {
    project,
    design,
    summary: written.summary,
    principles: written.principles,
    layers,
    parts,
    decisions,
    flows,
    check: { checked: ago(last.at, now), files: last.files, findings: last.findings },
  };
  return { ...(filter ? filterModel(model, DECISIONS_FILTER, query) : model), $query: query };
}
