// A reference design host: Prelude's contract (server/hosts.js) served over
// HTTP, rendering Eta. A starting point for a host in another stack - replace
// the render() function with that stack's engine - and the host Prelude's own
// tests start through a prelude.json.
//
//   node tools/reference-host.js [port]   (or PORT, as Prelude sets it)
//
// Unlike Prelude's built-in Eta host it is not sandboxed: like any design host
// it runs a repository's views as code, which is why Prelude asks before it
// starts one.

import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';

const port = Number(process.argv[2] ?? process.env.PORT ?? 5299);
const root = process.cwd();
const DEFAULT_LAYOUT = fileURLToPath(new URL('../server/views/host', import.meta.url));

function render(views, template, data) {
  return new Eta({ views, cache: false, autoEscape: true, autoTrim: [false, 'nl'] }).render(`./${template}`, data);
}

function job(body) {
  const at = views => join(body.root ?? root, ...String(views).split('/'));
  const withQuery = data => (data && typeof data === 'object' ? Object.assign(data, { $query: body.query ?? {} }) : data);
  const page = render(at(body.page.views), body.page.template, withQuery(body.page.data));
  if (!body.layout) return page;
  const regions = {};
  for (const [name, region] of Object.entries(body.regions ?? {})) {
    regions[name] = { html: render(at(region.views), region.template, withQuery(region.data)), location: region.location };
  }
  const data = { ...body.layout.data, body: page, regions };
  return body.layout.default ? render(DEFAULT_LAYOUT, 'layout', data) : render(at(body.layout.views), body.layout.template, data);
}

createServer((req, res) => {
  if (req.url === '/__prelude/health') return res.end('ok');
  if (req.method === 'POST' && req.url === '/__prelude/render') {
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      try {
        const html = job(JSON.parse(text));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(String(error.message));
      }
    });
    return;
  }
  // The app's own static assets, from public/ in the repository.
  const file = normalize(join(root, 'public', decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  try {
    if (!file.startsWith(join(root, 'public') + sep) || !statSync(file).isFile()) throw new Error();
    res.writeHead(200, { 'content-type': extname(file) === '.css' ? 'text/css' : 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Reference design host on http://localhost:${port}`));
