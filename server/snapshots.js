// Approved screens (plan: step 6d).
//
// "Approve these screens" saves every page of a design, in every state, as it
// renders now: prelude/<design>/snapshots/<state>/<page>.html, committed with
// the design. From then on the check compares each render with its snapshot,
// so a view that starts rendering something else - a ported view changed in
// the app, a component that moved - fails by name, with a diff.
//
// Pages are compared as normalised HTML: one tag or text run per line, runs of
// whitespace collapsed and attributes sorted, so reformatting isn't a change.
// Snapshots are stored normalised, which also makes their git diffs readable.
// A host must render the same job the same way every time for this to hold.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SNAPSHOTS_DIR = 'snapshots';

/** The file a render is kept in: "/orders/7/edit" -> "orders_7_edit", a refused form "POST_orders_7". */
export function snapshotName(path, { post = false } = {}) {
  const slug = path.split('?')[0].split('/').filter(Boolean).map(part => part.replace(/[^A-Za-z0-9._-]+/g, '-')).join('_') || 'index';
  return post ? `POST_${slug}` : slug;
}

const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^\s/>]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+|</g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

function normaliseTag(tag) {
  if (tag.startsWith('<!') || tag.startsWith('</')) return tag.replace(/\s+/g, ' ');
  const name = tag.match(/^<([A-Za-z][^\s/>]*)/)[1].toLowerCase();
  const rest = tag.slice(name.length + 1).replace(/\/?>$/, '');
  const attributes = [];
  for (const [, key, raw] of rest.matchAll(ATTRIBUTE)) {
    const value = raw === undefined ? null : raw.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
    attributes.push(value === null ? key.toLowerCase() : `${key.toLowerCase()}="${value.replace(/"/g, '&quot;')}"`);
  }
  attributes.sort();
  return `<${[name, ...attributes].join(' ')}>`;
}

/** HTML as compared and stored: one tag or text run per line. */
export function normalise(html) {
  const lines = [];
  for (const [token] of String(html).matchAll(TOKEN)) {
    if (token.startsWith('<') && token.length > 1) lines.push(normaliseTag(token));
    else {
      const text = token.replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }
  return lines.join('\n') + '\n';
}

/** Each line of a and b, marked kept (' '), removed ('-') or added ('+'), by longest common subsequence. */
function lineDiff(a, b) {
  // Lines common to both ends cost nothing; only the middle needs the table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);
  const ops = a.slice(0, start).map(line => [' ', line]);
  if (x.length * y.length > 4_000_000) {
    ops.push(...x.map(line => ['-', line]), ...y.map(line => ['+', line]));
  } else {
    const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { ops.push([' ', x[i]]); i++; j++; }
      else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1])) ops.push(['-', x[i++]]);
      else ops.push(['+', y[j++]]);
    }
  }
  ops.push(...a.slice(a.length - end).map(line => [' ', line]));
  return ops;
}

/** The lines that differ, each change with a little context: a short diff for a person to read. */
export function diff(before, after, { context = 2, limit = 40 } = {}) {
  const ops = lineDiff(before.replace(/\n$/, '').split('\n'), after.replace(/\n$/, '').split('\n'));
  const show = new Set();
  ops.forEach(([op], index) => {
    if (op === ' ') return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) show.add(k);
  });
  const out = [];
  let previous = -1;
  for (const index of [...show].sort((p, q) => p - q)) {
    if (out.length >= limit) { out.push('…'); break; }
    if (previous >= 0 && index > previous + 1) out.push('  ⋮');
    out.push(`${ops[index][0]} ${ops[index][1]}`);
    previous = index;
  }
  return out.join('\n');
}

/** The approved snapshots: Map "<state>/<name>" -> normalised html, or null when none were approved. */
export function readSnapshots(designDir) {
  const root = join(designDir, SNAPSHOTS_DIR);
  let states;
  try { states = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()); } catch { return null; }
  const snapshots = new Map();
  for (const state of states) {
    for (const file of readdirSync(join(root, state.name))) {
      if (file.endsWith('.html')) snapshots.set(`${state.name}/${file.slice(0, -5)}`, readFileSync(join(root, state.name, file), 'utf8'));
    }
  }
  return snapshots;
}

/**
 * Compare renders (Map "<state>/<name>" -> html, or null for one that didn't
 * render) with the approved snapshots:
 * { approved, differ: [{ name, diff }] }. A page rendered but never approved,
 * or approved but no longer rendered, differs too. Nothing differs before the
 * first approval.
 */
export function compareSnapshots(designDir, renders) {
  const snapshots = readSnapshots(designDir);
  if (!snapshots) return { approved: false, differ: [] };
  const differ = [];
  for (const [name, html] of renders) {
    if (html === null) continue;   // didn't render: that's reported as a failure
    const now = normalise(html);
    if (!snapshots.has(name)) differ.push({ name, diff: 'new: not approved yet' });
    else if (snapshots.get(name) !== now) differ.push({ name, diff: diff(snapshots.get(name), now) });
  }
  for (const name of snapshots.keys()) {
    if (!renders.has(name)) differ.push({ name, diff: 'approved, but no longer rendered' });
  }
  return { approved: true, differ };
}

/** Approve: replace the design's snapshots with these renders. Returns how many. */
export function writeSnapshots(designDir, renders) {
  const root = join(designDir, SNAPSHOTS_DIR);
  rmSync(root, { recursive: true, force: true });
  let count = 0;
  for (const [name, html] of renders) {
    if (html === null) continue;
    count++;
    const [state, file] = name.split('/');
    mkdirSync(join(root, state), { recursive: true });
    writeFileSync(join(root, state, `${file}.html`), normalise(html));
  }
  return count;
}
