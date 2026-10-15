// The sandboxed half of the Eta host: renders a design's views, and nothing else.
//
// Eta templates compile to JavaScript, and a design's views are written by the
// agent. Rendered inside Prelude's server they could do anything Prelude can,
// undoing the fences on what the agent may read and write. So they render
// here, in a process of their own started under Node's permission model
// (renderers.js): it may read the folder and Prelude's own files, and may not
// write, start processes or load native code. (Node's permission model
// doesn't yet cover the network; that remains a known gap.)
//
// Messages, over the IPC channel:
//   in:  { id, page: { views, template, data }, layout?: { views, template, data },
//          regions?: { <name>: { views, template, data, location } } }
//   out: { id, html } or { id, error }
// The layout, when there is one, gets the rendered page as `it.body`, and each
// rendered region (an overlay presented over the page) as
// `it.regions.<name> = { html, location }`, to print inside the region it offers.

import { Eta } from 'eta';

const engines = new Map();   // views folder -> Eta

function engine(views) {
  if (!engines.has(views)) {
    // No cache: the agent edits views constantly, and each render should see
    // the files as they are now.
    engines.set(views, new Eta({ views, cache: false, autoEscape: true, autoTrim: [false, 'nl'] }));
  }
  return engines.get(views);
}

function render({ page, layout, regions = {} }) {
  const body = engine(page.views).render(page.template, page.data ?? {});
  if (!layout) return body;
  const rendered = {};
  for (const [name, region] of Object.entries(regions)) {
    rendered[name] = { html: engine(region.views).render(region.template, region.data ?? {}), location: region.location };
  }
  return engine(layout.views).render(layout.template, { ...layout.data, body, regions: rendered });
}

process.on('message', message => {
  try {
    process.send({ id: message.id, html: render(message) });
  } catch (error) {
    process.send({ id: message.id, error: String(error?.message ?? error) });
  }
});
