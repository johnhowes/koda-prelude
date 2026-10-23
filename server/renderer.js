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
//          regions?: { <name>: { views, template, data, location } }, query? }
//   out: { id, html } or { id, error }
// The layout, when there is one, gets the rendered page as `it.body`, and each
// rendered region (an overlay presented over the page) as
// `it.regions.<name> = { html, location }`, to print inside the region it offers.
// The page (and every region) sees the request's query string as `it.$query`,
// so a search or filter form can show what was asked.

import { extname, join } from 'node:path';

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

// An ordinary property, so it survives Eta's include(), which copies a
// partial's data: a partial rendered inside the page sees the query too.
function withQuery(data, query) {
  if (data && typeof data === 'object') data.$query = query;
  return data ?? { $query: query };
}

// A view that doesn't compile: Eta's message ends with the whole compiled
// template, tens of thousands of characters of its own code, told for every
// route that renders the view. The error alone, and the view rendered, say
// more.
function viewError(error, file) {
  const message = String(error?.message ?? error);
  if (!/^Bad template syntax/.test(message)) return error;
  return new Error(`${message.replace(/\n=+\n[\s\S]*$/, '').trim()}\n(in ${file}, or a partial it includes)`);
}

function renderView({ views, template }, data) {
  try {
    return engine(views).render(template, data);
  } catch (error) {
    throw viewError(error, `${join(views, template)}${extname(template) ? '' : '.eta'}`);
  }
}

function render({ page, layout, regions = {}, query = {} }) {
  const body = renderView(page, withQuery(page.data, query));
  if (!layout) return body;
  const rendered = {};
  for (const [name, region] of Object.entries(regions)) {
    rendered[name] = { html: renderView(region, withQuery(region.data, query)), location: region.location };
  }
  return renderView(layout, { ...layout.data, body, regions: rendered });
}

process.on('message', message => {
  try {
    process.send({ id: message.id, html: render(message) });
  } catch (error) {
    process.send({ id: message.id, error: String(error?.message ?? error) });
  }
});
