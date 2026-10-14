// Views, and the one rule for answering in two shapes.
//
// Every page is a fragment view (`_name.eta`). A request from Koda
// (x-koda-fragment: 1) gets the fragment alone; anything else gets the layout
// with that same fragment inside the workspace region.

import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '@kodalang/core';
import { Eta } from 'eta';

/**
 * An entry ready for its view: the agent's words as HTML, rendered with Koda's
 * own markdown renderer, which escapes raw HTML and keeps only safe link
 * schemes - so whatever the agent writes can't put a script on the page.
 */
export function presentEntry(entry) {
  return entry.type === 'text' ? { ...entry, html: renderMarkdown(entry.text).html } : entry;
}

const eta = new Eta({
  views: fileURLToPath(new URL('./views', import.meta.url)),
  cache: true,
});

export function render(name, data) {
  return eta.render(name, data);
}

/** The fragment, or the whole page around it. */
export function shaped(view, data, { fragment, path, title }) {
  const body = render(`./_${view}`, data);
  if (fragment) return body;
  return render('./layout', { body, path, title });
}
