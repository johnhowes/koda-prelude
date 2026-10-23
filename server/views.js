// Views, and the one rule for answering in two shapes.
//
// Every page is a fragment view (`_name.eta`). A request from Koda
// (x-koda-fragment: 1) gets the fragment alone; anything else gets the layout
// with that same fragment inside the workspace region.

import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '@kodalang/core';
import { Eta } from 'eta';

import { drawingOf, mapOf, readBlock, splitMessage } from './visuals.js';

/** Markdown on one line (a flow's step), without the paragraph around it. */
const inlineHtml = text => renderMarkdown(text).html.replace(/^<p>([\s\S]*)<\/p>$/, '$1');

/**
 * An agent's message as _message.eta prints it: its words and the visuals it
 * drew, in the order it wrote them (D-v3x, R-6jw). The words between are
 * rendered with Koda's own markdown renderer, which escapes raw HTML and
 * keeps only safe link schemes, so whatever the agent writes can't put a
 * script on the page; a visual is drawn only from the model visuals.js read
 * and checked against `architecture` (the session's branch's, as it stands:
 * R-x2a, R-0hq), and is otherwise shown as written, with why. `streaming`:
 * a block not yet closed is a placeholder saying what it's drawing (R-w5g).
 */
export function messagePieces(text, architecture = null, { streaming = false } = {}) {
  const pieces = splitMessage(text).flatMap(piece => {
    if (piece.text !== undefined) return [{ kind: 'text', html: renderMarkdown(piece.text).html }];
    if (piece.open && streaming) {
      const of = drawingOf(piece.tag);
      return of ? [{ kind: 'drawing', of }] : [{ kind: 'text', html: renderMarkdown(`\`\`\`${piece.tag}\n${piece.code}`).html }];
    }
    const read = readBlock(piece, architecture);
    if (read.kind === 'flow') return [{ kind: 'flow', flow: { ...read.flow, steps: read.flow.steps.map(({ text: words, ...step }) => ({ ...step, html: inlineHtml(words) })) } }];
    return [read];
  });
  return pieces.length ? pieces : [{ kind: 'text', html: '' }];
}

/**
 * The parts a turn changed (R-c1y), recorded by Prelude from the files, as
 * the map draws them: each part's files as its note, the first in full and
 * those beside it by name ("src/pricing/total.ts, total.test.ts"). Parts the
 * architecture no longer has aren't on it; with none left, or no
 * architecture, it says only how many files changed.
 */
function presentParts(entry, architecture) {
  const known = new Set((architecture?.layers ?? []).flatMap(layer => layer.parts.map(part => part.id)));
  const parts = (entry.parts ?? []).filter(part => known.has(part.id));
  const files = entry.files ?? 0;
  if (!parts.length) return { type: 'note', text: files === 1 ? 'This turn changed 1 file of the app.' : `This turn changed ${files} files of the app.` };
  const dirOf = path => path.slice(0, path.lastIndexOf('/') + 1);
  const note = paths => paths.map((path, i) => (i && dirOf(path) === dirOf(paths[0]) ? path.slice(dirOf(path).length) : path)).join(', ');
  return { ...entry, files, map: mapOf(architecture, new Map(parts.map(part => [part.id, note(part.files ?? [])])), 'touched') };
}

/**
 * An entry ready for its view: the agent's words as their pieces (and as
 * HTML, for the views that print them whole), and the parts a turn changed
 * as a map. `visuals.architecture` is what the visuals are drawn with.
 */
export function presentEntry(entry, { architecture = null } = {}) {
  if (entry.type === 'text') return { ...entry, html: renderMarkdown(entry.text).html, pieces: messagePieces(entry.text, architecture) };
  if (entry.type === 'parts') return presentParts(entry, architecture);
  return entry;
}

const eta = new Eta({
  views: fileURLToPath(new URL('./views', import.meta.url)),
  cache: true,
});

export function render(name, data) {
  return eta.render(name, data);
}

/**
 * The fragment, or the whole page around it. A view in a folder of its own
 * (home/index) is named by its path. `layout` is the layout's own data (the
 * live channel, the bar's count), `regions` what a cold load of an overlay
 * puts in its region ({ modal: { html, location } }), and `system` asks for
 * the folder's design system instead of ds/v1 (pages ported from a design).
 */
export function shaped(view, data, { fragment, path, title, layout = {}, regions = {}, system = false, bare = false }) {
  const body = render(view.includes('/') ? `./${view}` : `./_${view}`, data);
  if (fragment) return body;
  return render('./layout', { body, path, title, layout, regions, system, bare });
}
